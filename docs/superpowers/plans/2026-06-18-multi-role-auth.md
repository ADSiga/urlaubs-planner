# Multi-Role Auth & Department Bosses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared "Boss Mode" with a multi-role system: one full-access admin (existing TOTP), multiple department bosses (each own TOTP, scoped to their department[s]), and members with email/password login that ties leave requests to the logged-in person.

**Architecture:** A signed (HMAC-SHA256) session cookie carries a `Principal` (`role`, `id`, `name`, `departmentIds`). Security-critical pure logic (password hashing, session signing, scope checks, TOTP secret generation) lives in dependency-light TS modules under `kalender/lib/` and is unit-tested with the built-in Node test runner. A server-only `lib/auth.ts` wires those to Next cookies and the SQLite database. Every mutating server action gains a principal-based guard.

**Tech Stack:** Next.js 16.2.6 (App Router, Server Actions), React 19, raw `sqlite3` against `../dev.db`, `otplib` (TOTP, already installed), `qrcode` (already installed), Node 22 built-in `crypto` (scrypt + HMAC) and `node --test`.

## Global Constraints

- **No new npm dependencies.** Use `otplib` and `qrcode` (already installed) and Node built-in `crypto`. Verbatim: passwords hashed with `crypto.scrypt`; sessions signed with HMAC-SHA256.
- **Runtime DB is raw `sqlite3` at `path.resolve(process.cwd(), "../dev.db")`.** The root `schema.prisma` is documentation only and not used at runtime.
- **Per `kalender/AGENTS.md`:** this Next.js (16.2.6) has breaking changes vs. common knowledge — consult `kalender/node_modules/next/dist/docs/` before writing route/cookie/server-action code.
- **All work happens inside `kalender/`** unless a path says otherwise. Run commands from `kalender/`.
- **Cookies** are always `httpOnly`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`.
- **German UI copy** — match existing tone (e.g. "Nur Administratoren", "Boss Mode").
- **`SESSION_SECRET`** must be read from `process.env`; throw if missing (same pattern as the existing `BOSS_SECRET` check).
- **Back up `dev.db`** before the first run that mutates schema.

---

### Task 1: Centralized DB layer + idempotent migrations

**Files:**
- Create: `kalender/lib/db.ts`
- Create: `kalender/lib/db.test.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `queryDatabase<T>(sql: string, params?: any[]): Promise<T[]>`
  - `runDatabase(sql: string, params?: any[]): Promise<void>`
  - `getOne<T>(sql: string, params?: any[]): Promise<T | null>`
  - `initDb(): Promise<void>` — creates `Department`, `Boss`, `BossDepartment` tables and adds `User.email` / `User.passwordHash` columns, idempotently.
  - DB path is overridable for tests via `process.env.URLAUBE_DB_PATH`.

- [ ] **Step 1: Initialize git if needed (one-time)**

Run from repo root `C:\laragon\www\Urlaube`:
```bash
git rev-parse --is-inside-work-tree 2>/dev/null || git init
```
Expected: either `true`, or `Initialized empty Git repository`. (The project is not yet a git repo; subsequent commit steps require this.)

- [ ] **Step 2: Write the failing test**

Create `kalender/lib/db.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";

test("initDb creates Boss/BossDepartment tables and User auth columns idempotently", async () => {
  const dbFile = join(tmpdir(), `urlaube-test-${randomUUID()}.db`);
  process.env.URLAUBE_DB_PATH = dbFile;
  const { runDatabase, queryDatabase, initDb, getOne } = await import("./db.ts");

  // Seed a minimal pre-existing User table (as the real DB already has one).
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, name TEXT)`
  );

  await initDb();
  await initDb(); // second call must not throw (idempotent)

  const tables = await queryDatabase<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table'`
  );
  const tableNames = tables.map((t) => t.name);
  assert.ok(tableNames.includes("Boss"));
  assert.ok(tableNames.includes("BossDepartment"));
  assert.ok(tableNames.includes("Department"));

  const cols = await queryDatabase<{ name: string }>(`PRAGMA table_info(User)`);
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("email"));
  assert.ok(colNames.includes("passwordHash"));

  assert.equal(await getOne(`SELECT * FROM Boss`), null);

  if (existsSync(dbFile)) rmSync(dbFile);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd kalender && node --test lib/db.test.ts`
Expected: FAIL — `Cannot find module './db.ts'` (file not created yet).

- [ ] **Step 4: Write minimal implementation**

Create `kalender/lib/db.ts`:
```ts
import path from "path";
import sqlite3 from "sqlite3";

function dbPath(): string {
  return process.env.URLAUBE_DB_PATH ?? path.resolve(process.cwd(), "../dev.db");
}

export function queryDatabase<T>(sql: string, params: any[] = []): Promise<T[]> {
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath(), sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function runDatabase(sql: string, params: any[] = []): Promise<void> {
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath(), sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function getOne<T>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await queryDatabase<T>(sql, params);
  return rows[0] ?? null;
}

let initialized = false;

export async function initDb(): Promise<void> {
  if (initialized) return;
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS Department (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, createdAt TEXT)`
  );
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS Boss (id TEXT PRIMARY KEY, name TEXT NOT NULL, totpSecret TEXT NOT NULL, createdAt TEXT)`
  );
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS BossDepartment (bossId TEXT NOT NULL, departmentId TEXT NOT NULL, PRIMARY KEY (bossId, departmentId))`
  );
  const cols = await queryDatabase<{ name: string }>(`PRAGMA table_info(User)`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("email")) await runDatabase(`ALTER TABLE User ADD COLUMN email TEXT`);
  if (!names.has("passwordHash")) await runDatabase(`ALTER TABLE User ADD COLUMN passwordHash TEXT`);
  // SQLite treats NULLs as distinct, so multiple members without email stay valid.
  await runDatabase(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON User(email)`);
  initialized = true;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd kalender && node --test lib/db.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add kalender/lib/db.ts kalender/lib/db.test.ts
