import { queryDatabase, runDatabase } from "./db";
import { randomUUID } from "crypto";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// All createdAt values are stored as new Date(...).toISOString() (fixed-width UTC "Z"), so the
// lexicographic string comparisons against an ISO cutoff below sort identically to chronological order.
/** Locked when >= MAX_FAILURES failures recorded within the last WINDOW_MS. */
export async function isLocked(key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const rows = await queryDatabase<{ n: number }>(
    "SELECT COUNT(*) AS n FROM LoginAttempt WHERE attemptKey = ? AND createdAt > ?",
    [key, cutoff]
  );
  return (rows[0]?.n ?? 0) >= MAX_FAILURES;
}

/** Record one failure for `key`; also prune globally-expired rows to bound the table. */
export async function recordFailure(key: string): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - WINDOW_MS).toISOString();
  await runDatabase("DELETE FROM LoginAttempt WHERE createdAt < ?", [cutoff]);
  await runDatabase(
    "INSERT INTO LoginAttempt (id, attemptKey, createdAt) VALUES (?, ?, ?)",
    [randomUUID(), key, new Date(now).toISOString()]
  );
}

/** Clear all failures for `key` (called on a successful login). */
export async function clearFailures(key: string): Promise<void> {
  await runDatabase("DELETE FROM LoginAttempt WHERE attemptKey = ?", [key]);
}
