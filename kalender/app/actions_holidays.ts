"use server";

import path from "path";
import sqlite3 from "sqlite3";

export async function getPublicHolidays() {
  const dbPath = path.resolve(process.cwd(), "../dev.db");
  const sqlite = sqlite3.verbose();
  const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY);
  
  return new Promise<Record<string, string>>((resolve, reject) => {
    db.all("SELECT date, name FROM PublicHoliday", [], (err, rows: any[]) => {
      db.close();
      if (err) reject(err);
      else {
        const holidays: Record<string, string> = {};
        rows.forEach(r => {
            holidays[r.date] = r.name.replace('Koenige', 'Könige');
        });
        resolve(holidays);
      }
    });
  });
}
