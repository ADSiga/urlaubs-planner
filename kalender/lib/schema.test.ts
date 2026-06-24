import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Fresh temp DB before importing the db layer.
const TMP_DB = join(tmpdir(), `schema-${randomUUID()}.db`);
process.env.URLAUBE_DB_PATH = TMP_DB;
const { runDatabase, queryDatabase, initDb } = await import("./db.ts");

// Drift guard: the exact schema initDb() is expected to produce.
// If you change a CREATE TABLE in initDb(), update this map in the same commit —
// that is the whole point: schema changes must be deliberate, not silent.
const EXPECTED_TABLES: Record<string, string[]> = {
  Department: ["id", "name", "createdAt"],
  Boss: ["id", "name", "totpSecret", "createdAt"],
  BossDepartment: ["bossId", "departmentId"],
  PasswordResetToken: ["id", "userId", "tokenHash", "expiresAt", "usedAt", "createdAt"],
  LoginAttempt: ["id", "attemptKey", "createdAt"],
  MailFailure: ["id", "recipient", "reason", "error", "createdAt"],
  SessionRevocation: ["principalId", "validFrom"],
};

// Indexes initDb() must create.
const EXPECTED_INDEXES = ["idx_prt_userId", "idx_login_attempt_key"];

// Columns initDb() adds to the pre-existing User table (User itself is created
// outside initDb in the real DB, so we only guard the auth columns it adds).
const EXPECTED_USER_COLUMNS = ["email", "passwordHash", "passwordChangedAt"];

async function columnsOf(table: string): Promise<string[]> {
  const rows = await queryDatabase<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name).sort();
}

before(async () => {
  // Mirror the real DB: a User table already exists before initDb runs.
  await runDatabase(`CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, name TEXT)`);
  await initDb();
  await initDb(); // idempotent: a second run must not throw
});

for (const [table, expected] of Object.entries(EXPECTED_TABLES)) {
  test(`initDb creates ${table} with exactly its expected columns`, async () => {
    const actual = await columnsOf(table);
    assert.deepEqual(actual, [...expected].sort());
  });
}

test("initDb adds the auth columns to the User table", async () => {
  const cols = await columnsOf("User");
  for (const c of EXPECTED_USER_COLUMNS) {
    assert.ok(cols.includes(c), `User is missing column ${c}`);
  }
});

test("initDb creates the expected indexes", async () => {
  const rows = await queryDatabase<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='index'`
  );
  const names = rows.map((r) => r.name);
  for (const idx of EXPECTED_INDEXES) {
    assert.ok(names.includes(idx), `missing index ${idx}`);
  }
});
