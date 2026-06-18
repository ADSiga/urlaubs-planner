"use client";

import { useState, useEffect } from "react";

interface DbDepartment {
  id: string;
  name: string;
}

interface EditableDepartmentProps {
  department: DbDepartment;
  onUpdate?: (formData: FormData) => Promise<void>;
  onDelete?: (formData: FormData) => Promise<void>;
}

export default function EditableDepartment({ department, onUpdate, onDelete }: EditableDepartmentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center justify-between gap-x-6 rounded-xl border border-zinc-100 bg-zinc-50/30 p-4 dark:border-zinc-800/50 dark:bg-zinc-950/10 h-[66px]">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{department.name}</div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
        <form
          action={async (formData) => {
            if (onUpdate) {
                await onUpdate(formData);
                setIsEditing(false);
            }
          }}
          className="flex items-end gap-3"
        >
          <input type="hidden" name="id" value={department.id} />
          
          <div className="flex-1">
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Abteilungsname</label>
            <input 
              type="text" 
              name="name" 
              defaultValue={department.name} 
              required 
              className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold focus:border-emerald-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" 
            />
          </div>
          
          <div className="flex gap-1.5 h-[34px] items-center">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              title="Abbrechen"
              className="flex items-center justify-center p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              type="submit"
              title="Speichern"
              className="flex items-center justify-center p-2 rounded-lg bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-x-6 rounded-xl border border-zinc-100 bg-zinc-50/30 p-4 dark:border-zinc-800/50 dark:bg-zinc-950/10 hover:bg-zinc-50 dark:hover:bg-zinc-950/40 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">{department.name}</p>
      </div>
      
      <div className="flex items-center gap-1.5">
        {onUpdate && (
            <button
            type="button"
            onClick={() => setIsEditing(true)}
            title="Abteilung bearbeiten"
            className="flex items-center justify-center p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
            >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
            </button>
        )}

        {onDelete && (
            <form
            action={onDelete}
            onSubmit={(e) => {
                if (!confirm(`Möchtest du die Abteilung "${department.name}" wirklich permanent löschen?`)) {
                e.preventDefault();
                }
            }}
            >
            <input type="hidden" name="id" value={department.id} />
            <button
                type="submit"
                title="Abteilung löschen"
                className="flex items-center justify-center p-2 rounded-lg border border-zinc-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-950/30 transition-colors"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
            </button>
            </form>
        )}
      </div>
    </div>
  );
}
