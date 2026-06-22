# Login Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock out a login identity after 5 failed attempts within 15 minutes, for both member (email+password) and staff (TOTP) logins, with an explicit "too many attempts" message.

**Architecture:** A `LoginAttempt` table records only failures; lockout is derived by counting recent rows (the `password-reset` throttle pattern). A `lib/login-throttle.ts` module exposes `isLocked`/`recordFailure`/`clearFailures`. `loginMember`/`loginStaff` return a `LoginResult` discriminated union; member is keyed by email, staff by client IP (best-effort, fail-open if absent). The login modal shows a lockout message.

**Tech Stack:** Next.js 16 (App Router, server actions, async `headers()`), React 19, SQLite via raw SQL (`lib/db.ts`), Node 22 native TS test runner.

## Global Constraints

- **Working directory for all commands:** `C:\laragon\www\Urlaube\kalender`.
- **Policy constants (exact):** `MAX_FAILURES = 5`; `WINDOW_MS = 15 * 60 * 1000`.
- **Throttle keys (exact format):** member → `` `email:${email.toLowerCase()}` ``; staff → `` `ip:${ip}` `` when an IP is present, else **no throttle** (key is `null`).
- **Column name:** the throttle-key column is `attemptKey` (NOT `key`, to avoid SQLite keyword ambiguity).
- **LoginResult type (exact):** `{ ok: true } | { ok: false; reason: "invalid" | "locked" }`, exported from `lib/auth.ts`.
- **German copy (exact):** lockout message `Zu viele Versuche. Bitte später erneut versuchen.`; existing invalid message `Zugriff verweigert` stays.
- **A locked attempt is rejected BEFORE credentials are checked and records NO new failure row** (so the lockout cannot be extended by continued attempts).
- **A successful login calls `clearFailures(key)`** to reset the counter.
- **Migration mechanism:** new table added in `initDb()` with `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`; `schema.prisma` updated for reference only.
- **Typecheck command:** `npx tsc --noEmit` — MUST exit 0 after every task.
- **Test command:** `node --test lib/<name>.test.ts`; for tests whose module transitively imports sibling source (`login-throttle`), use `node --import ./lib/_tsresolve.mjs --test lib/<name>.test.ts`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Do NOT touch** `app/bosse/BossList.tsx` or the untracked `types/` directory.

## Task ordering note

The table (Task 1) comes first so the module has a target. The module (Task 2) is pure DB + unit-tested. The auth/actions/UI wiring (Task 3) is a single task: changing `loginMember`/`loginStaff` from `Promise<boolean>` to `Promise<LoginResult>` breaks the server actions and the login modal in the same edit, so they must change together to keep `tsc` green.

---

## File Structure

- **Modify** `lib/db.ts` — `LoginAttempt` table in `initDb()`.
- **Modify** `schema.prisma` — reference model.
- **Create** `lib/login-throttle.ts` (+ `lib/login-throttle.test.ts`) — throttle module.
- **Modify** `lib/auth.ts` — `LoginResult`; throttle in `loginMember`/`loginStaff`.
- **Modify** `app/actions_auth.ts` — return `LoginResult`; client IP from `headers()` for staff.
- **Modify** `app/AdminToggle.tsx` — lockout message in both tabs.

---

### Task 1: LoginAttempt table

**Files:**
- Modify: `lib/db.ts`
- Modify: `schema.prisma`

**Interfaces:**
- Produces: a `LoginAttempt(id, attemptKey, createdAt)` table + index on `(attemptKey, createdAt)`, created idempotently by `initDb()`.

Schema glue; verified by `npx tsc --noEmit`. Exercised by Task 2.

- [ ] **Step 1: Add the table + index in `initDb()`**

In `lib/db.ts`, immediately after the existing `idx_prt_userId` index block:

```ts
  await runDatabase(
    `CREATE INDEX IF NOT EXISTS idx_prt_userId ON PasswordResetToken(userId)`
  );
```

add:

```ts
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS LoginAttempt (
       id TEXT PRIMARY KEY,
       attemptKey TEXT NOT NULL,
       createdAt TEXT NOT NULL
     )`
  );
  await runDatabase(
    `CREATE INDEX IF NOT EXISTS idx_login_attempt_key ON LoginAttempt(attemptKey, createdAt)`
  );
