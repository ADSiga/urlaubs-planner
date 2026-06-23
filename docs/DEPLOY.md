# Deployment & runtime config

## Topology

- **Dev source** = this repo, `C:\laragon\www\Urlaube` (git). All edits happen here.
- **Deploy server** = `192.168.2.12`, reachable via FTP (path `/Kalender/`, the repo root copied
  there; the Next app is `/Kalender/kalender/`). The app runs with **`next dev` on port 3000**.
  Port 80 on that host is a separate Apache install (returns 403 for app paths) — it is **not** the app.

## Runtime environment file

The Next runtime loads **`kalender/.env.local`** — NOT the repo-root `.env` (that one is Prisma's,
holds `DATABASE_URL`, and is not read at runtime). Required keys in `kalender/.env.local`:

| Key | Purpose |
|-----|---------|
| `BOSS_SECRET` | admin TOTP secret |
| `SESSION_SECRET` | HMAC key for the signed session cookie |
| `MAIL_SERVER` | SMTP host (port 587, STARTTLS required, TLS 1.2 floor) |
| `MAIL_USERNAME` | SMTP user + From address |
| `MAIL_PASSWORD` | SMTP password |
| `APP_BASE_URL` | base for password-reset links — **must include the port the app serves on** |

`APP_BASE_URL` gotcha: reset emails embed `${APP_BASE_URL}/reset/<token>`. Since the app serves on
`:3000`, this must be `http://192.168.2.12:3000` (no port → the link hits Apache :80 → 403, dead link).

Env changes take effect only on a **process restart** (`next dev` reads env at startup, not on hot-reload).

## Database & migrations

Runtime uses raw `sqlite3` against `../dev.db` (relative to the Next project cwd → `/Kalender/dev.db`
on the server). `schema.prisma` is reference-only, not used at runtime.

Migrations are **automatic and additive**: `initDb()` runs in `app/layout.tsx` on the next request
after a restart, applying `CREATE TABLE IF NOT EXISTS` / guarded `ALTER TABLE ... ADD COLUMN`. No manual
migration step. The live member data is preserved. (Recent additions: `LoginAttempt` table,
`User.passwordChangedAt`, `PasswordResetToken`.)

## Deploy procedure (FTP file copy)

1. Identify changed source by content-comparing local vs server (the server git history has diverged,
   so a git diff is unreliable). Upload only the differing files under `kalender/lib/`, `kalender/app/`,
   and root `schema.prisma`. Dependencies are usually already present (no `npm install` unless
   `package.json` deps changed).
2. Update `kalender/.env.local` if any keys are missing (see table above).
3. **Restart the `next dev` process** so env reloads and `initDb()` re-runs.

### FTP gotchas

- **`[` and `]` in paths** (e.g. `app/reset/[token]/`) are glob characters in curl — use `--globoff`
  or percent-encode (`%5B` / `%5D`), or comparisons return empty (false "differs").
- **Binary downloads of `dev.db` arrive corrupted** over this FTP path (valid header but page-count
  zeroed → reads as empty), even though byte size matches. Do **not** trust an FTP-pulled `dev.db` for
  inspection — verify DB state through the running app instead (e.g. login rate-limiting exercises the
  `LoginAttempt` table).
