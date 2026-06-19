# Substitute Acceptance Gate — Design

**Date:** 2026-06-19
**Branch:** feature/multi-role-auth
**Status:** Approved (design)

## Problem

When a member requests Erholungsurlaub, they nominate a **Vertretung** (substitute).
Today the request goes straight to the boss for approval — the nominated substitute
is never asked. We want the substitute to **accept the request first**; only then does
it reach the boss. If the substitute declines, the request returns to the requester so
they can pick a different substitute and resubmit.

## Scope decisions (agreed)

- **Leave types:** the gate applies to **Erholungsurlaub only**. Sonderurlaub continues
  to go straight to the boss (`PENDING`).
- **On decline:** the request returns to the requester, who can pick a different
  substitute and resubmit. It is *not* rejected outright and is *not* forwarded to the
  boss.
- **Boss/admin-created requests:** bypass the gate by default (go straight to `PENDING`),
  but staff get a per-request checkbox to opt in (see below).
- **Admin control:** a per-request checkbox in the leave form — **"Vertretung muss
  zustimmen"** — shown to staff (boss/admin). Members never see it; for members the gate
  is always on for Erholungsurlaub.
- **Substitute experience:** in-app only (no email infrastructure exists). A logged-in
  member sees a "Vertretungs-Anfragen" section plus a count badge in the header.

## State machine

The `status` column is free-form `TEXT` (verified: no CHECK constraint, no Prisma enum —
`schema.prisma` declares `status String` and is reference-only, not migrated via Prisma
CLI). **No DB migration is required**, for either the dev DB (`../dev.db`) or the deploy
copy at `C:\laragon\www\Kalender`.

Statuses:

| Status | German label | Meaning |
|---|---|---|
| `WARTE_VERTRETUNG` | *Wartet auf Vertretung* | Awaiting the substitute's acceptance — boss cannot see it yet |
| `ABGELEHNT_VERTRETUNG` | *Vertretung abgelehnt* | Substitute declined; back with the requester to re-pick |
| `PENDING` | *Ausstehend* | Cleared the substitute gate; awaiting boss approval |
| `GENEHMIGT` | *Genehmigt* | Boss approved |

Transitions:

```
                       member + Erholungsurlaub
   (create) ─────────────────────────────────────────▶ WARTE_VERTRETUNG
                                                          │        │
   member + Sonderurlaub                       accept     │        │ decline
   OR staff (checkbox off) ──────▶ PENDING ◀─────────────┘        ▼
                                     ▲                    ABGELEHNT_VERTRETUNG
   staff (checkbox on) ──────▶ WARTE_VERTRETUNG                    │
                                                                   │ requester
   boss approve: PENDING ──────▶ GENEHMIGT          re-pick + resubmit
                                                                   │
                                              WARTE_VERTRETUNG ◀───┘
```

Creation logic in `handleCreateLeave`:

- **member + Erholungsurlaub** → `WARTE_VERTRETUNG` (always)
- **member + Sonderurlaub** → `PENDING`
- **boss/admin** → `PENDING` by default; if "Vertretung muss zustimmen" is ticked **and**
  a substitute is selected → `WARTE_VERTRETUNG`. The staff checkbox is an explicit
  override and applies regardless of leave type — the "Erholungsurlaub only" rule governs
  the *automatic* gate for members, not this deliberate staff opt-in.

Side effect (desirable): the existing header badge and boss list filter on
`status='PENDING'`, so a request only appears for the boss once it has cleared the
substitute gate. No change needed to that filter.

## Server actions (`app/urlaube/actions.ts`)

New auth helpers alongside the existing `canActOnLeave`:

- `isSubstituteOf(leaveId)` — true when the logged-in principal is the request's
  `substituteId`.
- `isOwnerOf(leaveId)` — true when the logged-in principal is the request's `userId`.

Changed / new actions:

- **`handleCreateLeave`** (changed) — compute initial status from role + leaveType +
  the new `requireSubstitute` form field, per the creation logic above. Existing
  validation (1-month lead time, balance, conflicts) is unchanged.
