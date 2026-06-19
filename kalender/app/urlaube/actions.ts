"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { queryDatabase, runDatabase, getOne } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { computeInitialStatus, canSubstituteAct, canResubmit, type CreatorRole } from "@/lib/leave-workflow";

async function canActOnLeave(leaveId: string): Promise<boolean> {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") return false;
  if (principal.role === "admin") return true;
  // boss: the leave's owner must share a department with the boss
  const rows = await queryDatabase<{ departmentId: string }>(
    `SELECT ud.departmentId
     FROM LeaveRequest lr
     JOIN UserDepartment ud ON lr.userId = ud.userId
     WHERE lr.id = ?`,
    [leaveId]
  );
  return rows.some((r) => principal.departmentIds.includes(r.departmentId));
}

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

// 1. ACTION: Konflikte prüfen (alle Abteilungen des Benutzers)
export async function calculateWorkingDays(startDate: string, endDate: string) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const holidaysResult = await queryDatabase<{ date: string }>("SELECT date FROM PublicHoliday");
  const holidays = new Set(holidaysResult.map(h => h.date.split('T')[0]));

  let workingDays = 0;
  let current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split('T')[0];

    // 0 = Sonntag, 6 = Samstag
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

export async function getUserBalance(userId: string) {
  const userResult = await queryDatabase<any>(
    "SELECT vacationDays, prevYearDays FROM User WHERE id = ?",
    [userId]
  );
  if (userResult.length === 0) return { total: 0, used: 0, remaining: 0 };

  const user = userResult[0];
  const total = (user.vacationDays || 0) + (user.prevYearDays || 0);

  // Alle GENEHMIGTEN Urlaube abrufen
  const leaves = await queryDatabase<any>(
    "SELECT startDate, endDate FROM LeaveRequest WHERE userId = ? AND status = 'GENEHMIGT' AND leaveType = 'Erholungsurlaub'",
    [userId]
  );

  let used = 0;
  for (const leave of leaves) {
    used += await calculateWorkingDays(leave.startDate, leave.endDate);
  }

  return {
    total,
    used,
    remaining: total - used
  };
}

export async function checkConflicts(userId: string, startDate: string, endDate: string, excludeLeaveId?: string) {
  // Find all department IDs for the given user
  const deptResult = await queryDatabase<{ departmentId: string }>(
    "SELECT departmentId FROM UserDepartment WHERE userId = ?",
    [userId]
  );
  const departmentIds = deptResult.map(r => r.departmentId);

  if (departmentIds.length === 0) return [];

  // Check for any user who shares at least one department with the requestor
  const sql = `
    SELECT u.name as userName, lr.startDate, lr.endDate, u.id as userId
    FROM LeaveRequest lr
    INNER JOIN User u ON lr.userId = u.id
    INNER JOIN UserDepartment ud ON u.id = ud.userId
    WHERE ud.departmentId IN (${departmentIds.map(() => '?').join(',')})
      AND lr.userId != ?
      ${excludeLeaveId ? "AND lr.id != ?" : ""}
      AND lr.startDate <= ?
      AND lr.endDate >= ?
    GROUP BY lr.id
  `;

  const params = [
      ...departmentIds,
      userId,
      ...(excludeLeaveId ? [excludeLeaveId] : []),
      endDate,
      startDate
  ];

  return await queryDatabase<{ userName: string; startDate: string; endDate: string, userId: string }>(sql, params);
}

// 2. ACTION: Urlaub eintragen
export async function handleCreateLeave(formData: FormData) {
  const userId = formData.get("userId") as string;
  const substituteId = formData.get("substituteId") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const leaveType = formData.get("leaveType") as string || "Erholungsurlaub";
  const leaveDetails = formData.get("leaveDetails") as string || "";
  const requireSubstitute = formData.get("requireSubstitute") === "on";

  if (!userId || !startDate || !endDate) return;

  const principal = await getPrincipal();
  if (principal?.role === "member" && principal.id !== userId) {
    console.error("Mitglied versucht, Urlaub für eine andere Person einzutragen!");
    return;
  }

  // --- Serverseitige Validierung: Mindestens 1 Monat im Voraus (nur bei Erholungsurlaub) ---
  if (leaveType === "Erholungsurlaub") {
    const today = new Date();
    const minDate = new Date();
    minDate.setMonth(today.getMonth() + 1);
    const selectedStart = new Date(startDate);

    if (selectedStart < minDate) {
      console.error("Sicherheits-Check: Erholungsurlaub weniger als 1 Monat im Voraus abgelehnt.");
      return; // Abbruch auf Server-Ebene
    }

    // --- NEU: Urlaubstage-Kontingent prüfen ---
    const balance = await getUserBalance(userId);
    const neededDays = await calculateWorkingDays(startDate, endDate);
    if (neededDays > balance.remaining) {
      console.error(`Sicherheits-Check: Nicht genügend Resturlaub (${neededDays} benötigt, ${balance.remaining} vorhanden).`);
      return;
    }
    // ------------------------------------------
  }
  // ------------------------------------------------------------------------------------------

  const conflicts = await checkConflicts(userId, startDate, endDate);
  if (conflicts.length > 0) {
    console.error("Sicherheits-Check: Überschneidung mit bestehenden Urlauben.");
    return;
  }

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
}

// 3. ACTION: Urlaub ändern
export async function handleUpdateLeave(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await canActOnLeave(id))) {
    console.error("Nicht autorisierter / abteilungsfremder Zugriff auf Urlaubsantrag!");
    return;
  }

  const substituteId = formData.get("substituteId") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const leaveType = formData.get("leaveType") as string;
  const leaveDetails = formData.get("leaveDetails") as string || "";
  if (!startDate || !endDate || !leaveType) return;

  await runDatabase(
    `UPDATE LeaveRequest SET substituteId = ?, startDate = ?, endDate = ?, leaveType = ?, leaveDetails = ?, updatedAt = ? WHERE id = ?`,
    [substituteId, startDate, endDate, leaveType, leaveDetails, new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
}

// 4. ACTION: Urlaub löschen
export async function handleDeleteLeave(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await canActOnLeave(id))) {
    console.error("Nicht autorisierter / abteilungsfremder Zugriff auf Urlaubsantrag!");
    return;
  }

  await runDatabase(`DELETE FROM LeaveRequest WHERE id = ?`, [id]);
  revalidatePath("/urlaube");
}

// 5. ACTION: Urlaub genehmigen
export async function handleApproveLeave(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;
  if (!(await canActOnLeave(id))) {
    console.error("Nicht autorisierter / abteilungsfremder Zugriff auf Urlaubsantrag!");
    return;
  }

  await runDatabase(
    `UPDATE LeaveRequest SET status = 'GENEHMIGT', updatedAt = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
  revalidatePath("/mitglieder");
  revalidatePath("/");
}

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
  if (!(await isOwnerOf(id)) && !(await canActOnLeave(id))) {
    console.error("Nur der Antragsteller oder ein zuständiger Vorgesetzter darf erneut einreichen!");
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
