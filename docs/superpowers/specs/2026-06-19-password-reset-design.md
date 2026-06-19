# Self-Service Password Reset (Forgot Password) — Design / Spec

**Date:** 2026-06-19
**Branch:** feature/multi-role-auth
**Status:** Spec (awaiting review)

## Context

A member who forgets their password currently has no way back in on their own — there is
no recovery flow (verified: no "Passwort vergessen?" UI, no token table, no email
sending). Today the only remedy is a boss/admin setting a new password for them. This spec
adds a classic self-service email reset: the member requests a link by email and sets a new
password through it. Companion to the already-built in-app change-password feature
(`docs/superpowers/specs/2026-06-19-member-change-password-design.md`), which only covers
changing a password while logged in.

## Decisions (agreed)

- **Mechanism:** self-service email reset (member-initiated, link by email).
- **Email transport:** **nodemailer over SMTP** (host/port/user/pass from env). Works on
  the self-hosted laragon deploy; no third-party provider.
- **Link lifetime:** **1 hour**, and **single-use** regardless of expiry.
- **Audience:** **members only.** Staff (boss/admin) authenticate via TOTP and have no
  password to reset.

## Verified current state

- **No email infra:** no `nodemailer`/SMTP/provider deps or code; env has only
  `BOSS_SECRET`, `SESSION_SECRET`.
- **No token tables:** none in `schema.prisma` or the runtime SQL.
- **`User`** has `email` and `passwordHash` columns. **In current data every member's
  `email` is NULL** — see Prerequisite.
- **Migration mechanism:** runtime schema is raw SQL via idempotent `initDb()` in
  `kalender/lib/db.ts` (e.g., `CREATE TABLE IF NOT EXISTS Boss ...`). New tables are added
  there, not via Prisma. `schema.prisma` is reference-only and is kept in sync.
- **Hashing:** `lib/password.ts` (`hashPassword`/`verifyPassword`, scrypt) — reuse for the
  new password.
- **Sessions:** stateless HMAC-signed cookie, no server-side store (`lib/auth.ts:53`).

## Prerequisite (not built here)

Email reset is inert for a member whose `User.email` is NULL. Admins already set member
emails via the member-management edit form (`handleUpdateUser`). **Provisioning real,
unique emails for members is a prerequisite handled through the existing UI**, not part of
this spec.

## Scope

**In scope**
- A public "Passwort vergessen?" request page: enter email → receive a reset link (if a
  matching member account exists).
- A public reset page reached via the emailed link: validate token → set a new password
  (min 8 chars) → token consumed → redirect to login.
- nodemailer/SMTP sending, a `PasswordResetToken` table, token hashing/expiry/single-use,
  and anti-enumeration on the request endpoint.

**Out of scope**
- Email provisioning for members (prerequisite, existing UI).
- Staff (boss/admin) reset — TOTP-based, no password.
- Auto-login after reset (member logs in with the new password).
- Cross-device session revocation (stateless cookies — same constraint as change-password).
- CAPTCHA, account lockout, "magic-link" passwordless login, i18n beyond German.

## Constraints

- **Anti-enumeration:** the request endpoint MUST return the same response whether or not
  the email matches an account. Never reveal account existence.
- **Members only:** only `User` rows that are members with a `passwordHash` and a non-null
  `email` are eligible; staff are never matched.
- **Tokens hashed at rest:** store only `sha256(rawToken)`; the raw token lives only in the
  emailed URL. A DB leak must not yield usable links.
- **Single-use + 1h expiry**, enforced server-side on the reset submit.
- **No session revocation:** resetting does not invalidate existing sessions (stateless
  cookies); documented, not solved here.
