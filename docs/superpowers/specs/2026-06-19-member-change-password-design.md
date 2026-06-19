# In-App Member Password Change — Design / Spec

**Date:** 2026-06-19
**Branch:** feature/multi-role-auth
**Status:** Spec (awaiting review)

## Context

Members can log in with email + password (`loginMember`, `kalender/lib/auth.ts:94`) but
have no way to change their own password. The only place a password is set or changed is
the staff-only member-management page, and its action blocks members outright:

```ts
// kalender/app/mitglieder/actions.ts:60
export async function handleUpdateUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") { /* rejected */ return; }
  ...
  if (password) { await runDatabase(`UPDATE User SET passwordHash = ? WHERE id = ?`, [hashPassword(password), id]); }
```

So today a member who wants a new password must ask a boss/admin. This spec adds
self-service: a logged-in member can change their own password from the header menu,
after re-entering their current password.

## Scope

**In scope**
- A logged-in **member** can change their own password via a modal opened from the
  header (the `AdminToggle` logged-in area).
- Changing requires: current password (re-auth) + new password (min 8 chars) + a
  client-side confirm field.
- Server enforces authorization, current-password verification, and the length rule.

**Out of scope** (explicitly not built here)
- Forgot-password / reset without the current password (no email infrastructure exists).
  Tracked separately if wanted.
- Staff (boss/admin) passwords — staff authenticate via TOTP and have no password.
- Cross-device session revocation / "log out everywhere" — there is no server-side
  session store (see Constraints).
- Login/throttle rate limiting (not present anywhere today; out of scope, noted as a
  future hardening).
- Password strength meter or composition rules beyond a minimum length.

## Verified current state

- **Auth model:** members → email+password (`lib/auth.ts:94` `loginMember`); staff →
  TOTP (`loginStaff`, `lib/auth.ts:71`). Password change is therefore **members-only**.
- **Hashing:** `lib/password.ts` — `hashPassword` (scrypt, `scrypt$salt$hash`) and
  `verifyPassword`. Reuse both; do not reinvent.
- **Principal:** `getPrincipal()` (`lib/auth.ts:64`) returns
  `{ role: "admin"|"boss"|"member"; id; name; departmentIds }` from the signed cookie.
- **Auth server actions** live in `kalender/app/actions_auth.ts` and are wired into the
  header via `AdminToggle` (`kalender/app/layout.tsx:74`).
- **No new column needed:** `User.passwordHash` already exists (`schema.prisma:15`).
  No DB migration.

## Constraints

The session is a self-contained HMAC-signed cookie with a 24h `maxAge` and **no
server-side session store** (`lib/auth.ts:53` `setSession`). Consequences:
- A password change **cannot** revoke sessions on other devices — those cookies stay
  valid until they expire (≤24h). This is acceptable for this feature; "log out
  everywhere" would need a per-user token version and is out of scope.
- The member's **own** session stays valid after the change (the cookie does not embed
  the password). No re-login is forced; no cookie re-issue is required.

## Design

### 1. Pure validation helper (`lib/password.ts`)

Add a pure, dependency-free validator so the rules are unit-testable (matches the repo
pattern of pure helpers + `node:test`):

```ts
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeError =
  | "empty"
  | "too_short"
  | "same_as_current";

export function validateNewPassword(
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: PasswordChangeError } {
  if (!currentPassword || !newPassword) return { ok: false, error: "empty" };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "too_short" };
  if (newPassword === currentPassword) return { ok: false, error: "same_as_current" };
  return { ok: true };
}
```

### 2. Auth logic (`lib/auth.ts`)

```ts
export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

export async function changeMemberPassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const principal = await getPrincipal();
  if (!principal || principal.role !== "member") {
    return { ok: false, error: "Nicht berechtigt." };
  }

  const valid = validateNewPassword(currentPassword, newPassword);
  if (!valid.ok) {
    const msg: Record<string, string> = {
      empty: "Bitte beide Felder ausfüllen.",
      too_short: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
      same_as_current: "Das neue Passwort muss sich vom aktuellen unterscheiden.",
    };
    return { ok: false, error: msg[valid.error] };
  }

  const rows = await queryDatabase<{ passwordHash: string | null }>(
    "SELECT passwordHash FROM User WHERE id = ?",
    [principal.id]
  );
  const hash = rows[0]?.passwordHash;
  if (!hash || !verifyPassword(currentPassword, hash)) {
    return { ok: false, error: "Aktuelles Passwort ist falsch." };
  }

  await runDatabase("UPDATE User SET passwordHash = ? WHERE id = ?", [
    hashPassword(newPassword),
    principal.id,
  ]);
  return { ok: true };
}
```

