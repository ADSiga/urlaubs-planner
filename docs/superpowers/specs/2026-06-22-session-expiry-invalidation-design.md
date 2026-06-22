# Session Expiry & Invalidate-on-Password-Change — Design

**Date:** 2026-06-22
**Branch:** feature/multi-role-auth
**Status:** Approved design — ready for implementation plan.

## Goal

Close two gaps in the stateless session layer:

1. **No server-side expiry.** The signed cookie payload (`lib/session-crypto.ts`) is just the
   `Principal` — it carries no expiry. `verifySession` accepts any validly-signed payload forever;
   the `maxAge: 24h` on the cookie is client-controlled and trivially bypassed by keeping the cookie
   value. A leaked token is valid indefinitely.
2. **No invalidation on credential change.** A password change (`changeMemberPassword`) or reset
   (`performPasswordReset`) updates `passwordHash` but does not invalidate existing sessions, so a
   compromised account's attacker keeps a valid cookie.

## Decisions (locked)

- **Invalidation mechanism:** a `passwordChangedAt` timestamp on `User`. The session carries its
  issued-at (`iat`); a session is invalid for a member if `iat < passwordChangedAt`.
- **Expiry:** embed `exp = iat + 24h` in the signed payload; reject expired tokens. Matches the
  existing cookie `maxAge` — no behavior change for normal users.
- **Existing cookies:** the old payload format has no `exp` → treated as invalid → every current
  user logs in once after deploy. No grandfathering.
- **Triggers for invalidation:** both in-app password change **and** forgot-password reset bump
  `passwordChangedAt`.
- **Time unit:** millisecond epochs (`Date.now()`) for `iat`/`exp` and for the `passwordChangedAt`
  comparison, for sub-second precision around the re-issue edge case.

## Architecture

Three layers, matching the existing separation (pure crypto / DB+cookie glue / orchestration).

### 1. `lib/session-crypto.ts` — pure crypto + time (no DB)

Change the signed payload from the bare `Principal` to `{ principal, iat, exp }`.

```ts
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

export function signSession(principal: Principal, secret: string): string;
//   iat = Date.now(); exp = iat + SESSION_TTL_MS;
//   payload = base64url(JSON.stringify({ principal, iat, exp })); returns `${payload}.${sig}`

export function verifySession(token: string, secret: string): SessionData | null;
//   verify HMAC (timing-safe, unchanged) → parse →
//   null if not the new shape (missing numeric iat/exp or principal) → null if Date.now() >= exp →
//   else { principal, iat, exp }

export function sessionPredatesPasswordChange(
  iat: number,
  passwordChangedAt: string | null
): boolean;
//   passwordChangedAt == null ? false : iat < Date.parse(passwordChangedAt)
```

`verifySession` returning `SessionData` (not bare `Principal`) is a deliberate change so callers can
read `iat`. The old-format rejection is what invalidates all currently-issued cookies on deploy.

`sessionPredatesPasswordChange` is extracted as a pure function purely so the comparison is
unit-testable without `next/headers` or a DB.

### 2. `lib/auth.ts` — DB + cookie glue

- **`getPrincipal()`** — after `verifySession` returns a `SessionData` (or null), for
  `session.principal.role === "member"` look up `User.passwordChangedAt` (`getOne`) and return
  `null` when `sessionPredatesPasswordChange(session.iat, row.passwordChangedAt)`. Boss/admin skip
  this lookup (they authenticate via TOTP and have no password). On success, return
  `session.principal`.
- **`changeMemberPassword()`** — in the existing `UPDATE`, also set `passwordChangedAt = <now ISO>`.
  **Then re-issue the current session** via `setSession(principal)` so the user who just changed
  their own password stays logged in *in the current tab* while their *other* sessions are
  invalidated. Re-issue happens after the UPDATE, so the new `iat >= passwordChangedAt` and the
  strict `<` comparison keeps it valid.

`setSession`/`signSession` need no caller changes — `signSession` computes `iat`/`exp` internally.

