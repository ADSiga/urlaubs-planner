"use server";

import path from "path";
import sqlite3 from "sqlite3";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { isBossModeActive } from "@/lib/boss-auth";

// Zentrale Hilfsfunktion für Abfragen
function queryDatabase<T>(sql: string, params: any[] = []): Promise<T[]> {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READWRITE);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

// Zentrale Hilfsfunktion für Änderungen
function runDatabase(sql: string, params: any[] = []): Promise<void> {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READWRITE);
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
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
  
  if (!userId || !startDate || !endDate) return;

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

  await runDatabase(
    `INSERT INTO LeaveRequest (id, userId, substituteId, startDate, endDate, leaveType, leaveDetails, status, createdAt, updatedAt) 
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [newRequestId, userId, substituteId, startDate, endDate, leaveType, leaveDetails, nowIsoString, nowIsoString]
  );
  revalidatePath("/urlaube");
}

// 3. ACTION: Urlaub ändern
export async function handleUpdateLeave(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Urlaub zu ändern!");
    return;
  }

  const id = formData.get("id") as string;
  const substituteId = formData.get("substituteId") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const leaveType = formData.get("leaveType") as string;
  const leaveDetails = formData.get("leaveDetails") as string || "";
  if (!id || !startDate || !endDate || !leaveType) return;

  await runDatabase(
    `UPDATE LeaveRequest SET substituteId = ?, startDate = ?, endDate = ?, leaveType = ?, leaveDetails = ?, updatedAt = ? WHERE id = ?`,
    [substituteId, startDate, endDate, leaveType, leaveDetails, new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
}

// 4. ACTION: Urlaub löschen
export async function handleDeleteLeave(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Urlaub zu löschen!");
    return;
  }

  const id = formData.get("id") as string;
  if (!id) return;

  await runDatabase(`DELETE FROM LeaveRequest WHERE id = ?`, [id]);
  revalidatePath("/urlaube");
}

// 5. ACTION: Urlaub genehmigen
export async function handleApproveLeave(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Urlaub zu genehmigen!");
    return;
  }

  const id = formData.get("id") as string;
  if (!id) return;

  await runDatabase(
    `UPDATE LeaveRequest SET status = 'GENEHMIGT', updatedAt = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
  revalidatePath("/urlaube");
  revalidatePath("/mitglieder");
  revalidatePath("/");
}