Notes: identity comes from the **session** (`principal.id`), never from a client-supplied
user id — a member can only change their own password. Returns a structured result so the
UI can show a specific reason (unlike `loginMember`'s boolean).

### 3. Server action (`app/actions_auth.ts`)

```ts
export async function handleChangePassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  return changeMemberPassword(currentPassword, newPassword);
}
```

No `revalidatePath` needed — nothing rendered changes.

### 4. UI (`app/ChangePassword.tsx`, new client component)

A "Passwort ändern" button rendered inside `AdminToggle`'s logged-in block, **only when
`principalRole === "member"`**. Clicking opens a modal styled like the existing login
modal with three password fields:

- Aktuelles Passwort
- Neues Passwort
- Neues Passwort bestätigen (client-only confirm)

Behavior:
- Submit disabled until all three filled, new ≥ 8 chars, and new === confirm.
- On submit, call `onChangePassword(current, next)`; on `{ ok: false }` show
  `error` inline (reuse the login modal's error styling); on `{ ok: true }` show a brief
  success state and close.
- Props: `{ onChangePassword: (current: string, next: string) => Promise<ChangePasswordResult> }`.

### 5. Wiring (`AdminToggle.tsx`, `layout.tsx`)

- `AdminToggle` gains an optional `onChangePassword` prop; in the `principalRole` block,
  render `<ChangePassword onChangePassword={onChangePassword} />` when
  `principalRole === "member"`.
- `layout.tsx` passes `onChangePassword={handleChangePassword}` to `AdminToggle`.

## Authorization summary

| Action | Who | Guard |
|---|---|---|
| Open the change-password modal | member only | button hidden unless `principalRole === "member"` |
| `changeMemberPassword` | member only, self only | `principal.role === "member"`; target is `principal.id`; current password verified |

Defense in depth: even though the button is hidden for staff, the server action
re-checks role, so a crafted call from a non-member is rejected. Requiring the current
password blocks an attacker at an unlocked, logged-in session from silently taking over
the account.

## Acceptance criteria

1. A logged-in member sees a "Passwort ändern" control in the header; admin and boss do not.
2. Submitting with the correct current password and a valid new password (≥ 8 chars,
   different from current) updates `User.passwordHash`; the member can immediately log in
   again with the new password and not the old one.
3. Wrong current password returns "Aktuelles Passwort ist falsch." and makes no DB change.
4. New password < 8 chars is rejected with the length message (client and server).
5. New password equal to current is rejected with the "muss sich unterscheiden" message.
6. The confirm field mismatch blocks submission client-side.
7. A non-member (admin/boss) calling `handleChangePassword` directly gets
   `{ ok: false, error: "Nicht berechtigt." }` and no DB change.
8. The member's current session keeps working after the change (no forced logout).
9. `npx tsc --noEmit` passes; new unit tests pass.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (`node --test`) | `validateNewPassword`: empty, too_short, same_as_current, ok | +4 |
| Action/integration | `changeMemberPassword`: non-member rejected, wrong current rejected, happy path updates hash (verified via `verifyPassword`) — covered by `tsc` + manual; optional thin test against a temp DB | manual |
| E2E (browser) | member logs in → change password (wrong current → error; correct → success) → re-login with new password works | manual |

## Files reference

| File | Change |
|---|---|
| `kalender/lib/password.ts` | Add `MIN_PASSWORD_LENGTH`, `validateNewPassword` (pure) |
| `kalender/lib/password.test.ts` | Add `validateNewPassword` cases |
| `kalender/lib/auth.ts` | Add `ChangePasswordResult`, `changeMemberPassword` |
| `kalender/app/actions_auth.ts` | Add `handleChangePassword` server action |
| `kalender/app/ChangePassword.tsx` | New client modal component |
| `kalender/app/AdminToggle.tsx` | Render `ChangePassword` for members; add `onChangePassword` prop |
| `kalender/app/layout.tsx` | Pass `handleChangePassword` to `AdminToggle` |

## Rollback

Revert the PR. No DB migration (the `passwordHash` column already exists and is unchanged
in shape), so there is nothing to undo at the data layer.

## Effort estimate

- Pure validator + tests: ~0.5h
- `changeMemberPassword` + action: ~0.5h
- `ChangePassword` modal component: ~1h
- Wiring + manual/browser verification: ~0.5h
- Total: ~2.5h

## Out of scope (restated)

- Forgot-password / email reset, staff passwords, cross-device session revocation,
  rate limiting, strength meter. Each is a separate spec if wanted.
