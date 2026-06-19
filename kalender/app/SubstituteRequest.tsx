interface SubstituteRequestData {
  id: string;
  userName?: string;
  userDepartment?: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  leaveDetails?: string;
}

interface SubstituteRequestProps {
  request: SubstituteRequestData;
  onAccept: (formData: FormData) => Promise<void>;
  onDecline: (formData: FormData) => Promise<void>;
}

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SubstituteRequest({ request, onAccept, onDecline }: SubstituteRequestProps) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-sky-200 bg-sky-50/50 dark:border-sky-900/40 dark:bg-sky-950/20">
      <div>
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{request.userName || "Unbekannt"}</h3>
        <p className="text-xs text-zinc-500">Bereich: {request.userDepartment || "Keine Angabe"}</p>
        <div className="mt-2 text-sm text-sky-700 dark:text-sky-400 font-medium">{fmt(request.startDate)} - {fmt(request.endDate)}</div>
        <div className="mt-1 text-[11px] text-zinc-400">{request.leaveType}</div>
        {request.leaveDetails && (
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 italic">Details: {request.leaveDetails}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <form action={onAccept}>
          <input type="hidden" name="id" value={request.id} />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            Zustimmen
          </button>
        </form>
        <form action={onDecline}>
          <input type="hidden" name="id" value={request.id} />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-300"
          >
            Ablehnen
          </button>
        </form>
      </div>
    </div>
  );
}