- **`handleSubstituteAccept(formData)`** (new) — requires `isSubstituteOf` and current
  status `WARTE_VERTRETUNG`; sets `→ PENDING`, bumps `updatedAt`, revalidates `/urlaube`.
- **`handleSubstituteDecline(formData)`** (new) — same auth; sets
  `→ ABGELEHNT_VERTRETUNG`.
- **`handleResubmitLeave(formData)`** (new) — requires `isOwnerOf` and current status
  `ABGELEHNT_VERTRETUNG`; updates `substituteId` to the newly chosen one, re-runs
  `checkConflicts`, and sets `→ WARTE_VERTRETUNG`.

Existing boss/admin actions (`handleApproveLeave`, `handleUpdateLeave`,
`handleDeleteLeave`) are unchanged and continue to operate on `PENDING`.

### Authorization summary

| Action | Who | Precondition |
|---|---|---|
| Accept / Decline | the substitute (`principal.id === substituteId`) | status `WARTE_VERTRETUNG` |
| Re-pick + resubmit | the owner (`principal.id === userId`) | status `ABGELEHNT_VERTRETUNG` |
| Approve / update / delete | boss (dept-scoped) / admin | status `PENDING` |

## UI

### `app/urlaube/page.tsx`

Members currently see only the approved history. Add two member-facing sections:

- **"Vertretungs-Anfragen"** — requests where the principal is the substitute and status
  is `WARTE_VERTRETUNG`, each with **Zustimmen / Ablehnen** buttons. Shown to anyone
  logged in who is someone's substitute (members and staff alike).
- **"Meine Anträge"** — the principal's own requests across all statuses, so they can see
  a request sitting in *Wartet auf Vertretung* and, if declined, a *Vertretung abgelehnt*
  card with an inline re-pick-substitute + resubmit control.

The boss "Offene Genehmigungen" section and the approved-history section are unchanged.

### Components

To avoid overloading `EditableLeave`, add two small focused components:

- **`SubstituteRequest.tsx`** — the accept/decline card (server-action forms).
- **`ResubmitLeave.tsx`** — the re-pick-and-resubmit card for declined requests; reuses
  the same department-shared substitute filtering as `LeaveForm`.

`EditableLeave.tsx` — extend the status badge to label the two new statuses (today it
only knows `PENDING` vs `GENEHMIGT`).

### `app/LeaveForm.tsx`

Add the staff-only **"Vertretung muss zustimmen"** checkbox (field name
`requireSubstitute`). Hidden for members. The form already requires a substitute, so the
checkbox only governs whether staff-created requests enter the gate.

### `app/layout.tsx`

Add a substitute badge next to the "Urlaube" link: for a logged-in member, the count of
`WARTE_VERTRETUNG` rows where `substituteId = me`. The existing boss `PENDING` badge is
untouched.

## Out of scope / non-goals

- Email or push notifications (no infrastructure today; in-app only).
- Substitute acceptance for Sonderurlaub.
- Re-checking conflicts at accept time — a `WARTE_VERTRETUNG` request already blocks
  overlapping requests via `checkConflicts`, so no new overlap can appear between
  creation and acceptance. The resubmit path *does* re-check, since the substitute
  changes.

## Testing

- **Pure/action logic:** initial-status computation across the matrix (member vs staff;
  Erholungsurlaub vs Sonderurlaub; checkbox on/off).
- **Authorization:** a non-substitute cannot accept/decline; a non-owner cannot resubmit;
  status preconditions are enforced.
- **Flow:** create → accept → boss sees `PENDING` → approve → `GENEHMIGT`; and
  create → decline → owner re-picks → `WARTE_VERTRETUNG` → accept → `PENDING`.

## Files touched

- `app/urlaube/actions.ts` — creation logic + 3 new actions + 2 auth helpers
- `app/urlaube/page.tsx` — member-facing sections
- `app/LeaveForm.tsx` — staff checkbox
- `app/EditableLeave.tsx` — status labels
- `app/SubstituteRequest.tsx` — new
- `app/ResubmitLeave.tsx` — new
- `app/layout.tsx` — substitute badge
- `schema.prisma` — reference comment documenting allowed status values (no migration)
