import EditableLeave from "../EditableLeave";
import LeaveForm from "./LeaveForm";
// Alle Actions sauber von außen importieren
import { checkConflicts, handleCreateLeave, handleUpdateLeave, handleDeleteLeave, handleApproveLeave, getUserBalance, calculateWorkingDays } from "./actions";
import { queryDatabase } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface DbUser { id: string; name: string; departmentIds: string[] }
interface DbLeaveRequest {
  id: string; userId: string; substituteId?: string; startDate: string; endDate: string;
  leaveType: string; status: string; userName?: string; userDepartment?: string; substituteName?: string;
  userDeptIds?: string;
}

export default async function UrlaubePage() {
  const principal = await getPrincipal();
  const canApprove = principal?.role === "admin" || principal?.role === "boss";

  // Refactor to fetch multiple departments
  const usersRaw = await queryDatabase<any>(`
    SELECT u.id, u.name, GROUP_CONCAT(ud.departmentId) as departmentIds
    FROM User u
    LEFT JOIN UserDepartment ud ON u.id = ud.userId
    GROUP BY u.id
    ORDER BY u.name ASC
  `);

  const users: DbUser[] = usersRaw.map(u => ({
      ...u,
      departmentIds: u.departmentIds ? u.departmentIds.split(',') : []
  }));

  // Updated query: Join with Department to get department names (using GROUP_CONCAT for many-to-many)
  // Also fetch userDeptIds (departmentId values) for boss-scoped filtering
  const leaveRequests = await queryDatabase<DbLeaveRequest>(`
    SELECT lr.*, u.name as userName, s.name as substituteName,
           GROUP_CONCAT(d.name) as userDepartment,
           GROUP_CONCAT(ud.departmentId) as userDeptIds
    FROM LeaveRequest lr
    LEFT JOIN User u ON lr.userId = u.id
    LEFT JOIN User s ON lr.substituteId = s.id
    LEFT JOIN UserDepartment ud ON u.id = ud.userId
    LEFT JOIN Department d ON ud.departmentId = d.id
    GROUP BY lr.id
    ORDER BY lr.startDate ASC
  `);

  const pendingRequests = leaveRequests.filter(r => r.status === 'PENDING');
  const approvedRequests = leaveRequests.filter(r => r.status === 'GENEHMIGT');

  const visiblePending =
    principal?.role === "boss"
      ? pendingRequests.filter((r) =>
          (r.userDeptIds ?? "").split(",").some((d) => principal.departmentIds.includes(d))
        )
      : pendingRequests;

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">

        {/* Eintragungs-Formular */}
        <div className="md:col-span-1">
          <LeaveForm
            users={users}
            currentMemberId={principal?.role === "member" ? principal.id : null}
            onCreateLeave={handleCreateLeave}
            checkConflicts={checkConflicts}
            getUserBalance={getUserBalance}
            calculateWorkingDays={calculateWorkingDays}
          />
        </div>

        {/* Listen-Bereich */}
        <div className="md:col-span-2 space-y-8">

          {/* 1. SEKTION: Offene Genehmigungen (Für den Chef) */}
          {canApprove && visiblePending.length > 0 && (
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50/30 p-6 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/10">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-amber-800 dark:text-amber-400">Offene Genehmigungen</h2>
                  <p className="text-xs text-amber-600/80">Diese Anträge warten auf deine Bestätigung.</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                  {visiblePending.length}
                </div>
              </div>

              <div className="space-y-3">
                {visiblePending.map((request) => (
                  <EditableLeave
                    key={request.id}
                    request={request}
                    users={users}
                    onUpdate={canApprove ? handleUpdateLeave : undefined}
                    onDelete={canApprove ? handleDeleteLeave : undefined}
                    onApprove={canApprove ? handleApproveLeave : undefined}
                    checkConflicts={checkConflicts}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 2. SEKTION: Alle Urlaube / Historie */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-bold tracking-tight mb-1 text-zinc-900 dark:text-zinc-100">
                {pendingRequests.length > 0 ? "Genehmigte Urlaube" : "Eingetragene Urlaube"}
            </h2>
            <p className="text-sm text-zinc-500 mb-6">Gesamtübersicht aller bestätigten Anträge.</p>

            <div className="space-y-4">
              {approvedRequests.map((request) => (
                <EditableLeave
                  key={request.id}
                  request={request}
                  users={users}
                  onUpdate={canApprove ? handleUpdateLeave : undefined}
                  onDelete={canApprove ? handleDeleteLeave : undefined}
                  onApprove={canApprove ? handleApproveLeave : undefined}
                  checkConflicts={checkConflicts}
                />
              ))}
              {approvedRequests.length === 0 && (
                <p className="text-sm text-zinc-400 py-4 text-center">Keine bestätigten Einträge vorhanden.</p>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
