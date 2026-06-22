import { verify, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { cookies } from "next/headers";
import { queryDatabase, runDatabase, getOne } from "./db";
import { verifyPassword, hashPassword, validateNewPassword, MIN_PASSWORD_LENGTH } from "./password";
import { signSession, verifySession, sessionPredatesPasswordChange, type Principal } from "./session-crypto";
import {
  isAdminPrincipal,
  canManageDepartmentScope,
  canManageMemberScope,
} from "./scope";

export type { Principal };

const SESSION_COOKIE = "session";

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable must be set.");
  return s;
}

async function verifyTotp(code: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({
      token: code,
      secret,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });
    return result.valid;
  } catch (err) {
    console.error("[AUTH] TOTP verify error:", err);
    return false;
  }
}

async function deptIdsForBoss(bossId: string): Promise<string[]> {
  const rows = await queryDatabase<{ departmentId: string }>(
    "SELECT departmentId FROM BossDepartment WHERE bossId = ?",
    [bossId]
  );
  return rows.map((r) => r.departmentId);
}

async function deptIdsForUser(userId: string): Promise<string[]> {
  const rows = await queryDatabase<{ departmentId: string }>(
    "SELECT departmentId FROM UserDepartment WHERE userId = ?",
    [userId]
  );
  return rows.map((r) => r.departmentId);
}

async function setSession(principal: Principal): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSession(principal, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

export async function getPrincipal(): Promise<Principal | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = verifySession(token, sessionSecret());
  if (!session) return null;
  if (session.principal.role === "member") {
    const row = await getOne<{ passwordChangedAt: string | null }>(
      "SELECT passwordChangedAt FROM User WHERE id = ?",
      [session.principal.id]
    );
    if (sessionPredatesPasswordChange(session.iat, row?.passwordChangedAt ?? null)) {
      return null;
    }
  }
  return session.principal;
}

export async function loginStaff(code: string): Promise<boolean> {
  const adminSecret = process.env.BOSS_SECRET;
  if (adminSecret && (await verifyTotp(code, adminSecret))) {
    await setSession({ role: "admin", id: "admin", name: "Admin", departmentIds: [] });
    return true;
  }
  const bosses = await queryDatabase<{ id: string; name: string; totpSecret: string }>(
    "SELECT id, name, totpSecret FROM Boss"
  );
  for (const b of bosses) {
    if (await verifyTotp(code, b.totpSecret)) {
      await setSession({
        role: "boss",
        id: b.id,
        name: b.name,
        departmentIds: await deptIdsForBoss(b.id),
      });
      return true;
    }
  }
  return false;
}

export async function loginMember(email: string, password: string): Promise<boolean> {
  const rows = await queryDatabase<{ id: string; name: string; passwordHash: string | null }>(
    "SELECT id, name, passwordHash FROM User WHERE email = ?",
    [email]
  );
  const user = rows[0];
  if (!user || !user.passwordHash) return false;
  if (!verifyPassword(password, user.passwordHash)) return false;
  await setSession({
    role: "member",
    id: user.id,
    name: user.name,
    departmentIds: await deptIdsForUser(user.id),
  });
  return true;
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
}

export async function isAdmin(): Promise<boolean> {
  return isAdminPrincipal(await getPrincipal());
}

export async function isBossModeActive(): Promise<boolean> {
  const p = await getPrincipal();
  return p?.role === "admin" || p?.role === "boss";
}

export async function canManageDepartment(deptId: string): Promise<boolean> {
  return canManageDepartmentScope(await getPrincipal(), deptId);
}

export async function canManageMember(userId: string): Promise<boolean> {
  const p = await getPrincipal();
  if (!p) return false;
  if (p.role === "admin") return true;
  return canManageMemberScope(p, await deptIdsForUser(userId));
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

export async function changeMemberPassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const principal = await getPrincipal();
  if (!principal || principal.role !== "member") {
    return { ok: false, error: "Nicht berechtigt." };
  }

  const valid = validateNewPassword(currentPassword, newPassword);
  if (!valid.ok) {
    const messages: Record<string, string> = {
      empty: "Bitte beide Felder ausfüllen.",
      too_short: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
      same_as_current: "Das neue Passwort muss sich vom aktuellen unterscheiden.",
    };
    return { ok: false, error: messages[valid.error] };
  }

  const rows = await queryDatabase<{ passwordHash: string | null }>(
    "SELECT passwordHash FROM User WHERE id = ?",
    [principal.id]
  );
  const hash = rows[0]?.passwordHash;
  if (!hash || !verifyPassword(currentPassword, hash)) {
    return { ok: false, error: "Aktuelles Passwort ist falsch." };
  }

  const now = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ?, passwordChangedAt = ? WHERE id = ?", [
    hashPassword(newPassword),
    now,
    principal.id,
  ]);
  // Re-issue THIS session with a fresh iat (>= passwordChangedAt) so the current
  // tab stays logged in while the member's other sessions are invalidated.
  await setSession(principal);
  return { ok: true };
}
