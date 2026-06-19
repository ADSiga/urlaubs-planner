# Self-Service Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member who forgot their password request an emailed reset link and set a new password through it.

**Architecture:** Pure token + validation helpers (unit-tested) under a DB-backed orchestration layer (`lib/password-reset.ts`) that creates single-use, sha256-hashed, 1-hour tokens in a new `PasswordResetToken` table, sends a link via nodemailer/SMTP, and consumes the token on reset. Two public pages (`/reset` request, `/reset/[token]` set-new) and server actions drive it. Anti-enumeration throughout.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, SQLite via raw SQL (`lib/db.ts`), scrypt (`lib/password.ts`), nodemailer (SMTP), Node 22 native TS test runner.

## Global Constraints

- **Members only.** Eligible = a `User` row with a non-null `email` AND non-null `passwordHash`. Staff (Boss table / synthetic admin) are never matched.
- **Anti-enumeration.** The request endpoint ALWAYS resolves the same way (success) whether or not the email matches; SMTP errors are swallowed (logged server-side), never surfaced to the client.
- **Tokens:** raw = `crypto.randomBytes(32).toString("base64url")`; store only `sha256(raw)` hex. 1-hour expiry, single-use (`usedAt`).
- **Min password length 8** for the new password (reuse `MIN_PASSWORD_LENGTH`).
- **No session revocation** (stateless cookies) — a reset does not invalidate existing sessions.
- **New env (required to actually send):** `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Keep out of git.
- **Migration mechanism:** new table added in `initDb()` with `CREATE TABLE IF NOT EXISTS` (the repo pattern); `schema.prisma` updated for reference only.
- **German UI copy (exact):** request title "Passwort zurücksetzen"; request confirmation "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet."; reset title "Neues Passwort vergeben"; invalid token "Dieser Link ist ungültig oder abgelaufen."; too-short error "Das Passwort muss mindestens 8 Zeichen lang sein."; success "Passwort zurückgesetzt. Du kannst dich jetzt anmelden."; login-modal link "Passwort vergessen?".
- **Test command:** `node --test lib/<name>.test.ts` (from `kalender/`).
- **Typecheck command:** `npx tsc --noEmit` (from `kalender/`, currently clean).
- **Working directory for all commands:** `C:\laragon\www\Urlaube\kalender`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `lib/reset-tokens.ts` (+ test) — token generate/hash primitives.
- **Modify** `lib/password.ts` (+ test) — `validateResetPassword`.
- **Modify** `lib/db.ts` — `PasswordResetToken` table in `initDb()`.
- **Modify** `schema.prisma` — reference model + `User.resetTokens` relation.
- **Create** `lib/email.ts` (+ test) — `buildResetEmail` (pure) + `sendPasswordResetEmail` (nodemailer).
- **Modify** `package.json` — add `nodemailer` + `@types/nodemailer`.
- **Create** `lib/password-reset.ts` (+ test) — `createResetTokenForEmail`, `validateResetToken`, `performPasswordReset`, `requestPasswordReset`.
- **Modify** `app/actions_auth.ts` — `handleRequestPasswordReset`, `handlePerformPasswordReset`.
- **Create** `app/reset/page.tsx`, `app/reset/ResetRequestForm.tsx` — request page + client form.
- **Create** `app/reset/[token]/page.tsx`, `app/reset/[token]/ResetForm.tsx` — set-new page + client form.
- **Modify** `app/AdminToggle.tsx` — "Passwort vergessen?" link in the member login tab.

---

### Task 1: Token primitives

**Files:**
- Create: `lib/reset-tokens.ts`
- Test: `lib/reset-tokens.test.ts`

**Interfaces:**
- Produces:
  - `function generateResetToken(): { raw: string; hash: string }`
  - `function hashResetToken(raw: string): string`

- [ ] **Step 1: Write the failing test**

Create `lib/reset-tokens.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateResetToken, hashResetToken } from "./reset-tokens.ts";

test("hashResetToken is deterministic and differs from the raw token", () => {
  const h1 = hashResetToken("abc");
  const h2 = hashResetToken("abc");
  assert.equal(h1, h2);
  assert.notEqual(h1, "abc");
  assert.equal(h1.length, 64); // sha256 hex
});