### 3. `lib/password-reset.ts` — orchestration

- **`performPasswordReset()`** — add `passwordChangedAt = <now ISO>` to its existing
  `UPDATE User SET passwordHash = ? WHERE id = ?`. No cookie work: the user is logged out on the
  reset page, so all their sessions die and they log in fresh — the desired outcome.

## Data model

Add a nullable column via the existing idempotent pattern in `initDb()` (alongside the
`email`/`passwordHash` column adds):

```ts
if (!names.has("passwordChangedAt"))
  await runDatabase(`ALTER TABLE User ADD COLUMN passwordChangedAt TEXT`);
```

`schema.prisma` (reference only): add `passwordChangedAt DateTime?` to `model User`.

`NULL` means the user has never changed their password → only the 24h expiry governs their sessions.

## Data flow

- **Login** (member/staff): `setSession` → `signSession` stamps `iat`/`exp` → cookie.
- **Every request**: `getPrincipal` → `verifySession` (sig + expiry) → for members, `passwordChangedAt`
  check → `Principal | null`.
- **Change password**: verify current → `UPDATE passwordHash, passwordChangedAt` → `setSession`
  (fresh `iat`) → other sessions now fail the `passwordChangedAt` check; current survives.
- **Reset password**: token consumed → `UPDATE passwordHash, passwordChangedAt` → all that user's
  sessions fail the check on next request.

## Error handling / edge cases

- **Old-format cookie** (pre-deploy): no numeric `exp` → `verifySession` → null → re-login. One-time.
- **Tampered/!2-part token**: unchanged — null.
- **Expired token**: `Date.now() >= exp` → null.
- **Same-millisecond change + re-issue**: re-issue's `iat` is read after the `passwordChangedAt`
  write, so `iat >= changedAt`; strict `<` keeps the re-issued session valid. A pre-existing session
  with `iat == changedAt` (sub-ms collision) would survive — negligible window, accepted.
- **`passwordChangedAt` unparseable** (shouldn't happen — we only write ISO): `Date.parse` → `NaN`;
  `iat < NaN` is `false` → session treated as valid. Acceptable fail-open for a value we control;
  not a security regression versus today.

## Testing

- **`lib/session-crypto.test.ts`** (extend):
  - sign → verify roundtrip returns `{ principal, iat, exp }` with `exp == iat + SESSION_TTL_MS`.
  - expired token (`exp` in the past, re-signed by hand) → `null`.
  - tampered signature → `null` (existing).
  - old-format payload (`base64url(JSON.stringify(principal))` + valid sig, no `exp`) → `null`.
  - `sessionPredatesPasswordChange`: `null` → false; `iat` before → true; `iat` equal/after → false.
- **`lib/password-reset.test.ts`** (extend): add `passwordChangedAt TEXT` to the test schema; after
  `performPasswordReset` happy path, assert `User.passwordChangedAt` is non-null.
- **`auth.ts` glue** (no `auth.test.ts`; needs `next/headers`): covered by the pure helpers above
  plus a browser smoke test — log in as a member, simulate a "second session" (a token minted with
  an `iat` earlier than a subsequent `passwordChangedAt`), confirm the old token is rejected while a
  freshly re-issued one works; re-run the password-reset smoke test.

## Out of scope

- Sliding/refresh expiry, "active sessions" UI, per-device revocation.
- Login rate limiting / brute-force protection (separate follow-up).
- Boss/admin credential rotation (TOTP-based; no password to change).

## Files touched

- `lib/session-crypto.ts` (+ test) — payload `iat`/`exp`, expiry check, `sessionPredatesPasswordChange`.
- `lib/auth.ts` — `getPrincipal` member check; `changeMemberPassword` sets `passwordChangedAt` + re-issues.
- `lib/password-reset.ts` (+ test) — `performPasswordReset` sets `passwordChangedAt`.
- `lib/db.ts` — `passwordChangedAt` column in `initDb()`.
- `schema.prisma` — reference column.
