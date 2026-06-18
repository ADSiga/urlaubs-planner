"use client";

import { useState } from "react";

interface BossRow {
  id: string;
  name: string;
  otpauthUrl: string;
  qrDataUrl: string;
  departmentNames: string;
}

export default function BossList({
  bosses,
  onDelete,
  onRegenerate,
}: {
  bosses: BossRow[];
  onDelete: (formData: FormData) => Promise<void>;
  onRegenerate: (formData: FormData) => Promise<void>;
}) {
  const [shown, setShown] = useState<string | null>(null);

  if (bosses.length === 0) {
    return <p className="text-sm text-zinc-400 py-4 text-center">Keine Bosse angelegt.</p>;
  }

  return (
    <div className="space-y-3">
      {bosses.map((b) => (
        <div
          key={b.id}
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{b.name}</p>
              <p className="text-xs text-zinc-500">{b.departmentNames || "Keine Abteilung"}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShown(shown === b.id ? null : b.id)}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {shown === b.id ? "QR verbergen" : "QR anzeigen"}
              </button>
              <form action={onRegenerate}>
                <input type="hidden" name="id" value={b.id} />
                <button className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300">
                  Neuer Code
                </button>
              </form>
              <form action={onDelete}>
                <input type="hidden" name="id" value={b.id} />
                <button className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-200 dark:bg-rose-950/30">
                  Löschen
                </button>
              </form>
            </div>
          </div>
          {shown === b.id && (
            <div className="mt-4 flex flex-col items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={b.qrDataUrl} alt={`QR für ${b.name}`} className="h-44 w-44" />
              <code className="break-all text-center text-[10px] text-zinc-400">{b.otpauthUrl}</code>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