```

- [ ] **Step 2: Add the reference model to `schema.prisma`**

In `schema.prisma`, after the `PasswordResetToken` model, add:

```prisma
model LoginAttempt {
  id         String   @id @default(cuid())
  attemptKey String
  createdAt  DateTime @default(now())

  @@index([attemptKey, createdAt])
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts schema.prisma
git commit -m "feat(auth): LoginAttempt table (idempotent initDb + schema ref)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: login-throttle module

**Files:**
- Create: `lib/login-throttle.ts`
- Test: `lib/login-throttle.test.ts`

**Interfaces:**
- Consumes: `queryDatabase`, `runDatabase` (`lib/db.ts`); `LoginAttempt` table (Task 1).
- Produces:
  - `const MAX_FAILURES = 5`
  - `const WINDOW_MS = 15 * 60 * 1000`
  - `async function isLocked(key: string): Promise<boolean>`
  - `async function recordFailure(key: string): Promise<void>`
  - `async function clearFailures(key: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `lib/login-throttle.test.ts`:

```ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `lttest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { isLocked, recordFailure, clearFailures, MAX_FAILURES, WINDOW_MS } = await import(
  "./login-throttle.ts"
);
const { runDatabase, queryDatabase } = await import("./db.ts");

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS LoginAttempt");
  await runDatabase(
    `CREATE TABLE LoginAttempt (id TEXT PRIMARY KEY, attemptKey TEXT NOT NULL, createdAt TEXT NOT NULL)`
  );
}
beforeEach(resetSchema);

test("below the threshold is not locked", async () => {
  for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), false);
});

test("at the threshold is locked", async () => {
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), true);
});

test("clearFailures resets only its key", async () => {
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("email:a@x.de");
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("ip:1.2.3.4");
  await clearFailures("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), false);
  assert.equal(await isLocked("ip:1.2.3.4"), true);
});

test("failures older than the window do not count", async () => {
  const old = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
  for (let i = 0; i < MAX_FAILURES; i++) {
    await runDatabase(
      "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
      [randomUUID(), "email:a@x.de", old]
    );
  }
  assert.equal(await isLocked("email:a@x.de"), false);
});

test("recordFailure prunes rows older than the window", async () => {
  const old = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
  await runDatabase(
    "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
    [randomUUID(), "ip:9.9.9.9", old]
  );
  await recordFailure("email:a@x.de"); // triggers the prune
  const rows = await queryDatabase("SELECT * FROM LoginAttempt WHERE attemptKey = ?", ["ip:9.9.9.9"]);
  assert.equal(rows.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./lib/_tsresolve.mjs --test lib/login-throttle.test.ts`
Expected: FAIL — `./login-throttle.ts` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/login-throttle.ts`:

```ts
import { queryDatabase, runDatabase } from "./db";
import { randomUUID } from "crypto";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Locked when >= MAX_FAILURES failures recorded within the last WINDOW_MS. */
export async function isLocked(key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const rows = await queryDatabase<{ n: number }>(
    "SELECT COUNT(*) AS n FROM LoginAttempt WHERE attemptKey = ? AND createdAt > ?",
    [key, cutoff]
  );
  return (rows[0]?.n ?? 0) >= MAX_FAILURES;
}

/** Record one failure for `key`; also prune globally-expired rows to bound the table. */
export async function recordFailure(key: string): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - WINDOW_MS).toISOString();
  await runDatabase("DELETE FROM LoginAttempt WHERE createdAt < ?", [cutoff]);
  await runDatabase(
    "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
    [randomUUID(), key, new Date(now).toISOString()]
  );
}

