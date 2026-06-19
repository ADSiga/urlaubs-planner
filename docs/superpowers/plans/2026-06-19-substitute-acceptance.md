# Substitute Acceptance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the nominated Vertretung (substitute) to accept an Erholungsurlaub request before it reaches the boss; a decline returns the request to the requester to pick a different substitute and resubmit.

**Architecture:** Add a pure, fully-tested workflow module (`lib/leave-workflow.ts`) that computes the initial leave status and guards the new state transitions. Server actions in `app/urlaube/actions.ts` become thin glue over that module plus DB + auth. The leave page gains member-facing sections (accept/decline, re-pick) and the header gains a substitute badge. No DB migration — `status` is free-form `TEXT`.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, SQLite via raw SQL (`lib/db.ts`), Node 22 native TS test runner (`node --test`).

## Global Constraints

- **No DB migration.** `status` is `TEXT NOT NULL DEFAULT 'pending'` with no CHECK constraint; `schema.prisma` declares `status String` and is reference-only. New status values are written explicitly on every insert/update.
- **Status string values (exact):** `WARTE_VERTRETUNG`, `ABGELEHNT_VERTRETUNG`, `PENDING`, `GENEHMIGT`.
- **German UI labels (exact):** `Wartet auf Vertretung`, `Vertretung abgelehnt`, `Ausstehend`, `Genehmigt`.
- **Gate scope:** automatic gate applies to member-created **Erholungsurlaub** only. Staff (boss/admin) opt in per request via the `requireSubstitute` checkbox, which applies regardless of leave type.
- **Test command:** `node --test lib/<name>.test.ts` (run from the `kalender/` directory).
- **Typecheck command:** `npx tsc --noEmit` (run from `kalender/`, currently passes clean).
- **Working directory for all commands:** `C:\laragon\www\Urlaube\kalender`.
- **`Principal` type** (`lib/session-crypto.ts`): `{ role: "admin" | "boss" | "member"; id: string; name: string; departmentIds: string[] }`.
- **Commit footer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `lib/leave-workflow.ts` — pure workflow logic: status constants, `computeInitialStatus`, transition guards, label map. No I/O.
- **Create** `lib/leave-workflow.test.ts` — `node:test` unit tests for the above.
- **Create** `app/SubstituteRequest.tsx` — accept/decline card (server component).
- **Create** `app/ResubmitLeave.tsx` — re-pick-substitute + resubmit card (server component).
- **Modify** `app/urlaube/actions.ts` — status computation in `handleCreateLeave`; 3 new actions; 2 auth helpers.
- **Modify** `app/urlaube/page.tsx` — member-facing sections + `isStaff` prop to form.
- **Modify** `app/urlaube/LeaveForm.tsx` — staff-only `requireSubstitute` checkbox.
- **Modify** `app/EditableLeave.tsx` — status badge labels/colors for all four statuses.
- **Modify** `app/layout.tsx` — substitute badge for logged-in members.
- **Modify** `schema.prisma` — reference comment listing allowed status values.

---

### Task 1: Pure workflow module

**Files:**
- Create: `lib/leave-workflow.ts`
- Test: `lib/leave-workflow.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `type LeaveStatus = "WARTE_VERTRETUNG" | "ABGELEHNT_VERTRETUNG" | "PENDING" | "GENEHMIGT"`
  - `type CreatorRole = "admin" | "boss" | "member"`
  - `const STATUS_LABELS: Record<string, string>`
  - `function computeInitialStatus(args: { role: CreatorRole; leaveType: string; requireSubstitute: boolean; hasSubstitute: boolean }): LeaveStatus`
  - `function canSubstituteAct(status: string): boolean`
  - `function canResubmit(status: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/leave-workflow.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeInitialStatus,
  canSubstituteAct,
  canResubmit,
  STATUS_LABELS,
} from "./leave-workflow.ts";

test("member + Erholungsurlaub with substitute is gated", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "WARTE_VERTRETUNG"
  );
});

