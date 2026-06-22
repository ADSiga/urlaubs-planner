import Link from "next/link";
import ResetForm from "./ResetForm";
import { validateResetToken } from "@/lib/password-reset";
import { handlePerformPasswordReset } from "../../actions_auth";

export const dynamic = "force-dynamic";

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { valid } = await validateResetToken(token);

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">
        Neues Passwort vergeben
      </h1>
      {valid ? (
        <ResetForm token={token} onReset={handlePerformPasswordReset} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-rose-600">Dieser Link ist ungültig oder abgelaufen.</p>
          <Link href="/reset" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
            Neuen Link anfordern
          </Link>
        </div>
      )}
    </main>
  );
}
