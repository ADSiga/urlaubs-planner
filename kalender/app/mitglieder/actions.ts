"use server";

import path from "path";
import sqlite3 from "sqlite3";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { isBossModeActive } from "@/lib/boss-auth";

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

// 1. ACTION: Mitglied anlegen
export async function handleCreateUser(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Mitglied anzulegen!");
    return;
  }

  const name = formData.get("name") as string;
  const color = formData.get("color") as string || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[]; // Multi-select
  const vacationDays = parseInt(formData.get("vacationDays") as string || "35", 10);
  const prevYearDays = parseInt(formData.get("prevYearDays") as string || "0", 10);
  if (!name || departmentIds.length === 0) return;

  const newUserId = randomUUID();
  
  // 1. User anlegen
  await runDatabase(
    `INSERT INTO User (id, name, color, vacationDays, prevYearDays, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [newUserId, name, color, vacationDays, prevYearDays, new Date().toISOString()]
  );
  
  // 2. Abteilungen verknüpfen
  for (const deptId of departmentIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [newUserId, deptId]);
  }
  
  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}

// 2. ACTION: Mitglied aktualisieren
export async function handleUpdateUser(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Mitglied zu ändern!");
    return;
  }

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const color = formData.get("color") as string || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[]; // Multi-select
  const vacationDays = parseInt(formData.get("vacationDays") as string || "35", 10);
  const prevYearDays = parseInt(formData.get("prevYearDays") as string || "0", 10);
  if (!id || !name) return;

  // 1. User Update
  await runDatabase(
    `UPDATE User SET name = ?, color = ?, vacationDays = ?, prevYearDays = ? WHERE id = ?`,
    [name, color, vacationDays, prevYearDays, id]
  );
  
  // 2. UserDepartment Update (löschen und neu einfügen)
  await runDatabase(`DELETE FROM UserDepartment WHERE userId = ?`, [id]);
  for (const deptId of departmentIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [id, deptId]);
  }
  
  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}

// 4. ACTION: Jahr abschließen / Rollover
export async function handleYearRollover() {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Jahr abzuschließen!");
    return;
  }

  const users = await queryDatabase<{ id: string; vacationDays: number; prevYearDays: number }>(
    "SELECT id, vacationDays, prevYearDays FROM User"
  );
  const holidaysResult = await queryDatabase<{ date: string }>("SELECT date FROM PublicHoliday");
  const holidays = new Set(holidaysResult.map(h => h.date.split('T')[0]));

  for (const user of users) {
    const leaves = await queryDatabase<{ startDate: string; endDate: string }>(
      "SELECT startDate, endDate FROM LeaveRequest WHERE userId = ? AND status = 'GENEHMIGT' AND leaveType = 'Erholungsurlaub'",
      [user.id]
    );
    let used = 0;
    for (const leave of leaves) {
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        const dow = current.getDay();
        const ds = current.toISOString().split('T')[0];
        if (dow !== 0 && dow !== 6 && !holidays.has(ds)) used++;
        current.setDate(current.getDate() + 1);
      }
    }
    const remaining = Math.max(0, (user.vacationDays || 0) + (user.prevYearDays || 0) - used);
    await runDatabase(
      "UPDATE User SET prevYearDays = ?, vacationDays = 35 WHERE id = ?",
      [remaining, user.id]
    );
  }
  revalidatePath("/mitglieder");
}

// 5. ACTION: Urlaub löschen (reusing handleDeleteUser logic internally or similar)
export async function handleDeleteUser(formData: FormData) {
  if (!(await isBossModeActive())) {
    console.error("Nicht autorisierter Versuch, Mitglied zu löschen!");
    return;
  }

  const id = formData.get("id") as string;
  if (!id) return;

  await runDatabase(`DELETE FROM UserDepartment WHERE userId = ?`, [id]);
  await runDatabase(`DELETE FROM LeaveRequest WHERE userId = ?`, [id]);
  await runDatabase(`DELETE FROM User WHERE id = ?`, [id]);
  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}