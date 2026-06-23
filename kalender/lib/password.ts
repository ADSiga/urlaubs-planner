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

// A valid scrypt hash of a throwaway value, computed once at module load.
// Used to spend an equivalent scrypt cost when no real hash exists, so login
// timing does not reveal whether an account is registered.
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

/**
 * Always performs one scrypt verification of equivalent cost, even when `stored`
 * is null/missing (verifies against a dummy hash and returns false). This keeps
 * login response time independent of whether the account exists, closing the
 * email-enumeration timing side-channel. Returns true only for a real match.
 */
export function verifyPasswordConstantTime(
  password: string,
  stored: string | null | undefined
): boolean {
  const ok = verifyPassword(password, stored ?? DUMMY_HASH);
  return stored == null ? false : ok;
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

export function validateResetPassword(
  newPassword: string
): { ok: true } | { ok: false; error: "empty" | "too_short" } {
  if (!newPassword) return { ok: false, error: "empty" };
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "too_short" };
  return { ok: true };
}
