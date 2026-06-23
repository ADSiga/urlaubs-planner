import { isMailConfigured } from "@/lib/email";

// Next.js calls register() once when the server starts.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!isMailConfigured()) {
    console.warn(
      "[startup] Mail is NOT configured (set MAIL_SERVER, MAIL_USERNAME, MAIL_PASSWORD). " +
        "Password-reset emails will not be sent; attempts are recorded in the MailFailure table."
    );
  }
}
