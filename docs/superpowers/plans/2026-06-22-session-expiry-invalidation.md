# Session Expiry & Invalidate-on-Password-Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the stateless session cookie a server-enforced 24h expiry and invalidate a member's other sessions when their password changes or is reset.

**Architecture:** The signed payload changes from a bare `Principal` to `{ principal, iat, exp }` (ms epochs); `verifySession` enforces `exp` and rejects the old format. A new nullable `User.passwordChangedAt` column is set on password change/reset; `getPrincipal` rejects a member session whose `iat` predates it. The in-app change path re-issues the current session so only *other* sessions die.

**Tech Stack:** Next.js 16 (App Router, server actions), SQLite via raw SQL (`lib/db.ts`), scrypt (`lib/password.ts`), HMAC-SHA256 cookie (`lib/session-crypto.ts`), Node 22 native TS test runner.

## Global Constraints

- **Working directory for all commands:** `C:\laragon\www\Urlaube\kalender`.
- **Time unit:** millisecond epochs (`Date.now()`) for `iat`/`exp`; `passwordChangedAt` stored as an ISO string and compared via `Date.parse`.
- **Session TTL:** 24h = `60 * 60 * 24 * 1000` ms (`SESSION_TTL_MS`).
- **Old-format cookies** (no numeric `exp`) MUST be rejected — every current user logs in once after deploy. No grandfathering.
- **Invalidation triggers:** in-app password change AND forgot-password reset.
- **Member-only invalidation:** boss/admin authenticate via TOTP and have no password — `getPrincipal` skips the `passwordChangedAt` lookup for them.
- **Migration mechanism:** new column added in `initDb()` with the existing `PRAGMA table_info` + `ALTER TABLE` guard; `schema.prisma` updated for reference only.
- **Typecheck command:** `npx tsc --noEmit` (currently clean — and MUST be clean after every task).
- **Test command:** `node --test lib/<name>.test.ts`. For tests whose module-under-test transitively imports sibling source files (e.g. `password-reset`), use `node --import ./lib/_tsresolve.mjs --test lib/<name>.test.ts`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Task ordering note

The column is added first (Task 1) so the code that writes it has a target. The
`session-crypto` payload change and the `auth.ts` change live in **one task** (Task 2)
on purpose: changing `verifySession`'s return type from `Principal` to `SessionData`
breaks its only consumer (`getPrincipal`) in the same edit, so splitting them would
leave `tsc` red between commits. Keeping every commit green is the priority.

---

## File Structure

- **Modify** `lib/db.ts` — `passwordChangedAt` column in `initDb()`.
- **Modify** `schema.prisma` — reference column on `User`.
- **Modify** `lib/session-crypto.ts` (+ rewrite test) — `SessionData`, `SESSION_TTL_MS`, `iat`/`exp` in payload, expiry + old-format rejection, `sessionPredatesPasswordChange`.
- **Modify** `lib/auth.ts` — `getPrincipal` member check; `changeMemberPassword` sets `passwordChangedAt` and re-issues the session.
- **Modify** `lib/password-reset.ts` (+ extend test) — `performPasswordReset` sets `passwordChangedAt`.

---

### Task 1: passwordChangedAt column

**Files:**
- Modify: `lib/db.ts`
- Modify: `schema.prisma`

**Interfaces:**
- Produces: a nullable `passwordChangedAt TEXT` column on `User`, added idempotently by `initDb()`.

Schema glue; verified by `npx tsc --noEmit`. The column is exercised by Tasks 2 and 3.

- [ ] **Step 1: Add the column guard in `initDb()`**

In `lib/db.ts`, immediately after the existing line:

```ts
  if (!names.has("passwordHash")) await runDatabase(`ALTER TABLE User ADD COLUMN passwordHash TEXT`);
```

add:

```ts
  if (!names.has("passwordChangedAt")) await runDatabase(`ALTER TABLE User ADD COLUMN passwordChangedAt TEXT`);
```

- [ ] **Step 2: Add the reference field to `schema.prisma`**

In `schema.prisma`, in `model User`, immediately after the existing `passwordHash` field line, add:

