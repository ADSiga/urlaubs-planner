import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

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
