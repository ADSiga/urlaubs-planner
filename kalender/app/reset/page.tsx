import Link from "next/link";
import ResetRequestForm from "./ResetRequestForm";
import { handleRequestPasswordReset } from "../actions_auth";

export const dynamic = "force-dynamic";

export default function ResetRequestPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-2 text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">
        Passwort zurücksetzen
      </h1>
      <p className="mb-6 text-sm text-zinc-500">
        Gib deine E-Mail-Adresse ein. Wir senden dir einen Link zum Zurücksetzen.
      </p>
      <ResetRequestForm onRequest={handleRequestPasswordReset} />
      <div className="mt-6">
        <Link href="/" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
          Zurück zur Startseite
        </Link>
      </div>
    </main>
  );
}
