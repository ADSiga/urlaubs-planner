"use client";

import { useState } from "react";

interface ChangePasswordProps {
  onChangePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

// Kept as a local literal on purpose: lib/password.ts imports node:crypto,
// so importing MIN_PASSWORD_LENGTH from it would pull crypto into this client bundle.
const MIN_LEN = 8;

export default function ChangePassword({ onChangePassword }: ChangePasswordProps) {
  const [showModal, setShowModal] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setSuccess(false);
    setIsSaving(false);
  };

  const close = () => {
    setShowModal(false);
    reset();
  };

  const canSubmit =
    !!current && next.length >= MIN_LEN && next === confirm && !isSaving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setIsSaving(true);
    const result = await onChangePassword(current, next);
    if (result.ok) {
      setSuccess(true);
      setIsSaving(false);
      setTimeout(close, 1200);
    } else {
      setError(result.error ?? "Fehler beim Ändern des Passworts.");
      setIsSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-2xl border-2 border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500 px-4 py-3 text-sm outline-none transition-all";

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="rounded-xl bg-zinc-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 transition-colors"
        title="Passwort ändern"
      >
        Passwort ändern
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-xs rounded-3xl bg-white p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <h3 className="mb-6 text-center text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">
              Passwort ändern
            </h3>

            {success ? (
              <div className="text-center text-sm font-bold text-emerald-600 py-6">Passwort geändert.</div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="password"
                  value={current}
                  disabled={isSaving}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Aktuelles Passwort"
                  className={inputClass}
                  autoComplete="current-password"
                  autoFocus
                />
                <input
                  type="password"
                  value={next}
                  disabled={isSaving}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Neues Passwort"
                  className={inputClass}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  value={confirm}
                  disabled={isSaving}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Neues Passwort bestätigen"
                  className={inputClass}
                  autoComplete="new-password"
                />

                {next.length > 0 && next.length < MIN_LEN && (
                  <p className="text-[10px] font-medium text-zinc-400 px-1">
                    Mindestens {MIN_LEN} Zeichen.
                  </p>
                )}
                {confirm.length > 0 && next !== confirm && (
                  <p className="text-[10px] font-medium text-amber-600 px-1">
                    Passwörter stimmen nicht überein.
                  </p>
                )}
                {error && (
                  <p className="text-[10px] font-bold uppercase text-red-500 px-1">{error}</p>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-2xl bg-zinc-100 py-3.5 text-xs font-bold text-zinc-500 hover:bg-zinc-200 transition-colors dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    Abbruch
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex-1 rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                  >
                    {isSaving ? "Speichert..." : "Speichern"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
