"use client";

import { useState, useRef } from "react";

interface DbUser {
  id: string;
  name: string;
  color: string;
  departmentIds: string[];
  departmentNames: string;
  vacationDays: number;
  prevYearDays: number;
}

interface EditableUserProps {
  user: DbUser;
  takenDays: number;
  allDepartments: Array<{ id: string, name: string }>;
  onUpdate?: (formData: FormData) => Promise<void>;
  onDelete?: (formData: FormData) => Promise<void>;
}

export default function EditableUser({ user, takenDays, allDepartments, onUpdate, onDelete }: EditableUserProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<string[]>(user.departmentIds);
  const formRef = useRef<HTMLFormElement>(null);

  const currentYearDays = user.vacationDays !== undefined ? user.vacationDays : 35;
  const prevYearDays = user.prevYearDays !== undefined ? user.prevYearDays : 0;
  
  const totalDays = currentYearDays + prevYearDays;
  const remainingDays = totalDays - takenDays;

  const handleSaveClick = async () => {
    if (!formRef.current || !onUpdate) return;
    if (!formRef.current.reportValidity()) return;

    setIsSubmitting(true);
    try {
      const formData = new FormData(formRef.current);
      formData.delete("departmentIds");
      selectedDepts.forEach(id => formData.append("departmentIds", id));
      formData.append("id", user.id);

      await onUpdate(formData);
      setIsEditing(false);
    } catch (error) {
      console.error("Fehler beim Aktualisieren:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleDept = (deptId: string) => {
    setSelectedDepts(prev => 
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    );
  };

  if (isEditing) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-950/30">
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="grid grid-cols-1 gap-3 sm:grid-cols-5 items-end">
          <input type="hidden" name="id" value={user.id} />
          
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Name</label>
            <input type="text" name="name" defaultValue={user.name} required className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          </div>
          
          <div className="sm:col-span-1 relative">
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Abteilungen</label>
            <div 
              className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs bg-white cursor-pointer dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              onClick={() => setIsOpen(!isOpen)}
            >
              {selectedDepts.length > 0 ? `${selectedDepts.length} gewählt` : "Keine"}
            </div>
            {isOpen && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-40 overflow-y-auto dark:bg-zinc-900 dark:border-zinc-700">
                {allDepartments.map(dept => (
                  <div 
                    key={dept.id} 
                    className={`px-3 py-2 text-xs cursor-pointer flex items-center justify-between ${selectedDepts.includes(dept.id) ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    onClick={() => toggleDept(dept.id)}
                  >
                    {dept.name}
                    {selectedDepts.includes(dept.id) && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="sm:col-span-1">
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Farbe</label>
            <input 
              type="color" 
              name="color" 
              defaultValue={user.color || "#3B82F6"}
              className="w-full h-[26px] rounded-md border border-zinc-200 p-0.5 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900" 
            />
          </div>
          
          <div>
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Urlaub</label>
            <input type="number" name="vacationDays" defaultValue={currentYearDays} min="0" required className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          </div>
          
          <div>
            <label className="block text-[10px] font-medium text-zinc-400 mb-0.5">Rest Vorjahr</label>
            <input type="number" name="prevYearDays" defaultValue={prevYearDays} min="0" required className="w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          </div>
          
          <div className="flex gap-1.5 justify-end">
            <button type="button" onClick={() => setIsEditing(false)} className="p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            <button type="button" disabled={isSubmitting} onClick={handleSaveClick} className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg></button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-x-6 rounded-xl border border-zinc-100 bg-zinc-50/30 p-4 dark:border-zinc-800/50 dark:bg-zinc-950/10 hover:bg-zinc-50 dark:hover:bg-zinc-950/40 transition-colors">
      <div className="min-w-0 flex-1 flex items-center gap-3">
        {/* Color Indicator */}
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: user.color || "#3B82F6" }} />
        
        <div>
          <div className="flex items-center gap-x-3">
            <p className="text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">{user.name}</p>
            <p className="rounded-md whitespace-nowrap px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800">
              {user.departmentNames}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setIsEditing(true)} className="p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg></button>
          <button type="button" onClick={async () => { if(onDelete && confirm("Wirklich löschen?")) { const fd = new FormData(); fd.append("id", user.id); await onDelete(fd); }}} className="p-2 rounded-lg border border-zinc-200 text-rose-600 hover:bg-rose-50 dark:border-zinc-700 dark:text-rose-400 dark:hover:bg-rose-950/30"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg></button>
      </div>
    </div>
  );
}
