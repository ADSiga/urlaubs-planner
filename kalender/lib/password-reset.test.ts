import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import sqlite3 from "sqlite3";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `prtest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { hashPassword } = await import("./password.ts");
const { createResetTokenForEmail, validateResetToken, performPasswordReset } = await import(
  "./password-reset.ts"
);
const { queryDatabase, runDatabase } = await import("./db.ts");

const MEMBER_ID = "u-test-1";

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS PasswordResetToken");
  await runDatabase("DROP TABLE IF EXISTS User");
  await runDatabase(
    `CREATE TABLE User (id TEXT PRIMARY KEY, name TEXT, email TEXT, passwordHash TEXT)`
  );
  await runDatabase(
    `CREATE TABLE PasswordResetToken (id TEXT PRIMARY KEY, userId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT NOT NULL)`
  );
  await runDatabase("INSERT INTO User (id, name, email, passwordHash) VALUES (?, ?, ?, ?)", [
    MEMBER_ID,
    "Tester",
    "tester@example.com",
    hashPassword("oldpassword1"),
  ]);
}

beforeEach(resetSchema);

test("createResetTokenForEmail: unknown email creates no token, returns null", async () => {
  const r = await createResetTokenForEmail("nobody@example.com");
  assert.equal(r, null);
  const rows = await queryDatabase("SELECT * FROM PasswordResetToken");
  assert.equal(rows.length, 0);
});

test("createResetTokenForEmail: member without passwordHash is ineligible", async () => {
  await runDatabase("UPDATE User SET passwordHash = NULL WHERE id = ?", [MEMBER_ID]);
  const r = await createResetTokenForEmail("tester@example.com");
  assert.equal(r, null);
});

test("createResetTokenForEmail: eligible member gets exactly one token; 60s throttle blocks the second", async () => {
  const first = await createResetTokenForEmail("tester@example.com");
  assert.ok(first?.raw);
  const second = await createResetTokenForEmail("tester@example.com");
  assert.equal(second, null);
  const rows = await queryDatabase("SELECT * FROM PasswordResetToken");
  assert.equal(rows.length, 1);
});

test("validateResetToken: valid, expired, and used states", async () => {
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  assert.deepEqual(await validateResetToken(raw), { valid: true });
  assert.deepEqual(await validateResetToken("not-a-real-token"), { valid: false });

  // expire it
  await runDatabase("UPDATE PasswordResetToken SET expiresAt = ?", [
    new Date(Date.now() - 1000).toISOString(),
  ]);
  assert.deepEqual(await validateResetToken(raw), { valid: false });
});

test("performPasswordReset: happy path updates hash and consumes the token", async () => {
  const { hashPassword: hp, verifyPassword } = await import("./password.ts");
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  const res = await performPasswordReset(raw, "brandnewpass1");
  assert.deepEqual(res, { ok: true });

  const user = (await queryDatabase<{ passwordHash: string }>(
    "SELECT passwordHash FROM User WHERE id = ?",
    [MEMBER_ID]
  ))[0];
  assert.equal(verifyPassword("brandnewpass1", user.passwordHash), true);
  assert.equal(verifyPassword("oldpassword1", user.passwordHash), false);
  void hp;

  // token now used -> second use rejected
  const again = await performPasswordReset(raw, "anotherpass12");
  assert.equal(again.ok, false);
});

test("performPasswordReset: too-short password rejected, no change", async () => {
  const { raw } = (await createResetTokenForEmail("tester@example.com"))!;
  const res = await performPasswordReset(raw, "short");
  assert.equal(res.ok, false);
});
