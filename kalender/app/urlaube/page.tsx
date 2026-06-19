import EditableLeave from "../EditableLeave";
import LeaveForm from "./LeaveForm";
import SubstituteRequest from "../SubstituteRequest";
import ResubmitLeave from "../ResubmitLeave";
// Alle Actions sauber von außen importieren
import { checkConflicts, handleCreateLeave, handleUpdateLeave, handleDeleteLeave, handleApproveLeave, handleSubstituteAccept, handleSubstituteDecline, handleResubmitLeave, getUserBalance, calculateWorkingDays } from "./actions";
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

  const myId = principal?.id ?? null;

  // Requests where I am the nominated substitute and acceptance is pending.
  const substituteRequests = leaveRequests.filter(
    (r) => r.substituteId === myId && r.status === "WARTE_VERTRETUNG"
  );

  // My own requests, newest-relevant statuses first for visibility.
  const myRequests =
    principal?.role === "member"
      ? leaveRequests.filter((r) => r.userId === myId)
      : [];

  const myDeclined = myRequests.filter((r) => r.status === "ABGELEHNT_VERTRETUNG");
  const myPendingOwn = myRequests.filter(
    (r) => r.status === "WARTE_VERTRETUNG" || r.status === "PENDING"
  );

  // Eligible substitutes for re-pick: users sharing a department with me, excluding me.
  const me = users.find((u) => u.id === myId);
  const eligibleSubstitutes = me
    ? users
        .filter((u) => u.id !== me.id && u.departmentIds.some((d) => me.departmentIds.includes(d)))
        .map((u) => ({ id: u.id, name: u.name }))
    : [];

  // Boss/admin view of declined requests (department-scoped, like visiblePending).
  const visibleDeclined = canApprove
    ? leaveRequests.filter(
        (r) =>
          r.status === "ABGELEHNT_VERTRETUNG" &&
          (principal?.role === "admin" ||
            (r.userDeptIds ?? "").split(",").some((d) => principal!.departmentIds.includes(d)))
      )
    : [];

  // Eligible substitutes for a given request owner (shares a department with the owner).
  const eligibleForOwner = (ownerId: string, ownerDeptIds: string) => {
    const deptIds = (ownerDeptIds ?? "").split(",");
    return users
      .filter((u) => u.id !== ownerId && u.departmentIds.some((d) => deptIds.includes(d)))
      .map((u) => ({ id: u.id, name: u.name }));
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid gap-8 md:grid-cols-3">

        {/* Eintragungs-Formular */}
        <div className="md:col-span-1">
          <LeaveForm
            users={users}
            currentMemberId={principal?.role === "member" ? principal.id : null}
            isStaff={canApprove}
            onCreateLeave={handleCreateLeave}
            checkConflicts={checkConflicts}
            getUserBalance={getUserBalance}
            calculateWorkingDays={calculateWorkingDays}
          />
        </div>

        {/* Listen-Bereich */}
        <div className="md:col-span-2 space-y-8">

          {/* Vertretungs-Anfragen: Anträge, bei denen ich die Vertretung bin */}
          {substituteRequests.length > 0 && (
            <div className="rounded-xl border-2 border-sky-200 bg-sky-50/30 p-6 shadow-sm dark:border-sky-900/30 dark:bg-sky-950/10">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-sky-800 dark:text-sky-400">Vertretungs-Anfragen</h2>
                  <p className="text-xs text-sky-600/80">Diese Anträge warten auf deine Zustimmung als Vertretung.</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-400">
                  {substituteRequests.length}
                </div>
              </div>
              <div className="space-y-3">
                {substituteRequests.map((request) => (
                  <SubstituteRequest
                    key={request.id}
                    request={request}
                    onAccept={handleSubstituteAccept}
                    onDecline={handleSubstituteDecline}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Meine Anträge: eigene offene und abgelehnte Anträge */}
          {principal?.role === "member" && (myDeclined.length > 0 || myPendingOwn.length > 0) && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-bold tracking-tight mb-1 text-zinc-900 dark:text-zinc-100">Meine Anträge</h2>
              <p className="text-sm text-zinc-500 mb-6">Status deiner offenen Urlaubsanträge.</p>
              <div className="space-y-3">
                {myDeclined.map((request) => (
                  <ResubmitLeave
                    key={request.id}
                    request={request}
                    eligibleSubstitutes={eligibleSubstitutes}
                    onResubmit={handleResubmitLeave}
                  />
                ))}
                {myPendingOwn.map((request) => (
                  <EditableLeave
                    key={request.id}
                    request={request}
                    users={users}
                    checkConflicts={checkConflicts}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Abgelehnte Vertretungen (Für den Chef): neue Vertretung zuweisen oder löschen */}
          {canApprove && visibleDeclined.length > 0 && (
            <div className="rounded-xl border-2 border-rose-200 bg-rose-50/30 p-6 shadow-sm dark:border-rose-900/30 dark:bg-rose-950/10">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-rose-800 dark:text-rose-400">Abgelehnte Vertretungen</h2>
                  <p className="text-xs text-rose-600/80">Die Vertretung hat abgelehnt — neue Vertretung zuweisen oder Antrag löschen.</p>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-700 dark:bg-rose-900/50 dark:text-rose-400">
                  {visibleDeclined.length}
                </div>
              </div>
              <div className="space-y-3">
                {visibleDeclined.map((request) => (
                  <div key={request.id} className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {request.userName || "Unbekannt"}
                        <span className="ml-2 text-xs font-normal text-zinc-500">{request.userDepartment || "Keine Angabe"}</span>
                      </span>
                      <form action={handleDeleteLeave}>
                        <input type="hidden" name="id" value={request.id} />
                        <button
                          type="submit"
                          className="text-[11px] font-semibold text-zinc-400 hover:text-red-500 transition-colors"
                          title="Antrag löschen"
                        >
                          Löschen
                        </button>
                      </form>
                    </div>
                    <ResubmitLeave
                      request={request}
                      eligibleSubstitutes={eligibleForOwner(request.userId, request.userDeptIds ?? "")}
                      onResubmit={handleResubmitLeave}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