```prisma
  passwordChangedAt DateTime?
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/db.ts schema.prisma
git commit -m "feat(auth): User.passwordChangedAt column (idempotent initDb + schema ref)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Session payload (iat/exp/expiry) + auth enforcement

**Files:**
- Modify: `lib/session-crypto.ts`
- Test: `lib/session-crypto.test.ts` (rewrite — existing tests assume `verifySession` returns a bare `Principal`)
- Modify: `lib/auth.ts`

**Interfaces:**
- Consumes: `createHmac`, `timingSafeEqual` from `crypto`; `getOne` (`lib/db.ts`); `passwordChangedAt` column (Task 1); existing `setSession`, `hashPassword`.
- Produces:
  - `interface SessionData { principal: Principal; iat: number; exp: number }`
  - `const SESSION_TTL_MS: number`
  - `function signSession(principal: Principal, secret: string): string`
  - `function verifySession(token: string, secret: string): SessionData | null`
  - `function sessionPredatesPasswordChange(iat: number, passwordChangedAt: string | null): boolean`
  - `getPrincipal` and `changeMemberPassword` enforce/bump invalidation (public signatures unchanged).

`session-crypto` carries this task's automated test cycle. `auth.ts` has no unit test (it needs
`next/headers` cookies + DB); it is verified by `tsc` and the Task 4 browser smoke test, and is in
this task because the `verifySession` return-type change breaks `getPrincipal` in the same edit.

- [ ] **Step 1: Rewrite the session-crypto test**

Replace the entire contents of `lib/session-crypto.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import {
  signSession,
  verifySession,
  sessionPredatesPasswordChange,
  SESSION_TTL_MS,
  type Principal,
} from "./session-crypto.ts";

const SECRET = "test-session-secret";
const p: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };

// Mint a validly-signed token from an arbitrary body (mirrors signSession's scheme)
// so we can construct expired and old-format tokens that signSession would never emit.
function mint(body: unknown, secret = SECRET): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

test("signSession/verifySession round-trips principal with iat and exp", () => {
  const before = Date.now();
  const data = verifySession(signSession(p, SECRET), SECRET);
  assert.ok(data);
  assert.deepEqual(data!.principal, p);
  assert.ok(data!.iat >= before && data!.iat <= Date.now());
  assert.equal(data!.exp, data!.iat + SESSION_TTL_MS);
});

test("verifySession rejects an expired token", () => {
  const now = Date.now();
  const token = mint({ principal: p, iat: now - SESSION_TTL_MS - 1000, exp: now - 1000 });
  assert.equal(verifySession(token, SECRET), null);
});

test("verifySession rejects the old payload format (bare principal, no exp)", () => {
  assert.equal(verifySession(mint(p), SECRET), null);
});

