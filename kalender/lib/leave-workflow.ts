export type LeaveStatus =
  | "WARTE_VERTRETUNG"
  | "ABGELEHNT_VERTRETUNG"
  | "PENDING"
  | "GENEHMIGT";

export type CreatorRole = "admin" | "boss" | "member";

export const STATUS_LABELS: Record<string, string> = {
  WARTE_VERTRETUNG: "Wartet auf Vertretung",
  ABGELEHNT_VERTRETUNG: "Vertretung abgelehnt",
  PENDING: "Ausstehend",
  GENEHMIGT: "Genehmigt",
};

export function computeInitialStatus(args: {
  role: CreatorRole;
  leaveType: string;
  requireSubstitute: boolean;
  hasSubstitute: boolean;
}): LeaveStatus {
  const { role, leaveType, requireSubstitute, hasSubstitute } = args;

  if (role === "member") {
    // Automatic gate: Erholungsurlaub only, and only when a substitute exists.
    return leaveType === "Erholungsurlaub" && hasSubstitute
      ? "WARTE_VERTRETUNG"
      : "PENDING";
  }

  // Staff (admin/boss): explicit opt-in via the form checkbox, any leave type.
  return requireSubstitute && hasSubstitute ? "WARTE_VERTRETUNG" : "PENDING";
}

export function canSubstituteAct(status: string): boolean {
  return status === "WARTE_VERTRETUNG";
}

export function canResubmit(status: string): boolean {
  return status === "ABGELEHNT_VERTRETUNG";
}
