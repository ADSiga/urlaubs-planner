# Member Change-Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in member change their own password from the header menu, after re-entering their current password.

**Architecture:** A pure, unit-tested validator carries the password rules. A server action (`changeMemberPassword`) verifies the session principal is a member, checks the current password against the stored scrypt hash, and writes the new hash. A small client modal (`ChangePassword`) rendered in the header (`AdminToggle`) for members only drives it.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, SQLite via raw SQL (`lib/db.ts`), scrypt password hashing (`lib/password.ts`), Node 22 native TS test runner.

## Global Constraints

- **Members-only.** Only `principal.role === "member"` may change a password; staff use TOTP and have none. The server action re-checks role (defense in depth); the UI control is hidden for non-members.
- **Self only.** Identity comes from `getPrincipal().id` — never a client-supplied user id.
- **Require current password.** Verify it via `verifyPassword` before writing.
- **Minimum length 8** for the new password; new must differ from current.
- **No DB migration** — `User.passwordHash` already exists.
- **No session revocation** — there is no server-side session store; the member's own cookie stays valid, other devices cannot be revoked. Do not attempt it.
- **German UI copy (exact):** button "Passwort ändern"; field labels/placeholders "Aktuelles Passwort", "Neues Passwort", "Neues Passwort bestätigen"; errors "Aktuelles Passwort ist falsch.", "Das neue Passwort muss mindestens 8 Zeichen lang sein.", "Das neue Passwort muss sich vom aktuellen unterscheiden.", "Bitte beide Felder ausfüllen.", "Nicht berechtigt."; success "Passwort geändert."
- **Test command:** `node --test lib/<name>.test.ts` (from `kalender/`).
- **Typecheck command:** `npx tsc --noEmit` (from `kalender/`, currently clean).
- **Working directory for all commands:** `C:\laragon\www\Urlaube\kalender`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `lib/password.ts` — add `MIN_PASSWORD_LENGTH`, `PasswordChangeError`, pure `validateNewPassword`.
- **Modify** `lib/password.test.ts` — add `validateNewPassword` cases.
- **Modify** `lib/auth.ts` — add `ChangePasswordResult`, `changeMemberPassword`.
- **Modify** `app/actions_auth.ts` — add `handleChangePassword` server action.
- **Create** `app/ChangePassword.tsx` — client modal (button + form).
- **Modify** `app/AdminToggle.tsx` — render `ChangePassword` for members; add `onChangePassword` prop.
- **Modify** `app/layout.tsx` — pass `handleChangePassword` to `AdminToggle`.

---

### Task 1: Pure password-change validator

**Files:**
- Modify: `lib/password.ts`
- Test: `lib/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const MIN_PASSWORD_LENGTH = 8`
  - `type PasswordChangeError = "empty" | "too_short" | "same_as_current"`
  - `function validateNewPassword(currentPassword: string, newPassword: string): { ok: true } | { ok: false; error: PasswordChangeError }`

- [ ] **Step 1: Write the failing test**

Append to `lib/password.test.ts`:

```ts
import { validateNewPassword, MIN_PASSWORD_LENGTH } from "./password.ts";

test("validateNewPassword: rejects empty fields", () => {
  assert.deepEqual(validateNewPassword("", "newpass12"), { ok: false, error: "empty" });
  assert.deepEqual(validateNewPassword("current12", ""), { ok: false, error: "empty" });
});

test("validateNewPassword: rejects too-short new password", () => {
  assert.deepEqual(validateNewPassword("current12", "short"), { ok: false, error: "too_short" });
  // exactly MIN_PASSWORD_LENGTH-1 is too short
  assert.equal(validateNewPassword("current12", "a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
});

test("validateNewPassword: rejects new equal to current", () => {
  assert.deepEqual(validateNewPassword("samepass12", "samepass12"), { ok: false, error: "same_as_current" });
});

test("validateNewPassword: accepts a valid distinct new password >= 8 chars", () => {
  assert.deepEqual(validateNewPassword("current12", "brandnew34"), { ok: true });
  assert.deepEqual(validateNewPassword("current12", "a".repeat(MIN_PASSWORD_LENGTH)), { ok: true });
});
```

Note: `lib/password.test.ts` already imports `test` from `node:test` and `assert` from `node:assert/strict` at the top — do not duplicate those imports; only add the new `import { validateNewPassword, MIN_PASSWORD_LENGTH } from "./password.ts";` line and the new `test(...)` blocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/password.test.ts`
Expected: FAIL — `validateNewPassword` / `MIN_PASSWORD_LENGTH` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/password.ts`:

```ts
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeError = "empty" | "too_short" | "same_as_current";

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

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/password.test.ts`
Expected: PASS — all existing tests plus the 4 new ones (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add lib/password.ts lib/password.test.ts
git commit -m "feat(auth): pure validateNewPassword helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: changeMemberPassword logic + server action

**Files:**
- Modify: `lib/auth.ts`
- Modify: `app/actions_auth.ts`

**Interfaces:**
- Consumes: `validateNewPassword`, `MIN_PASSWORD_LENGTH` from `./password` (Task 1); existing `getPrincipal`, `queryDatabase`, `runDatabase`, `verifyPassword`, `hashPassword`.
- Produces:
  - `type ChangePasswordResult = { ok: true } | { ok: false; error: string }` (exported from `lib/auth.ts`)
  - `async function changeMemberPassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult>` (exported from `lib/auth.ts`)
  - `async function handleChangePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult>` (exported from `app/actions_auth.ts`)

This task is DB + auth glue (the rule logic is unit-tested in Task 1). Verify with `npx tsc --noEmit`.

- [ ] **Step 1: Extend imports in `lib/auth.ts`**

In `lib/auth.ts`, update the two relevant import lines. Change:

```ts
import { queryDatabase } from "./db";
import { verifyPassword } from "./password";
```

to:

```ts
import { queryDatabase, runDatabase } from "./db";
import { verifyPassword, hashPassword, validateNewPassword, MIN_PASSWORD_LENGTH } from "./password";
```

- [ ] **Step 2: Add `ChangePasswordResult` and `changeMemberPassword`**

Append to the end of `lib/auth.ts`:

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
    const messages: Record<string, string> = {
      empty: "Bitte beide Felder ausfüllen.",
      too_short: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
      same_as_current: "Das neue Passwort muss sich vom aktuellen unterscheiden.",
    };
    return { ok: false, error: messages[valid.error] };
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

- [ ] **Step 3: Add the server action in `app/actions_auth.ts`**

In `app/actions_auth.ts`, extend the existing import and append the action. Change the import line:

```ts
import { loginStaff, loginMember, logout } from "@/lib/auth";
```

to:

```ts
import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult } from "@/lib/auth";
```

Then append:

```ts
export async function handleChangePassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  return changeMemberPassword(currentPassword, newPassword);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts app/actions_auth.ts
git commit -m "feat(auth): changeMemberPassword action (members, self, re-auth)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ChangePassword client modal component

**Files:**
- Create: `app/ChangePassword.tsx`

**Interfaces:**
- Consumes: the `onChangePassword` action shape from Task 2 (passed as a prop).
- Produces: default export `ChangePassword` with props
  `{ onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }> }`.

Note: the prop type uses the structural shape `{ ok: boolean; error?: string }` rather than importing `ChangePasswordResult` from the server module, so this client component has no value import from `lib/auth`.

- [ ] **Step 1: Create the component**

Create `app/ChangePassword.tsx`:

```tsx
"use client";

import { useState } from "react";

interface ChangePasswordProps {
  onChangePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

const MIN_LEN = 8;

export default function ChangePassword({ onChangePassword }: ChangePasswordProps) {
  const [showModal, setShowModal] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setSuccess(false);
    setIsSaving(false);
  };

  const close = () => {
    setShowModal(false);
    reset();
  };

