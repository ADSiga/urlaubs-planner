# Multi-Role Auth & Department Bosses — Design

**Date:** 2026-06-18
**App:** `kalender/` (Next.js 16.2.6, React 19, raw `sqlite3` against `../dev.db`)
**Status:** Approved — ready for implementation planning

## Problem

Today the Urlaubs-Planer has a single shared "Boss Mode": one TOTP secret
(`BOSS_SECRET`) sets a boolean cookie `boss_mode_session=active`. Anyone with the
code gets full access everywhere (approve leaves, create/edit/delete *all* members
and departments). There is no concept of *who* is logged in, and members have no
accounts at all.

We need a real multi-role system:

- **Three+ department bosses**, each with their own Authenticator (TOTP) code,
  able to manage only their own department(s).
- **One full-access admin** (the existing Boss Mode, elevated).
- **Members** with email + password login, used to submit/view their own leave
  requests.

## Roles & Access Matrix

| Capability | Member | Boss (own dept[s] only) | Admin |
|---|---|---|---|
| Auth method | email + password | own TOTP code | existing `BOSS_SECRET` TOTP |
| View calendar / overview | ✅ (open to all) | ✅ | ✅ |
| Submit/view **own** leave requests | ✅ | ✅ | ✅ |
| Approve/deny leave requests | ❌ | ✅ own depts | ✅ all |
| Create/edit/delete members | ❌ | ✅ own depts | ✅ all |
| Rename department | ❌ | ✅ own depts | ✅ all |
| Create/delete departments | ❌ | ❌ | ✅ |
| Create/manage boss accounts | ❌ | ❌ | ✅ |

Notes:

- A **boss is not a member account** — it is a separate management login. Bosses
  do not submit their own vacation through the boss login.
- Member login attributes leave requests to the logged-in member; the anonymous
  "pick any user" submission path is removed for members. Admin/boss can still
  create requests on a member's behalf.
- Viewing the calendar/overview stays open to everyone (no login required to view).

## Data Model & Migrations

Runtime uses raw `sqlite3` (the root `schema.prisma` is not used at runtime). All
changes applied via SQL in a centralized init helper.

- **`User`** gains:
  - `email TEXT UNIQUE` (nullable)
  - `passwordHash TEXT` (nullable)
  - Existing rows remain valid; a member can log in only once email + password are set.
- **New `Boss`**: `id TEXT PRIMARY KEY, name TEXT NOT NULL, totpSecret TEXT NOT NULL, createdAt TEXT`.
- **New `BossDepartment`** (many-to-many, supports multiple departments per boss):
  `bossId TEXT, departmentId TEXT, PRIMARY KEY(bossId, departmentId)`.

Implementation details:

- **Password hashing:** Node built-in `crypto.scrypt` with a random salt, stored as
  `scrypt$<saltHex>$<hashHex>`, verified with `crypto.timingSafeEqual`. No new
  dependency.
- **TOTP / QR:** boss secrets are random base32; QR codes rendered with the already
  installed `qrcode` package. No new dependency.
- **Centralize schema creation:** introduce `lib/db.ts` with the `queryDatabase` /
  `runDatabase` helpers (currently duplicated across pages/actions) and an `initDb()`
  that runs `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE User ADD COLUMN`
  statements idempotently. Removes the ad-hoc `CREATE TABLE` sitting inside the
  abteilungen page render.
- Update root `schema.prisma` to match the real schema so it stops being misleading
  (documentation only; not used at runtime).
- **Migration safety:** `ALTER TABLE ... ADD COLUMN` guarded so re-runs don't error;
  back up `dev.db` before first run.

## Auth / Session Mechanism

Replace the boolean cookie with a **signed session cookie** carrying a principal:

```
{ role: "admin" | "boss" | "member", id, name, departmentIds: string[] }
```

- Signed with **HMAC-SHA256** using a new `SESSION_SECRET` (`.env`) to prevent
  tampering. Cookie is `httpOnly`, `sameSite=lax`, `secure` in production.
