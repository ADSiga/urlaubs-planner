"use server";

import { verifyBossCode, loginBoss, logoutBoss } from "@/lib/boss-auth";
import { revalidatePath } from "next/cache";

export async function handleBossLogin(code: string): Promise<boolean> {
  const isValid = await verifyBossCode(code);
  if (isValid) {
    await loginBoss();
    revalidatePath("/", "layout");
    return true;
  }
  return false;
}

export async function handleBossLogout() {
  await logoutBoss();
  revalidatePath("/", "layout");
}
