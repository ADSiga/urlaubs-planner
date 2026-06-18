import path from "path";
import sqlite3 from "sqlite3";

function dbPath(): string {
  return process.env.URLAUBE_DB_PATH ?? path.resolve(process.cwd(), "../dev.db");
}

export function queryDatabase<T>(sql: string, params: any[] = []): Promise<T[]> {
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath(), sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function runDatabase(sql: string, params: any[] = []): Promise<void> {
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath(), sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE);
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function getOne<T>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await queryDatabase<T>(sql, params);
  return rows[0] ?? null;
}

export async function initDb(): Promise<void> {
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS Department (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, createdAt TEXT)`
  );
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS Boss (id TEXT PRIMARY KEY, name TEXT NOT NULL, totpSecret TEXT NOT NULL, createdAt TEXT)`
  );
  await runDatabase(
    `CREATE TABLE IF NOT EXISTS BossDepartment (bossId TEXT NOT NULL, departmentId TEXT NOT NULL, PRIMARY KEY (bossId, departmentId))`
  );
  const cols = await queryDatabase<{ name: string }>(`PRAGMA table_info(User)`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("email")) await runDatabase(`ALTER TABLE User ADD COLUMN email TEXT`);
  if (!names.has("passwordHash")) await runDatabase(`ALTER TABLE User ADD COLUMN passwordHash TEXT`);
  // SQLite treats NULLs as distinct, so multiple members without email stay valid.
  await runDatabase(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON User(email)`);
}
