"use server";

import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult } from "@/lib/auth";
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
