"use client";

import { useState } from "react";

interface ConflictUser {
  userName: string;
  startDate: string;
  endDate: string;
  userId: string;
}

interface LeaveProps {
  request: { 
    id: string; userId: string; substituteId?: string; startDate: string; endDate: string; 
    leaveType: string; leaveDetails?: string; status: string; userName?: string; userDepartment?: string; substituteName?: string;
  };
  users?: { id: string; name: string; departmentIds: string[] }[];
  onUpdate?: (formData: FormData) => Promise<void>;
  onDelete?: (formData: FormData) => Promise<void>;
  onApprove?: (formData: FormData) => Promise<void>;
  checkConflicts: (userId: string, startDate: string, endDate: string, excludeLeaveId?: string) => Promise<ConflictUser[]>;
}

export default function EditableLeave({ request, users = [], onUpdate, onDelete, onApprove, checkConflicts }: LeaveProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictUser[] | null>(null);
  const [currentInputDates, setCurrentInputDates] = useState<{ start: string; end: string } | null>(null);
  const [conflictingUserIds, setConflictingUserIds] = useState<Set<string>>(new Set());
  const [leaveType, setLeaveType] = useState<string>(request.leaveType);

  const start = new Date(request.startDate).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  const end = new Date(request.endDate).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  const currentUser = users.find(u => u.id === request.userId);

  // Helper to check if two users share at least one department
  const shareDepartment = (userA: {departmentIds: string[]} | undefined, userB: {departmentIds: string[]}) => {
    if (!userA || !userB) return false;
    return userA.departmentIds.some(deptId => userB.departmentIds.includes(deptId));
  };

  const updateConflicts = async (formData: FormData) => {
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    
    if (!startDate || !endDate) return;

    // Check conflicts for everyone
    const allConflicts = await checkConflicts(request.userId, startDate, endDate, request.id);
    setConflictingUserIds(new Set(allConflicts.map(c => c.userId)));
    setConflicts(allConflicts); // Show all conflicts
  };

  const handleAction = async (formData: FormData) => {
    if (!onUpdate) return;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;
    const substituteId = formData.get("substituteId") as string;

    if (!startDate || !endDate || !substituteId) {
      if (!substituteId) alert("Bitte wähle eine Vertretung aus!");
      return;
    }

    setIsSubmitting(true);
    try {
      // Konflikte prüfen (unter Ausschluss dieses aktuellen Urlaubsantrags)
      const result = await checkConflicts(request.userId, startDate, endDate, request.id);

      if (result.length > 0) {
        setCurrentInputDates({ start: startDate, end: endDate });
        setConflicts(result);
        setIsSubmitting(false);
        return;
      }

      // Wenn alles frei ist, speichern
      await onUpdate(formData);
      setIsEditing(false);
      setConflicts(null);
      setCurrentInputDates(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEditing) {
    return (
      <form
        action={handleAction}
        onChange={(e) => updateConflicts(new FormData(e.currentTarget))}
        className="p-4 rounded-xl border border-emerald-500 bg-zinc-100 dark:bg-zinc-900 space-y-3 text-sm text-zinc-900 dark:text-zinc-50"
      >
        <input type="hidden" name="id" value={request.id} />
        
        <div>
          <span className="font-semibold">{request.userName || "Mitarbeiter"}</span> bearbeiten
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            name="startDate"
            defaultValue={request.startDate}
            required
            className="rounded-lg border border-zinc-200 bg-white p-1.5 w-full dark:border-zinc-800 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 outline-none focus:border-emerald-500 text-xs"
          />
          <input
            type="date"
            name="endDate"
            defaultValue={request.endDate}
            required
            className="rounded-lg border border-zinc-200 bg-white p-1.5 w-full dark:border-zinc-800 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 outline-none focus:border-emerald-500 text-xs"
          />
        </div>

        <div>
          <select
            name="substituteId"
            defaultValue={request.substituteId}
            required
            className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="">-- Vertretung wählen --</option>
            {users
              .filter(user => user.id !== request.userId && shareDepartment(currentUser, user))
              .map((user) => {
                const isBusy = conflictingUserIds.has(user.id);
                return (
                  <option 
                    key={user.id} 
                    value={user.id} 
                    disabled={isBusy}
                    className={isBusy ? "text-zinc-400" : ""}
                  >
                    {user.name} {isBusy ? "(im Urlaub)" : ""}
                  </option>
                );
              })}
          </select>
        </div>

        <div>
          <select
            name="leaveType"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="Erholungsurlaub">Erholungsurlaub</option>
            <option value="Sonderurlaub">Sonderurlaub</option>
          </select>
        </div>

        {leaveType === "Sonderurlaub" && (
          <div>
            <textarea
              name="leaveDetails"
              defaultValue={request.leaveDetails || ""}
              placeholder="Details zum Sonderurlaub..."
              required
              className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
            />
          </div>
        )}

        {conflicts && conflicts.length > 0 && currentInputDates && (
          <div className="rounded-lg p-3 text-xs border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 transition-all">
            <div className="space-y-1.5">
              <div className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1.5">
                Änderung blockiert!
              </div>
              <div className="max-h-[140px] overflow-y-auto space-y-1.5 pr-1">
                {conflicts.map((c, i) => (
                  <div key={i} className="flex flex-col gap-0.5 bg-white dark:bg-zinc-950 px-2 py-1.5 rounded border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="text-zinc-700 dark:text-zinc-300 font-semibold text-[12px]">
                      {c.userName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="pt-1 flex items-center justify-between">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200">
            {leaveType}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setIsEditing(false);
                setConflicts(null);
                setCurrentInputDates(null);
              }}
              className="px-3 py-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-lg text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-400/50 dark:hover:bg-zinc-600/50 transition-colors"
            >
              Abbrechen
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Prüfe..." : "Speichern"}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/50 hover:shadow-sm transition-shadow">
      <div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{request.userName || "Gelöschter Mitarbeiter"}</h3>
        <p className="text-xs text-zinc-500">Bereich: {request.userDepartment || "Keine Angabe"}</p>
        <div className="mt-1 text-[11px] text-zinc-400">Vertretung: <span className="text-zinc-600 dark:text-zinc-300 font-medium">{request.substituteName || "Nicht angegeben"}</span></div>
        <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">{start} - {end}</div>
        {request.leaveDetails && (
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 italic">Details: {request.leaveDetails}</div>
        )}
      </div>
      
      <div className="flex flex-col items-end gap-2">
        <div className="flex gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
            request.status === 'PENDING' 
                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800" 
                : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
            }`}>
            {request.status === 'PENDING' ? 'Ausstehend' : 'Genehmigt'}
            </span>
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            {request.leaveType}
            </span>
        </div>
        
        <div className="flex items-center gap-1">
          {request.status === 'PENDING' && onApprove && (
            <form action={onApprove}>
              <input type="hidden" name="id" value={request.id} />
              <button
                type="submit"
                className="p-1.5 text-zinc-400 hover:text-emerald-500 transition-colors text-sm"
                title="Urlaub genehmigen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </button>
            </form>
          )}
          {onUpdate && request.status !== 'GENEHMIGT' && (
            <button
                onClick={() => setIsEditing(true)}
                className="p-1.5 text-zinc-400 hover:text-emerald-500 transition-colors text-sm"
                title="Urlaub bearbeiten"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                </svg>
            </button>
          )}
          {onDelete && request.status !== 'GENEHMIGT' && (
            <form 
                action={onDelete} 
                onSubmit={(e) => !confirm(`Möchtest du diesen Urlaub von ${request.userName} wirklich stornieren?`) && e.preventDefault()}
            >
                <input type="hidden" name="id" value={request.id} />
                <button 
                type="submit" 
                className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors text-sm"
                title="Urlaub stornieren"
                >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
