import nodemailer from "nodemailer";

export function buildResetEmail(resetUrl: string): { subject: string; text: string } {
  return {
    subject: "Passwort zurücksetzen — Urlaubs-Planer",
    text:
      `Du hast angefordert, dein Passwort zurückzusetzen.\n\n` +
      `Öffne diesen Link, um ein neues Passwort zu vergeben (gültig für 1 Stunde):\n` +
      `${resetUrl}\n\n` +
      `Wenn du das nicht warst, kannst du diese E-Mail ignorieren.`,
  };
}

// Reads the project's existing mail credentials: MAIL_SERVER (host),
// MAIL_USERNAME (auth user + From), MAIL_PASSWORD. Port 587 with STARTTLS.
function transport() {
  return nodemailer.createTransport({
    host: process.env.MAIL_SERVER,
    port: 587,
    secure: false, // STARTTLS upgrade on 587
    auth:
      process.env.MAIL_USERNAME && process.env.MAIL_PASSWORD
        ? { user: process.env.MAIL_USERNAME, pass: process.env.MAIL_PASSWORD }
        : undefined,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { subject, text } = buildResetEmail(resetUrl);
  await transport().sendMail({
    from: process.env.MAIL_USERNAME ?? "no-reply@urlaubsplaner.local",
    to,
    subject,
    text,
  });
}
