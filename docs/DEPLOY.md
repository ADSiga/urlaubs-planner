# Deployment & runtime config

## Topology

- **Dev source** = this repo, `C:\laragon\www\Urlaube` (git). All edits happen here.
- **Deploy server** = `192.168.2.12`, reachable via FTP (path `/Kalender/`, the repo root copied
  there; the Next app is `/Kalender/kalender/`). The app runs with **`next dev` on port 3000**.
  The host runs a **full Laragon stack**: its Apache holds **both `:80` and `:443`** (the latter with a
  self-signed `CN=laragon` cert whose SANs cover `*.test`, incl. `Kalender.test`) — that Apache is *not*
  the app, but it is used as the TLS reverse proxy in the hardening runbook below.

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

### Runbook (decided: Laragon's own Apache as the TLS reverse proxy)

The deploy server runs a **full Laragon stack** — Apache already terminates TLS on `:443` with a
self-signed cert (`CN=laragon`) whose SANs include **`Kalender.test`**. So instead of standing up a second
TLS server, point that Apache at the app: serve `https://Kalender.test` and reverse-proxy to the Next prod
server on `127.0.0.1:3000`. (An earlier draft of this doc wrongly assumed `:443` was free and used Caddy;
that approach was dropped because Apache already owns `:443`.)

Access is **by name** (`Kalender.test`), since that is what the cert matches — *not* by IP (the cert has
no `192.168.2.12` SAN, which is why hitting the IP over HTTPS gives a name-mismatch warning). The vhost is
at [`deploy/Kalender.test.conf`](../deploy/Kalender.test.conf) (also FTP'd to `/Kalender/deploy/`). Run the
steps **on `192.168.2.12` itself** (FTP cannot start/reload services).

Phases are ordered so the app stays verifiable and **login never breaks**: HTTPS goes live *while still in
dev mode* (cookie not yet `secure`), and only then do we flip to the production build.

**Prereq — DNS/hosts for `Kalender.test`:** Laragon already maps `Kalender.test → 127.0.0.1` in the
server's hosts file, so it resolves *on the server*. **Every other device** that will use the app needs
`192.168.2.12  Kalender.test` in its hosts file (or a LAN DNS record), plus Laragon's root CA trusted (or
it accepts the cert warning once). If you need IP-based access for many clients instead, the Caddy-with-
IP-SAN approach (in git history) is the alternative.

**Phase 1 — TLS proxy in front (reversible; app stays in dev mode):**
1. Ensure Apache has the needed modules loaded (uncomment `LoadModule` in
   `C:\laragon\bin\apache\<ver>\conf\httpd.conf` if absent): `mod_ssl`, `mod_proxy`, `mod_proxy_http`,
   `mod_headers`.
2. Copy `deploy/Kalender.test.conf` into Laragon's `C:\laragon\etc\apache2\sites-enabled\`. **Verify the
   `SSLCertificateFile`/`SSLCertificateKeyFile` paths** match your install (Laragon menu → Apache → ssl).
3. Reload Apache (Laragon menu → Apache → Reload, or `httpd -k restart`). Watch for config errors.
4. **Checkpoint:** browse `https://Kalender.test` on the server → the app loads over TLS, still in dev
   mode (cookie not yet `secure`, so login works). If the proxy 502s or Apache won't start, fix here — no
   production change has been made yet.

**Phase 2 — production build + cutover (the cookie-`secure` flip happens here):**
5. Build: `cd /Kalender/kalender` then `npm run build` (`npm ci` first only if deps changed).
6. Stop the running `next dev` process.
7. Start the production server bound to localhost (so `:3000` is reachable only via Apache).
   `next start` sets `NODE_ENV=production` automatically, which flips the session cookie to `secure`:
   ```
   npx next start -H 127.0.0.1 -p 3000
   ```
   Because traffic now arrives over Apache's HTTPS, the `secure` cookie round-trips and login works.

**Phase 3 — env + verify:**
8. Edit `kalender/.env.local`: `APP_BASE_URL=https://Kalender.test` (no port — Apache is on 443). Restart
   the `next start` process so the new env is read (it loads env at startup, not on hot-reload).
9. **Verify:** log in at `https://Kalender.test`, navigate between pages and confirm the session persists
   (proves the `secure` cookie round-trips); confirm there is **no** Next.js Dev Tools button and that an
   error page shows no stack trace / source maps; trigger a password reset and confirm the emailed link is
   `https://Kalender.test/reset/<token>`.

**Phase 4 — keep the prod server alive (survive reboot):** Apache is already a Laragon-managed service.
Wrap the **Next prod server** so it restarts on boot, e.g. with [NSSM](https://nssm.cc/):
```
nssm install UrlaubeApp "C:\Program Files\nodejs\npx.cmd" next start -H 127.0.0.1 -p 3000
nssm set     UrlaubeApp AppDirectory "C:\laragon\www\Kalender\kalender"
```
(`pm2` + `pm2-windows-startup` is an alternative.)

**Phase 5 — HSTS (only after Phase 3 verifies clean):** add to the vhost in `deploy/Kalender.test.conf`:
`Header always set Strict-Transport-Security "max-age=300"` (needs `mod_headers`) and ramp `max-age` up
(300 → 86400 → 31536000) over a few days so a TLS misconfig can't lock clients out. Do **not** add
`preload` for a private host.

**Phase 6 — (follow-up) tighten CSP:** the current CSP is `frame-ancestors 'none'` only. On a stable prod
build, add a `script-src` / `style-src` policy and test it against every page before committing (a strict
`script-src` can break Next's inline bootstrap if mis-set).

### Rollback (if login breaks after Phase 2)

A `secure` cookie that won't round-trip makes every request look logged-out. To revert fast: stop the
`next start` process and restart `next dev` (`NODE_ENV` unset → `secure` off, login works over plain HTTP
again on `:3000`). The Apache vhost can stay (it harmlessly proxies dev). Then diagnose before retrying.
