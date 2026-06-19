import { test } from "node:test";
import assert from "node:assert/strict";
import { generateResetToken, hashResetToken } from "./reset-tokens.ts";

test("hashResetToken is deterministic and differs from the raw token", () => {
  const h1 = hashResetToken("abc");
  const h2 = hashResetToken("abc");
  assert.equal(h1, h2);
  assert.notEqual(h1, "abc");
  assert.equal(h1.length, 64); // sha256 hex
});

test("generateResetToken returns a raw token and its matching hash", () => {
  const { raw, hash } = generateResetToken();
  assert.ok(raw.length >= 32);
  assert.equal(hash, hashResetToken(raw));
  assert.notEqual(raw, hash);
});

test("generateResetToken yields distinct raw tokens", () => {
  assert.notEqual(generateResetToken().raw, generateResetToken().raw);
});
