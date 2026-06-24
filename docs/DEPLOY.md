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

### Runbook

1. **Stand up TLS in front of the app.** Terminate TLS at a reverse proxy and forward to Next on
   `127.0.0.1:3000` (bind Next to localhost so `:3000` is no longer directly reachable). Options for an
   internal LAN host:
   - Caddy with its built-in internal CA (simplest — auto-certs for `192.168.2.12` / a `.local` name), or
   - the Apache already on `:80` configured as a `mod_ssl` + `mod_proxy` vhost on `:443`, or
   - nginx with a self-signed / internal-CA cert.
2. **Build and run in production mode** on the server instead of `next dev`:
   ```
   cd /Kalender/kalender
   npm ci            # only if deps changed
   npm run build
   npm start         # = next start, NODE_ENV=production, serves on :3000 (proxy upstream)
   ```
   Keep it under a process manager (pm2 / a systemd or Windows service) so it survives reboots.
3. **Update `kalender/.env.local`:** set `APP_BASE_URL=https://<host>` (the public HTTPS URL the proxy
   serves; include the port only if not 443). Reset links must point at the TLS origin.
4. **Verify** the `secure` session cookie round-trips over HTTPS (log in, confirm the session persists
   across requests) and that error pages no longer expose stack traces / the dev-tools button.
5. **Add HSTS** *after* HTTPS is confirmed working — either at the proxy or by adding
   `Strict-Transport-Security: max-age=31536000; includeSubDomains` to `securityHeaders` in
   `next.config.ts`. Ramp `max-age` up from a small value first so a misconfig can't lock clients out.
6. **(Follow-up) Tighten CSP:** the current CSP is `frame-ancestors 'none'` only. Once on a stable
   production build, add a `script-src` / `style-src` policy and test it against every page before
   committing (a strict `script-src` can break Next's inline bootstrap if mis-set).
