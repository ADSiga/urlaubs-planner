import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import path from "path";
import sqlite3 from "sqlite3";
import { initDb } from "@/lib/db";
import { getPrincipal } from "@/lib/auth";
import AdminToggle from "./AdminToggle";
import { handleStaffLogin, handleMemberLogin, handleLogout } from "./actions_auth";

export const metadata: Metadata = {
  title: "Urlaubs-Planer",
  description: "Urlaubsplaner Dashboard",
};

// Hilfsfunktion für den Layout-Status
async function getPendingCount(): Promise<number> {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);

  return new Promise((resolve) => {
    db.get("SELECT COUNT(*) as count FROM LeaveRequest WHERE status = 'PENDING'", [], (err, row: any) => {
      db.close();
      if (err) resolve(0);
      else resolve(row?.count || 0);
    });
  });
}

async function getSubstituteCount(memberId: string): Promise<number> {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);

  return new Promise((resolve) => {
    db.get(
      "SELECT COUNT(*) as count FROM LeaveRequest WHERE status = 'WARTE_VERTRETUNG' AND substituteId = ?",
      [memberId],
      (err, row: any) => {
        db.close();
        if (err) resolve(0);
        else resolve(row?.count || 0);
      }
    );
  });
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await initDb();
  const pendingCount = await getPendingCount();
  const principal = await getPrincipal();
  const substituteCount =
    principal?.role === "member" ? await getSubstituteCount(principal.id) : 0;
  const bossActive = principal?.role === "admin" || principal?.role === "boss";

  return (
    <html lang="de">
      <body className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <header className="border-b border-zinc-200 bg-white px-8 py-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-5xl items-center justify-between w-full">
            
            {/* Linke Seite: Logo und Navigation zusammen */}
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-3 hover:opacity-80">
                <div className="h-4 w-4 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xl font-bold tracking-tight">Urlaubs-Planer</span>
              </Link>
              
              {/* Globale Navigations-Links */}
              <nav className="flex items-center gap-5 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                <Link href="/" className="hover:text-emerald-500 transition-colors">Übersicht</Link>
                <Link href="/mitglieder" className="hover:text-emerald-500 transition-colors">Mitglieder</Link>
                <Link href="/abteilungen" className="hover:text-emerald-500 transition-colors">Abteilungen</Link>
                {principal?.role === "admin" && (
                  <Link href="/bosse" className="hover:text-emerald-500 transition-colors">Bosse</Link>
                )}
                <Link href="/urlaube" className="relative hover:text-emerald-500 transition-colors flex items-center gap-1.5">
                  <span>Urlaube</span>
                  {bossActive && pendingCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white shadow-sm">
                      {pendingCount}
                    </span>
                  )}
                  {substituteCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white shadow-sm">
                      {substituteCount}
                    </span>
                  )}
                </Link>
              </nav>
            </div>
            
            {/* Rechte Seite: Boss Mode Toggle */}
            <div className="flex items-center gap-4">
              <AdminToggle
                principalName={principal?.name ?? null}
                principalRole={principal?.role ?? null}
                onStaffLogin={handleStaffLogin}
                onMemberLogin={handleMemberLogin}
                onLogout={handleLogout}
              />
              <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest text-zinc-300 dark:text-zinc-600 border-l border-zinc-100 dark:border-zinc-800 pl-4">
                v2.1
              </span>
            </div>
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}