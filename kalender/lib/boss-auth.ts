// Backwards-compatible re-export. All auth logic now lives in ./auth.
export {
  getPrincipal,
  loginStaff,
  loginMember,
  logout,
  isAdmin,
  isBossModeActive,
  canManageDepartment,
  canManageMember,
  type Principal,
} from "./auth";