/** Clear all failures for `key` (called on a successful login). */
export async function clearFailures(key: string): Promise<void> {
  await runDatabase("DELETE FROM LoginAttempt WHERE attemptKey = ?", [key]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./lib/_tsresolve.mjs --test lib/login-throttle.test.ts`
Expected: PASS (`# fail 0`, 5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/login-throttle.ts lib/login-throttle.test.ts
git commit -m "feat(auth): login-throttle module (failure counting + rolling lockout)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire throttle into login (auth + actions + UI)

**Files:**
- Modify: `lib/auth.ts`
- Modify: `app/actions_auth.ts`
- Modify: `app/AdminToggle.tsx`

**Interfaces:**
- Consumes: `isLocked`, `recordFailure`, `clearFailures` (Task 2); existing `setSession`, `verifyPassword`, `verifyTotp`, `queryDatabase`, `deptIdsForBoss`, `deptIdsForUser`.
- Produces:
  - `export type LoginResult = { ok: true } | { ok: false; reason: "invalid" | "locked" }` (from `lib/auth.ts`)
  - `loginMember(email, password): Promise<LoginResult>`
  - `loginStaff(code, ip?: string | null): Promise<LoginResult>`
  - `handleMemberLogin`/`handleStaffLogin` return `LoginResult`.

`lib/auth.ts` has no unit test (needs `next/headers` + DB); verified by `tsc` and the Task 4 browser smoke test. All three files change together so `tsc` stays green.

- [ ] **Step 1: Add the throttle import and `LoginResult` to `lib/auth.ts`**

In `lib/auth.ts`, after the existing `import { ... } from "./session-crypto";` line, add:

```ts
import { isLocked, recordFailure, clearFailures } from "./login-throttle";
```

And add the exported type near the top (e.g. just after `const SESSION_COOKIE = "session";`):

```ts
export type LoginResult = { ok: true } | { ok: false; reason: "invalid" | "locked" };
```

- [ ] **Step 2: Throttle `loginStaff`**

Replace the entire `loginStaff` function:

```ts
export async function loginStaff(code: string): Promise<boolean> {
  const adminSecret = process.env.BOSS_SECRET;
  if (adminSecret && (await verifyTotp(code, adminSecret))) {
    await setSession({ role: "admin", id: "admin", name: "Admin", departmentIds: [] });
    return true;
  }
  const bosses = await queryDatabase<{ id: string; name: string; totpSecret: string }>(
    "SELECT id, name, totpSecret FROM Boss"
  );
  for (const b of bosses) {
    if (await verifyTotp(code, b.totpSecret)) {
      await setSession({
        role: "boss",
        id: b.id,
        name: b.name,
        departmentIds: await deptIdsForBoss(b.id),
      });
      return true;
    }
  }
  return false;
}
```

with:

```ts
export async function loginStaff(code: string, ip?: string | null): Promise<LoginResult> {
  const key = ip ? `ip:${ip}` : null;
  if (key && (await isLocked(key))) return { ok: false, reason: "locked" };

  const adminSecret = process.env.BOSS_SECRET;
  if (adminSecret && (await verifyTotp(code, adminSecret))) {
    if (key) await clearFailures(key);
    await setSession({ role: "admin", id: "admin", name: "Admin", departmentIds: [] });
    return { ok: true };
  }
  const bosses = await queryDatabase<{ id: string; name: string; totpSecret: string }>(
    "SELECT id, name, totpSecret FROM Boss"
  );
  for (const b of bosses) {
    if (await verifyTotp(code, b.totpSecret)) {
      if (key) await clearFailures(key);
      await setSession({
        role: "boss",
        id: b.id,
        name: b.name,
        departmentIds: await deptIdsForBoss(b.id),
      });
      return { ok: true };
    }
  }
  if (key) await recordFailure(key);
  return { ok: false, reason: "invalid" };
}
```

- [ ] **Step 3: Throttle `loginMember`**

Replace the entire `loginMember` function:

```ts
export async function loginMember(email: string, password: string): Promise<boolean> {
  const rows = await queryDatabase<{ id: string; name: string; passwordHash: string | null }>(
    "SELECT id, name, passwordHash FROM User WHERE email = ?",
    [email]
  );
  const user = rows[0];
  if (!user || !user.passwordHash) return false;
  if (!verifyPassword(password, user.passwordHash)) return false;
  await setSession({
    role: "member",
    id: user.id,
    name: user.name,
    departmentIds: await deptIdsForUser(user.id),
  });
  return true;
}
```

with:

```ts
export async function loginMember(email: string, password: string): Promise<LoginResult> {
  const key = `email:${email.toLowerCase()}`;
  if (await isLocked(key)) return { ok: false, reason: "locked" };

  const rows = await queryDatabase<{ id: string; name: string; passwordHash: string | null }>(
    "SELECT id, name, passwordHash FROM User WHERE email = ?",
    [email]
  );
  const user = rows[0];
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    await recordFailure(key);
    return { ok: false, reason: "invalid" };
  }
  await clearFailures(key);
  await setSession({
    role: "member",
    id: user.id,
    name: user.name,
    departmentIds: await deptIdsForUser(user.id),
  });
  return { ok: true };
}
```

- [ ] **Step 4: Update the server actions**

In `app/actions_auth.ts`, change the auth import line to also import `headers` and the `LoginResult` type. Change:

```ts
import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult } from "@/lib/auth";
import { requestPasswordReset, performPasswordReset } from "@/lib/password-reset";
import { revalidatePath } from "next/cache";
```

to:

```ts
import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult, type LoginResult } from "@/lib/auth";
import { requestPasswordReset, performPasswordReset } from "@/lib/password-reset";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
```

Replace `handleStaffLogin` and `handleMemberLogin`:

```ts
export async function handleStaffLogin(code: string): Promise<boolean> {
  const ok = await loginStaff(code);
  if (ok) revalidatePath("/", "layout");
  return ok;
}

export async function handleMemberLogin(email: string, password: string): Promise<boolean> {
  const ok = await loginMember(email, password);
  if (ok) revalidatePath("/", "layout");
  return ok;
}
```

with:

```ts
async function clientIp(): Promise<string | null> {
  const xff = (await headers()).get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0].trim() || null;
}

export async function handleStaffLogin(code: string): Promise<LoginResult> {
  const res = await loginStaff(code, await clientIp());
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function handleMemberLogin(email: string, password: string): Promise<LoginResult> {
  const res = await loginMember(email, password);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
```

- [ ] **Step 5: Update the login modal (`app/AdminToggle.tsx`)**

(5a) Add the type import after the existing `import ChangePassword from "./ChangePassword";` line:

```tsx
import type { LoginResult } from "@/lib/auth";
```

(5b) In `LoginMenuProps`, change the two return types from `Promise<boolean>` to `Promise<LoginResult>`:

```tsx
  onStaffLogin: (code: string) => Promise<LoginResult>;
  onMemberLogin: (email: string, password: string) => Promise<LoginResult>;
```

(5c) Replace the error state declaration:

```tsx
  const [error, setError] = useState(false);
```

with (a tri-state kind plus a derived boolean so existing `error ?` styling keeps working unchanged):

```tsx
  const [errorKind, setErrorKind] = useState<"invalid" | "locked" | null>(null);
  const error = errorKind !== null;
```

(5d) Replace `handleMemberSubmit`'s body:

```tsx
  const handleMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const success = await onMemberLogin(email, password);
    if (success) {
      setShowModal(false);
      setEmail("");
      setPassword("");
      setError(false);
      window.location.reload();
    } else {
      setError(true);
      setIsLoggingIn(false);
    }
  };
```

with:

```tsx
  const handleMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const res = await onMemberLogin(email, password);
    if (res.ok) {
      setShowModal(false);
      setEmail("");
      setPassword("");
      setErrorKind(null);
      window.location.reload();
    } else {
      setErrorKind(res.reason);
      setIsLoggingIn(false);
    }
  };
```

(5e) Replace `handleStaffSubmit`'s body:

```tsx
  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const success = await onStaffLogin(code);
    if (success) {
      setShowModal(false);
      setCode("");
      setError(false);
      window.location.reload();
    } else {
      setError(true);
      setIsLoggingIn(false);
    }
  };
```

with:

```tsx
  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    const res = await onStaffLogin(code);
    if (res.ok) {
      setShowModal(false);
      setCode("");
      setErrorKind(null);
      window.location.reload();
    } else {
      setErrorKind(res.reason);
      setIsLoggingIn(false);
    }
  };
```

(5f) In `handleTabChange` and `handleCloseModal`, replace `setError(false);` with `setErrorKind(null);` (two occurrences, use replace-all for the exact line `    setError(false);`).

(5g) In BOTH error blocks (member tab and staff tab), the text node currently reads:

```tsx
                    Zugriff verweigert
```

Replace each occurrence (replace-all) with:

```tsx
                    {errorKind === "locked" ? "Zu viele Versuche. Bitte später erneut versuchen." : "Zugriff verweigert"}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (whole project — the `LoginResult` change and all its consumers are updated together).

- [ ] **Step 7: Full test suite**

Run: `node --import ./lib/_tsresolve.mjs --test lib/*.test.ts`
Expected: PASS (`# fail 0`).

- [ ] **Step 8: Commit**

```bash
git add lib/auth.ts app/actions_auth.ts app/AdminToggle.tsx
git commit -m "feat(auth): rate-limit member and staff logins (5/15min lockout)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Whole-feature verification (browser smoke test)

**Files:** none (verification only).

`lib/auth.ts` / actions / UI glue has no unit test; verify the end-to-end behavior before declaring done.

- [ ] **Step 1: Full suite + typecheck**

Run: `node --import ./lib/_tsresolve.mjs --test lib/*.test.ts`
Expected: PASS (`# fail 0`).
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Smoke test in the browser**

Start the dev server (`npm run dev`). Seed a throwaway member with an email + known password (reuse the helper-script pattern from earlier smoke tests; ensure `initDb()` has run so `LoginAttempt` exists). Then:

1. **Member lockout:** open the login modal, submit the member's email with a WRONG password 5 times. The first 4 show `Zugriff verweigert`; the 5th (and the next attempt) shows `Zu viele Versuche. Bitte später erneut versuchen.` Confirm that even the CORRECT password now shows the lockout message (locked rejects before credential check).
2. **Reset clears the lock:** run `clearFailures("email:<lowercased email>")` via a node one-liner (or delete the member's `LoginAttempt` rows), then log in with the CORRECT password → success (logged in).
3. **Staff (best-effort):** if the dev server receives no `x-forwarded-for`, staff login is not throttled — confirm a wrong TOTP just shows `Zugriff verweigert` with no lockout. (Throttling staff requires a real client IP, present on the proxied deploy.)

- [ ] **Step 3: Clean up**

Delete the throwaway member and its `LoginAttempt` rows; stop the dev server; confirm `git status` shows only the pre-existing `app/bosse/BossList.tsx` and untracked `types/`.

---

## Self-Review

**Spec coverage:**
- `LoginAttempt` table (idempotent initDb + schema ref) → Task 1.
- `isLocked`/`recordFailure`(+prune)/`clearFailures`, constants 5 / 15min → Task 2.
- Member keyed by email, staff by IP, fail-open when no IP → Task 3 (`loginMember`/`loginStaff`).
- Locked rejected before credential check, no new row; success clears → Tasks 2 + 3.
- `LoginResult` discriminated union → Task 3.
- Actions return result; IP from `headers()` → Task 3.
- Explicit lockout message in both tabs → Task 3 (5g).
- Record failure on unknown email (anti-enumeration) → Task 3 (`loginMember` records on the combined `!user || !hash || !verify` branch).
- End-to-end verified → Task 4.

**Placeholder scan:** none — every code step shows exact content; Task 4 is verification with concrete steps.

**Type consistency:** `LoginResult` (Task 3) is the return of `loginMember`/`loginStaff`, `handleMemberLogin`/`handleStaffLogin`, and the `onMemberLogin`/`onStaffLogin` props; `attemptKey` column name is identical across Task 1 DDL, Task 2 test schema + queries, and the module; `MAX_FAILURES`/`WINDOW_MS` defined in Task 2 are used by its tests; the derived `const error = errorKind !== null` preserves every existing `error ?` className conditional in `AdminToggle.tsx` without touching them.

**Every-commit-green:** Tasks 1, 2, 3 each leave `tsc --noEmit` at exit 0 (the `boolean → LoginResult` change and all consumers — auth, actions, modal — are in Task 3).
