import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `srtest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { revokeSessions, revokedSince } = await import("./session-revocation.ts");
const { runDatabase } = await import("./db.ts");

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS SessionRevocation");
  await runDatabase(
    `CREATE TABLE SessionRevocation (principalId TEXT PRIMARY KEY, validFrom TEXT NOT NULL)`
  );
}
beforeEach(resetSchema);

test("revokedSince returns null when no cutoff has been set", async () => {
  assert.equal(await revokedSince("admin"), null);
});

test("revokeSessions stores a cutoff that revokedSince reads back", async () => {
  const at = new Date("2026-06-24T12:00:00.000Z");
  await revokeSessions("boss-1", at);
  assert.equal(await revokedSince("boss-1"), at.toISOString());
});

test("revokeSessions overwrites an earlier cutoff for the same principal", async () => {
  await revokeSessions("boss-1", new Date("2026-06-24T12:00:00.000Z"));
  const later = new Date("2026-06-24T13:00:00.000Z");
  await revokeSessions("boss-1", later);
  assert.equal(await revokedSince("boss-1"), later.toISOString());
});

test("cutoffs are isolated per principal", async () => {
  await revokeSessions("boss-1", new Date("2026-06-24T12:00:00.000Z"));
  assert.equal(await revokedSince("boss-2"), null);
});
