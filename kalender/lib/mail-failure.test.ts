import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Point the db layer at a fresh temp DB BEFORE importing modules that read it.
const TMP_DB = join(tmpdir(), `mftest-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;

const { recordMailFailure, recentMailFailures } = await import("./mail-failure.ts");
const { runDatabase, queryDatabase } = await import("./db.ts");

async function resetSchema() {
  await runDatabase("DROP TABLE IF EXISTS MailFailure");
  await runDatabase(
    `CREATE TABLE MailFailure (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, reason TEXT NOT NULL, error TEXT, createdAt TEXT NOT NULL)`
  );
}
beforeEach(resetSchema);

test("records a failure with recipient, reason and Error message", async () => {
  await recordMailFailure("u@x.de", "send_error", new Error("smtp down"));
  const rows = await queryDatabase<{ recipient: string; reason: string; error: string }>(
    "SELECT recipient, reason, error FROM MailFailure"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, "u@x.de");
  assert.equal(rows[0].reason, "send_error");
  assert.equal(rows[0].error, "smtp down");
});

test("records config_missing with a null error", async () => {
  await recordMailFailure("u@x.de", "config_missing");
  const rows = await queryDatabase<{ reason: string; error: string | null }>(
    "SELECT reason, error FROM MailFailure"
  );
  assert.equal(rows[0].reason, "config_missing");
  assert.equal(rows[0].error, null);
});

test("stringifies a non-Error throwable", async () => {
  await recordMailFailure("u@x.de", "send_error", "raw string fail");
  const rows = await queryDatabase<{ error: string }>("SELECT error FROM MailFailure");
  assert.equal(rows[0].error, "raw string fail");
});

test("recentMailFailures returns newest first and honors the limit", async () => {
  // insert with explicit, increasing timestamps so ordering is deterministic
  for (let i = 0; i < 3; i++) {
    await runDatabase(
      "INSERT INTO MailFailure (id, recipient, reason, error, createdAt) VALUES (?, ?, ?, ?, ?)",
      [`id${i}`, `r${i}@x.de`, "send_error", null, `2026-06-23T10:0${i}:00.000Z`]
    );
  }
  const all = await recentMailFailures();
  assert.deepEqual(
    all.map((r) => r.recipient),
    ["r2@x.de", "r1@x.de", "r0@x.de"]
  );
  const limited = await recentMailFailures(1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0].recipient, "r2@x.de");
});