git commit -m "feat(db): centralized sqlite helpers + idempotent multi-role migrations"
```

---

### Task 2: Password hashing (scrypt)

**Files:**
- Create: `kalender/lib/password.ts`
- Create: `kalender/lib/password.test.ts`

**Interfaces:**
- Consumes: Node `crypto` only.
- Produces:
  - `hashPassword(password: string): string` → `"scrypt$<saltHex>$<hashHex>"`
  - `verifyPassword(password: string, stored: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `kalender/lib/password.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("hashPassword round-trips and rejects wrong password", () => {
  const hash = hashPassword("Sommer2026!");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("Sommer2026!", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("verifyPassword rejects malformed stored values", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "notarealhash"), false);
  assert.equal(verifyPassword("x", "bcrypt$a$b"), false);
});

test("two hashes of same password differ (random salt)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalender && node --test lib/password.test.ts`
Expected: FAIL — `Cannot find module './password.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `kalender/lib/password.ts`:
```ts
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kalender && node --test lib/password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kalender/lib/password.ts kalender/lib/password.test.ts
git commit -m "feat(auth): scrypt password hashing helpers"
```

---

### Task 3: Session crypto + Principal type

**Files:**
- Create: `kalender/lib/session-crypto.ts`
- Create: `kalender/lib/session-crypto.test.ts`

**Interfaces:**
- Consumes: Node `crypto` only.
- Produces:
  - `interface Principal { role: "admin" | "boss" | "member"; id: string; name: string; departmentIds: string[] }`
  - `signSession(principal: Principal, secret: string): string` → `"<payloadB64url>.<sigB64url>"`
  - `verifySession(token: string, secret: string): Principal | null`

- [ ] **Step 1: Write the failing test**

Create `kalender/lib/session-crypto.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, type Principal } from "./session-crypto.ts";

const SECRET = "test-session-secret";
const p: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };

test("signSession/verifySession round-trips a principal", () => {
  const token = signSession(p, SECRET);
  assert.deepEqual(verifySession(token, SECRET), p);
});

test("verifySession rejects a tampered payload", () => {
  const token = signSession(p, SECRET);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...p, role: "admin" })
  ).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, SECRET), null);
});

