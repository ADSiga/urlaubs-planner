interface ResubmitLeaveData {
  id: string;
  startDate: string;
  endDate: string;
  leaveType: string;
}

interface ResubmitLeaveProps {
  request: ResubmitLeaveData;
  eligibleSubstitutes: { id: string; name: string }[];
  onResubmit: (formData: FormData) => Promise<void>;
}

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ResubmitLeave({ request, eligibleSubstitutes, onResubmit }: ResubmitLeaveProps) {
  return (
    <form
      action={onResubmit}
      className="p-4 rounded-xl border border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20 space-y-3"
    >
      <input type="hidden" name="id" value={request.id} />
      <div>
        <div className="text-sm font-medium text-rose-700 dark:text-rose-400">{fmt(request.startDate)} - {fmt(request.endDate)}</div>
        <div className="text-[11px] text-zinc-500">{request.leaveType} · Vertretung hat abgelehnt — bitte neue Vertretung wählen.</div>
      </div>
      <div className="flex items-center gap-2">
        <select
          name="substituteId"
          required
          defaultValue=""
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 dark:text-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="" disabled>-- Neue Vertretung wählen --</option>
          {eligibleSubstitutes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950"
        >
          Erneut einreichen
        </button>
      </div>
    </form>
  );
}