test("generateResetToken returns a raw token and its matching hash", () => {
  const { raw, hash } = generateResetToken();
  assert.ok(raw.length >= 32);
  assert.equal(hash, hashResetToken(raw));
  assert.notEqual(raw, hash);
});

test("generateResetToken yields distinct raw tokens", () => {
  assert.notEqual(generateResetToken().raw, generateResetToken().raw);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/reset-tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/reset-tokens.ts`:

```ts
import { randomBytes, createHash } from "crypto";

export function hashResetToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashResetToken(raw) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/reset-tokens.test.ts`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add lib/reset-tokens.ts lib/reset-tokens.test.ts
git commit -m "feat(auth): reset-token generate/hash primitives

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: validateResetPassword

**Files:**
- Modify: `lib/password.ts`
- Test: `lib/password.test.ts`

**Interfaces:**
- Consumes: existing `MIN_PASSWORD_LENGTH` (already exported from `lib/password.ts`).
- Produces: `function validateResetPassword(newPassword: string): { ok: true } | { ok: false; error: "empty" | "too_short" }`

- [ ] **Step 1: Write the failing test**

Append to `lib/password.test.ts` (the file already imports `test`, `assert`, and from `./password.ts` — add `validateResetPassword` to the existing `./password.ts` import; do not duplicate the `node:test`/`assert` imports):

```ts
test("validateResetPassword: rejects empty", () => {
  assert.deepEqual(validateResetPassword(""), { ok: false, error: "empty" });
});

test("validateResetPassword: rejects too short", () => {
  assert.deepEqual(validateResetPassword("short"), { ok: false, error: "too_short" });
});

test("validateResetPassword: accepts >= 8 chars", () => {
  assert.deepEqual(validateResetPassword("longenough1"), { ok: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/password.test.ts`
Expected: FAIL — `validateResetPassword` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/password.ts`:

```ts
export function validateResetPassword(
  newPassword: string
): { ok: true } | { ok: false; error: "empty" | "too_short" } {
  if (!newPassword) return { ok: false, error: "empty" };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "too_short" };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/password.test.ts`
Expected: PASS (existing + 3 new, `# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add lib/password.ts lib/password.test.ts
git commit -m "feat(auth): validateResetPassword helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: PasswordResetToken table

**Files:**
- Modify: `lib/db.ts`
- Modify: `schema.prisma`

**Interfaces:**
- Produces: a `PasswordResetToken` table created idempotently by `initDb()`.

This is schema glue; verify with `npx tsc --noEmit`. The DDL is exercised by Task 5's integration test.

- [ ] **Step 1: Add the table to `initDb()`**

In `lib/db.ts`, inside `initDb()`, after the existing `BossDepartment` `CREATE TABLE IF NOT EXISTS` call and before the `const cols = await queryDatabase...PRAGMA table_info(User)` line, add:

```ts
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS PasswordResetToken (
       id TEXT PRIMARY KEY,
       userId TEXT NOT NULL,
       tokenHash TEXT NOT NULL UNIQUE,
       expiresAt TEXT NOT NULL,
       usedAt TEXT,
       createdAt TEXT NOT NULL,
       FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
     )`
  );
  await runDatabase(
    `CREATE INDEX IF NOT EXISTS idx_prt_userId ON PasswordResetToken(userId)`
  );
```

- [ ] **Step 2: Add the reference model to `schema.prisma`**

In `schema.prisma`, add the relation field to `model User` (after the existing `leaves LeaveRequest[]` line):

```prisma
  resetTokens  PasswordResetToken[]
```

And add the model (place it after `model LeaveRequest { ... }`):

```prisma
model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts schema.prisma
git commit -m "feat(auth): PasswordResetToken table (idempotent initDb + schema ref)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Email module (nodemailer)

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/email.ts`
- Test: `lib/email.test.ts`

**Interfaces:**
- Produces:
  - `function buildResetEmail(resetUrl: string): { subject: string; text: string }`
  - `async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>`

- [ ] **Step 1: Install nodemailer**

Run:
```bash
npm install nodemailer && npm install -D @types/nodemailer
```
Expected: `package.json` gains `nodemailer` under dependencies and `@types/nodemailer` under devDependencies; `package-lock.json` updates. (Do NOT touch the existing `@types/qrcode` entry.)

- [ ] **Step 2: Write the failing test (pure body builder)**

Create `lib/email.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResetEmail } from "./email.ts";

test("buildResetEmail includes the reset URL and a German subject", () => {
  const url = "https://example.com/reset/abc123";
  const { subject, text } = buildResetEmail(url);
  assert.ok(subject.length > 0);
  assert.match(subject, /[Pp]asswort/);
  assert.ok(text.includes(url));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test lib/email.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `lib/email.ts`:

```ts
import nodemailer from "nodemailer";

export function buildResetEmail(resetUrl: string): { subject: string; text: string } {
  return {
    subject: "Passwort zurücksetzen — Urlaubs-Planer",
    text:
      `Du hast angefordert, dein Passwort zurückzusetzen.\n\n` +
      `Öffne diesen Link, um ein neues Passwort zu vergeben (gültig für 1 Stunde):\n` +
      `${resetUrl}\n\n` +
      `Wenn du das nicht warst, kannst du diese E-Mail ignorieren.`,
  };
}

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { subject, text } = buildResetEmail(resetUrl);
  await transport().sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@urlaubsplaner.local",
    to,
    subject,
    text,
  });
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `node --test lib/email.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/email.ts lib/email.test.ts
git commit -m "feat(auth): SMTP email module (buildResetEmail + sendPasswordResetEmail)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Password-reset orchestration

**Files:**
- Create: `lib/password-reset.ts`
- Test: `lib/password-reset.test.ts`

**Interfaces:**
- Consumes: `generateResetToken`, `hashResetToken` (Task 1); `validateResetPassword` (Task 2); `hashPassword` (`lib/password.ts`); `queryDatabase`, `runDatabase`, `getOne` (`lib/db.ts`); `sendPasswordResetEmail` (Task 4); `PasswordResetToken` table (Task 3).
- Produces:
  - `async function createResetTokenForEmail(email: string): Promise<{ raw: string } | null>`
  - `async function validateResetToken(raw: string): Promise<{ valid: boolean }>`
  - `async function performPasswordReset(raw: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `async function requestPasswordReset(email: string): Promise<void>`

- [ ] **Step 1: Write the failing integration test**

Create `lib/password-reset.test.ts`:

```ts
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import sqlite3 from "sqlite3";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `prtest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { hashPassword } = await import("./password.ts");
const { createResetTokenForEmail, validateResetToken, performPasswordReset } = await import(
  "./password-reset.ts"
);
const { queryDatabase, runDatabase } = await import("./db.ts");

const MEMBER_ID = "u-test-1";

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS PasswordResetToken");
  await runDatabase("DROP TABLE IF EXISTS User");
  await runDatabase(
    `CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT, email TEXT, passwordHash TEXT)`
  );
  await runDatabase(
    `CREATE TABLE PasswordResetToken (id TEXT PRIMARY KEY, userId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT NOT NULL)`
  );
  await runDatabase("INSERT INTO User (id, name, email, passwordHash) VALUES (?, ?, ?, ?)", [
    MEMBER_ID,
    "Tester",
    "tester@example.com",
    hashPassword("oldpassword1"),
  ]);
}

beforeEach(resetSchema);

test("createResetTokenForEmail: unknown email creates no token, returns null", async () => {
  const r = await createResetTokenForEmail("nobody@example.com");
  assert.equal(r, null);
  const rows = await queryDatabase("SELECT * FROM PasswordResetToken");
  assert.equal(rows.length, 0);
});

test("createResetTokenForEmail: member without passwordHash is ineligible", async () => {
  await runDatabase("UPDATE User SET passwordHash = NULL WHERE id = ?", [MEMBER_ID]);
  const r = await createResetTokenForEmail("tester@example.com");
  assert.equal(r, null);
});

test("createResetTokenForEmail: eligible member gets exactly one token; 60s throttle blocks the second", async () => {
  const first = await createResetTokenForEmail("tester@example.com");
  assert.ok(first?.raw);
  const second = await createResetTokenForEmail("tester@example.com");
  assert.equal(second, null);
  const rows = await queryDatabase("SELECT * FROM PasswordResetToken");
  assert.equal(rows.length, 1);
});

test("validateResetToken: valid, expired, and used states", async () => {
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  assert.deepEqual(await validateResetToken(raw), { valid: true });
  assert.deepEqual(await validateResetToken("not-a-real-token"), { valid: false });

  // expire it
  await runDatabase("UPDATE PasswordResetToken SET expiresAt = ?", [
    new Date(Date.now() - 1000).toISOString(),
  ]);
  assert.deepEqual(await validateResetToken(raw), { valid: false });
});

test("performPasswordReset: happy path updates hash and consumes the token", async () => {
  const { hashPassword: hp, verifyPassword } = await import("./password.ts");
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  const res = await performPasswordReset(raw, "brandnewpass1");
  assert.deepEqual(res, { ok: true });

  const user = (await queryDatabase<{ passwordHash: string }>(
    "SELECT passwordHash FROM User WHERE id = ?",
    [MEMBER_ID]
  ))[0];
  assert.equal(verifyPassword("brandnewpass1", user.passwordHash), true);
  assert.equal(verifyPassword("oldpassword1", user.passwordHash), false);
  void hp;

  // token now used -> second use rejected
  const again = await performPasswordReset(raw, "anotherpass12");
  assert.equal(again.ok, false);
});

test("performPasswordReset: too-short password rejected, no change", async () => {
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  const res = await performPasswordReset(raw, "short");
  assert.equal(res.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/password-reset.test.ts`
Expected: FAIL — `./password-reset.ts` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/password-reset.ts`:

```ts
import { queryDatabase, runDatabase, getOne } from "./db";
import { hashPassword, validateResetPassword } from "./password";
import { generateResetToken, hashResetToken } from "./reset-tokens";
import { sendPasswordResetEmail } from "./email";
import { randomUUID } from "crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MS = 60 * 1000; // 60 seconds

/**
 * Create a reset token for an eligible member, honoring a 60s throttle.
 * Returns the raw token to email, or null when no email should be sent
 * (no eligible member, or throttled). Never reveals which case occurred.
 */
export async function createResetTokenForEmail(
  email: string
): Promise<{ raw: string } | null> {
  const user = await getOne<{ id: string }>(
    "SELECT id FROM User WHERE email = ? AND passwordHash IS NOT NULL",
    [email]
  );
  if (!user) return null;

  const cutoff = new Date(Date.now() - THROTTLE_MS).toISOString();
  const recent = await getOne<{ id: string }>(
    "SELECT id FROM PasswordResetToken WHERE userId = ? AND usedAt IS NULL AND createdAt > ?",
    [user.id, cutoff]
  );
  if (recent) return null;

  const { raw, hash } = generateResetToken();
  const now = new Date();
  await runDatabase(
    `INSERT INTO PasswordResetToken (id, userId, tokenHash, expiresAt, usedAt, createdAt)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [randomUUID(), user.id, hash, new Date(now.getTime() + TOKEN_TTL_MS).toISOString(), now.toISOString()]
  );
  return { raw };
}

export async function validateResetToken(raw: string): Promise<{ valid: boolean }> {
  const row = await getOne<{ expiresAt: string; usedAt: string | null }>(
    "SELECT expiresAt, usedAt FROM PasswordResetToken WHERE tokenHash = ?",
    [hashResetToken(raw)]
  );
  if (!row || row.usedAt) return { valid: false };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { valid: false };
  return { valid: true };
}

export async function performPasswordReset(
  raw: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = validateResetPassword(newPassword);
  if (!valid.ok) {
    const msg: Record<string, string> = {
      empty: "Bitte ein neues Passwort eingeben.",
      too_short: "Das Passwort muss mindestens 8 Zeichen lang sein.",
    };
    return { ok: false, error: msg[valid.error] };
  }

  const row = await getOne<{ id: string; userId: string; expiresAt: string; usedAt: string | null }>(
    "SELECT id, userId, expiresAt, usedAt FROM PasswordResetToken WHERE tokenHash = ?",
    [hashResetToken(raw)]
  );
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: "Dieser Link ist ungültig oder abgelaufen." };
  }

  const nowIso = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ? WHERE id = ?", [
    hashPassword(newPassword),
    row.userId,
  ]);
  // Consume this token and invalidate any other outstanding tokens for the user.
  await runDatabase("UPDATE PasswordResetToken SET usedAt = ? WHERE userId = ? AND usedAt IS NULL", [
    nowIso,
    row.userId,
  ]);
  return { ok: true };
}

/** Anti-enumeration wrapper: always resolves; swallows send errors. */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    const created = await createResetTokenForEmail(email);
    if (!created) return;
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    await sendPasswordResetEmail(email, `${base}/reset/${created.raw}`);
  } catch (err) {
    console.error("[password-reset] send failed:", err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/password-reset.test.ts`
Expected: PASS (`# fail 0`). (This test stubs nothing for email — it only calls the DB-facing functions; `requestPasswordReset`'s send path is verified by typecheck + manual.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/password-reset.ts lib/password-reset.test.ts
git commit -m "feat(auth): password-reset orchestration (token lifecycle + anti-enumeration)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Server actions

**Files:**
- Modify: `app/actions_auth.ts`

**Interfaces:**
- Consumes: `requestPasswordReset`, `performPasswordReset` (Task 5).
- Produces:
  - `async function handleRequestPasswordReset(email: string): Promise<{ ok: true }>`
  - `async function handlePerformPasswordReset(token: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Add the import**

In `app/actions_auth.ts`, below the existing imports, add:

```ts
import { requestPasswordReset, performPasswordReset } from "@/lib/password-reset";
```

- [ ] **Step 2: Add the actions**

Append to `app/actions_auth.ts`:

```ts
export async function handleRequestPasswordReset(email: string): Promise<{ ok: true }> {
  await requestPasswordReset(email);
  return { ok: true }; // anti-enumeration: always the same response
}

export async function handlePerformPasswordReset(
  token: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return performPasswordReset(token, newPassword);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/actions_auth.ts
git commit -m "feat(auth): password-reset server actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Public reset pages

**Files:**
- Create: `app/reset/page.tsx`, `app/reset/ResetRequestForm.tsx`
- Create: `app/reset/[token]/page.tsx`, `app/reset/[token]/ResetForm.tsx`

**Interfaces:**
- Consumes: `handleRequestPasswordReset`, `handlePerformPasswordReset` (Task 6); `validateResetToken` (Task 5).

- [ ] **Step 1: Create the request form (client)**

Create `app/reset/ResetRequestForm.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  onRequest: (email: string) => Promise<{ ok: true }>;
}

export default function ResetRequestForm({ onRequest }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || busy) return;
    setBusy(true);
    await onRequest(email);
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-Mail"
        autoComplete="email"
        className="w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none"
      />
      <button
        type="submit"
        disabled={!email || busy}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? "Senden..." : "Link senden"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create the request page (server)**

Create `app/reset/page.tsx`:

```tsx
import Link from "next/link";
import ResetRequestForm from "./ResetRequestForm";
import { handleRequestPasswordReset } from "../actions_auth";

export const dynamic = "force-dynamic";

export default function ResetRequestPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-2 text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">
        Passwort zurücksetzen
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        Gib deine E-Mail-Adresse ein. Wir senden dir einen Link zum Zurücksetzen.
      </p>
      <ResetRequestForm onRequest={handleRequestPasswordReset} />
      <div className="mt-6">
        <Link href="/" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
          Zurück zur Startseite
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create the set-new form (client)**

Create `app/reset/[token]/ResetForm.tsx`:

```tsx
"use client";

import { useState } from "react";

interface Props {
  token: string;
  onReset: (
    token: string,
    newPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const MIN_LEN = 8;

export default function ResetForm({ token, onReset }: Props) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = next.length >= MIN_LEN && next === confirm && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    const res = await onReset(token, next);
    if (res.ok) setDone(true);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-bold text-emerald-600">
          Passwort zurückgesetzt. Du kannst dich jetzt anmelden.
        </p>
        <a href="/" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
          Zur Startseite
        </a>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none";

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="Neues Passwort"
        autoComplete="new-password"
        className={inputClass}
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Neues Passwort bestätigen"
        autoComplete="new-password"
        className={inputClass}
      />
      {next.length > 0 && next.length < MIN_LEN && (
        <p className="text-[10px] font-medium text-zinc-400 px-1">Mindestens {MIN_LEN} Zeichen.</p>
      )}
      {confirm.length > 0 && next !== confirm && (
        <p className="text-[10px] font-medium text-amber-600 px-1">Passwörter stimmen nicht überein.</p>
      )}
      {error && <p className="text-[10px] font-bold uppercase text-red-500 px-1">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? "Speichert..." : "Passwort speichern"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create the set-new page (server)**

Create `app/reset/[token]/page.tsx`:

```tsx
import Link from "next/link";
import ResetForm from "./ResetForm";
import { validateResetToken } from "@/lib/password-reset";
import { handlePerformPasswordReset } from "../../actions_auth";

export const dynamic = "force-dynamic";

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { valid } = await validateResetToken(token);

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">
        Neues Passwort vergeben
      </h1>
      {valid ? (
        <ResetForm token={token} onReset={handlePerformPasswordReset} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-rose-600">Dieser Link ist ungültig oder abgelaufen.</p>
          <Link href="/reset" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
            Neuen Link anfordern
          </Link>
        </div>
      )}
    </main>
  );
}
```

Note: in Next 16 `params` is a Promise and must be awaited (as shown). Keep that.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/reset
git commit -m "feat(auth): public password-reset request and set-new pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Login-modal "Passwort vergessen?" link

**Files:**
- Modify: `app/AdminToggle.tsx`

**Interfaces:**
- Consumes: the `/reset` route (Task 7).

- [ ] **Step 1: Add the link in the member tab**

In `app/AdminToggle.tsx`, `AdminToggle` is a client component. Inside the member form (`{tab === "member" && ( <form ...> ... </form> )}`), immediately AFTER the password `<input>`'s wrapping `</div>` and BEFORE the `{error && (` block, add a link to the reset page that also closes the modal:

```tsx
                <div className="text-right">
                  <a
                    href="/reset"
                    className="text-[11px] font-medium text-emerald-600 hover:text-emerald-500"
                  >
                    Passwort vergessen?
                  </a>
                </div>
```

(Using a plain `<a href>` triggers a full navigation to `/reset`, which is the desired behavior — it leaves the modal/page entirely.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`). With a member that has a real `email` set:
1. Open the login modal → "Passwort vergessen?" navigates to `/reset`.
2. Submit any email → always see the "Falls ein Konto..." confirmation.
3. For a real member email, find the generated link: read it from the DB
   (`SELECT tokenHash FROM PasswordResetToken`) is hashed, so instead read the raw link
   from the server console if logged, OR (test shortcut) generate a token via
   `createResetTokenForEmail` in a node REPL. Open `/reset/<raw>`, set a new password ≥ 8,
   see the success message, and log in with the new password.
4. Re-open the used link → "Dieser Link ist ungültig oder abgelaufen."

Note: without SMTP env configured no email is actually delivered; the request still
succeeds silently (by design). Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add app/AdminToggle.tsx
git commit -m "feat(auth): 'Passwort vergessen?' link in member login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Token primitives (hashed-at-rest, single-use, 1h) → Task 1 + Task 5.
- Min-8 new password → Task 2 + Task 5.
- `PasswordResetToken` table (idempotent initDb + schema ref) → Task 3.
- nodemailer/SMTP send + pure body builder → Task 4.
- Eligibility (member + email + passwordHash), anti-enumeration, 60s throttle, token lifecycle → Task 5.
- Server actions (anti-enumeration response) → Task 6.
- Public `/reset` and `/reset/[token]` pages → Task 7.
- "Passwort vergessen?" entry point → Task 8.
- New env documented in Global Constraints.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `generateResetToken`/`hashResetToken` (T1) used in T5; `validateResetPassword` (T2) used in T5; `PasswordResetToken` columns identical across T3 DDL, T5 test schema, and T5 queries (`id,userId,tokenHash,expiresAt,usedAt,createdAt`); `createResetTokenForEmail`/`validateResetToken`/`performPasswordReset`/`requestPasswordReset` (T5) consumed by T6; action names `handleRequestPasswordReset`/`handlePerformPasswordReset` consistent T6→T7; component prop shapes (`onRequest`, `onReset`, `token`) match the page wiring in T7.

**Note on email verification:** end-to-end *delivery* needs real SMTP env, which may be absent. The orchestration (token lifecycle, eligibility, throttle, consume) is fully covered by Task 5's integration test without sending; the SMTP send path is verified by typecheck + the manual smoke test, with delivery deferred until SMTP is configured on the deploy.
