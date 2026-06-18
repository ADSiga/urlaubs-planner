import { verify, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { cookies } from "next/headers";

const BOSS_SESSION_COOKIE = "boss_mode_session";

function getSecret(): string {
  const secret = process.env.BOSS_SECRET;
  if (!secret) throw new Error("BOSS_SECRET environment variable must be set.");
  return secret;
}

export async function isBossModeActive(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(BOSS_SESSION_COOKIE);
  const active = !!session && session.value === "active";

  console.log(`[AUTH DEBUG] Session Cookie found: ${!!session}, Active: ${active}`);

  return active;
}

export async function verifyBossCode(code: string): Promise<boolean> {
  try {
    const result = await verify({
      token: code,
      secret: getSecret(),
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin()
    });

    console.log(`[AUTH DEBUG] Verification result: ${result.valid}`);
    return result.valid;
  } catch (err) {
    console.error("[AUTH DEBUG] Authentifizierung Fehler:", err);
    return false;
  }
}

export async function loginBoss() {
  const cookieStore = await cookies();
  cookieStore.set(BOSS_SESSION_COOKIE, "active", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  console.log("[AUTH DEBUG] loginBoss: Cookie set.");
}

export async function logoutBoss() {
  const cookieStore = await cookies();
  cookieStore.set(BOSS_SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  console.log("[AUTH DEBUG] logoutBoss: Cookie cleared.");
}
