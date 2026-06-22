import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import {
  signSession,
  verifySession,
  sessionPredatesPasswordChange,
  SESSION_TTL_MS,
  type Principal,
} from "./session-crypto.ts";

const SECRET = "test-session-secret";
const p: Principal = { role: "boss", id: "b1", name: "Anna", departmentIds: ["d1", "d2"] };

// Mint a validly-signed token from an arbitrary body (mirrors signSession's scheme)
// so we can construct expired and old-format tokens that signSession would never emit.
function mint(body: unknown, secret = SECRET): string {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

test("signSession/verifySession round-trips principal with iat and exp", () => {
  const before = Date.now();
  const data = verifySession(signSession(p, SECRET), SECRET);
  assert.ok(data);
  assert.deepEqual(data!.principal, p);
  assert.ok(data!.iat >= before && data!.iat <= Date.now());
  assert.equal(data!.exp, data!.iat + SESSION_TTL_MS);
});

test("verifySession rejects an expired token", () => {
  const now = Date.now();
  const token = mint({ principal: p, iat: now - SESSION_TTL_MS - 1000, exp: now - 1000 });
  assert.equal(verifySession(token, SECRET), null);
});

test("verifySession rejects the old payload format (bare principal, no exp)", () => {
  assert.equal(verifySession(mint(p), SECRET), null);
});

test("verifySession rejects a tampered payload", () => {
  const sig = signSession(p, SECRET).split(".")[1];
  const forged = Buffer.from(
    JSON.stringify({ principal: { ...p, role: "admin" }, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, SECRET), null);
});

test("verifySession rejects a wrong secret and malformed tokens", () => {
  const token = signSession(p, SECRET);
  assert.equal(verifySession(token, "other-secret"), null);
  assert.equal(verifySession("garbage", SECRET), null);
  assert.equal(verifySession("", SECRET), null);
});

test("sessionPredatesPasswordChange: null, before, equal, after", () => {
  const changed = new Date(2000).toISOString(); // 2000 ms epoch
  assert.equal(sessionPredatesPasswordChange(1000, null), false);
  assert.equal(sessionPredatesPasswordChange(1000, changed), true);
  assert.equal(sessionPredatesPasswordChange(2000, changed), false);
  assert.equal(sessionPredatesPasswordChange(3000, changed), false);
});
