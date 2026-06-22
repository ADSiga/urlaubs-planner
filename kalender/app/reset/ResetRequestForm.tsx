"use client";

import { useState } from "react";

interface Props {
  onRequest: (email: string) => Promise<{ ok: true }>;
}

export default function ResetRequestForm({ onRequest }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || busy) return;
    setBusy(true);
    await onRequest(email);
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-Mail"
        autoComplete="email"
        className="w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none"
      />
      <button
        type="submit"
        disabled={!email || busy}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? "Senden..." : "Link senden"}
      </button>
    </form>
  );
}
