import { initDb } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import { recentMailFailures } from "@/lib/mail-failure";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  config_missing: "Mail nicht konfiguriert",
  send_error: "Sendefehler",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("de-DE");
}

export default async function MailFehlerPage() {
  await initDb();
  const principal = await getPrincipal();
  if (principal?.role !== "admin") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-6">
        <p className="text-sm text-zinc-500 text-center py-12">
          Nur der Administrator kann Mail-Fehler einsehen.
        </p>
      </main>
    );
  }

  const failures = await recentMailFailures();

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Mail-Fehler
        </h2>
        <p className="mb-4 text-sm text-zinc-500">
          Fehlgeschlagene Passwort-Zurücksetzen-E-Mails. Leer ist gut.
        </p>

        {failures.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-12">Keine Mail-Fehler.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                  <th className="py-2 pr-4">Zeitpunkt</th>
                  <th className="py-2 pr-4">Empfänger</th>
                  <th className="py-2 pr-4">Grund</th>
                  <th className="py-2">Fehler</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr
                    key={f.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap text-zinc-500">
                      {formatTimestamp(f.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-zinc-900 dark:text-zinc-100">{f.recipient}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        {REASON_LABEL[f.reason] ?? f.reason}
                      </span>
                    </td>
                    <td className="py-2 text-zinc-500 break-all">{f.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