- **New env (all required for sending):** `APP_BASE_URL` (absolute base for building links,
  e.g. `https://kalender.example.com`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM` (sender address). Document in the env checklist; keep out of git.
- **German UI copy.** Key strings: request page title "Passwort zurücksetzen"; the
  always-shown request confirmation "Falls ein Konto mit dieser E-Mail existiert, wurde ein
  Link zum Zurücksetzen gesendet."; reset page "Neues Passwort vergeben"; invalid-token
  message "Dieser Link ist ungültig oder abgelaufen."; min-length error "Das Passwort muss
  mindestens 8 Zeichen lang sein."; success "Passwort zurückgesetzt. Du kannst dich jetzt
  anmelden."

## Data model (new table)

Added to `initDb()` (raw SQL, idempotent) and mirrored in `schema.prisma` (reference):

```sql
CREATE TABLE IF NOT EXISTS PasswordResetToken (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,   -- sha256(rawToken), hex
  expiresAt TEXT NOT NULL,          -- ISO 8601
  usedAt    TEXT,                   -- ISO 8601, NULL until consumed
  createdAt TEXT NOT NULL,          -- ISO 8601
  FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prt_userId ON PasswordResetToken(userId);
```

Prisma reference model:

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```
(Add the matching `resetTokens PasswordResetToken[]` relation field to `model User`.)

## Design

### Modules

- **`lib/reset-tokens.ts`** (new) — token primitives:
  - `generateResetToken(): { raw: string; hash: string }` — `raw` = 32 random bytes
    base64url (`crypto.randomBytes(32)`); `hash` = `sha256(raw)` hex.
  - `hashResetToken(raw: string): string` — sha256 hex (used on lookup).
  - Pure/deterministic enough to unit-test: same `raw` → same `hash`; `raw !== hash`;
    `generateResetToken` yields distinct raws.

- **`lib/password.ts`** (extend) — add a pure validator for the reset case (no current
  password to compare against):
  - `validateResetPassword(newPassword: string): { ok: true } | { ok: false; error: "empty" | "too_short" }`
    reusing `MIN_PASSWORD_LENGTH` (8).

- **`lib/email.ts`** (new) — SMTP sending:
  - `sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>` — builds a
    German subject/body and sends via a nodemailer transport configured from
    `SMTP_HOST/PORT/USER/PASS/FROM`. A pure `buildResetEmail(resetUrl)` → `{ subject, text }`
    is extracted so the message body is unit-testable without sending.

- **`lib/password-reset.ts`** (new) — orchestration:
  - `requestPasswordReset(email: string): Promise<void>` — find an eligible member by
    email; if found, create a token row (`generateResetToken`, expiry now+1h) and call
    `sendPasswordResetEmail(email, \`${APP_BASE_URL}/reset/${raw}\`)`. **Always returns
    void/success to the caller** regardless of match (anti-enumeration). Throttle: if an
    unused, unexpired token already exists for that user created < 60s ago, skip creating a
    new one (still return success).
  - `validateResetToken(raw: string): Promise<{ valid: boolean }>` — look up by
    `hashResetToken(raw)`; valid iff a row exists with `usedAt IS NULL` and
    `expiresAt > now`.
  - `performPasswordReset(raw, newPassword): Promise<{ ok: true } | { ok: false; error: string }>`
    — re-validate token; `validateResetPassword`; on success `UPDATE User SET passwordHash`
    for the token's `userId`, set `usedAt = now` on the token, and mark any other unused
    tokens for that user used (invalidate siblings). Map errors to the German strings.

### Server actions (`app/actions_auth.ts`)

- `handleRequestPasswordReset(email: string): Promise<{ ok: true }>` — calls
  `requestPasswordReset`; always `{ ok: true }` (anti-enumeration). Never throws to the
  client even if SMTP fails (log server-side).
- `handlePerformPasswordReset(token: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }>`
  — calls `performPasswordReset`.

### Routes (public, no auth)

- **`app/reset/page.tsx`** — request form: one email field + submit → `handleRequestPasswordReset`.
  After submit, always show the anti-enumeration confirmation. (Client component for the form.)
- **`app/reset/[token]/page.tsx`** — server component: reads `params.token`, calls
  `validateResetToken`. If invalid/expired → show "Dieser Link ist ungültig oder
  abgelaufen." with a link to request a new one. If valid → render a client form (new
  password + confirm) → `handlePerformPasswordReset(token, newPassword)`; on success show
  the success message + a link to the login.

### Entry point

- `app/AdminToggle.tsx` — in the member ("Mitglied") login tab, add a small
  "Passwort vergessen?" link to `/reset`.

## Authorization & security summary

| Step | Who | Guard |
|---|---|---|
| Request reset | anyone (public) | Always same response; only eligible members get an email; per-email 60s throttle |
| Open reset link | anyone with the raw token | Token must exist (by hash), be unused, and unexpired |
| Set new password | holder of a valid token | Re-validated server-side; min 8; token consumed + siblings invalidated |

Notes: tokens are high-entropy (32 bytes) and stored only as sha256, so guessing or a DB
leak doesn't yield a usable link. Members-only by construction (staff aren't matched). The
request action swallows SMTP errors so failures don't leak account existence via error
differences.

