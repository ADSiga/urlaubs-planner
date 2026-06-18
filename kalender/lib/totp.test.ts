import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBase32Secret, buildOtpauthUrl } from "./totp.ts";

test("generateBase32Secret produces uppercase base32 of expected length", () => {
  const s = generateBase32Secret();
  assert.match(s, /^[A-Z2-7]+$/);
  assert.equal(s.length, 32); // 20 bytes -> 160 bits / 5 = 32 chars
  assert.notEqual(generateBase32Secret(), generateBase32Secret());
});

test("buildOtpauthUrl encodes issuer, label and secret", () => {
  const url = buildOtpauthUrl("Boss Anna", "ABC234", "Urlaubs-Planer");
  assert.equal(
    url,
    "otpauth://totp/Urlaubs-Planer:Boss%20Anna?secret=ABC234&issuer=Urlaubs-Planer"
  );
});
