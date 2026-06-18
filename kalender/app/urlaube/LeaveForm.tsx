"use client";

import { useState, useRef, useEffect } from "react";

interface DbUser { id: string; name: string; departmentIds: string[]; }
interface ConflictUser { userName: string; userId: string; startDate: string; endDate: string; }

interface LeaveFormProps {
  users: DbUser[];
  currentMemberId: string | null;
  onCreateLeave: (formData: FormData) => Promise<void>;
  checkConflicts: (userId: string, startDate: string, endDate: string) => Promise<ConflictUser[]>;
  getUserBalance: (userId: string) => Promise<{ total: number; used: number; remaining: number }>;
  calculateWorkingDays: (startDate: string, endDate: string) => Promise<number>;
}

export default function LeaveForm({ users, currentMemberId, onCreateLeave, checkConflicts, getUserBalance, calculateWorkingDays }: LeaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [conflicts, setConflicts] = useState<ConflictUser[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentInputDates, setCurrentInputDates] = useState<{ start: string; end: string } | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [leaveType, setLeaveType] = useState<string>("Erholungsurlaub");
  const [conflictingUserIds, setConflictingUserIds] = useState<Set<string>>(new Set());
  const [userBalance, setUserBalance] = useState<{ total: number; used: number; remaining: number } | null>(null);
  const [neededDays, setNeededDays] = useState<number>(0);

  const effectiveUserId = currentMemberId ?? selectedUserId;
  const selectedUser = users.find(u => u.id === effectiveUserId);

  // Helper to check if two users share at least one department
  const shareDepartment = (userA: DbUser | undefined, userB: DbUser) => {
    if (!userA || !userB) return false;
    return userA.departmentIds.some(deptId => userB.departmentIds.includes(deptId));
  };

  useEffect(() => {
    if (effectiveUserId) {
      getUserBalance(effectiveUserId).then(setUserBalance);
    } else {
      setUserBalance(null);
    }
  }, [effectiveUserId]);

  useEffect(() => {
    if (startDate && endDate) {
        calculateWorkingDays(startDate, endDate).then(setNeededDays);
    } else {
        setNeededDays(0);
    }
    updateConflicts();
  }, [effectiveUserId, startDate, endDate]);

  const updateConflicts = async () => {
    if (!startDate || !endDate) {
      setConflictingUserIds(new Set());
      setConflicts(null);
      return;
    }
    
    // Check conflicts for everyone
    const allConflicts = await checkConflicts(effectiveUserId || "none", startDate, endDate);
    setConflictingUserIds(new Set(allConflicts.map(c => c.userId)));

    // For general conflict display
    if (effectiveUserId) {
        setConflicts(allConflicts);
    }
  };

  // DIE BRECHSTANGE: Direktes Event auf dem Button-Klick, völlig losgelöst vom Form-Submit
  const handleBruteForceClick = async () => {
    setDateError(null);
    if (!formRef.current) {
      console.error("Formular-Referenz fehlt!");
      return;
    }

    const formData = new FormData(formRef.current);
    const userId = formData.get("userId") as string;
    const substituteId = formData.get("substituteId") as string;
    const startDate = formData.get("startDate") as string;
    const endDate = formData.get("endDate") as string;

    if (!userId || !startDate || !endDate) {
      alert("Fehler: Bitte fülle alle Pflichtfelder aus!");
      return;
    }

    if (!substituteId) {
      alert("Fehler: Bitte wähle eine Vertretung aus!");
      return;
    }

    // --- Validierung: Mindestens 1 Monat im Voraus (nur bei Erholungsurlaub) ---
    if (leaveType === "Erholungsurlaub") {
      const today = new Date();
      const minDate = new Date();
      minDate.setMonth(today.getMonth() + 1);
      const selectedStart = new Date(startDate);

      if (selectedStart < minDate) {
        const minDateStr = minDate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        setDateError(`Erholungsurlaub muss mindestens einen Monat im Voraus gebucht werden. Frühestmöglicher Termin: ${minDateStr}`);
        return;
      }

      if (userBalance && neededDays > userBalance.remaining) {
        setDateError(`Nicht genügend Resturlaub. Benötigt: ${neededDays} Tage, Verfügbar: ${userBalance.remaining} Tage.`);
        return;
      }
    }
    // ---------------------------------------------------------------------------------------

    setIsSubmitting(true);
    try {
      const result = await checkConflicts(userId, startDate, endDate);
      
      if (result.length > 0) {
        setCurrentInputDates({ start: startDate, end: endDate });
        setConflicts(result);
        setIsSubmitting(false);
        return;
      }

      await onCreateLeave(formData);
      
      formRef.current.reset();
      if (!currentMemberId) setSelectedUserId("");
      setStartDate("");
      setEndDate("");
      setLeaveType("Erholungsurlaub");
      setConflictingUserIds(new Set());
      setConflicts(null);
      setCurrentInputDates(null);
    } catch (error) {
      console.error("Schwerer Fehler im Ablauf:", error);
      alert("Fehler aufgetreten: " + error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sticky top-6">
      <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase text-zinc-400">Urlaub eintragen</h2>
      
      <p className="text-[10px] text-zinc-400 mb-4 bg-zinc-50 dark:bg-zinc-950 p-2 rounded border border-dashed border-zinc-200 dark:border-zinc-800">
        Hinweis: Urlaub muss mindestens **1 Monat im Voraus** gebucht werden.
      </p>

      {/* Wir entfernen onSubmit und action komplett, um HTML5-Blockaden zu verhindern */}
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          {currentMemberId ? (
            <>
              <input type="hidden" name="userId" value={currentMemberId} />
              <div className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                {selectedUser?.name ?? currentMemberId}
              </div>
            </>
          ) : (
            <select
              name="userId"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <option value="">-- Mitarbeiter wählen --</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          )}
          {userBalance && (
            <div className="mt-1.5 flex justify-between px-1">
              <span className="text-[10px] text-zinc-500">Gesamt: {userBalance.total} Tg.</span>
              <span className={`text-[10px] font-bold ${userBalance.remaining <= 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                Rest: {userBalance.remaining} Tage
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            name="startDate"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          />
          <input
            type="date"
            name="endDate"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          />
        </div>
        
        {neededDays > 0 && (
          <div className="px-1 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span className="text-[10px] text-zinc-500">Dieser Zeitraum benötigt <strong>{neededDays} Arbeitstage</strong>.</span>
          </div>
        )}

        <div>
          <select
            name="substituteId"
            disabled={!effectiveUserId || !startDate || !endDate}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 disabled:opacity-50"
          >
            <option value="">-- Vertretung wählen --</option>
            {users
              .filter(user => user.id !== effectiveUserId && shareDepartment(selectedUser, user))
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
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <option value="Erholungsurlaub">Erholungsurlaub</option>
            <option value="Sonderurlaub">Sonderurlaub</option>
          </select>
        </div>

        {leaveType === "Sonderurlaub" && (
          <div>
            <textarea
              name="leaveDetails"
              placeholder="Details zum Sonderurlaub..."
              required
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
            />
          </div>
        )}

        {dateError && (
          <div className="rounded-lg p-3 text-[11px] leading-relaxed border border-red-200 bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-400">
            <div className="flex items-start gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{dateError}</span>
            </div>
          </div>
        )}

        {conflicts && conflicts.length > 0 && currentInputDates && (
          <div className="rounded-lg p-3 text-xs border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="text-amber-600 font-semibold mb-1">Überschneidung:</div>
            {conflicts.map((c, i) => (
              <div key={i} className="text-zinc-700 dark:text-zinc-300">{c.userName}</div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleBruteForceClick}
          disabled={isSubmitting}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 disabled:opacity-50"
        >
          {isSubmitting ? "Wird verarbeitet..." : "Urlaub Speichern"}
        </button>
      </form>
    </div>
  );
}
