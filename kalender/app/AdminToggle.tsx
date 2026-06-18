"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AdminToggleProps {
  isActive: boolean;
  onLogin: (code: string) => Promise<boolean>;
  onLogout: () => Promise<void>;
}

export default function AdminToggle({ isActive, onLogin, onLogout }: AdminToggleProps) {
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [isLoggingIn, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const success = await onLogin(code);
    if (success) {
      setShowModal(false);
      setCode("");
      setError(false);
      // Wir erzwingen einen harten Refresh der Seite
      window.location.reload();
    } else {
      setError(true);
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await onLogout();
    window.location.reload();
  };

  if (isActive) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-col items-end">
            <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-tighter leading-none">
                Boss Mode
            </span>
            <span className="text-[8px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mt-0.5">
                Authentifiziert
            </span>
        </div>
        <button 
          onClick={handleLogout}
          className="group relative flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 hover:bg-rose-50 hover:text-rose-600 transition-all dark:bg-emerald-950/20 dark:hover:bg-rose-950/20"
          title="Boss Mode beenden"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-500 group-hover:bg-rose-500 animate-ping" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button 
        onClick={() => setShowModal(true)}
        className="group flex items-center gap-2.5 px-4 py-2 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 text-xs font-bold uppercase tracking-wide hover:bg-emerald-600 hover:text-white transition-all shadow-sm active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        Boss Login
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-xs rounded-3xl bg-white p-8 shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 scale-in-center">
            <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                        <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
                    </svg>
                </div>
                <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">Eintritt verboten</h3>
                <p className="mt-1 text-xs font-medium text-zinc-400">Nur für befugtes Personal</p>
            </div>
            
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <input
                    type="text"
                    value={code}
                    disabled={isLoggingIn}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    className={`w-full rounded-2xl border-2 ${error ? "border-red-500 bg-red-50 dark:bg-red-950/20" : "border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 focus:border-emerald-500"} px-4 py-4 text-center text-3xl font-black tracking-[0.4em] outline-none transition-all placeholder:text-zinc-200 dark:placeholder:text-zinc-800`}
                    autoFocus
                    autoComplete="one-time-code"
                />
              </div>
              
              {error && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-red-500 uppercase animate-shake">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                  </svg>
                  Zugriff verweigert
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-2xl bg-zinc-100 py-3.5 text-xs font-bold text-zinc-500 hover:bg-zinc-200 transition-colors dark:bg-zinc-800 dark:text-zinc-400"
                >
                  Abbruch
                </button>
                <button
                  type="submit"
                  disabled={isLoggingIn || code.length < 6}
                  className="flex-1 rounded-2xl bg-emerald-600 py-3.5 text-xs font-bold text-white hover:bg-emerald-500 shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                >
                  {isLoggingIn ? "Prüfe..." : "Eintreten"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