  const canSubmit =
    !!current && next.length >= MIN_LEN && next === confirm && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setIsSaving(true);
    const result = await onChangePassword(current, next);
    if (result.ok) {
      setSuccess(true);
      setIsSaving(false);
      setTimeout(close, 1200);
    } else {
      setError(result.error ?? "Fehler beim Ändern des Passworts.");
      setIsSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none transition-all";

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="rounded-xl bg-zinc-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
        title="Passwort ändern"
      >
        Passwort ändern
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-xs rounded-3xl bg-white p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <h3 className="mb-6 text-center text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">
              Passwort ändern
            </h3>

            {success ? (
              <div className="text-center text-sm font-bold text-emerald-600 py-6">Passwort geändert.</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="password"
                  value={current}
                  disabled={isSaving}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Aktuelles Passwort"
                  className={inputClass}
                  autoComplete="current-password"
                  autoFocus
                />
                <input
                  type="password"
                  value={next}
                  disabled={isSaving}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Neues Passwort"
                  className={inputClass}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  value={confirm}
                  disabled={isSaving}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Neues Passwort bestätigen"
                  className={inputClass}
                  autoComplete="new-password"
                />

                {next.length > 0 && next.length < MIN_LEN && (
                  <p className="text-[10px] font-medium text-zinc-400 px-1">
                    Mindestens {MIN_LEN} Zeichen.
                  </p>
                )}
                {confirm.length > 0 && next !== confirm && (
                  <p className="text-[10px] font-medium text-amber-600 px-1">
                    Passwörter stimmen nicht überein.
                  </p>
                )}
                {error && (
                  <p className="text-[10px] font-bold uppercase text-red-500 px-1">{error}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-2xl bg-zinc-100 py-3.5 text-xs font-bold text-zinc-500 hover:bg-zinc-200 transition-colors dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    Abbruch
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                  >
                    {isSaving ? "Speichert..." : "Speichern"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/ChangePassword.tsx
git commit -m "feat(auth): ChangePassword modal component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire ChangePassword into the header

**Files:**
- Modify: `app/AdminToggle.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `ChangePassword` (Task 3); `handleChangePassword` (Task 2).
- Produces: a "Passwort ändern" control visible in the header for logged-in members.

- [ ] **Step 1: Add the import and prop in `AdminToggle.tsx`**

At the top of `app/AdminToggle.tsx`, below `import { useState } from "react";`, add:

```ts
import ChangePassword from "./ChangePassword";
```

Extend the `LoginMenuProps` interface to add the optional prop (place it after `onLogout`):

```ts
  onLogout: () => Promise<void>;
  onChangePassword?: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>;
```

And add `onChangePassword` to the destructured props in the component signature:

```ts
export default function AdminToggle({
  principalName,
  principalRole,
  onStaffLogin,
  onMemberLogin,
  onLogout,
  onChangePassword,
}: LoginMenuProps) {
```

- [ ] **Step 2: Render the control for members**

In `app/AdminToggle.tsx`, inside the `if (principalRole) { return ( ... ) }` block, the logged-in view is a `<div className="flex items-center gap-2">` containing the name/role column and the logout button. Insert the change-password control as the FIRST child of that `<div>`, before the name/role column:

```tsx
        {principalRole === "member" && onChangePassword && (
          <ChangePassword onChangePassword={onChangePassword} />
        )}
```

- [ ] **Step 3: Pass the action in `layout.tsx`**

In `app/layout.tsx`, extend the auth-actions import. Change:

```ts
import { handleStaffLogin, handleMemberLogin, handleLogout } from "./actions_auth";
```

to:

```ts
import { handleStaffLogin, handleMemberLogin, handleLogout, handleChangePassword } from "./actions_auth";
```

Then add the prop to the `<AdminToggle ... />` usage:

```tsx
              <AdminToggle
                principalName={principal?.name ?? null}
                principalRole={principal?.role ?? null}
                onStaffLogin={handleStaffLogin}
                onMemberLogin={handleMemberLogin}
                onLogout={handleLogout}
                onChangePassword={handleChangePassword}
              />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Manual smoke test**

Start the dev server (`npm run dev`). Logged in as a member:
1. A "Passwort ändern" button appears in the header; it does NOT appear for admin/boss.
2. Open it; wrong current password → "Aktuelles Passwort ist falsch.", no change.
3. New password < 8 chars → submit disabled with the hint; new ≠ confirm → mismatch hint.
4. Correct current + valid new + matching confirm → "Passwort geändert.", modal closes.
5. Log out, log in with the new password → succeeds; old password → fails.

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add app/AdminToggle.tsx app/layout.tsx
git commit -m "feat(auth): wire member change-password into header

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Members-only, self, re-auth, min-8, new≠current → Task 1 (rules) + Task 2 (auth/verify/role).
- Header-menu modal placement → Task 3 + Task 4.
- German copy → Global Constraints + Tasks 2/3.
- No DB migration / no session revocation → honored (Task 2 only updates `passwordHash`; no cookie/session changes).
- Acceptance criteria 1-9 → Task 4 Step 5 (manual) + Task 1 tests + Task 2 typecheck.

**Placeholder scan:** none — every step has concrete code and commands.

**Type consistency:** `validateNewPassword` / `MIN_PASSWORD_LENGTH` signatures match across Task 1 (definition) and Task 2 (use). `ChangePasswordResult` defined in Task 2 `lib/auth.ts`, imported in `actions_auth.ts` (Task 2). The client prop shape `{ ok: boolean; error?: string }` is structurally compatible with `ChangePasswordResult` (`{ ok: true } | { ok: false; error: string }`) for the `onChangePassword` prop passed in Task 4. Component/action names (`ChangePassword`, `handleChangePassword`, `changeMemberPassword`, `onChangePassword`) consistent across Tasks 2-4.