test("verifySession rejects a tampered payload", () => {
  const sig = signSession(p, SECRET).split(".")[1];
  const forged = Buffer.from(
    JSON.stringify({ principal: { ...p, role: "admin" }, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, SECRET), null);
});

test("verifySession rejects a wrong secret and malformed tokens", () => {
  const token = signSession(p, SECRET);
  assert.equal(verifySession(token, "other-secret"), null);
  assert.equal(verifySession("garbage", SECRET), null);
  assert.equal(verifySession("", SECRET), null);
});

test("sessionPredatesPasswordChange: null, before, equal, after", () => {
  const changed = new Date(2000).toISOString(); // 2000 ms epoch
  assert.equal(sessionPredatesPasswordChange(1000, null), false);
  assert.equal(sessionPredatesPasswordChange(1000, changed), true);
  assert.equal(sessionPredatesPasswordChange(2000, changed), false);
  assert.equal(sessionPredatesPasswordChange(3000, changed), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/session-crypto.test.ts`
Expected: FAIL — `sessionPredatesPasswordChange`/`SESSION_TTL_MS` not exported; round-trip shape mismatch.

- [ ] **Step 3: Rewrite `lib/session-crypto.ts`**

Replace the entire contents with:

```ts
import { createHmac, timingSafeEqual } from "crypto";

export interface Principal {
  role: "admin" | "boss" | "member";
  id: string;
  name: string;
  departmentIds: string[];
}

export interface SessionData {
  principal: Principal;
  iat: number; // ms epoch
  exp: number; // ms epoch
}

export const SESSION_TTL_MS = 60 * 60 * 24 * 1000; // 24h

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(principal: Principal, secret: string): string {
  const iat = Date.now();
  const body: SessionData = { principal, iat, exp: iat + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token: string, secret: string): SessionData | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as SessionData).iat !== "number" ||
    typeof (body as SessionData).exp !== "number" ||
    typeof (body as SessionData).principal !== "object" ||
    (body as SessionData).principal === null
  ) {
    return null; // rejects the old bare-principal format
  }
  const data = body as SessionData;
  if (Date.now() >= data.exp) return null;
  return data;
}

export function sessionPredatesPasswordChange(
  iat: number,
  passwordChangedAt: string | null
): boolean {
  if (!passwordChangedAt) return false;
  return iat < Date.parse(passwordChangedAt);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/session-crypto.test.ts`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Update auth imports**

In `lib/auth.ts`, change:

```ts
import { queryDatabase, runDatabase } from "./db";
```

to:

```ts
import { queryDatabase, runDatabase, getOne } from "./db";
```

and change:

```ts
import { signSession, verifySession, type Principal } from "./session-crypto";
```

to:

```ts
import { signSession, verifySession, sessionPredatesPasswordChange, type Principal } from "./session-crypto";
```

- [ ] **Step 6: Enforce expiry + passwordChangedAt in `getPrincipal`**

Replace:

```ts
export async function getPrincipal(): Promise<Principal | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, sessionSecret());
}
```

with:

```ts
export async function getPrincipal(): Promise<Principal | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = verifySession(token, sessionSecret());
  if (!session) return null;
  if (session.principal.role === "member") {
    const row = await getOne<{ passwordChangedAt: string | null }>(
      "SELECT passwordChangedAt FROM User WHERE id = ?",
      [session.principal.id]
    );
    if (sessionPredatesPasswordChange(session.iat, row?.passwordChangedAt ?? null)) {
      return null;
    }
  }
  return session.principal;
}
```

- [ ] **Step 7: Bump passwordChangedAt + re-issue in `changeMemberPassword`**

Replace the final update + return of `changeMemberPassword`:

```ts
  await runDatabase("UPDATE User SET passwordHash = ? WHERE id = ?", [
    hashPassword(newPassword),
    principal.id,
  ]);
  return { ok: true };
```

with:

```ts
  const now = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ?, passwordChangedAt = ? WHERE id = ?", [
    hashPassword(newPassword),
    now,
    principal.id,
  ]);
  // Re-issue THIS session with a fresh iat (>= passwordChangedAt) so the current
  // tab stays logged in while the member's other sessions are invalidated.
  await setSession(principal);
  return { ok: true };
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (whole project green — the `verifySession` shape change and its consumer are both updated here).

- [ ] **Step 9: Commit**

```bash
git add lib/session-crypto.ts lib/session-crypto.test.ts lib/auth.ts
git commit -m "feat(auth): session expiry + invalidate member sessions on password change

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Reset stamps passwordChangedAt

**Files:**
- Modify: `lib/password-reset.ts`
- Test: `lib/password-reset.test.ts`

**Interfaces:**
- Consumes: `passwordChangedAt` column (Task 1).
- Produces: `performPasswordReset` writes `passwordChangedAt` alongside `passwordHash` (signature unchanged).

- [ ] **Step 1: Extend the test**

In `lib/password-reset.test.ts`, update the `User` DDL in `resetSchema()`. Change:

```ts
    `CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT, email TEXT, passwordHash TEXT)`
```

to:

```ts
    `CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT, email TEXT, passwordHash TEXT, passwordChangedAt TEXT)`
