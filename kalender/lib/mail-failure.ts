import { runDatabase, queryDatabase } from "./db";
import { randomUUID } from "crypto";

export type MailFailureReason = "config_missing" | "send_error";

export interface MailFailureRow {
  id: string;
  recipient: string;
  reason: MailFailureReason;
  error: string | null;
  createdAt: string;
}

/**
 * Persist a mail-delivery failure so it survives beyond a console line.
 * Best-effort: callers should not let a logging failure break their flow.
 */
export async function recordMailFailure(
  recipient: string,
  reason: MailFailureReason,
  error?: unknown
): Promise<void> {
  const message =
    error == null ? null : error instanceof Error ? error.message : String(error);
  await runDatabase(
    "INSERT INTO MailFailure (id, recipient, reason, error, createdAt) VALUES (?, ?, ?, ?, ?)",
    [randomUUID(), recipient, reason, message, new Date().toISOString()]
  );
}

/** Most recent mail failures, newest first, for the admin view. */
export async function recentMailFailures(limit = 100): Promise<MailFailureRow[]> {
  return queryDatabase<MailFailureRow>(
    "SELECT id, recipient, reason, error, createdAt FROM MailFailure ORDER BY createdAt DESC LIMIT ?",
    [limit]
  );
}
