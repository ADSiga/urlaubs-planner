import { runDatabase } from "./db";
import { randomUUID } from "crypto";

export type MailFailureReason = "config_missing" | "send_error";

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