## Acceptance criteria

1. From the login modal, "Passwort vergessen?" opens `/reset`.
2. Submitting any email on `/reset` shows the anti-enumeration confirmation and never
   reveals whether the email exists.
3. For an eligible member (member role, has `passwordHash`, non-null `email`), a reset email
   is sent containing an `${APP_BASE_URL}/reset/<token>` link.
4. Opening a valid, unexpired, unused link shows the new-password form; opening an invalid,
   expired, or already-used link shows "Dieser Link ist ungültig oder abgelaufen."
5. Setting a new password ≥ 8 chars succeeds: `User.passwordHash` updates, the member can
   log in with the new password and not the old one, and the token is marked used.
6. A new password < 8 chars is rejected (client and server) with the length message.
7. Re-using a consumed link, or using it after 1 hour, is rejected.
8. Requesting twice within 60s for the same email sends at most one email (throttle), still
   showing the confirmation both times.
9. A non-member email (or NULL-email member) produces no email but the same confirmation.
10. `npx tsc --noEmit` passes; new unit tests pass.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (`node --test`) | `validateResetPassword` (empty/too_short/ok); `reset-tokens` (hash determinism, raw≠hash, distinct raws); `buildResetEmail` (subject + URL present) | +7 |
| Action/integration | `requestPasswordReset` (match → token+send; no-match → no token; throttle), `validateResetToken` (valid/expired/used), `performPasswordReset` (happy/used/expired/short) — against a temp SQLite DB with a stubbed email sender | +6 |
| E2E (browser) | request → (read token from DB/log in test) open link → set new password → log in with new; expired/used link shows error | manual |

## Files reference

| File | Change |
|---|---|
| `kalender/lib/db.ts` | Add `PasswordResetToken` table + index to `initDb()` |
| `schema.prisma` | Add `PasswordResetToken` model + `User.resetTokens` relation (reference) |
| `kalender/lib/reset-tokens.ts` | New — `generateResetToken`, `hashResetToken` |
| `kalender/lib/reset-tokens.test.ts` | New — token primitive tests |
| `kalender/lib/password.ts` | Add `validateResetPassword` |
| `kalender/lib/password.test.ts` | Add `validateResetPassword` cases |
| `kalender/lib/email.ts` | New — `buildResetEmail`, `sendPasswordResetEmail` (nodemailer/SMTP) |
| `kalender/lib/email.test.ts` | New — `buildResetEmail` test |
| `kalender/lib/password-reset.ts` | New — `requestPasswordReset`, `validateResetToken`, `performPasswordReset` |
| `kalender/app/actions_auth.ts` | Add `handleRequestPasswordReset`, `handlePerformPasswordReset` |
| `kalender/app/reset/page.tsx` | New — request form (public) |
| `kalender/app/reset/[token]/page.tsx` | New — set-new-password page (public) |
| `kalender/app/AdminToggle.tsx` | Add "Passwort vergessen?" link in the member login tab |
| `kalender/package.json` | Add `nodemailer` dependency (+ `@types/nodemailer` dev) |
| env (`.env.local` / deploy) | Add `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |

## Rollback

- Revert the PR. The `PasswordResetToken` table is additive and created via
  `CREATE TABLE IF NOT EXISTS`; leaving it in place is harmless if the code is reverted
  (nothing reads it). No destructive migration. Remove the new env vars at the deploy if
  desired.

## Effort estimate

- Token + password validators (+ tests): ~1h
- `PasswordResetToken` table + schema sync: ~0.5h
- `lib/email.ts` (nodemailer) + `buildResetEmail` test: ~1.5h
- `lib/password-reset.ts` orchestration (+ tests): ~2h
- Request + reset pages and the login-modal link: ~2.5h
- Wiring, env, manual/browser verification: ~1.5h
- Total: ~9h

## Open dependency

Sending requires a reachable SMTP account and the six env vars on the deploy server. Until
those exist, the request endpoint will accept input and show the confirmation but no email
goes out (errors are swallowed by design). Confirm SMTP availability before rollout.
