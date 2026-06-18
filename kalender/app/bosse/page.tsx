import QRCode from "qrcode";
import { queryDatabase, initDb } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { buildOtpauthUrl } from "@/lib/totp";
import DepartmentMultiSelect from "../components/DepartmentMultiSelect";
import BossList from "./BossList";
import {
  handleCreateBoss,
  handleUpdateBoss,
  handleDeleteBoss,
  handleRegenerateSecret,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function BossePage() {
  await initDb();
  const principal = await getPrincipal();
  if (principal?.role !== "admin") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-6">
        <p className="text-sm text-zinc-500 text-center py-12">
          Nur der Administrator kann Bosse verwalten.
        </p>
      </main>
    );
  }

  const allDepartments = await queryDatabase<{ id: string; name: string }>(
    "SELECT id, name FROM Department ORDER BY name ASC"
  );

  const bossesRaw = await queryDatabase<{
    id: string;
    name: string;
    totpSecret: string;
    departmentNames: string | null;
    departmentIds: string | null;
  }>(`
    SELECT b.id, b.name, b.totpSecret,
           GROUP_CONCAT(d.name, ', ') as departmentNames,
           GROUP_CONCAT(bd.departmentId) as departmentIds
    FROM Boss b
    LEFT JOIN BossDepartment bd ON b.id = bd.bossId
    LEFT JOIN Department d ON bd.departmentId = d.id
    GROUP BY b.id
    ORDER BY b.name ASC
  `);

  const bosses = await Promise.all(
    bossesRaw.map(async (b) => {
      const otpauthUrl = buildOtpauthUrl(b.name, b.totpSecret);
      return {
        id: b.id,
        name: b.name,
        departmentNames: b.departmentNames ?? "",
        departmentIds: b.departmentIds ? b.departmentIds.split(",") : [],
        otpauthUrl,
        qrDataUrl: await QRCode.toDataURL(otpauthUrl),
      };
    })
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-1">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sticky top-6">
            <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-zinc-400">
              Boss hinzufügen
            </h2>
            <form action={handleCreateBoss} className="space-y-4">
              <input
                type="text"
                name="name"
                placeholder="Name"
                required
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">
                  Abteilung(en)
                </label>
                <DepartmentMultiSelect allDepartments={allDepartments} />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 shadow-sm"
              >
                Boss anlegen
              </button>
            </form>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Bosse verwalten
            </h2>
            <BossList
              bosses={bosses}
              allDepartments={allDepartments}
              onUpdate={handleUpdateBoss}
              onDelete={handleDeleteBoss}
              onRegenerate={handleRegenerateSecret}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
