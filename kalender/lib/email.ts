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

function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const { subject, text } = buildResetEmail(resetUrl);
  await transport().sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@urlaubsplaner.local",
    to,
    subject,
    text,
  });
}
