import path from "path";
import sqlite3 from "sqlite3";
import EditableUser from "../EditableUser";
import DepartmentMultiSelect from "../components/DepartmentMultiSelect";
import { handleCreateUser, handleUpdateUser, handleDeleteUser, handleYearRollover } from "./actions";
import RolloverButton from "./RolloverButton";
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

async function calculateWorkingDays(startDateStr: string, endDateStr: string): Promise<number> {
  const holidays = await queryDatabase<{ date: string }>("SELECT date FROM PublicHoliday");
  const holidayDates = new Set(holidays.map(h => h.date.split('T')[0]));

  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split('T')[0];

    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

interface DbUser {
  id: string;
  name: string;
  color: string;
  departmentIds: string[];
  departmentNames: string;
  vacationDays: number;
  prevYearDays: number;
}

interface LeaveRequest {
  userId: string;
  startDate: string;
  endDate: string;
}

export default async function MitgliederPage() {
  const bossActive = await isBossModeActive();

  // 2. ALLE Abteilungen aus der globalen Tabelle holen (ID und Name)
  const allDepartments = await queryDatabase<{ id: string, name: string }>("SELECT id, name FROM Department ORDER BY name ASC");

  // 3. Nutzer und ihre Abteilungen laden
  const usersRaw = await queryDatabase<any>(`
    SELECT u.id, u.name, u.color, GROUP_CONCAT(ud.departmentId) as departmentIds, GROUP_CONCAT(d.name, ', ') as departmentNames, u.vacationDays, u.prevYearDays 
    FROM User u
    LEFT JOIN UserDepartment ud ON u.id = ud.userId
    LEFT JOIN Department d ON ud.departmentId = d.id
    GROUP BY u.id
    ORDER BY u.name ASC
  `);

  const users: DbUser[] = usersRaw.map(u => ({
      ...u,
      departmentIds: u.departmentIds ? u.departmentIds.split(',') : []
  }));

  const leaves = await queryDatabase<LeaveRequest>("SELECT userId, startDate, endDate FROM LeaveRequest WHERE status = 'GENEHMIGT'");

  // Berechnung der genommenen Tage für jeden User (async)
  const usersWithTakenDays = await Promise.all(users.map(async (user) => {
    const userLeaves = leaves.filter(l => l.userId === user.id);
    let takenDays = 0;
    for (const leave of userLeaves) {
      takenDays += await calculateWorkingDays(leave.startDate, leave.endDate);
    }
    return { ...user, takenDays };
  }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">

        {/* Form panel */}
        <div className="md:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sticky top-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-zinc-400">
              Mitglied hinzufügen
            </h2>
            {bossActive ? (
              <form action={handleCreateUser} className="space-y-4">
                <div>
                  <input type="text" name="name" placeholder="Name" required className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Farbe</label>
                  <input type="color" name="color" defaultValue="#3B82F6" className="w-full h-[40px] rounded-lg border border-zinc-200 bg-zinc-50 p-1 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Abteilung(en)</label>
                  <DepartmentMultiSelect allDepartments={allDepartments} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Urlaub {new Date().getFullYear()}</label>
                    <input type="number" name="vacationDays" defaultValue="35" min="0" max="100" required className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Rest Vorjahr</label>
                    <input type="number" name="prevYearDays" defaultValue="0" min="0" max="100" required className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50" />
                  </div>
                </div>
                <button type="submit" className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 shadow-sm">
                  Mitglied anlegen
                </button>
              </form>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4">Nur Administratoren können Mitglieder anlegen.</p>
            )}
            {bossActive && <RolloverButton action={handleYearRollover} />}
          </div>
        </div>

        {/* Display List Panel */}
        <div className="md:col-span-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Mitglieder verwalten</h2>
            <div className="space-y-3">
              {usersWithTakenDays.map((user) => (
                <EditableUser
                  key={user.id}
                  user={user}
                  takenDays={user.takenDays}
                  allDepartments={allDepartments}
                  onUpdate={bossActive ? handleUpdateUser : undefined}
                  onDelete={bossActive ? handleDeleteUser : undefined}
                />
              ))}
              {users.length === 0 && (
                <p className="text-sm text-zinc-400 py-4 text-center">Keine Mitglieder angelegt.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
