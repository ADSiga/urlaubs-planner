"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { queryDatabase, runDatabase } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { canManageDepartmentScope, canManageMemberScope } from "@/lib/scope";
import { hashPassword } from "@/lib/password";

// 1. ACTION: Mitglied anlegen
export async function handleCreateUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied anzulegen!");
    return;
  }

  const name = formData.get("name") as string;
  const color = (formData.get("color") as string) || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[];
  const email = ((formData.get("email") as string) || "").trim() || null;
  const password = (formData.get("password") as string) || "";
  const vacationDays = parseInt((formData.get("vacationDays") as string) || "35", 10);
  const prevYearDays = parseInt((formData.get("prevYearDays") as string) || "0", 10);
  if (!name || departmentIds.length === 0) return;

  // A boss may only assign departments they manage.
  if (
    principal.role === "boss" &&
    !departmentIds.every((d) => canManageDepartmentScope(principal, d))
  ) {
    console.error("Boss versucht, fremde Abteilung zuzuweisen!");
    return;
  }

  const newUserId = randomUUID();
  const passwordHash = password ? hashPassword(password) : null;

  try {
    await runDatabase(
      `INSERT INTO User (id, name, color, vacationDays, prevYearDays, email, passwordHash, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newUserId, name, color, vacationDays, prevYearDays, email, passwordHash, new Date().toISOString()]
    );
  } catch (e) {
    console.error("Mitglied anlegen fehlgeschlagen (evtl. E-Mail bereits vergeben):", e);
    return;
  }

  for (const deptId of departmentIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [newUserId, deptId]);
  }

  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}

// 2. ACTION: Mitglied aktualisieren
export async function handleUpdateUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied zu ändern!");
    return;
  }

  const id = formData.get("id") as string;
  const name = formData.get("name") as string;
  const color = (formData.get("color") as string) || "#3B82F6";
  const departmentIds = formData.getAll("departmentIds") as string[];
  const email = ((formData.get("email") as string) || "").trim() || null;
  const password = (formData.get("password") as string) || "";
  const vacationDays = parseInt((formData.get("vacationDays") as string) || "35", 10);
  const prevYearDays = parseInt((formData.get("prevYearDays") as string) || "0", 10);
  if (!id || !name) return;

  // Boss may only edit a member who is in one of their departments.
  let memberDepts: string[] = [];
  if (principal.role === "boss") {
    memberDepts = (
      await queryDatabase<{ departmentId: string }>(
        "SELECT departmentId FROM UserDepartment WHERE userId = ?",
        [id]
      )
    ).map((r) => r.departmentId);
    if (!canManageMemberScope(principal, memberDepts)) {
      console.error("Boss versucht, fremdes Mitglied zu ändern!");
      return;
    }
    if (!departmentIds.every((d) => canManageDepartmentScope(principal, d))) {
      console.error("Boss versucht, fremde Abteilung zuzuweisen!");
      return;
    }
  }

  // For a boss: preserve departments the boss does not manage (they belong to other bosses).
  // For admin: use the submitted departmentIds unchanged.
  const finalDeptIds =
    principal.role === "boss"
      ? Array.from(
          new Set([
            ...departmentIds,
            ...memberDepts.filter((d) => !canManageDepartmentScope(principal, d)),
          ])
        )
      : departmentIds;

  await runDatabase(
    `UPDATE User SET name = ?, color = ?, vacationDays = ?, prevYearDays = ?, email = ? WHERE id = ?`,
    [name, color, vacationDays, prevYearDays, email, id]
  );
  if (password) {
    await runDatabase(`UPDATE User SET passwordHash = ? WHERE id = ?`, [hashPassword(password), id]);
  }

  await runDatabase(`DELETE FROM UserDepartment WHERE userId = ?`, [id]);
  for (const deptId of finalDeptIds) {
    await runDatabase(`INSERT INTO UserDepartment (userId, departmentId) VALUES (?, ?)`, [id, deptId]);
  }

  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}

// 4. ACTION: Jahr abschließen / Rollover
export async function handleYearRollover() {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
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

// 5. ACTION: Mitglied löschen
export async function handleDeleteUser(formData: FormData) {
  const principal = await getPrincipal();
  if (!principal || principal.role === "member") {
    console.error("Nicht autorisierter Versuch, Mitglied zu löschen!");
    return;
  }
  const id = formData.get("id") as string;
  if (!id) return;
  if (principal.role === "boss") {
    const memberDepts = (
      await queryDatabase<{ departmentId: string }>(
        "SELECT departmentId FROM UserDepartment WHERE userId = ?",
        [id]
      )
    ).map((r) => r.departmentId);
    if (!canManageMemberScope(principal, memberDepts)) {
      console.error("Boss versucht, fremdes Mitglied zu löschen!");
      return;
    }
  }

  await runDatabase(`DELETE FROM UserDepartment WHERE userId = ?`, [id]);
  await runDatabase(`DELETE FROM LeaveRequest WHERE userId = ?`, [id]);
  await runDatabase(`DELETE FROM User WHERE id = ?`, [id]);
  revalidatePath("/mitglieder");
  revalidatePath("/urlaube");
  revalidatePath("/");
}
