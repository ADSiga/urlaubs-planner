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

### Runbook (decided: Laragon's Apache + an IP-SAN cert, accessed by IP)

The deploy server runs a **full Laragon stack** — Apache already terminates TLS on `:443` for several
`*.test` sites (its self-signed `CN=laragon` cert lists `crm.test`, `siga-crm.test`, … and `Kalender.test`).
So we **can't** evict Apache from `:443` (it serves those other sites), and we **can't** rely on
`Kalender.test` either, because **most users reach the app by IP** and can't all get a hosts entry. (An
earlier draft used Caddy on `:443` — dropped, Apache owns the port; a later draft used name-based
`Kalender.test` — dropped, clients hit the IP.)

Solution: add a **second SSL vhost to the existing Apache** that serves a cert whose **SAN includes
`IP:192.168.2.12`**, reverse-proxying to the Next prod server on `127.0.0.1:3000`. A purpose-built local
CA + leaf cert was generated off-box for this; the vhost is [`deploy/00-aaa-urlaube-ssl.conf`](../deploy/00-aaa-urlaube-ssl.conf).
Run the steps **on `192.168.2.12` itself** (FTP cannot start/reload services).

**Why `00-` / "default vhost":** a browser hitting a bare IP sends no SNI, so Apache answers with the
*first* SSL vhost on `:443` (Apache parses `sites-enabled\*.conf` alphabetically). Laragon's own default
vhost is `00-default.conf`, so ours is named **`00-aaa-urlaube-ssl.conf`** to sort *before* it and win the
no-SNI default; Laragon's `*.test` sites keep matching by SNI hostname (their cert is untouched).

Phases are ordered so the app stays verifiable and **login never breaks**: HTTPS goes live *while still in
dev mode* (cookie not yet `secure`), and only then do we flip to the production build.

**Prereq — cert files on the server (staged via FTP at `/Kalender/deploy/tls/`):**
- `urlaube.crt` + `urlaube.key` → copy to `C:\laragon\etc\ssl\` (the paths in the vhost). The `.key` is
  **secret** — do not commit it or expose it.
- `urlaube-ca.crt` (the local CA) → also copy to `C:\laragon\etc\ssl\` (used as `SSLCertificateChainFile`).
  **Import this one on each client** (Windows: *Trusted Root Certification Authorities*; Firefox:
  *Authorities*) to get a warning-free cert. *Optional* — without it, clients get one ordinary "accept"
  warning per device; the **encryption (the actual security win) works regardless.**

**Phase 1 — TLS vhost in front (reversible; app stays in dev mode):**
1. Ensure Apache has the needed modules loaded (uncomment `LoadModule` in
   `C:\laragon\bin\apache\<ver>\conf\httpd.conf` if absent): `mod_ssl`, `mod_proxy`, `mod_proxy_http`,
   `mod_headers`.
2. Copy `deploy/00-aaa-urlaube-ssl.conf` into Laragon's `C:\laragon\etc\apache2\sites-enabled\` (the
   `00-aaa-` prefix must sort before Laragon's `00-default.conf` so ours is the `:443` default), and the
   three cert files into `C:\laragon\etc\ssl\` (verify those paths match the vhost).
3. Reload Apache (Laragon menu → Apache → Reload, or `httpd -k restart`). Watch for config errors.
4. **Checkpoint:** confirm our cert is the IP default (no `-servername`!):
   ```
   openssl s_client -connect 192.168.2.12:443 </dev/null | openssl x509 -noout -subject
   # must print:  subject=O=Urlaube, CN=192.168.2.12
   ```
   Then browse `https://192.168.2.12` on the server → app loads over TLS, still in dev mode (cookie not
   yet `secure`, login works). If `s_client` shows the old `CN=laragon` cert, our vhost isn't loading
   first — rename it earlier or move Laragon's default SSL vhost after it. Fix here; no prod change yet.

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
8. Edit `kalender/.env.local`: `APP_BASE_URL=https://192.168.2.12` (no port — Apache is on 443). Restart
   the `next start` process so the new env is read (it loads env at startup, not on hot-reload).
9. **Verify:** log in at `https://192.168.2.12`, navigate between pages and confirm the session persists
   (proves the `secure` cookie round-trips); confirm there is **no** Next.js Dev Tools button and that an
   error page shows no stack trace / source maps; trigger a password reset and confirm the emailed link is
   `https://192.168.2.12/reset/<token>`.

**Phase 4 — keep the prod server alive (survive reboot):** Apache is already a Laragon-managed service.
Wrap the **Next prod server** as a Windows service with [NSSM](https://nssm.cc/). Use the committed
script [`deploy/install-urlaube-service.cmd`](../deploy/install-urlaube-service.cmd) — run it **as
Administrator** on the server. It registers the service pointing at **`node.exe` + Next's bin** (not
`npx.cmd`/`npm.cmd`, which are batch wrappers and misbehave under the service manager), binds to
`127.0.0.1:3000`, sets auto-start, and logs to `C:\laragon\www\Kalender\logs\`.

Prereqs the script checks/needs: NSSM on PATH (`choco install nssm` or download from nssm.cc), Node on
PATH, `npm run build` already done, and **stop any manual `next start` first** (port 3000 conflict).
Verify after: `nssm status UrlaubeApp` → `SERVICE_RUNNING`. (`pm2` + `pm2-windows-startup` is an
alternative.)

**Phase 5 — HSTS (only after Phase 3 verifies clean):** add to the vhost in `deploy/00-aaa-urlaube-ssl.conf`:
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
