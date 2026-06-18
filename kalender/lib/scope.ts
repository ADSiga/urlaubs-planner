import type { Principal } from "./session-crypto";

export function isAdminPrincipal(p: Principal | null): boolean {
  return p?.role === "admin";
}

export function canManageDepartmentScope(p: Principal | null, deptId: string): boolean {
  if (!p) return false;
  if (p.role === "admin") return true;
  if (p.role === "boss") return p.departmentIds.includes(deptId);
  return false;
}

export function canManageMemberScope(p: Principal | null, memberDeptIds: string[]): boolean {
  if (!p) return false;
  if (p.role === "admin") return true;
  if (p.role === "boss") return memberDeptIds.some((d) => p.departmentIds.includes(d));
  return false;
}