test("member + Sonderurlaub goes straight to PENDING", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Sonderurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
});

test("member + Erholungsurlaub without a substitute cannot be gated", () => {
  assert.equal(
    computeInitialStatus({ role: "member", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: false }),
    "PENDING"
  );
});

test("staff defaults to PENDING when checkbox is off", () => {
  assert.equal(
    computeInitialStatus({ role: "boss", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
  assert.equal(
    computeInitialStatus({ role: "admin", leaveType: "Erholungsurlaub", requireSubstitute: false, hasSubstitute: true }),
    "PENDING"
  );
});

test("staff gates when checkbox is on and a substitute is chosen (any leave type)", () => {
  assert.equal(
    computeInitialStatus({ role: "admin", leaveType: "Sonderurlaub", requireSubstitute: true, hasSubstitute: true }),
    "WARTE_VERTRETUNG"
  );
});

test("staff checkbox on but no substitute falls back to PENDING", () => {
  assert.equal(
    computeInitialStatus({ role: "boss", leaveType: "Erholungsurlaub", requireSubstitute: true, hasSubstitute: false }),
    "PENDING"
  );
});

test("canSubstituteAct only on WARTE_VERTRETUNG", () => {
  assert.equal(canSubstituteAct("WARTE_VERTRETUNG"), true);
  assert.equal(canSubstituteAct("PENDING"), false);
  assert.equal(canSubstituteAct("GENEHMIGT"), false);
  assert.equal(canSubstituteAct("ABGELEHNT_VERTRETUNG"), false);
});

test("canResubmit only on ABGELEHNT_VERTRETUNG", () => {
  assert.equal(canResubmit("ABGELEHNT_VERTRETUNG"), true);
  assert.equal(canResubmit("WARTE_VERTRETUNG"), false);
  assert.equal(canResubmit("PENDING"), false);
});

test("STATUS_LABELS maps all four statuses to German", () => {
  assert.equal(STATUS_LABELS.WARTE_VERTRETUNG, "Wartet auf Vertretung");
  assert.equal(STATUS_LABELS.ABGELEHNT_VERTRETUNG, "Vertretung abgelehnt");
  assert.equal(STATUS_LABELS.PENDING, "Ausstehend");
  assert.equal(STATUS_LABELS.GENEHMIGT, "Genehmigt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/leave-workflow.test.ts`
Expected: FAIL — cannot find module `./leave-workflow.ts` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/leave-workflow.ts`:

```ts
export type LeaveStatus =
  | "WARTE_VERTRETUNG"
  | "ABGELEHNT_VERTRETUNG"
  | "PENDING"
  | "GENEHMIGT";

export type CreatorRole = "admin" | "boss" | "member";

export const STATUS_LABELS: Record<string, string> = {
  WARTE_VERTRETUNG: "Wartet auf Vertretung",
  ABGELEHNT_VERTRETUNG: "Vertretung abgelehnt",
  PENDING: "Ausstehend",
  GENEHMIGT: "Genehmigt",
};

export function computeInitialStatus(args: {
  role: CreatorRole;
  leaveType: string;
  requireSubstitute: boolean;
  hasSubstitute: boolean;
}): LeaveStatus {
  const { role, leaveType, requireSubstitute, hasSubstitute } = args;

  if (role === "member") {
    // Automatic gate: Erholungsurlaub only, and only when a substitute exists.
    return leaveType === "Erholungsurlaub" && hasSubstitute
      ? "WARTE_VERTRETUNG"
      : "PENDING";
  }

  // Staff (admin/boss): explicit opt-in via the form checkbox, any leave type.
  return requireSubstitute && hasSubstitute ? "WARTE_VERTRETUNG" : "PENDING";
}

export function canSubstituteAct(status: string): boolean {
  return status === "WARTE_VERTRETUNG";
}

export function canResubmit(status: string): boolean {
  return status === "ABGELEHNT_VERTRETUNG";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/leave-workflow.test.ts`
Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/leave-workflow.ts lib/leave-workflow.test.ts
git commit -m "feat(holidays): pure leave-workflow status helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server actions for the substitute gate

**Files:**
- Modify: `app/urlaube/actions.ts`

**Interfaces:**
- Consumes: `computeInitialStatus`, `canSubstituteAct`, `canResubmit`, `type CreatorRole` from `@/lib/leave-workflow`; `getOne`, `queryDatabase`, `runDatabase` from `@/lib/db`; `getPrincipal` from `@/lib/auth`; existing `checkConflicts` in this file.
- Produces (used by Task 6 page wiring):
  - `handleSubstituteAccept(formData: FormData): Promise<void>` — form field `id`
  - `handleSubstituteDecline(formData: FormData): Promise<void>` — form field `id`
  - `handleResubmitLeave(formData: FormData): Promise<void>` — form fields `id`, `substituteId`
  - `handleCreateLeave` now also reads form field `requireSubstitute` (checkbox value `"on"`)

This task is DB + auth glue (the testable logic lives in Task 1). It is verified by `npx tsc --noEmit` and the manual smoke test in Step 6, matching the repo convention that server actions have no unit-test harness.

- [ ] **Step 1: Add imports**

In `app/urlaube/actions.ts`, update the existing imports. Change the `@/lib/db` import line to include `getOne`, and add the workflow import:

```ts
import { queryDatabase, runDatabase, getOne } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { computeInitialStatus, canSubstituteAct, canResubmit, type CreatorRole } from "@/lib/leave-workflow";
```

- [ ] **Step 2: Add the two auth helpers**

Add directly below the existing `canActOnLeave` function:

```ts
async function isSubstituteOf(leaveId: string): Promise<boolean> {
  const principal = await getPrincipal();
  if (!principal) return false;
  const row = await getOne<{ substituteId: string | null }>(
    "SELECT substituteId FROM LeaveRequest WHERE id = ?",
    [leaveId]
  );
  return !!row && row.substituteId === principal.id;
}

async function isOwnerOf(leaveId: string): Promise<boolean> {
  const principal = await getPrincipal();
  if (!principal) return false;
  const row = await getOne<{ userId: string }>(
    "SELECT userId FROM LeaveRequest WHERE id = ?",
    [leaveId]
  );
  return !!row && row.userId === principal.id;
}
```

- [ ] **Step 3: Compute the initial status in `handleCreateLeave`**

In `handleCreateLeave`, read the checkbox right after the other `formData.get` calls:

```ts
  const requireSubstitute = formData.get("requireSubstitute") === "on";
```

Then replace the hard-coded `'PENDING'` insert. Change the INSERT block from:

```ts
  const newRequestId = randomUUID();
  const nowIsoString = new Date().toISOString();

  await runDatabase(
    `INSERT INTO LeaveRequest (id, userId, substituteId, startDate, endDate, leaveType, leaveDetails, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [newRequestId, userId, substituteId, startDate, endDate, leaveType, leaveDetails, nowIsoString, nowIsoString]
  );
  revalidatePath("/urlaube");
```

to:

```ts
  const newRequestId = randomUUID();
  const nowIsoString = new Date().toISOString();

  const role: CreatorRole = principal?.role ?? "member";
  const status = computeInitialStatus({
    role,
    leaveType,
    requireSubstitute,
    hasSubstitute: !!substituteId,
  });

  await runDatabase(
    `INSERT INTO LeaveRequest (id, userId, substituteId, startDate, endDate, leaveType, leaveDetails, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newRequestId, userId, substituteId, startDate, endDate, leaveType, leaveDetails, status, nowIsoString, nowIsoString]
  );
  revalidatePath("/urlaube");
```

Note: `principal` is already fetched earlier in `handleCreateLeave` (the member-mismatch check). Reuse that variable — do not call `getPrincipal()` again. A null principal defaults to `"member"`, which is the safer (gated) default.

- [ ] **Step 4: Add the three new actions**

Append to the end of `app/urlaube/actions.ts`:

```ts
// 6. ACTION: Vertretung stimmt zu (WARTE_VERTRETUNG -> PENDING)
export async function handleSubstituteAccept(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await isSubstituteOf(id))) {
    console.error("Nur die zugewiesene Vertretung darf zustimmen!");
    return;
  }
  const row = await getOne<{ status: string }>(
    "SELECT status FROM LeaveRequest WHERE id = ?",
    [id]
  );
  if (!row || !canSubstituteAct(row.status)) return;

  await runDatabase(
    `UPDATE LeaveRequest SET status = 'PENDING', updatedAt = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
}

// 7. ACTION: Vertretung lehnt ab (WARTE_VERTRETUNG -> ABGELEHNT_VERTRETUNG)
export async function handleSubstituteDecline(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await isSubstituteOf(id))) {
    console.error("Nur die zugewiesene Vertretung darf ablehnen!");
    return;
  }
  const row = await getOne<{ status: string }>(
    "SELECT status FROM LeaveRequest WHERE id = ?",
    [id]
  );
  if (!row || !canSubstituteAct(row.status)) return;

  await runDatabase(
    `UPDATE LeaveRequest SET status = 'ABGELEHNT_VERTRETUNG', updatedAt = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
}

// 8. ACTION: Antragsteller wählt neue Vertretung und reicht erneut ein
//    (ABGELEHNT_VERTRETUNG -> WARTE_VERTRETUNG)
export async function handleResubmitLeave(formData: FormData) {
  const id = formData.get("id") as string;
  const substituteId = formData.get("substituteId") as string;
  if (!id || !substituteId) return;
  if (!(await isOwnerOf(id))) {
    console.error("Nur der Antragsteller darf erneut einreichen!");
    return;
  }
  const row = await getOne<{ status: string; userId: string; startDate: string; endDate: string }>(
    "SELECT status, userId, startDate, endDate FROM LeaveRequest WHERE id = ?",
    [id]
  );
  if (!row || !canResubmit(row.status)) return;

  const conflicts = await checkConflicts(row.userId, row.startDate, row.endDate, id);
  if (conflicts.length > 0) {
    console.error("Sicherheits-Check: Überschneidung beim erneuten Einreichen.");
    return;
  }

  await runDatabase(
    `UPDATE LeaveRequest SET substituteId = ?, status = 'WARTE_VERTRETUNG', updatedAt = ? WHERE id = ?`,
    [substituteId, new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Manual smoke test (deferred until Task 6 wires the UI)**

The actions have no UI yet. Mark this step done once `npx tsc --noEmit` passes; the end-to-end flow is exercised in Task 6's verification.

- [ ] **Step 7: Commit**

```bash
git add app/urlaube/actions.ts
git commit -m "feat(holidays): substitute accept/decline/resubmit actions + gated create

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Staff-only "Vertretung muss zustimmen" checkbox

**Files:**
- Modify: `app/urlaube/LeaveForm.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a new optional prop `isStaff?: boolean` on `LeaveForm`; renders a checkbox `name="requireSubstitute"` when `isStaff` is true. The checkbox is naturally included in the `FormData` built by the existing `handleBruteForceClick`.

- [ ] **Step 1: Add `isStaff` to the props interface**

In `app/urlaube/LeaveForm.tsx`, change the `LeaveFormProps` interface to add the prop:

```ts
interface LeaveFormProps {
  users: DbUser[];
  currentMemberId: string | null;
  isStaff?: boolean;
  onCreateLeave: (formData: FormData) => Promise<void>;
  checkConflicts: (userId: string, startDate: string, endDate: string) => Promise<ConflictUser[]>;
  getUserBalance: (userId: string) => Promise<{ total: number; used: number; remaining: number }>;
  calculateWorkingDays: (startDate: string, endDate: string) => Promise<number>;
}
```

And destructure it in the component signature:

```ts
export default function LeaveForm({ users, currentMemberId, isStaff, onCreateLeave, checkConflicts, getUserBalance, calculateWorkingDays }: LeaveFormProps) {
```

- [ ] **Step 2: Render the checkbox**

In `app/urlaube/LeaveForm.tsx`, insert this block immediately AFTER the `leaveType` `<select>`'s closing `</div>` (the `<div>` containing the Erholungsurlaub/Sonderurlaub select) and BEFORE the `{leaveType === "Sonderurlaub" && (` block:

```tsx
        {isStaff && (
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 px-1">
            <input
              type="checkbox"
              name="requireSubstitute"
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            Vertretung muss zustimmen
          </label>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/urlaube/LeaveForm.tsx
git commit -m "feat(holidays): staff-only require-substitute checkbox on leave form

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: SubstituteRequest component (accept / decline card)

**Files:**
- Create: `app/SubstituteRequest.tsx`

**Interfaces:**
- Consumes: `STATUS_LABELS` is not needed here. The two server actions from Task 2 (`handleSubstituteAccept`, `handleSubstituteDecline`) are passed in as props.
- Produces: default export `SubstituteRequest` with props:
  `{ request: { id: string; userName?: string; userDepartment?: string; startDate: string; endDate: string; leaveType: string; leaveDetails?: string }; onAccept: (fd: FormData) => Promise<void>; onDecline: (fd: FormData) => Promise<void> }`

- [ ] **Step 1: Create the component**

Create `app/SubstituteRequest.tsx`:

```tsx
interface SubstituteRequestData {
  id: string;
  userName?: string;
  userDepartment?: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  leaveDetails?: string;
}

interface SubstituteRequestProps {
  request: SubstituteRequestData;
  onAccept: (formData: FormData) => Promise<void>;
  onDecline: (formData: FormData) => Promise<void>;
}

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SubstituteRequest({ request, onAccept, onDecline }: SubstituteRequestProps) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-sky-200 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20">
      <div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{request.userName || "Unbekannt"}</h3>
        <p className="text-xs text-zinc-500">Bereich: {request.userDepartment || "Keine Angabe"}</p>
        <div className="mt-2 text-sm text-sky-700 dark:text-sky-400 font-medium">{fmt(request.startDate)} - {fmt(request.endDate)}</div>
        <div className="mt-1 text-[11px] text-zinc-400">{request.leaveType}</div>
        {request.leaveDetails && (
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 italic">Details: {request.leaveDetails}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <form action={onAccept}>
          <input type="hidden" name="id" value={request.id} />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            Zustimmen
          </button>
        </form>
        <form action={onDecline}>
          <input type="hidden" name="id" value={request.id} />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Ablehnen
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/SubstituteRequest.tsx
git commit -m "feat(holidays): SubstituteRequest accept/decline card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: ResubmitLeave component (re-pick substitute)

**Files:**
- Create: `app/ResubmitLeave.tsx`

**Interfaces:**
- Consumes: `handleResubmitLeave` from Task 2 (passed as prop `onResubmit`).
- Produces: default export `ResubmitLeave` with props:
  `{ request: { id: string; startDate: string; endDate: string; leaveType: string }; eligibleSubstitutes: { id: string; name: string }[]; onResubmit: (fd: FormData) => Promise<void> }`

- [ ] **Step 1: Create the component**

Create `app/ResubmitLeave.tsx`:

```tsx
interface ResubmitLeaveData {
  id: string;
  startDate: string;
  endDate: string;
  leaveType: string;
}

interface ResubmitLeaveProps {
  request: ResubmitLeaveData;
  eligibleSubstitutes: { id: string; name: string }[];
  onResubmit: (formData: FormData) => Promise<void>;
}

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ResubmitLeave({ request, eligibleSubstitutes, onResubmit }: ResubmitLeaveProps) {
  return (
    <form
      action={onResubmit}
      className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 space-y-3"
    >
      <input type="hidden" name="id" value={request.id} />
      <div>
        <div className="text-sm font-medium text-rose-700 dark:text-rose-400">{fmt(request.startDate)} - {fmt(request.endDate)}</div>
        <div className="text-[11px] text-zinc-500">{request.leaveType} · Vertretung hat abgelehnt — bitte neue Vertretung wählen.</div>
      </div>
      <div className="flex items-center gap-2">
        <select
          name="substituteId"
          required
          defaultValue=""
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="" disabled>-- Neue Vertretung wählen --</option>
          {eligibleSubstitutes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950"
        >
          Erneut einreichen
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/ResubmitLeave.tsx
git commit -m "feat(holidays): ResubmitLeave re-pick-substitute card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire member-facing sections into the leave page

**Files:**
- Modify: `app/urlaube/page.tsx`

**Interfaces:**
- Consumes: `SubstituteRequest` (Task 4), `ResubmitLeave` (Task 5), `handleSubstituteAccept`, `handleSubstituteDecline`, `handleResubmitLeave` (Task 2), existing `handleCreateLeave` / `handleUpdateLeave` / `handleDeleteLeave` / `handleApproveLeave`, `STATUS_LABELS` (Task 1, optional).
- Produces: the rendered page; passes `isStaff={canApprove}` to `LeaveForm`.

- [ ] **Step 1: Add imports**

In `app/urlaube/page.tsx`, add to the top with the other imports:

```ts
import SubstituteRequest from "../SubstituteRequest";
import ResubmitLeave from "../ResubmitLeave";
```

And extend the existing action import line to include the three new actions:

```ts
import { checkConflicts, handleCreateLeave, handleUpdateLeave, handleDeleteLeave, handleApproveLeave, handleSubstituteAccept, handleSubstituteDecline, handleResubmitLeave, getUserBalance, calculateWorkingDays } from "./actions";
```

- [ ] **Step 2: Add the `substituteId` field to the query result type**

In `app/urlaube/page.tsx`, the `DbLeaveRequest` interface already includes `substituteId?: string`. Confirm it is present (it is). No change needed if so.

- [ ] **Step 3: Derive the member-facing lists**

In `app/urlaube/page.tsx`, immediately after the existing `visiblePending` declaration, add:

```ts
  const myId = principal?.id ?? null;

  // Requests where I am the nominated substitute and acceptance is pending.
  const substituteRequests = leaveRequests.filter(
    (r) => r.substituteId === myId && r.status === "WARTE_VERTRETUNG"
  );

  // My own requests, newest-relevant statuses first for visibility.
  const myRequests =
    principal?.role === "member"
      ? leaveRequests.filter((r) => r.userId === myId)
      : [];

  const myDeclined = myRequests.filter((r) => r.status === "ABGELEHNT_VERTRETUNG");
  const myPendingOwn = myRequests.filter(
    (r) => r.status === "WARTE_VERTRETUNG" || r.status === "PENDING"
  );

  // Eligible substitutes for re-pick: users sharing a department with me, excluding me.
  const me = users.find((u) => u.id === myId);
  const eligibleSubstitutes = me
    ? users
        .filter((u) => u.id !== me.id && u.departmentIds.some((d) => me.departmentIds.includes(d)))
        .map((u) => ({ id: u.id, name: u.name }))
    : [];
```

- [ ] **Step 4: Render the "Vertretungs-Anfragen" section**

In `app/urlaube/page.tsx`, inside the `<div className="md:col-span-2 space-y-8">` column, add this block as the FIRST child (before the `{canApprove && visiblePending.length > 0 && (` block):

```tsx
          {/* Vertretungs-Anfragen: Anträge, bei denen ich die Vertretung bin */}
          {substituteRequests.length > 0 && (
            <div className="rounded-xl border-2 border-sky-200 bg-sky-50/30 p-6 shadow-sm dark:border-sky-900/30 dark:bg-sky-950/10">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-sky-800 dark:text-sky-400">Vertretungs-Anfragen</h2>
                  <p className="text-xs text-sky-600/80">Diese Anträge warten auf deine Zustimmung als Vertretung.</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-400">
                  {substituteRequests.length}
                </div>
              </div>
              <div className="space-y-3">
                {substituteRequests.map((request) => (
                  <SubstituteRequest
                    key={request.id}
                    request={request}
                    onAccept={handleSubstituteAccept}
                    onDecline={handleSubstituteDecline}
                  />
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 5: Render the "Meine Anträge" section**

In `app/urlaube/page.tsx`, add this block immediately AFTER the "Vertretungs-Anfragen" block and BEFORE the `{canApprove && ...}` block:

```tsx
          {/* Meine Anträge: eigene offene und abgelehnte Anträge */}
          {principal?.role === "member" && (myDeclined.length > 0 || myPendingOwn.length > 0) && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-bold tracking-tight mb-1 text-zinc-900 dark:text-zinc-100">Meine Anträge</h2>
              <p className="text-sm text-zinc-500 mb-6">Status deiner offenen Urlaubsanträge.</p>
              <div className="space-y-3">
                {myDeclined.map((request) => (
                  <ResubmitLeave
                    key={request.id}
                    request={request}
                    eligibleSubstitutes={eligibleSubstitutes}
                    onResubmit={handleResubmitLeave}
                  />
                ))}
                {myPendingOwn.map((request) => (
                  <EditableLeave
                    key={request.id}
                    request={request}
                    users={users}
                    checkConflicts={checkConflicts}
                  />
                ))}
              </div>
            </div>
          )}
```

Note: `EditableLeave` is rendered here without `onUpdate`/`onDelete`/`onApprove`, so members see a read-only status card (the component already guards every action behind those props). Its status badge is upgraded in Task 7.

- [ ] **Step 6: Pass `isStaff` to the form**

In `app/urlaube/page.tsx`, update the `<LeaveForm ... />` usage to add the prop:

```tsx
          <LeaveForm
            users={users}
            currentMemberId={principal?.role === "member" ? principal.id : null}
            isStaff={canApprove}
            onCreateLeave={handleCreateLeave}
            checkConflicts={checkConflicts}
            getUserBalance={getUserBalance}
            calculateWorkingDays={calculateWorkingDays}
          />
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Manual end-to-end smoke test**

Start the dev server: `npm run dev` (from `kalender/`). Then, logged in as a member:
1. Create an Erholungsurlaub at least 1 month out, choosing a substitute → it should appear under **Meine Anträge** as *Wartet auf Vertretung*, and NOT in any boss list.
2. Log in as that substitute → the request appears under **Vertretungs-Anfragen**. Click **Ablehnen**.
3. Log back in as the requester → request now shows under **Meine Anträge** as a *Vertretung abgelehnt* re-pick card. Pick a different substitute → **Erneut einreichen**.
4. As the new substitute, **Zustimmen** → the request leaves the substitute list.
5. Log in as the boss → the request now appears under **Offene Genehmigungen** (status *Ausstehend*). Approve → it moves to *Genehmigte Urlaube*.

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add app/urlaube/page.tsx
git commit -m "feat(holidays): member substitute-request and my-requests sections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Status badge labels for all four statuses

**Files:**
- Modify: `app/EditableLeave.tsx`

**Interfaces:**
- Consumes: `STATUS_LABELS` from `@/lib/leave-workflow`.
- Produces: a status badge that renders the correct German label and color for `WARTE_VERTRETUNG`, `ABGELEHNT_VERTRETUNG`, `PENDING`, and `GENEHMIGT`.

- [ ] **Step 1: Add the import**

At the top of `app/EditableLeave.tsx` (it is a `"use client"` component; importing a pure module is fine), add:

```ts
import { STATUS_LABELS } from "@/lib/leave-workflow";
```

- [ ] **Step 2: Add a color map above the component's return**

Inside the component body, just before the final `return (`, add:

```ts
  const statusClasses: Record<string, string> = {
    WARTE_VERTRETUNG: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-800",
    ABGELEHNT_VERTRETUNG: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800",
    PENDING: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    GENEHMIGT: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
  };
```

- [ ] **Step 3: Replace the status badge span**

In `app/EditableLeave.tsx`, replace the existing status `<span>` (the one with the inline ternary on `request.status === 'PENDING'` that renders `'Ausstehend'`/`'Genehmigt'`) with:

```tsx
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
              statusClasses[request.status] ?? statusClasses.GENEHMIGT
            }`}>
              {STATUS_LABELS[request.status] ?? request.status}
            </span>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/EditableLeave.tsx
git commit -m "feat(holidays): status badge labels for all four leave statuses

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Substitute badge in the header

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `getPrincipal` (already imported).
- Produces: a count badge next to the "Urlaube" nav link for logged-in members, counting `WARTE_VERTRETUNG` requests where they are the substitute.

- [ ] **Step 1: Add the count helper**

In `app/layout.tsx`, add this function directly below the existing `getPendingCount` function:

```ts
async function getSubstituteCount(memberId: string): Promise<number> {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);

  return new Promise((resolve) => {
    db.get(
      "SELECT COUNT(*) as count FROM LeaveRequest WHERE status = 'WARTE_VERTRETUNG' AND substituteId = ?",
      [memberId],
      (err, row: any) => {
        db.close();
        if (err) resolve(0);
        else resolve(row?.count || 0);
      }
    );
  });
}
```

- [ ] **Step 2: Compute the count in the layout**

In `app/layout.tsx`, after the existing `const principal = await getPrincipal();` line, add:

```ts
  const substituteCount =
    principal?.role === "member" ? await getSubstituteCount(principal.id) : 0;
```

- [ ] **Step 3: Render the badge**

In `app/layout.tsx`, inside the "Urlaube" `<Link>`, immediately after the existing `{bossActive && pendingCount > 0 && (...)}` badge span, add a second badge:

```tsx
                  {substituteCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm">
                      {substituteCount}
                    </span>
                  )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(holidays): header badge for pending substitute requests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Document allowed status values in schema.prisma

**Files:**
- Modify: `schema.prisma`

**Interfaces:**
- Consumes: nothing.
- Produces: a reference comment (no migration, no behavior change).

- [ ] **Step 1: Add the comment**

In `schema.prisma`, change the `status` line of `model LeaveRequest` from:

```prisma
  status       String   @default("pending")
```

to:

```prisma
  // Allowed values: WARTE_VERTRETUNG, ABGELEHNT_VERTRETUNG, PENDING, GENEHMIGT
  // (written explicitly by app code; the lowercase default below is never used)
  status       String   @default("pending")
```

- [ ] **Step 2: Commit**

```bash
git add schema.prisma
git commit -m "docs(schema): document allowed LeaveRequest status values

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- State machine + statuses → Task 1 (pure) + Task 2 (transitions in actions).
- Creation logic (member/staff, leave type, checkbox) → Task 1 `computeInitialStatus` + Task 2 Step 3 + Task 3 checkbox.
- Accept / decline / resubmit actions + authorization → Task 2.
- Member "Vertretungs-Anfragen" + "Meine Anträge" sections → Task 6.
- `SubstituteRequest` / `ResubmitLeave` components → Tasks 4 / 5.
- Status badge labels → Task 7.
- Header substitute badge → Task 8.
- `schema.prisma` reference comment / no migration → Task 9 + Global Constraints.
- "Boss list still filters PENDING" (unchanged) → no task needed; verified in Task 6 Step 8.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has expected output.

**Type consistency:** `computeInitialStatus` signature identical in Task 1 definition and Task 2 call. `CreatorRole` exported (Task 1) and imported (Task 2). `canSubstituteAct`/`canResubmit` names consistent across Tasks 1–2. Action names `handleSubstituteAccept`/`handleSubstituteDecline`/`handleResubmitLeave` consistent across Tasks 2, 4, 5, 6. Component prop shapes match the data passed in Task 6 (`request` fields are a subset of `DbLeaveRequest`).
