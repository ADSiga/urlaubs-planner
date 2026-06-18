import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";

test("initDb creates Boss/BossDepartment tables and User auth columns idempotently", async () => {
  const dbFile = join(tmpdir(), `urlaube-test-${randomUUID()}.db`);
  process.env.URLAUBE_DB_PATH = dbFile;
  const { runDatabase, queryDatabase, initDb, getOne } = await import("./db.ts");

  // Seed a minimal pre-existing User table (as the real DB already has one).
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, name TEXT)`
  );

  await initDb();
  await initDb(); // second call must not throw (idempotent)

  const tables = await queryDatabase<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table'`
  );
  const tableNames = tables.map((t) => t.name);
  assert.ok(tableNames.includes("Boss"));
  assert.ok(tableNames.includes("BossDepartment"));
  assert.ok(tableNames.includes("Department"));

  const cols = await queryDatabase<{ name: string }>(`PRAGMA table_info(User)`);
  const colNames = cols.map((c) => c.name);
  assert.ok(colNames.includes("email"));
  assert.ok(colNames.includes("passwordHash"));

  assert.equal(await getOne(`SELECT * FROM Boss`), null);

  if (existsSync(dbFile)) rmSync(dbFile);
});
