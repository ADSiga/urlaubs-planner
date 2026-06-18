import path from "path";
import sqlite3 from "sqlite3";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import EditableDepartment from "./EditableDepartment";
import { isBossModeActive } from "@/lib/boss-auth";

export const dynamic = "force-dynamic";

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

interface DbDepartment {
  id: string;
  name: string;
}

export default async function AbteilungenPage() {
  const bossActive = await isBossModeActive();

  // Sicherstellen, dass die Department-Tabelle existiert
  await runDatabase(`
    CREATE TABLE IF NOT EXISTS Department (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      createdAt TEXT
    )
  `);

  const departments = await queryDatabase<DbDepartment>("SELECT * FROM Department ORDER BY name ASC");

  async function handleCreateDepartment(formData: FormData) {
    "use server";
    if (!(await isBossModeActive())) return;
    const name = formData.get("name") as string;
    if (!name || name.trim() === "") return;

    const id = randomUUID();
    try {
      await runDatabase(
        `INSERT INTO Department (id, name, createdAt) VALUES (?, ?, ?)`,
        [id, name.trim(), new Date().toISOString()]
      );
    } catch (e) {
      console.error("Abteilung existiert bereits oder Fehler.");
    }
    revalidatePath("/abteilungen");
    revalidatePath("/mitglieder");
  }

  async function handleUpdateDepartment(formData: FormData) {
    "use server";
    if (!(await isBossModeActive())) return;
    const id = formData.get("id") as string;
    const newName = formData.get("name") as string;
    if (!id || !newName || newName.trim() === "") return;

    // Dank Normalisierung (User.departmentId) reicht es jetzt, 
    // nur den Namen in der Department-Tabelle zu ändern.
    await runDatabase(
        `UPDATE Department SET name = ? WHERE id = ?`,
        [newName.trim(), id]
    );

    revalidatePath("/abteilungen");
    revalidatePath("/mitglieder");
    revalidatePath("/");
  }

  async function handleDeleteDepartment(formData: FormData) {
    "use server";
    if (!(await isBossModeActive())) return;
    const id = formData.get("id") as string;
    if (!id) return;

    await runDatabase(`DELETE FROM Department WHERE id = ?`, [id]);
    revalidatePath("/abteilungen");
    revalidatePath("/mitglieder");
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">
        
        {/* Form panel links */}
        <div className="md:col-span-1">
          {bossActive ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sticky top-6">
              <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-zinc-400">
                Abteilung hinzufügen
              </h2>
              <form action={handleCreateDepartment} className="space-y-4">
                <div>
                  <input 
                    type="text" 
                    name="name" 
                    placeholder="z.B. IT-Support" 
                    required 
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" 
                  />
                </div>
                <button type="submit" className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 shadow-sm">
                  Abteilung anlegen
                </button>
              </form>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-zinc-100/50 p-6 dark:border-zinc-800 dark:bg-zinc-900/50 sticky top-6 text-center">
                <p className="text-xs text-zinc-500">Nur Administratoren können Abteilungen verwalten.</p>
            </div>
          )}
        </div>

        {/* Display List Panel rechts */}
        <div className="md:col-span-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Abteilungen verwalten</h2>
            <div className="space-y-3">
              {departments.map((dept) => (
                <EditableDepartment 
                  key={dept.id} 
                  department={dept}
                  // @ts-ignore
                  onUpdate={bossActive ? handleUpdateDepartment : undefined} 
                  // @ts-ignore
                  onDelete={bossActive ? handleDeleteDepartment : undefined} 
                />
              ))}
              {departments.length === 0 && (
                <p className="text-sm text-zinc-400 py-4 text-center">Keine Abteilungen angelegt.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}