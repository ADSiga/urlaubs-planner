import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `lttest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { isLocked, recordFailure, clearFailures, MAX_FAILURES, WINDOW_MS } = await import(
  "./login-throttle.ts"
);
const { runDatabase, queryDatabase } = await import("./db.ts");

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS LoginAttempt");
  await runDatabase(
    `CREATE TABLE LoginAttempt (id TEXT PRIMARY KEY, attemptKey TEXT NOT NULL, createdAt TEXT NOT NULL)`
  );
}
beforeEach(resetSchema);

test("below the threshold is not locked", async () => {
  for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), false);
});

test("at the threshold is locked", async () => {
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), true);
});

test("clearFailures resets only its key", async () => {
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("email:a@x.de");
  for (let i = 0; i < MAX_FAILURES; i++) await recordFailure("ip:1.2.3.4");
  await clearFailures("email:a@x.de");
  assert.equal(await isLocked("email:a@x.de"), false);
  assert.equal(await isLocked("ip:1.2.3.4"), true);
});

test("failures older than the window do not count", async () => {
  const old = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
  for (let i = 0; i < MAX_FAILURES; i++) {
    await runDatabase(
      "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
      [randomUUID(), "email:a@x.de", old]
    );
  }
  assert.equal(await isLocked("email:a@x.de"), false);
});

test("recordFailure prunes rows older than the window", async () => {
  const old = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
  await runDatabase(
    "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
    [randomUUID(), "ip:9.9.9.9", old]
  );
  await recordFailure("email:a@x.de"); // triggers the prune
  const rows = await queryDatabase("SELECT * FROM LoginAttempt WHERE attemptKey = ?", ["ip:9.9.9.9"]);
  assert.equal(rows.length, 0);
});
