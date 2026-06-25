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

## Production hardening — TLS + `next start` (TODO, not yet done)

> **Status:** the app currently runs `next dev` over **plain HTTP** on `:3000`. This is the single
> largest security gap. Everything below is the runbook to close it. It is a deployment change, not a
> code change, so it lives here rather than in a commit.

### Why it matters

- The session cookie is a **stateless bearer HMAC token** (`lib/session-crypto.ts`). Over plain HTTP it
  travels in cleartext — anyone on the LAN can sniff it and **replay it for the full 24h TTL**. There is
  no IP/device binding and no server-side revocation for staff (see "Tier 2" below).
- `next dev` is not a production server: it ships the **Next.js Dev Tools** button to every visitor and
  leaks **stack traces / source maps** on errors. A production build (`next start`) removes both.

### The hard dependency (read before flipping anything)

The session cookie sets `secure: process.env.NODE_ENV === "production"` (`lib/auth.ts`). `next start`
runs with `NODE_ENV=production`, which flips `secure` **on** — and a `secure` cookie is **not sent by the
browser over plain HTTP**. So switching to production mode **without** TLS silently breaks login (the
cookie is set but never returned, so every request looks logged-out). **TLS and `next start` must land
together.**

### Runbook (decided: Caddy + internal CA, run on the server)

Approach chosen: **Caddy** terminating TLS on `:443` with its built-in internal CA, reverse-proxying to
the Next app on `127.0.0.1:3000`. Config lives in the repo at [`deploy/Caddyfile`](../deploy/Caddyfile)
(also pushed to the server at `/Kalender/deploy/Caddyfile`). Commands below are for the **Windows** server
(the `prod` npm script's `rmdir /s /q` indicates Windows) — swap the service-manager bits for `systemd`
if `.12` is actually Linux. Run them **on `192.168.2.12` itself** (FTP cannot start processes).

The phases are ordered so the app is verifiable at each checkpoint and **login never breaks**: HTTPS goes
live *while still in dev mode* (cookie not yet `secure`), and only then do we flip to the production build.

**Phase 1 — TLS in front (reversible; app stays in dev mode):**
1. Install Caddy on the server: `choco install caddy` (or `scoop install caddy`, or drop `caddy.exe` in
   place). Verify: `caddy version`.
2. Confirm the Caddyfile is present (FTP'd to `/Kalender/deploy/Caddyfile`).
3. Trust Caddy's local root so the cert is warning-free on the server: `caddy trust`. Import that root
   CA on any other device that will use the app (else a one-time TLS warning).
4. Start Caddy in the foreground to test: `caddy run --config X:\path\to\Kalender\deploy\Caddyfile`.
5. **Checkpoint:** browse `https://192.168.2.12` → the app loads over TLS, still in dev mode (cookie not
   yet `secure`, so login works on both HTTP and HTTPS). If the handshake or proxy fails, fix here — no
   production change has been made yet.

**Phase 2 — production build + cutover (the cookie-`secure` flip happens here):**
6. Build: `cd /Kalender/kalender` then `npm run build` (`npm ci` first only if deps changed).
7. Stop the running `next dev` process.
8. Start the production server bound to localhost (so `:3000` is reachable only via Caddy).
   `next start` sets `NODE_ENV=production` automatically, which flips the session cookie to `secure`:
   ```
   npx next start -H 127.0.0.1 -p 3000
   ```
   Because traffic now arrives over Caddy's HTTPS, the `secure` cookie round-trips and login works.

**Phase 3 — env + verify:**
9. Edit `kalender/.env.local`: `APP_BASE_URL=https://192.168.2.12` (no port — Caddy is on 443). Restart
   the `next start` process so the new env is read (it loads env at startup, not on hot-reload).
10. **Verify:** log in at `https://192.168.2.12`, navigate between pages and confirm the session persists
    (proves the `secure` cookie round-trips); confirm there is **no** Next.js Dev Tools button and that an
    error page shows no stack trace / source maps; trigger a password reset and confirm the emailed link
    is `https://192.168.2.12/reset/<token>`.

**Phase 4 — keep both processes alive (survive reboot):**
11. Wrap **Caddy** and the **Next prod server** as Windows services so they restart on boot, e.g. with
    [NSSM](https://nssm.cc/):
    ```
    nssm install UrlaubeCaddy  "C:\path\to\caddy.exe" run --config "X:\...\Kalender\deploy\Caddyfile"
    nssm install UrlaubeApp    "C:\Program Files\nodejs\npx.cmd" next start -H 127.0.0.1 -p 3000
    nssm set     UrlaubeApp    AppDirectory "X:\...\Kalender\kalender"
    ```
    (On Linux: two `systemd` units instead.) `pm2` + `pm2-windows-startup` is an alternative for the app.

**Phase 5 — HSTS (only after Phase 3 verifies clean):**
12. Add `Strict-Transport-Security`. Easiest at Caddy — add to the site block in `deploy/Caddyfile`:
    `header Strict-Transport-Security "max-age=300"` and ramp `max-age` up (300 → 86400 → 31536000) over
    a few days so a TLS misconfig can't lock clients out. (Alternatively add it to `securityHeaders` in
    `next.config.ts`.) Do **not** add `preload` for a private LAN host.

**Phase 6 — (follow-up) tighten CSP:** the current CSP is `frame-ancestors 'none'` only. On a stable prod
build, add a `script-src` / `style-src` policy and test it against every page before committing (a strict
`script-src` can break Next's inline bootstrap if mis-set).

### Rollback (if login breaks after Phase 2)

A `secure` cookie that won't round-trip makes every request look logged-out. To revert fast: stop the
`next start` process and restart `next dev` (`NODE_ENV` unset → `secure` off, login works over plain HTTP
again on `:3000`). Caddy can stay up (it harmlessly proxies dev) or be stopped. Then diagnose the TLS path
before retrying Phase 2.
