import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, KEYLEN);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export const MIN_PASSWORD_LENGTH = 8;

export type PasswordChangeError = "empty" | "too_short" | "same_as_current";

export function validateNewPassword(
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: PasswordChangeError } {
  if (!currentPassword || !newPassword) return { ok: false, error: "empty" };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "too_short" };
  if (newPassword === currentPassword) return { ok: false, error: "same_as_current" };
  return { ok: true };
}
