import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, type Principal } from "./session-crypto.ts";

const SECRET = "test-session-secret";
const p: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };

test("signSession/verifySession round-trips a principal", () => {
  const token = signSession(p, SECRET);
  assert.deepEqual(verifySession(token, SECRET), p);
});

test("verifySession rejects a tampered payload", () => {
  const token = signSession(p, SECRET);
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...p, role: "admin" })
  ).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, SECRET), null);
});

test("verifySession rejects a wrong secret and malformed tokens", () => {
  const token = signSession(p, SECRET);
  assert.equal(verifySession(token, "other-secret"), null);
  assert.equal(verifySession("garbage", SECRET), null);
  assert.equal(verifySession("", SECRET), null);
});
