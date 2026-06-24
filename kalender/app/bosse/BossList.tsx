"use client";

import { useState, useRef } from "react";

interface BossRow {
  id: string;
  name: string;
  otpauthUrl: string;
  qrDataUrl: string;
  departmentNames: string;
  departmentIds: string[];
}

export default function BossList({
  bosses,
  allDepartments,
  onUpdate,
  onDelete,
  onRegenerate,
}: {
  bosses: BossRow[];
  allDepartments: { id: string; name: string }[];
  onUpdate: (formData: FormData) => Promise<void>;
  onDelete: (formData: FormData) => Promise<void>;
  onRegenerate: (formData: FormData) => Promise<void>;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDepts, setEditDepts] = useState<string[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const startEdit = (b: BossRow) => {
    setShown(null);
    setEditing(b.id);
    setEditDepts(b.departmentIds);
    setDeptOpen(false);
  };

  const toggleDept = (deptId: string) => {
    setEditDepts((prev) =>
      prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]
    );
  };

  const handleSave = async (bossId: string) => {
    if (!formRef.current) return;
    if (!formRef.current.reportValidity()) return;
    setIsSaving(true);
    try {
      const fd = new FormData(formRef.current);
      fd.delete("departmentIds");
      editDepts.forEach((id) => fd.append("departmentIds", id));
      fd.set("id", bossId);
      await onUpdate(fd);
      setEditing(null);
    } finally {
      setIsSaving(false);
    }
  };

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
          {editing === b.id ? (
            <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-3">
              <input type="hidden" name="id" value={b.id} />
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Name</label>
                <input
                  type="text"
                  name="name"
                  defaultValue={b.name}
                  required
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
              </div>
              <div className="relative">
                <label className="block text-[10px] font-medium text-zinc-400 mb-1 px-0.5">Abteilung(en)</label>
                <div
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm cursor-pointer dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  onClick={() => setDeptOpen(!deptOpen)}
                >
                  {editDepts.length > 0 ? `${editDepts.length} Abteilung(en) gewählt` : "-- Abteilung wählen --"}
                </div>
                {deptOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-40 overflow-y-auto dark:bg-zinc-900 dark:border-zinc-700">
                    {allDepartments.map((dept) => (
                      <div
                        key={dept.id}
                        className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${editDepts.includes(dept.id) ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                        onClick={() => toggleDept(dept.id)}
                      >
                        {dept.name}
                        {editDepts.includes(dept.id) && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </div>
                    ))}
                    {allDepartments.length === 0 && (
                      <div className="px-3 py-2 text-xs text-zinc-400">Keine Abteilungen vorhanden.</div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleSave(b.id)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isSaving ? "Speichert…" : "Speichern"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-50 truncate">{b.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{b.departmentNames || "Keine Abteilung"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShown(shown === b.id ? null : b.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    {shown === b.id ? "QR verbergen" : "QR anzeigen"}
                  </button>
                  <button
                    onClick={() => startEdit(b)}
                    className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    Bearbeiten
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
            </>
          )}
        </div>
      ))}
    </div>
  );
}
