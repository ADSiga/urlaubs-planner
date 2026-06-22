"use server";

import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult } from "@/lib/auth";
import { requestPasswordReset, performPasswordReset } from "@/lib/password-reset";
import { revalidatePath } from "next/cache";

export async function handleStaffLogin(code: string): Promise<boolean> {
  const ok = await loginStaff(code);
  if (ok) revalidatePath("/", "layout");
  return ok;
}

export async function handleMemberLogin(email: string, password: string): Promise<boolean> {
  const ok = await loginMember(email, password);
  if (ok) revalidatePath("/", "layout");
  return ok;
}

export async function handleLogout() {
  await logout();
  revalidatePath("/", "layout");
}

export async function handleChangePassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  return changeMemberPassword(currentPassword, newPassword);
}

export async function handleRequestPasswordReset(email: string): Promise<{ ok: true }> {
  await requestPasswordReset(email);
  return { ok: true }; // anti-enumeration: always the same response
}

export async function handlePerformPasswordReset(
  token: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return performPasswordReset(token, newPassword);
}