- Stateless — no session table (appropriate for a small app).
- `lib/boss-auth.ts` is generalized into `lib/auth.ts`, exposing:
  - `getPrincipal()` → principal | null
  - `isAdmin()`, `isBossModeActive()` (shim = admin || boss, keeps existing call
    sites compiling during migration)
  - Scope helpers: `canManageDepartment(deptId)`, `canManageMember(userId)`
  - `login*/logout` helpers that set/clear the signed cookie.

### Login UX

One login modal with two paths (restyle of the existing "Boss Login" button/modal,
extended in `AdminToggle`):

- **Member:** email + password.
- **Staff (TOTP):** a single 6-digit code field. On submit, the server verifies the
  code against the admin secret first, then each boss's secret, and logs the user in
  as whichever matches. The code alone identifies admin-vs-which-boss because TOTP
  secrets are unique.

The header shows who is logged in (role + name) with a logout control.

## Authorization Enforcement (server actions)

Every mutating server action gets a principal-based guard (not just "is boss"),
returning early + logging on failure (as today):

- `handleCreateUser` — admin: any dept; boss: only into a dept they manage.
- `handleUpdateUser` / `handleDeleteUser` — allowed only if target user belongs to a
  dept the principal manages (admin: all).
- Leave approve/deny — only for requests by users in the principal's managed depts.
- `handleUpdateDepartment` (rename) — only own depts.
- `handleCreateDepartment` / `handleDeleteDepartment` — **admin only**.
- New member-self actions — a logged-in member may create/cancel only **their own**
  requests.

Guards live in `lib/auth.ts` so each action is a one-line check.

## Management UI & Member Fields

- **Admin-only "Bosse" area** (new page `/bosse`, nav link shown only to admin):
  create a boss → name + pick department(s) via existing `DepartmentMultiSelect` →
  server generates a random base32 TOTP secret → page shows the **QR code** +
  `otpauth://` URL for one-time scanning. List/edit/delete bosses; regenerate secret.
- **Member create/edit form** (`/mitglieder`) gains **email** + **password** fields
  (password optional on edit = "leave unchanged"). Bosses see/manage only their
  departments' members and can assign only their own departments.
- **`/mitglieder` and `/abteilungen`** become department-scoped for bosses (admin sees
  all). "Nur Administratoren" notices become role-aware ("nur Admin/Boss").
- **Member experience:** when logged in, the `/urlaube` leave form is pre-bound to the
  member (no user picker); they see their own requests + the open calendar. Header
  shows logged-in identity + logout.

## Edge Cases

- Deleting a department a boss manages → cascade-remove the `BossDepartment` link.
- Boss with zero departments → sees nothing manageable (no crash).
- Duplicate member email → UNIQUE constraint violation surfaced as a friendly error.
- Existing members without email/password → cannot log in until set (acceptable).
- Admin always passes scope checks.

## Testing

No test harness exists today. Plan:

- Lightweight script-based checks for security-critical **pure** logic:
  - `scrypt` hash/verify round-trip (and reject on wrong password).
  - HMAC session sign/verify (and reject tampered payloads).
  - `canManageDepartment` / `canManageMember` scope logic for admin/boss/member.
- Manual QA checklist: each role logs in; sees only what it should; scope guards
  reject cross-department actions (boss A cannot edit boss B's members/department,
  cannot create/delete departments; member cannot approve).

## Implementation Constraints

Per `kalender/AGENTS.md`, this Next.js (16.2.6) has breaking changes vs. common
knowledge. During implementation, consult `node_modules/next/dist/docs/` before
writing route/auth/cookie code.

## Out of Scope (YAGNI)

- Member self-registration (admin/boss provisions accounts).
- Password reset / email flows.
- Bosses submitting their own vacation via the boss login.
- A persistent server-side session store (stateless signed cookie is sufficient).
