"use client";

import { useState } from "react";

interface Props {
  token: string;
  onReset: (
    token: string,
    newPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const MIN_LEN = 8;

export default function ResetForm({ token, onReset }: Props) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = next.length >= MIN_LEN && next === confirm && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    const res = await onReset(token, next);
    if (res.ok) setDone(true);
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-bold text-emerald-600">
          Passwort zurückgesetzt. Du kannst dich jetzt anmelden.
        </p>
        <a href="/" className="text-xs font-medium text-emerald-600 hover:text-emerald-500">
          Zur Startseite
        </a>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none";

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="Neues Passwort"
        autoComplete="new-password"
        className={inputClass}
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Neues Passwort bestätigen"
        autoComplete="new-password"
        className={inputClass}
      />
      {next.length > 0 && next.length < MIN_LEN && (
        <p className="text-[10px] font-medium text-zinc-400 px-1">Mindestens {MIN_LEN} Zeichen.</p>
      )}
      {confirm.length > 0 && next !== confirm && (
        <p className="text-[10px] font-medium text-amber-600 px-1">Passwörter stimmen nicht überein.</p>
      )}
      {error && <p className="text-[10px] font-bold uppercase text-red-500 px-1">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50"
      >
        {busy ? "Speichert..." : "Passwort speichern"}
      </button>
    </form>
  );
}
