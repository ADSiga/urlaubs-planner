"use server";

import { loginStaff, logout } from "@/lib/boss-auth";
import { revalidatePath } from "next/cache";

export async function handleBossLogin(code: string): Promise<boolean> {
  const isValid = await loginStaff(code);
  if (isValid) {
    revalidatePath("/", "layout");
    return true;
  }
  return false;
}

export async function handleBossLogout() {
  await logout();
  revalidatePath("/", "layout");
}
