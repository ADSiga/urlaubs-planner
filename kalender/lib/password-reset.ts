import { queryDatabase, runDatabase, getOne } from "./db";
import { hashPassword, validateResetPassword } from "./password";
import { generateResetToken, hashResetToken } from "./reset-tokens";
import { sendPasswordResetEmail } from "./email";
import { randomUUID } from "crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_MS = 60 * 1000; // 60 seconds

/**
 * Create a reset token for an eligible member, honoring a 60s throttle.
 * Returns the raw token to email, or null when no email should be sent
 * (no eligible member, or throttled). Never reveals which case occurred.
 */
export async function createResetTokenForEmail(
  email: string
): Promise<{ raw: string } | null> {
  const user = await getOne<{ id: string }>(
    "SELECT id FROM User WHERE email = ? AND passwordHash IS NOT NULL",
    [email]
  );
  if (!user) return null;

  const cutoff = new Date(Date.now() - THROTTLE_MS).toISOString();
  const recent = await getOne<{ id: string }>(
    "SELECT id FROM PasswordResetToken WHERE userId = ? AND usedAt IS NULL AND createdAt > ?",
    [user.id, cutoff]
  );
  if (recent) return null;

  const { raw, hash } = generateResetToken();
  const now = new Date();
  await runDatabase(
    `INSERT INTO PasswordResetToken (id, userId, tokenHash, expiresAt, usedAt, createdAt)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [randomUUID(), user.id, hash, new Date(now.getTime() + TOKEN_TTL_MS).toISOString(), now.toISOString()]
  );
  return { raw };
}

export async function validateResetToken(raw: string): Promise<{ valid: boolean }> {
  const row = await getOne<{ expiresAt: string; usedAt: string | null }>(
    "SELECT expiresAt, usedAt FROM PasswordResetToken WHERE tokenHash = ?",
    [hashResetToken(raw)]
  );
  if (!row || row.usedAt) return { valid: false };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { valid: false };
  return { valid: true };
}

export async function performPasswordReset(
  raw: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = validateResetPassword(newPassword);
  if (!valid.ok) {
    const msg: Record<string, string> = {
      empty: "Bitte ein neues Passwort eingeben.",
      too_short: "Das Passwort muss mindestens 8 Zeichen lang sein.",
    };
    return { ok: false, error: msg[valid.error] };
  }

  const row = await getOne<{ id: string; userId: string; expiresAt: string; usedAt: string | null }>(
    "SELECT id, userId, expiresAt, usedAt FROM PasswordResetToken WHERE tokenHash = ?",
    [hashResetToken(raw)]
  );
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: "Dieser Link ist ungültig oder abgelaufen." };
  }

  const nowIso = new Date().toISOString();
  await runDatabase("UPDATE User SET passwordHash = ? WHERE id = ?", [
    hashPassword(newPassword),
    row.userId,
  ]);
  // Consume this token and invalidate any other outstanding tokens for the user.
  await runDatabase("UPDATE PasswordResetToken SET usedAt = ? WHERE userId = ? AND usedAt IS NULL", [
    nowIso,
    row.userId,
  ]);
  return { ok: true };
}

/** Anti-enumeration wrapper: always resolves; swallows send errors. */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    const created = await createResetTokenForEmail(email);
    if (!created) return;
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    await sendPasswordResetEmail(email, `${base}/reset/${created.raw}`);
  } catch (err) {
    console.error("[password-reset] send failed:", err);
  }
}
