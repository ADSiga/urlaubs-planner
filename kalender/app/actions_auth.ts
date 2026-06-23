"use server";

import { loginStaff, loginMember, logout, changeMemberPassword, type ChangePasswordResult, type LoginResult } from "@/lib/auth";
import { requestPasswordReset, performPasswordReset } from "@/lib/password-reset";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

// Trust assumption: the first x-forwarded-for hop is the real client only if a trusted reverse
// proxy SETS/OVERWRITES this header (does not merely append). If the app is reachable directly,
// or the proxy appends, a client can spoof XFF to dodge the per-IP staff throttle or pre-lock a
// victim IP. The staff IP throttle is best-effort; member (email-keyed) throttling does not rely on this.
async function clientIp(): Promise<string | null> {
  const xff = (await headers()).get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0].trim() || null;
}

export async function handleStaffLogin(code: string): Promise<LoginResult> {
  const res = await loginStaff(code, await clientIp());
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function handleMemberLogin(email: string, password: string): Promise<LoginResult> {
  const res = await loginMember(email, password);
  if (res.ok) revalidatePath("/", "layout");
  return res;
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
