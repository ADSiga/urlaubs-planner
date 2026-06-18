"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { queryDatabase, runDatabase } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { generateBase32Secret } from "@/lib/totp";

export async function handleCreateBoss(formData: FormData) {
  if (!(await isAdmin())) {
    console.error("Nicht autorisierter Versuch, einen Boss anzulegen!");
    return;
  }
  const name = (formData.get("name") as string)?.trim();
  const departmentIds = formData.getAll("departmentIds") as string[];
  if (!name) return;

  const id = randomUUID();
  await runDatabase(
    `INSERT INTO Boss (id, name, totpSecret, createdAt) VALUES (?, ?, ?, ?)`,
    [id, name, generateBase32Secret(), new Date().toISOString()]
  );
  for (const deptId of departmentIds) {
    await runDatabase(
      `INSERT INTO BossDepartment (bossId, departmentId) VALUES (?, ?)`,
      [id, deptId]
    );
  }
  revalidatePath("/bosse");
}

export async function handleUpdateBoss(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const departmentIds = formData.getAll("departmentIds") as string[];
  if (!id || !name) return;

  await runDatabase(`UPDATE Boss SET name = ? WHERE id = ?`, [name, id]);
  await runDatabase(`DELETE FROM BossDepartment WHERE bossId = ?`, [id]);
  for (const deptId of departmentIds) {
    await runDatabase(
      `INSERT INTO BossDepartment (bossId, departmentId) VALUES (?, ?)`,
      [id, deptId]
    );
  }
  revalidatePath("/bosse");
}

export async function handleRegenerateSecret(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  if (!id) return;
  await runDatabase(`UPDATE Boss SET totpSecret = ? WHERE id = ?`, [
    generateBase32Secret(),
    id,
  ]);
  revalidatePath("/bosse");
}

export async function handleDeleteBoss(formData: FormData) {
  if (!(await isAdmin())) return;
  const id = formData.get("id") as string;
  if (!id) return;
  await runDatabase(`DELETE FROM BossDepartment WHERE bossId = ?`, [id]);
  await runDatabase(`DELETE FROM Boss WHERE id = ?`, [id]);
  revalidatePath("/bosse");
}
