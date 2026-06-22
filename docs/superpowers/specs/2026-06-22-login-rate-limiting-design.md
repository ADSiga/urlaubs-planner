# Login Rate Limiting — Design

**Date:** 2026-06-22
**Branch:** main
**Status:** Approved design — ready for implementation plan.

## Goal

Protect the two login paths from brute-force. Today `loginMember` (email + password) and
`loginStaff` (TOTP code) in `lib/auth.ts` have no attempt throttling or lockout — an attacker can
guess passwords or TOTP codes without limit. Add a lockout after repeated failures.

## Decisions (locked)

- **Throttle key:** member logins by **email** (`email:<lowercased-email>`); staff logins by
  **client IP** (`ip:<ip>`). Member email is always available and reliable; staff TOTP carries no
  identity until verified, so IP is the only option.
- **Policy:** **5 failures within a rolling 15-minute window → locked** until the failures age out.
- **Lockout is communicated explicitly:** the login actions return a status so the modal can show a
  "too many attempts" message rather than the generic "access denied".
- **Scope:** both member and staff logins.
- **Best-effort IP with graceful fallback:** if no client IP can be determined (e.g. a dev/no-proxy
  setup where `x-forwarded-for` is absent), staff logins are **not** throttled rather than funnelled
  into one shared bucket (a shared bucket would let one attacker lock out all staff — a DoS). Member
  logins are always throttled (email is always present).

## Constants

- `MAX_FAILURES = 5`
- `WINDOW_MS = 15 * 60 * 1000` (15 minutes)

## Architecture

### Data model — `LoginAttempt` table

Only **failed** attempts are recorded. Lockout is derived by counting recent rows (the same
count-since-cutoff pattern as `lib/password-reset.ts`); no boolean lock flag is persisted.

```sql
CREATE TABLE IF NOT EXISTS LoginAttempt (
  id        TEXT PRIMARY KEY,
  key       TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_key ON LoginAttempt(key, createdAt);
```