test("verifySession rejects a wrong secret and malformed tokens", () => {
  const token = signSession(p, SECRET);
  assert.equal(verifySession(token, "other-secret"), null);
  assert.equal(verifySession("garbage", SECRET), null);
  assert.equal(verifySession("", SECRET), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalender && node --test lib/session-crypto.test.ts`
Expected: FAIL — `Cannot find module './session-crypto.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `kalender/lib/session-crypto.ts`:
```ts
import { createHmac, timingSafeEqual } from "crypto";

export interface Principal {
  role: "admin" | "boss" | "member";
  id: string;
  name: string;
  departmentIds: string[];
}

export function signSession(principal: Principal, secret: string): string {
  const payload = Buffer.from(JSON.stringify(principal)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string): Principal | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as Principal;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kalender && node --test lib/session-crypto.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kalender/lib/session-crypto.ts kalender/lib/session-crypto.test.ts
git commit -m "feat(auth): HMAC-signed session token + Principal type"
```

---

### Task 4: Scope helpers (pure authorization logic)

**Files:**
- Create: `kalender/lib/scope.ts`
- Create: `kalender/lib/scope.test.ts`

**Interfaces:**
- Consumes: `Principal` from `./session-crypto`.
- Produces (all pure, accept `Principal | null`):
  - `isAdminPrincipal(p: Principal | null): boolean`
  - `canManageDepartmentScope(p: Principal | null, deptId: string): boolean`
  - `canManageMemberScope(p: Principal | null, memberDeptIds: string[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `kalender/lib/scope.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAdminPrincipal,
  canManageDepartmentScope,
  canManageMemberScope,
} from "./scope.ts";
import type { Principal } from "./session-crypto.ts";

const admin: Principal = { role: "admin", id: "admin", name: "Admin", departmentIds: [] };
const boss: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };
const member: Principal = { role: "member", id: "u1", name: "Tom", departmentIds: ["d1"] };

test("isAdminPrincipal", () => {
  assert.equal(isAdminPrincipal(admin), true);
  assert.equal(isAdminPrincipal(boss), false);
  assert.equal(isAdminPrincipal(null), false);
});

test("canManageDepartmentScope: admin all, boss own only, member never", () => {
  assert.equal(canManageDepartmentScope(admin, "dX"), true);
  assert.equal(canManageDepartmentScope(boss, "d1"), true);
  assert.equal(canManageDepartmentScope(boss, "dX"), false);
  assert.equal(canManageDepartmentScope(member, "d1"), false);
  assert.equal(canManageDepartmentScope(null, "d1"), false);
});

test("canManageMemberScope: boss needs an overlapping department", () => {
  assert.equal(canManageMemberScope(admin, ["dX"]), true);
  assert.equal(canManageMemberScope(boss, ["d2", "d9"]), true);
  assert.equal(canManageMemberScope(boss, ["d9"]), false);
  assert.equal(canManageMemberScope(boss, []), false);
  assert.equal(canManageMemberScope(member, ["d1"]), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalender && node --test lib/scope.test.ts`
Expected: FAIL — `Cannot find module './scope.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `kalender/lib/scope.ts`:
```ts
import type { Principal } from "./session-crypto";

export function isAdminPrincipal(p: Principal | null): boolean {
  return p?.role === "admin";
}

export function canManageDepartmentScope(p: Principal | null, deptId: string): boolean {
  if (!p) return false;
  if (p.role === "admin") return true;
  if (p.role === "boss") return p.departmentIds.includes(deptId);
  return false;
}

export function canManageMemberScope(p: Principal | null, memberDeptIds: string[]): boolean {
  if (!p) return false;
  if (p.role === "admin") return true;
  if (p.role === "boss") return memberDeptIds.some((d) => p.departmentIds.includes(d));
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kalender && node --test lib/scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add kalender/lib/scope.ts kalender/lib/scope.test.ts
git commit -m "feat(auth): pure scope/authorization helpers"
```

---

### Task 5: TOTP secret + otpauth helpers

**Files:**
- Create: `kalender/lib/totp.ts`
- Create: `kalender/lib/totp.test.ts`

**Interfaces:**
- Consumes: Node `crypto` only (no otplib here — verification lives in Task 6).
- Produces:
  - `generateBase32Secret(bytes?: number): string` — RFC4648 base32, default 20 bytes → 32 chars.
  - `buildOtpauthUrl(label: string, secret: string, issuer?: string): string`

- [ ] **Step 1: Write the failing test**

Create `kalender/lib/totp.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBase32Secret, buildOtpauthUrl } from "./totp.ts";

test("generateBase32Secret produces uppercase base32 of expected length", () => {
  const s = generateBase32Secret();
  assert.match(s, /^[A-Z2-7]+$/);
  assert.equal(s.length, 32); // 20 bytes -> 160 bits / 5 = 32 chars
  assert.notEqual(generateBase32Secret(), generateBase32Secret());
});

test("buildOtpauthUrl encodes issuer, label and secret", () => {
  const url = buildOtpauthUrl("Boss Anna", "ABC234", "Urlaubs-Planer");
  assert.equal(
    url,
    "otpauth://totp/Urlaubs-Planer:Boss%20Anna?secret=ABC234&issuer=Urlaubs-Planer"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kalender && node --test lib/totp.test.ts`
Expected: FAIL — `Cannot find module './totp.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `kalender/lib/totp.ts`:
```ts
import { randomBytes } from "crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

export function buildOtpauthUrl(
  label: string,
  secret: string,
  issuer = "Urlaubs-Planer"
): string {
  const iss = encodeURIComponent(issuer);
  return `otpauth://totp/${iss}:${encodeURIComponent(label)}?secret=${secret}&issuer=${iss}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kalender && node --test lib/totp.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add kalender/lib/totp.ts kalender/lib/totp.test.ts
git commit -m "feat(auth): base32 TOTP secret + otpauth URL helpers"
```

---

### Task 6: Auth orchestration (`lib/auth.ts`) — replaces `lib/boss-auth.ts`

**Files:**
- Create: `kalender/lib/auth.ts`
- Modify: `kalender/lib/boss-auth.ts` (re-export shim, then delete its body)
- Reference: `kalender/node_modules/next/dist/docs/` for `cookies()` usage in this Next version.

**Interfaces:**
- Consumes: Task 1 (`queryDatabase`), Task 2 (`verifyPassword`), Task 3 (`signSession`/`verifySession`/`Principal`), Task 4 (scope helpers), `otplib`.
- Produces (server-only, all async):
  - `getPrincipal(): Promise<Principal | null>`
  - `loginStaff(code: string): Promise<boolean>` — checks admin `BOSS_SECRET` first, then each `Boss.totpSecret`; sets session.
  - `loginMember(email: string, password: string): Promise<boolean>`
  - `logout(): Promise<void>`
  - `isAdmin(): Promise<boolean>`
  - `isBossModeActive(): Promise<boolean>` — `true` for admin OR boss (compat shim for existing call sites).
  - `canManageDepartment(deptId: string): Promise<boolean>`
  - `canManageMember(userId: string): Promise<boolean>`
  - Re-exports `type Principal`.

- [ ] **Step 1: Read the Next docs for cookies (no code yet)**

Run: `ls kalender/node_modules/next/dist/docs/` and read the cookies/headers and server-actions entries. Confirm `cookies()` is `await`-ed (as the existing `lib/boss-auth.ts` already does). This task has no unit test (it is Next/DB-coupled); it is verified by typecheck (Step 4) and the QA checklist in Task 11.

- [ ] **Step 2: Write `lib/auth.ts`**

Create `kalender/lib/auth.ts`:
```ts
import { verify, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { cookies } from "next/headers";
import { queryDatabase } from "./db";
import { verifyPassword } from "./password";
import { signSession, verifySession, type Principal } from "./session-crypto";
import {
  isAdminPrincipal,
  canManageDepartmentScope,
  canManageMemberScope,
} from "./scope";

export type { Principal };

const SESSION_COOKIE = "session";

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable must be set.");
  return s;
}

async function verifyTotp(code: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({
      token: code,
      secret,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    return result.valid;
  } catch (err) {
    console.error("[AUTH] TOTP verify error:", err);
    return false;
  }
}

async function deptIdsForBoss(bossId: string): Promise<string[]> {
  const rows = await queryDatabase<{ departmentId: string }>(
    "SELECT departmentId FROM BossDepartment WHERE bossId = ?",
    [bossId]
  );
  return rows.map((r) => r.departmentId);
}

async function deptIdsForUser(userId: string): Promise<string[]> {
  const rows = await queryDatabase<{ departmentId: string }>(
    "SELECT departmentId FROM UserDepartment WHERE userId = ?",
    [userId]
  );
  return rows.map((r) => r.departmentId);
}

async function setSession(principal: Principal): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSession(principal, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

export async function getPrincipal(): Promise<Principal | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token, sessionSecret());
}

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

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
}

export async function isAdmin(): Promise<boolean> {
  return isAdminPrincipal(await getPrincipal());
}

export async function isBossModeActive(): Promise<boolean> {
  const p = await getPrincipal();
  return p?.role === "admin" || p?.role === "boss";
}

export async function canManageDepartment(deptId: string): Promise<boolean> {
  return canManageDepartmentScope(await getPrincipal(), deptId);
}

export async function canManageMember(userId: string): Promise<boolean> {
  const p = await getPrincipal();
  if (!p) return false;
  if (p.role === "admin") return true;
  return canManageMemberScope(p, await deptIdsForUser(userId));
}
```

- [ ] **Step 3: Turn `lib/boss-auth.ts` into a compat shim**

Replace the entire contents of `kalender/lib/boss-auth.ts` with:
```ts
// Backwards-compatible re-export. All auth logic now lives in ./auth.
export {
  getPrincipal,
  loginStaff,
  loginMember,
  logout,
  isAdmin,
  isBossModeActive,
  canManageDepartment,
  canManageMember,
  type Principal,
} from "./auth";
```
(Existing imports of `isBossModeActive` from `@/lib/boss-auth` keep working; later tasks migrate them to `@/lib/auth`.)

- [ ] **Step 4: Typecheck**

Run: `cd kalender && npx tsc --noEmit`
Expected: no errors. (If `tsc` flags otplib plugin types, mirror the exact import style already in the original `lib/boss-auth.ts`.)

- [ ] **Step 5: Commit**

```bash
git add kalender/lib/auth.ts kalender/lib/boss-auth.ts
git commit -m "feat(auth): principal-based auth orchestration (admin/boss/member)"
```

---

### Task 7: Boss management (admin-only) — actions + page

**Files:**
- Create: `kalender/app/bosse/actions.ts`
- Create: `kalender/app/bosse/page.tsx`
- Create: `kalender/app/bosse/BossList.tsx`
- Modify: `kalender/app/layout.tsx` (add `await initDb()` + admin-only "Bosse" nav link)

**Interfaces:**
- Consumes: Task 1 (`queryDatabase`, `runDatabase`, `initDb`), Task 5 (`generateBase32Secret`, `buildOtpauthUrl`), Task 6 (`getPrincipal`, `isAdmin`), existing `DepartmentMultiSelect` (`kalender/app/components/DepartmentMultiSelect.tsx`), `qrcode`.
- Produces:
  - `handleCreateBoss(formData: FormData): Promise<void>` — fields `name`, `departmentIds[]`; generates secret.
  - `handleUpdateBoss(formData: FormData): Promise<void>` — fields `id`, `name`, `departmentIds[]`.
  - `handleDeleteBoss(formData: FormData): Promise<void>` — field `id`.
  - `handleRegenerateSecret(formData: FormData): Promise<void>` — field `id`.

- [ ] **Step 1: Write boss actions**

Create `kalender/app/bosse/actions.ts`:
```ts
"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { queryDatabase, runDatabase } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { generateBase32Secret } from "@/lib/totp";

export async function handleCreateBoss(formData: FormData) {
  if (!(await isAdmin())) {
    console.error("Nicht autorisierter Versuch, einen Boss anzulegen!");
    return;
  }
  const name = (formData.get("name") as string)?.trim();
  const departmentIds = formData.getAll("departmentIds") as string[];
  if (!name) return;

  const id = randomUUID();
  await runDatabase(
    `INSERT INTO Boss (id, name, totpSecret, createdAt) VALUES (?, ?, ?, ?)`,
    [id, name, generateBase32Secret(), new Date().toISOString()]
  );
  for (const deptId of departmentIds) {
    await runDatabase(
      `INSERT INTO BossDepartment (bossId, departmentId) VALUES (?, ?)`,
      [id, deptId]
    );
  }
  revalidatePath("/bosse");
}

export async function handleUpdateBoss(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const departmentIds = formData.getAll("departmentIds") as string[];
  if (!id || !name) return;

  await runDatabase(`UPDATE Boss SET name = ? WHERE id = ?`, [name, id]);
  await runDatabase(`DELETE FROM BossDepartment WHERE bossId = ?`, [id]);
  for (const deptId of departmentIds) {
    await runDatabase(
      `INSERT INTO BossDepartment (bossId, departmentId) VALUES (?, ?)`,
      [id, deptId]
    );
  }
  revalidatePath("/bosse");
}

export async function handleRegenerateSecret(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  if (!id) return;
  await runDatabase(`UPDATE Boss SET totpSecret = ? WHERE id = ?`, [
    generateBase32Secret(),
    id,
  ]);
  revalidatePath("/bosse");
}

export async function handleDeleteBoss(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  if (!id) return;
  await runDatabase(`DELETE FROM BossDepartment WHERE bossId = ?`, [id]);
  await runDatabase(`DELETE FROM Boss WHERE id = ?`, [id]);
  revalidatePath("/bosse");
}
```

- [ ] **Step 2: Write the BossList client component (QR display)**

Create `kalender/app/bosse/BossList.tsx`:
```tsx
"use client";

import { useState } from "react";

interface BossRow {
  id: string;
  name: string;
  otpauthUrl: string;
  qrDataUrl: string;
  departmentNames: string;
}

export default function BossList({
  bosses,
  onDelete,
  onRegenerate,
}: {
  bosses: BossRow[];
  onDelete: (formData: FormData) => Promise<void>;
  onRegenerate: (formData: FormData) => Promise<void>;
}) {
  const [shown, setShown] = useState<string | null>(null);

  if (bosses.length === 0) {
    return <p className="text-sm text-zinc-400 py-4 text-center">Keine Bosse angelegt.</p>;
  }

  return (
    <div className="space-y-3">
      {bosses.map((b) => (
        <div
          key={b.id}
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{b.name}</p>
              <p className="text-xs text-zinc-500">{b.departmentNames || "Keine Abteilung"}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShown(shown === b.id ? null : b.id)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {shown === b.id ? "QR verbergen" : "QR anzeigen"}
              </button>
              <form action={onRegenerate}>
                <input type="hidden" name="id" value={b.id} />
                <button className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300">
                  Neuer Code
                </button>
              </form>
              <form action={onDelete}>
                <input type="hidden" name="id" value={b.id} />
                <button className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-200 dark:bg-rose-950/30">
                  Löschen
                </button>
              </form>
            </div>
          </div>
          {shown === b.id && (
            <div className="mt-4 flex flex-col items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.qrDataUrl} alt={`QR für ${b.name}`} className="h-44 w-44" />
              <code className="break-all text-center text-[10px] text-zinc-400">{b.otpauthUrl}</code>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write the boss page (admin-gated, server-rendered)**

Create `kalender/app/bosse/page.tsx`:
```tsx
import QRCode from "qrcode";
import { queryDatabase, initDb } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { buildOtpauthUrl } from "@/lib/totp";
import DepartmentMultiSelect from "../components/DepartmentMultiSelect";
import BossList from "./BossList";
import {
  handleCreateBoss,
  handleDeleteBoss,
  handleRegenerateSecret,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function BossePage() {
  await initDb();
  const principal = await getPrincipal();
  if (principal?.role !== "admin") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-6">
        <p className="text-sm text-zinc-500 text-center py-12">
          Nur der Administrator kann Bosse verwalten.
        </p>
      </main>
    );
  }

  const allDepartments = await queryDatabase<{ id: string; name: string }>(
    "SELECT id, name FROM Department ORDER BY name ASC"
  );

  const bossesRaw = await queryDatabase<{
    id: string;
    name: string;
    totpSecret: string;
    departmentNames: string | null;
  }>(`
    SELECT b.id, b.name, b.totpSecret, GROUP_CONCAT(d.name, ', ') as departmentNames
    FROM Boss b
    LEFT JOIN BossDepartment bd ON b.id = bd.bossId
    LEFT JOIN Department d ON bd.departmentId = d.id
    GROUP BY b.id
    ORDER BY b.name ASC
  `);

  const bosses = await Promise.all(
    bossesRaw.map(async (b) => {
      const otpauthUrl = buildOtpauthUrl(b.name, b.totpSecret);
      return {
        id: b.id,
        name: b.name,
        departmentNames: b.departmentNames ?? "",
        otpauthUrl,
        qrDataUrl: await QRCode.toDataURL(otpauthUrl),
      };
    })
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sticky top-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-zinc-400">
              Boss hinzufügen
            </h2>
            <form action={handleCreateBoss} className="space-y-4">
              <input
                type="text"
                name="name"
                placeholder="Name"
                required
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">
                  Abteilung(en)
                </label>
                <DepartmentMultiSelect allDepartments={allDepartments} />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 shadow-sm"
              >
                Boss anlegen
              </button>
            </form>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Bosse verwalten
            </h2>
            <BossList
              bosses={bosses}
              onDelete={handleDeleteBoss}
              onRegenerate={handleRegenerateSecret}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
```

(Confirm `DepartmentMultiSelect` accepts a prop named `allDepartments: {id,name}[]` and emits checkbox inputs named `departmentIds`. Read `kalender/app/components/DepartmentMultiSelect.tsx` first; if the prop/name differs, match it.)

- [ ] **Step 4: Add `initDb()` + admin-only nav link to layout**

In `kalender/app/layout.tsx`:
- Add import: `import { initDb } from "@/lib/db";` and `import { getPrincipal } from "@/lib/auth";`
- At the top of `RootLayout`, before `getPendingCount()`, add: `await initDb();`
- Replace `const bossActive = await isBossModeActive();` with:
  ```ts
  const principal = await getPrincipal();
  const bossActive = principal?.role === "admin" || principal?.role === "boss";
  ```
  (and update the import to `@/lib/auth`).
- In the `<nav>` block, after the Abteilungen link, add (admin-only):
  ```tsx
  {principal?.role === "admin" && (
    <Link href="/bosse" className="hover:text-emerald-500 transition-colors">Bosse</Link>
  )}
  ```

- [ ] **Step 5: Typecheck**

Run: `cd kalender && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add kalender/app/bosse kalender/app/layout.tsx
git commit -m "feat(bosse): admin-only boss management with TOTP QR provisioning"
```

---

### Task 8: Member email/password provisioning + department scoping (`/mitglieder`)

**Files:**
- Modify: `kalender/app/mitglieder/actions.ts`
- Modify: `kalender/app/mitglieder/page.tsx`
- Modify: `kalender/app/EditableUser.tsx` (add email/password edit fields)
- Reference: `kalender/app/EditableUser.tsx` current props before editing.

**Interfaces:**
- Consumes: Task 6 (`getPrincipal`, `isBossModeActive`, `canManageMember`, `canManageDepartmentScope` via principal), Task 2 (`hashPassword`).
- Produces: updated `handleCreateUser` / `handleUpdateUser` that persist `email`, `passwordHash`, enforce department scope; member create form includes `email` + `password` inputs.

- [ ] **Step 1: Update `mitglieder/actions.ts` imports and helpers**

In `kalender/app/mitglieder/actions.ts`:
- Remove the local `queryDatabase` / `runDatabase` definitions; import from the shared module instead:
  ```ts
  import { queryDatabase, runDatabase } from "@/lib/db";
  import { getPrincipal } from "@/lib/auth";
  import { canManageDepartmentScope, canManageMemberScope } from "@/lib/scope";
  import { hashPassword } from "@/lib/password";
  ```
  (Keep `randomUUID`, `revalidatePath`.)

- [ ] **Step 2: Enforce scope + persist email/password in `handleCreateUser`**

Replace the body of `handleCreateUser` with:
```ts
export async function handleCreateUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied anzulegen!");
    return;
  }

  const name = formData.get("name") as string;
  const color = (formData.get("color") as string) || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[];
  const email = ((formData.get("email") as string) || "").trim() || null;
  const password = (formData.get("password") as string) || "";
  const vacationDays = parseInt((formData.get("vacationDays") as string) || "35", 10);
  const prevYearDays = parseInt((formData.get("prevYearDays") as string) || "0", 10);
  if (!name || departmentIds.length === 0) return;

  // A boss may only assign departments they manage.
  if (
    principal.role === "boss" &&
    !departmentIds.every((d) => canManageDepartmentScope(principal, d))
  ) {
    console.error("Boss versucht, fremde Abteilung zuzuweisen!");
    return;
  }

  const newUserId = randomUUID();
  const passwordHash = password ? hashPassword(password) : null;

  try {
    await runDatabase(
      `INSERT INTO User (id, name, color, vacationDays, prevYearDays, email, passwordHash, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newUserId, name, color, vacationDays, prevYearDays, email, passwordHash, new Date().toISOString()]
    );
  } catch (e) {
    console.error("Mitglied anlegen fehlgeschlagen (evtl. E-Mail bereits vergeben):", e);
    return;
  }

  for (const deptId of departmentIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [newUserId, deptId]);
  }

  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}
```

- [ ] **Step 3: Enforce scope + optional password change in `handleUpdateUser`**

Replace the body of `handleUpdateUser` with:
```ts
export async function handleUpdateUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied zu ändern!");
    return;
  }

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const color = (formData.get("color") as string) || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[];
  const email = ((formData.get("email") as string) || "").trim() || null;
  const password = (formData.get("password") as string) || "";
  const vacationDays = parseInt((formData.get("vacationDays") as string) || "35", 10);
  const prevYearDays = parseInt((formData.get("prevYearDays") as string) || "0", 10);
  if (!id || !name) return;

  // Boss may only edit a member who is in one of their departments.
  if (principal.role === "boss") {
    const memberDepts = (
      await queryDatabase<{ departmentId: string }>(
        "SELECT departmentId FROM UserDepartment WHERE userId = ?",
        [id]
      )
    ).map((r) => r.departmentId);
    if (!canManageMemberScope(principal, memberDepts)) {
      console.error("Boss versucht, fremdes Mitglied zu ändern!");
      return;
    }
    if (!departmentIds.every((d) => canManageDepartmentScope(principal, d))) {
      console.error("Boss versucht, fremde Abteilung zuzuweisen!");
      return;
    }
  }

  await runDatabase(
    `UPDATE User SET name = ?, color = ?, vacationDays = ?, prevYearDays = ?, email = ? WHERE id = ?`,
    [name, color, vacationDays, prevYearDays, email, id]
  );
  if (password) {
    await runDatabase(`UPDATE User SET passwordHash = ? WHERE id = ?`, [hashPassword(password), id]);
  }

  await runDatabase(`DELETE FROM UserDepartment WHERE userId = ?`, [id]);
  for (const deptId of departmentIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [id, deptId]);
  }

  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}
```

- [ ] **Step 4: Scope `handleDeleteUser` to the principal**

In `handleDeleteUser`, replace the `isBossModeActive` guard with:
```ts
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied zu löschen!");
    return;
  }
  const id = formData.get("id") as string;
  if (!id) return;
  if (principal.role === "boss") {
    const memberDepts = (
      await queryDatabase<{ departmentId: string }>(
        "SELECT departmentId FROM UserDepartment WHERE userId = ?",
        [id]
      )
    ).map((r) => r.departmentId);
    if (!canManageMemberScope(principal, memberDepts)) {
      console.error("Boss versucht, fremdes Mitglied zu löschen!");
      return;
    }
  }
```
(Keep the existing `DELETE FROM ...` statements and `revalidatePath` calls that follow.)

- [ ] **Step 5: Add email/password inputs to the create form + scope the page**

In `kalender/app/mitglieder/page.tsx`:
- Replace the local `queryDatabase`/`runDatabase` with `import { queryDatabase } from "@/lib/db";` and `import { getPrincipal } from "@/lib/auth";`.
- Replace `const bossActive = await isBossModeActive();` with:
  ```ts
  const principal = await getPrincipal();
  const canManage = principal?.role === "admin" || principal?.role === "boss";
  ```
- Scope departments + users for a boss. After loading `allDepartments`, add:
  ```ts
  const visibleDepartments =
    principal?.role === "boss"
      ? allDepartments.filter((d) => principal.departmentIds.includes(d.id))
      : allDepartments;
  ```
  Use `visibleDepartments` in the `DepartmentMultiSelect` and pass it as `allDepartments` to `EditableUser`.
- Filter the rendered users for a boss: keep only users with at least one department in `principal.departmentIds`. Add after building `usersWithTakenDays`:
  ```ts
  const visibleUsers =
    principal?.role === "boss"
      ? usersWithTakenDays.filter((u) =>
          u.departmentIds.some((d) => principal.departmentIds.includes(d))
        )
      : usersWithTakenDays;
  ```
  and map over `visibleUsers` instead of `usersWithTakenDays`.
- Replace every `bossActive` reference in the JSX with `canManage`.
- Inside the create `<form action={handleCreateUser}>`, add these fields before the submit button:
  ```tsx
  <div>
    <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">E-Mail (Login)</label>
    <input type="email" name="email" placeholder="name@firma.de" className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
  </div>
  <div>
    <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Passwort (Login)</label>
    <input type="password" name="password" placeholder="Initialpasswort" className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
  </div>
  ```

- [ ] **Step 6: Add email/password to the edit form in `EditableUser.tsx`**

Read `kalender/app/EditableUser.tsx`. Extend the `user` prop type with `email?: string | null`. Inside the edit `<form>` (the one wired to `onUpdate`), add an email input pre-filled with `defaultValue={user.email ?? ""}` (name `email`) and a password input (name `password`, `placeholder="Neues Passwort (leer = unverändert)"`), mirroring the existing field markup. No password value is ever sent back to the client — only the edit input.

- [ ] **Step 7: Typecheck**

Run: `cd kalender && npx tsc --noEmit`
Expected: no errors. Note: `mitglieder/page.tsx` must `SELECT ... u.email` if `EditableUser` reads `user.email` — add `u.email` to the users query `SELECT` list and to the `DbUser` interface.

- [ ] **Step 8: Commit**

```bash
git add kalender/app/mitglieder kalender/app/EditableUser.tsx
git commit -m "feat(mitglieder): member email/password provisioning + boss department scoping"
```

---

### Task 9: Authorization for leave & department actions + department scoping

**Files:**
- Modify: `kalender/app/urlaube/actions.ts`
- Modify: `kalender/app/abteilungen/page.tsx`
- Modify: `kalender/app/urlaube/page.tsx`

**Interfaces:**
- Consumes: Task 6 (`getPrincipal`), Task 1 (`queryDatabase`).
- Produces: leave approve/update/delete scoped to the principal's departments; department create/delete admin-only; rename scoped; pending/lists filtered per principal.

- [ ] **Step 1: Add a leave-scope guard helper in `urlaube/actions.ts`**

In `kalender/app/urlaube/actions.ts`:
- Replace local `queryDatabase`/`runDatabase` with `import { queryDatabase, runDatabase } from "@/lib/db";`
- Add `import { getPrincipal } from "@/lib/auth";`
- Add this helper near the top (after imports):
  ```ts
  async function canActOnLeave(leaveId: string): Promise<boolean> {
    const principal = await getPrincipal();
    if (!principal || principal.role === "member") return false;
    if (principal.role === "admin") return true;
    // boss: the leave's owner must share a department with the boss
    const rows = await queryDatabase<{ departmentId: string }>(
      `SELECT ud.departmentId
       FROM LeaveRequest lr
       JOIN UserDepartment ud ON lr.userId = ud.userId
       WHERE lr.id = ?`,
      [leaveId]
    );
    return rows.some((r) => principal.departmentIds.includes(r.departmentId));
  }
  ```

- [ ] **Step 2: Apply the guard to approve/update/delete leave**

In `handleApproveLeave`, `handleUpdateLeave`, and `handleDeleteLeave`, replace the existing `if (!(await isBossModeActive())) { ... return; }` block with:
```ts
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await canActOnLeave(id))) {
    console.error("Nicht autorisierter / abteilungsfremder Zugriff auf Urlaubsantrag!");
    return;
  }
```
Remove the now-duplicated `const id = formData.get("id") ...` lines that previously followed each guard (keep a single declaration as shown). Remove the `isBossModeActive` import if no longer used.

- [ ] **Step 3: Scope department actions in `abteilungen/page.tsx`**

In `kalender/app/abteilungen/page.tsx`:
- Replace local `queryDatabase`/`runDatabase` with `import { queryDatabase, runDatabase } from "@/lib/db";` and add `import { getPrincipal } from "@/lib/auth";`
- Remove the inline `CREATE TABLE IF NOT EXISTS Department` block (now handled by `initDb`).
- Replace `const bossActive = await isBossModeActive();` with:
  ```ts
  const principal = await getPrincipal();
  const isAdminUser = principal?.role === "admin";
  const canManage = principal?.role === "admin" || principal?.role === "boss";
  ```
- In `handleCreateDepartment` and `handleDeleteDepartment`, change the guard to admin-only:
  ```ts
  const principal = await getPrincipal();
  if (principal?.role !== "admin") return;
  ```
- In `handleUpdateDepartment` (rename), change the guard to scope-checked:
  ```ts
  const principal = await getPrincipal();
  const id = formData.get("id") as string;
  const newName = formData.get("name") as string;
  if (!id || !newName || newName.trim() === "") return;
  if (principal?.role !== "admin" && !(principal?.role === "boss" && principal.departmentIds.includes(id))) {
    console.error("Nicht autorisierter Versuch, Abteilung umzubenennen!");
    return;
  }
  ```
- Scope the displayed list for a boss:
  ```ts
  const departments = await queryDatabase<DbDepartment>("SELECT * FROM Department ORDER BY name ASC");
  const visibleDepartments =
    principal?.role === "boss"
      ? departments.filter((d) => principal.departmentIds.includes(d.id))
      : departments;
  ```
  Render `visibleDepartments`. Show the "Abteilung hinzufügen" create form only when `isAdminUser` (bosses can't create departments); render the existing read-only notice otherwise. Pass `onUpdate`/`onDelete` to `EditableDepartment` based on: rename allowed when `canManage` and (admin or boss owns it — for a boss the list is already filtered to owned departments, so `canManage` suffices); delete only when `isAdminUser`.

- [ ] **Step 4: Filter pending/approved lists per principal in `urlaube/page.tsx`**

In `kalender/app/urlaube/page.tsx`:
- Replace local `queryDatabase` with `import { queryDatabase } from "@/lib/db";` and add `import { getPrincipal } from "@/lib/auth";`
- Replace `const bossActive = await isBossModeActive();` with:
  ```ts
  const principal = await getPrincipal();
  const canApprove = principal?.role === "admin" || principal?.role === "boss";
  ```
- For a boss, only show pending requests from their departments. After computing `pendingRequests`, add:
  ```ts
  const visiblePending =
    principal?.role === "boss"
      ? pendingRequests.filter((r) =>
          (r.userDepartment ?? "")
            .split(",")
            .some((name) => name) && // names available; prefer id-based filter below
          true
        )
      : pendingRequests;
  ```
  Replace the placeholder filter with an id-based one: extend the leave query `SELECT` to also `GROUP_CONCAT(ud.departmentId) as userDeptIds`, add `userDeptIds?: string` to `DbLeaveRequest`, then:
  ```ts
  const visiblePending =
    principal?.role === "boss"
      ? pendingRequests.filter((r) =>
          (r.userDeptIds ?? "").split(",").some((d) => principal.departmentIds.includes(d))
        )
      : pendingRequests;
  ```
- Use `visiblePending` (not `pendingRequests`) in the "Offene Genehmigungen" section, and replace `bossActive` with `canApprove` everywhere in the JSX (approve/update/delete buttons stay gated on `canApprove`; the server actions independently re-check scope from Task 9 Step 2, so cross-department buttons that slip through are still rejected server-side).

- [ ] **Step 5: Typecheck**

Run: `cd kalender && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add kalender/app/urlaube/actions.ts kalender/app/abteilungen/page.tsx kalender/app/urlaube/page.tsx
git commit -m "feat(authz): department-scoped leave approval and department management"
```

---

### Task 10: Login UX (member + staff) + header identity + member-bound leave form

**Files:**
- Modify: `kalender/app/AdminToggle.tsx` (rename concept to a login menu with two paths)
- Modify: `kalender/app/actions_auth.ts`
- Modify: `kalender/app/layout.tsx`
- Modify: `kalender/app/urlaube/page.tsx` and `kalender/app/urlaube/LeaveForm.tsx` (bind to logged-in member)
- Reference: `kalender/app/urlaube/LeaveForm.tsx` current props before editing.

**Interfaces:**
- Consumes: Task 6 (`loginStaff`, `loginMember`, `logout`, `getPrincipal`).
- Produces: a login modal with Member (email/password) and Staff (TOTP) tabs; header shows `principal.name` + role and a logout button; member's leave form is pre-bound to their own user id.

- [ ] **Step 1: Rewrite the auth server actions**

Replace `kalender/app/actions_auth.ts` with:
```ts
"use server";

import { loginStaff, loginMember, logout } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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

export async function handleLogout() {
  await logout();
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: Rewrite `AdminToggle.tsx` as a two-path login menu**

Replace `kalender/app/AdminToggle.tsx` with a client component named `LoginMenu` exporting default. It receives:
```tsx
interface LoginMenuProps {
  principalName: string | null;
  principalRole: "admin" | "boss" | "member" | null;
  onStaffLogin: (code: string) => Promise<boolean>;
  onMemberLogin: (email: string, password: string) => Promise<boolean>;
  onLogout: () => Promise<void>;
}
```
Behavior:
- If `principalRole` is set: show `principalName` + a role label (`Admin` / `Boss` / `Mitglied`) and a logout button calling `onLogout()` then `window.location.reload()`.
- Else: a "Login" button opening a modal with two tabs:
  - **Mitglied**: email + password inputs → `onMemberLogin(email, password)`.
  - **Personal**: a 6-digit code input (reuse the existing digit-only `onChange` + styling) → `onStaffLogin(code)`.
  - On success: close modal + `window.location.reload()`. On failure: show the existing "Zugriff verweigert" error styling.
Keep the existing Tailwind classes/markup from the current file for the modal shell and the code input; add a simple tab switcher (`useState<"member" | "staff">`).
Save the file as `kalender/app/AdminToggle.tsx` (keep the filename to minimize import churn) but rename the default export usage in the layout accordingly.

- [ ] **Step 3: Wire the layout header**

In `kalender/app/layout.tsx`, replace the `<AdminToggle .../>` usage with:
```tsx
<AdminToggle
  principalName={principal?.name ?? null}
  principalRole={principal?.role ?? null}
  onStaffLogin={handleStaffLogin}
  onMemberLogin={handleMemberLogin}
  onLogout={handleLogout}
/>
```
Update the import to `import { handleStaffLogin, handleMemberLogin, handleLogout } from "./actions_auth";`. (`principal` is already available from Task 7 Step 4.)

- [ ] **Step 4: Bind the leave form to a logged-in member**

In `kalender/app/urlaube/page.tsx`:
- Pass the principal down to `LeaveForm`:
  ```tsx
  <LeaveForm
    users={users}
    currentMemberId={principal?.role === "member" ? principal.id : null}
    onCreateLeave={handleCreateLeave}
    checkConflicts={checkConflicts}
    getUserBalance={getUserBalance}
    calculateWorkingDays={calculateWorkingDays}
  />
  ```
In `kalender/app/urlaube/LeaveForm.tsx`:
- Add `currentMemberId: string | null` to its props.
- When `currentMemberId` is set, render the member's name as fixed text and a hidden `<input type="hidden" name="userId" value={currentMemberId} />` instead of the user picker (so a member can only file for themselves). When it is `null`, keep the existing picker (used by admin/boss creating on behalf of others, and anonymous viewing — note: anonymous users can view but `handleCreateLeave` will still accept a submission; that matches current behavior).

- [ ] **Step 5: Harden `handleCreateLeave` for members**

In `kalender/app/urlaube/actions.ts` `handleCreateLeave`, after reading `userId`, add:
```ts
  const principal = await getPrincipal();
  if (principal?.role === "member" && principal.id !== userId) {
    console.error("Mitglied versucht, Urlaub für eine andere Person einzutragen!");
    return;
  }
```
(Leaves the existing validation logic intact.)

- [ ] **Step 6: Typecheck**

Run: `cd kalender && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add kalender/app/AdminToggle.tsx kalender/app/actions_auth.ts kalender/app/layout.tsx kalender/app/urlaube
git commit -m "feat(auth): dual login (member/staff) UI, header identity, member-bound leave form"
```

---

### Task 11: Schema sync, env, full test + QA pass

**Files:**
- Modify: `schema.prisma` (repo root)
- Modify: `kalender/.env.local` and root `.env`
- Create: `docs/superpowers/QA-multi-role-auth.md`

**Interfaces:**
- Consumes: everything above.
- Produces: an accurate `schema.prisma`, a configured `SESSION_SECRET`, a passing test run, and a manual QA checklist.

- [ ] **Step 1: Add `SESSION_SECRET` to env files**

Append to `kalender/.env.local` and root `.env`:
```
SESSION_SECRET="<paste output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">"
```
Generate it: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the value.

- [ ] **Step 2: Sync `schema.prisma` to match runtime (documentation only)**

In root `schema.prisma`:
- Add to `model User`: `email String? @unique` and `passwordHash String?` and `leaveDetails` is on `LeaveRequest` (add `leaveDetails String? @default("")` to `LeaveRequest`, which already exists at runtime).
- Add:
  ```prisma
  model Boss {
    id          String           @id @default(cuid())
    name        String
    totpSecret  String
    createdAt   DateTime         @default(now())
    departments BossDepartment[]
  }

  model BossDepartment {
    bossId       String
    departmentId String
    boss         Boss       @relation(fields: [bossId], references: [id])
    department   Department @relation(fields: [departmentId], references: [id])

    @@id([bossId, departmentId])
  }
  ```
- Add `bosses BossDepartment[]` to `model Department`.
(Note in a comment at the top that the runtime uses raw SQL via `lib/db.ts`; this file is for reference.)

- [ ] **Step 3: Run the full unit-test suite**

Run: `cd kalender && node --test lib/db.test.ts lib/password.test.ts lib/session-crypto.test.ts lib/scope.test.ts lib/totp.test.ts`
Expected: all tests pass (12 tests across 5 files).

- [ ] **Step 4: Back up the DB and start the app**

Run from repo root:
```bash
cp dev.db dev.db.preauth.bak
cd kalender && npm run dev
```
Expected: dev server starts; visiting any page triggers `initDb()` and the app loads without errors.

- [ ] **Step 5: Write the QA checklist and execute it**

Create `docs/superpowers/QA-multi-role-auth.md` with this checklist, then perform each step against the running app and tick it:
```markdown
# QA — Multi-Role Auth

## Admin (existing BOSS_SECRET TOTP)
- [ ] Login via "Personal" tab with the authenticator code → header shows "Admin".
- [ ] "Bosse" nav link is visible; can create a boss (name + departments) and see a QR.
- [ ] Scan the QR in an authenticator app; that code logs in as the boss (Step below).
- [ ] Can create/delete departments and create/edit/delete any member.
- [ ] Can approve any pending leave.

## Boss (own department[s] only)
- [ ] Login via "Personal" tab with the boss's authenticator code → header shows the boss name + "Boss".
- [ ] "Bosse" link is NOT visible.
- [ ] /mitglieder shows ONLY members in the boss's department(s); can create/edit/delete them.
- [ ] Cannot assign a member to a department the boss does not own (rejected).
- [ ] /abteilungen shows only owned departments; can rename them; cannot create or delete.
- [ ] /urlaube "Offene Genehmigungen" shows only own-department pending requests; can approve them.
- [ ] Attempting to approve another department's request (e.g. via crafted form) is rejected server-side.

## Member (email/password)
- [ ] Admin/boss created the member with an email + initial password.
- [ ] Login via "Mitglied" tab with email/password → header shows the member name + "Mitglied".
- [ ] /urlaube leave form is pre-bound to the member (no user picker); can file own request.
- [ ] Cannot see "Offene Genehmigungen"; cannot access member/department/boss management actions.
- [ ] Wrong password is rejected.

## Anonymous
- [ ] Can view the calendar/overview without logging in.
```

- [ ] **Step 6: Commit**

```bash
git add schema.prisma docs/superpowers/QA-multi-role-auth.md
git commit -m "docs(auth): sync prisma schema, add SESSION_SECRET, QA checklist"
```
(Do not commit `.env` / `.env.local` if they are gitignored — verify with `git status` first.)

---

## Self-Review Notes

- **Spec coverage:** roles & matrix → Tasks 6–10; data model/migrations → Task 1 (+ schema sync Task 11); password hashing → Task 2; signed session → Task 3; scope logic → Task 4; TOTP/QR → Tasks 5–7; auth orchestration & login UX → Tasks 6, 10; authorization enforcement → Tasks 8, 9, 10; admin boss management UI → Task 7; member fields → Task 8; member-bound submission → Task 10; edge cases (dept delete cascade, zero-dept boss, duplicate email, existing pwless members, admin-always) → handled in Tasks 1, 7–9; testing → Tasks 1–5 unit tests + Task 11 QA.
- **Dept-delete cascade:** `handleDeleteDepartment` (admin) should also remove `BossDepartment` rows for that department. Add to Task 9 Step 3's `handleDeleteDepartment`: `await runDatabase("DELETE FROM BossDepartment WHERE departmentId = ?", [id]);` alongside the existing `DELETE FROM Department`.
- **Type consistency:** `Principal` shape is identical across Tasks 3, 4, 6, 8–10; scope function names (`isAdminPrincipal`, `canManageDepartmentScope`, `canManageMemberScope`) are used consistently; auth method names (`getPrincipal`, `loginStaff`, `loginMember`, `logout`, `isBossModeActive`) match between Task 6 definitions and later consumers.
