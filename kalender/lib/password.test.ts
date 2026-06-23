import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, verifyPasswordConstantTime, validateNewPassword, validateResetPassword, MIN_PASSWORD_LENGTH } from "./password.ts";

test("hashPassword round-trips and rejects wrong password", () => {
  const hash = hashPassword("Sommer2026!");
  assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("Sommer2026!", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("verifyPassword rejects malformed stored values", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "notarealhash"), false);
  assert.equal(verifyPassword("x", "bcrypt$a$b"), false);
});

test("two hashes of same password differ (random salt)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("verifyPasswordConstantTime matches a real hash and rejects a wrong one", () => {
  const hash = hashPassword("Sommer2026!");
  assert.equal(verifyPasswordConstantTime("Sommer2026!", hash), true);
  assert.equal(verifyPasswordConstantTime("wrong", hash), false);
});

test("verifyPasswordConstantTime returns false (not a match) when no hash exists", () => {
  // Both branches run a scrypt verification; the null/undefined cases must never succeed.
  assert.equal(verifyPasswordConstantTime("anything", null), false);
  assert.equal(verifyPasswordConstantTime("anything", undefined), false);
});

test("validateNewPassword: rejects empty fields", () => {
  assert.deepEqual(validateNewPassword("", "newpass12"), { ok: false, error: "empty" });
  assert.deepEqual(validateNewPassword("current12", ""), { ok: false, error: "empty" });
});

test("validateNewPassword: rejects too-short new password", () => {
  assert.deepEqual(validateNewPassword("current12", "short"), { ok: false, error: "too_short" });
  // exactly MIN_PASSWORD_LENGTH-1 is too short
  assert.equal(validateNewPassword("current12", "a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
});

test("validateNewPassword: rejects new equal to current", () => {
  assert.deepEqual(validateNewPassword("samepass12", "samepass12"), { ok: false, error: "same_as_current" });
});

test("validateNewPassword: accepts a valid distinct new password >= 8 chars", () => {
  assert.deepEqual(validateNewPassword("current12", "brandnew34"), { ok: true });
  assert.deepEqual(validateNewPassword("current12", "a".repeat(MIN_PASSWORD_LENGTH)), { ok: true });
});

test("validateResetPassword: rejects empty", () => {
  assert.deepEqual(validateResetPassword(""), { ok: false, error: "empty" });
});

test("validateResetPassword: rejects too short", () => {
  assert.deepEqual(validateResetPassword("short"), { ok: false, error: "too_short" });
});

test("validateResetPassword: accepts >= 8 chars", () => {
  assert.deepEqual(validateResetPassword("longenough1"), { ok: true });
});
