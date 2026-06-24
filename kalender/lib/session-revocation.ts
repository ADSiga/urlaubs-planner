import { runDatabase, getOne } from "./db";

/**
 * Revoke every session for a principal issued before `at` (default: now).
 * getPrincipal() compares a token's `iat` against this cutoff and rejects
 * older staff sessions. Keyed by principal id (a Boss uuid or "admin").
 */
export async function revokeSessions(principalId: string, at: Date = new Date()): Promise<void> {
  await runDatabase(
    `INSERT OR REPLACE INTO SessionRevocation (principalId, validFrom) VALUES (?, ?)`,
    [principalId, at.toISOString()]
  );
}

/** The revocation cutoff for a principal, or null if none has ever been set. */
export async function revokedSince(principalId: string): Promise<string | null> {
  const row = await getOne<{ validFrom: string }>(
    "SELECT validFrom FROM SessionRevocation WHERE principalId = ?",
    [principalId]
  );
  return row?.validFrom ?? null;
}