Added idempotently in `initDb()` (the repo's `CREATE TABLE IF NOT EXISTS` migration pattern);
`schema.prisma` gets a reference-only model.

`key` namespaces the identity so member and staff keyspaces never collide:
- member: `email:<email.toLowerCase()>`
- staff: `ip:<clientIp>`

### Module — `lib/login-throttle.ts`

Three DB-backed functions plus the constants:

```ts
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

// Locked when >= MAX_FAILURES failures recorded within the last WINDOW_MS.
export async function isLocked(key: string): Promise<boolean>;

// Insert one failure row for `key`. Also prunes globally-expired rows
// (createdAt < now - WINDOW_MS) to keep the table bounded.
export async function recordFailure(key: string): Promise<void>;

// Delete all rows for `key` (called on a successful login → resets the counter).
export async function clearFailures(key: string): Promise<void>;
```

`isLocked` counts rows where `createdAt > now - WINDOW_MS`. Pruning lives in `recordFailure` so
every recorded failure opportunistically clears expired rows for all keys (a row older than the
window is useless to every key, since the window is global).

### Lockout semantics

A locked attempt is rejected **before** credentials are checked and records **no** new failure row.
Consequence: the 5 failures all age out of the window 15 minutes after the 5th one, producing a
clean 15-minute rolling lockout that a locked-out attacker cannot extend by continuing to hammer.

### Auth changes — `lib/auth.ts`

Return type changes from `Promise<boolean>` to:

```ts
export type LoginResult = { ok: true } | { ok: false; reason: "invalid" | "locked" };
```

- `loginMember(email, password)`: `key = "email:" + email.toLowerCase()`.
  1. `if (await isLocked(key)) return { ok: false, reason: "locked" }`
  2. verify credentials; on failure → `await recordFailure(key); return { ok: false, reason: "invalid" }`
  3. on success → `await clearFailures(key)`, set session, `return { ok: true }`
- `loginStaff(code, ip?)`: `key = ip ? "ip:" + ip : null`.
  1. `if (key && await isLocked(key)) return { ok: false, reason: "locked" }`
  2. try TOTP (admin secret, then each boss secret); on no match → `if (key) await recordFailure(key); return { ok: false, reason: "invalid" }`
  3. on match → `if (key) await clearFailures(key)`, set session, `return { ok: true }`

Keying member lockout on the submitted email — including non-existent ones — means the "locked"
behavior is identical whether or not the account exists, so it does not leak account existence.

### Server actions — `app/actions_auth.ts`

`handleMemberLogin` and `handleStaffLogin` return `LoginResult` (still `revalidatePath` on `ok`).
`handleStaffLogin` reads the client IP from `headers()` (`x-forwarded-for`, first comma-separated
hop, trimmed; `null` if the header is absent) and passes it to `loginStaff`. `handleMemberLogin`
needs no IP.

### UI — `app/AdminToggle.tsx`

The submit handlers consume `LoginResult`. On `{ ok: false, reason: "locked" }`, show
**"Zu viele Versuche. Bitte später erneut versuchen."**; on `"invalid"`, keep the existing
"Zugriff verweigert". Applies to both the member and staff tabs. A small state change (e.g. an
`errorKind: "invalid" | "locked" | null` instead of the current boolean) drives the message.

## Data flow

1. User submits login → server action computes/forwards identity (email, or IP for staff).
2. `auth` checks `isLocked(key)` → if locked, return `{ reason: "locked" }` without touching credentials.
3. Otherwise verify; failure → `recordFailure` (+ prune) → `{ reason: "invalid" }`; success →
   `clearFailures` → session → `{ ok: true }`.
4. UI renders the matching message or proceeds on success.

## Error handling / edge cases

- **No IP for staff:** `key === null` → staff login is not throttled (fail-open, documented). Member
  is unaffected (always keyed by email).
- **Empty/whitespace email:** still keyed (`email:`) — a degenerate but harmless bucket; credential
  check fails as today.
- **Successful login resets the counter** via `clearFailures`, so a legitimate user who eventually
  remembers their password is not penalized by earlier typos.
- **Table growth:** bounded by the prune in `recordFailure` (rows older than the window are deleted).
- **DB error inside throttle:** propagates like any other DB error in these functions; not swallowed
  (a throttle DB failure should not silently disable the throttle — it surfaces as a failed login
  attempt, consistent with the rest of `auth.ts`).

## Testing

- **`lib/login-throttle.test.ts`** (temp-DB integration, run with the `_tsresolve.mjs` loader, like
  `password-reset.test.ts`):
  - below threshold (4 failures) → `isLocked` false.
  - at/over threshold (5 failures) → `isLocked` true.
  - `clearFailures(key)` → `isLocked` false again; other keys unaffected.
  - failures older than `WINDOW_MS` (insert with a backdated `createdAt`) do not count toward the lock.
  - `recordFailure` prunes rows older than the window (assert expired rows are gone).
  - keys are independent (`email:a` lock does not lock `ip:x`).
- **`auth.ts` / actions / UI wiring**: no unit test (`auth.ts` needs `next/headers` + DB); verified
  by `npx tsc --noEmit` and a browser smoke test — 6 wrong member logins → "Zu viele Versuche";
  correct password after `clearFailures` (or after the window) → success; staff lockout best-effort
  if an IP is present.

## Out of scope

- Progressive/exponential backoff (fixed window chosen).
- Per-IP throttling of member logins (member is keyed by email only).
- CAPTCHA, account-lock notification emails, admin unlock UI.
- A persistent lock flag or audit log of attempts beyond the rolling window.

## Files touched

- **Create** `lib/login-throttle.ts` (+ `lib/login-throttle.test.ts`) — throttle module.
- **Modify** `lib/db.ts` — `LoginAttempt` table in `initDb()`.
- **Modify** `schema.prisma` — reference model.
- **Modify** `lib/auth.ts` — `LoginResult` type; throttle in `loginMember`/`loginStaff`.
- **Modify** `app/actions_auth.ts` — return `LoginResult`; IP from `headers()` for staff.
- **Modify** `app/AdminToggle.tsx` — lockout message in both tabs.