```

Then in the test `"performPasswordReset: happy path updates hash and consumes the token"`, after the existing `assert.deepEqual(res, { ok: true });` line, add:

```ts
  const after = (await queryDatabase<{ passwordChangedAt: string | null }>(
    "SELECT passwordChangedAt FROM User WHERE id = ?",
    [MEMBER_ID]
  ))[0];
  assert.ok(after.passwordChangedAt, "passwordChangedAt should be set after reset");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import ./lib/_tsresolve.mjs --test lib/password-reset.test.ts`
Expected: FAIL — `after.passwordChangedAt` is null.

- [ ] **Step 3: Update the implementation**

In `lib/password-reset.ts`, inside `performPasswordReset`, change:

```ts
  const nowIso = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ? WHERE id = ?", [
    hashPassword(newPassword),
    row.userId,
  ]);
```

to:

```ts
  const nowIso = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ?, passwordChangedAt = ? WHERE id = ?", [
    hashPassword(newPassword),
    nowIso,
    row.userId,
  ]);
```

(`nowIso` is already declared here and reused by the token-consume `UPDATE` below; do not move it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./lib/_tsresolve.mjs --test lib/password-reset.test.ts`
Expected: PASS (`# fail 0`, 6 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/password-reset.ts lib/password-reset.test.ts
git commit -m "feat(auth): password reset stamps passwordChangedAt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Whole-feature verification (browser smoke test)

**Files:** none (verification only).

No unit test covers the `auth.ts` cookie/DB glue (it needs `next/headers`), so verify the end-to-end
behavior in a browser before declaring done.

- [ ] **Step 1: Full test suite + typecheck**

Run: `node --import ./lib/_tsresolve.mjs --test lib/*.test.ts`
Expected: PASS (`# fail 0`).
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Smoke test in the browser**

Start the dev server (`npm run dev`). Seed a throwaway member with an email + password (reuse the
helper-script pattern from the password-reset smoke test). Then verify:

1. **Old-format / expiry:** mint a bare-principal token (old format) and set it as the `session`
   cookie; load any page → treated as logged out (rejected by `verifySession`).
2. **Invalidate-on-change:** set a valid member session cookie (a token with `iat = Date.now()`),
   confirm logged in. Change that member's password (via the UI in a separate browser session, or by
   calling `changeMemberPassword`). Reload the first cookie's page → logged out (its `iat` predates
   the new `passwordChangedAt`); the session that performed the change stays logged in.
3. **Reset invalidates:** with a logged-in member cookie (older `iat`), complete a password reset for
   that member (`createResetTokenForEmail` → `/reset/<token>`), then reload → logged out.

- [ ] **Step 3: Clean up**

Delete the throwaway member + its reset tokens; stop the dev server; confirm `git status` shows no
stray working-tree changes (only the pre-existing `app/bosse/BossList.tsx` and untracked `types/`).

---

## Self-Review

**Spec coverage:**
- Server-side 24h expiry (`exp` rejected when past) → Task 2.
- `sessionPredatesPasswordChange` helper → Task 2.
- Old-format cookies rejected (one-time re-login) → Task 2 (`verifySession` shape guard).
- `passwordChangedAt` column (idempotent initDb + schema ref) → Task 1.
- `getPrincipal` member check; `changeMemberPassword` bump + re-issue → Task 2.
- Member-only invalidation (boss/admin skip lookup) → Task 2.
- Reset bumps `passwordChangedAt` → Task 3.
- ms-epoch precision; re-issue keeps current session valid (strict `<`) → Tasks 2.
- End-to-end behavior verified → Task 4.

**Placeholder scan:** none — every code step shows exact before/after content; Task 4 is verification with concrete, runnable steps.

**Type consistency:** `SessionData { principal, iat, exp }` (Task 2) is consumed within Task 2 (`session.principal`, `session.iat`); `sessionPredatesPasswordChange(iat: number, passwordChangedAt: string | null)` matches its call `sessionPredatesPasswordChange(session.iat, row?.passwordChangedAt ?? null)`; the `passwordChangedAt` column name is identical across Task 1 DDL, Task 3 test schema + query, and Task 2 query; `nowIso` reuse in Task 3 matches the existing declaration; `setSession`/`hashPassword`/`getOne` are all pre-existing exports.

**Every-commit-green:** Tasks 1, 2, 3 each leave `npx tsc --noEmit` at exit 0 (the breaking return-type change and its only consumer are both in Task 2). No intermediate red state.
