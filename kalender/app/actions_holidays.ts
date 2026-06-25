"use server";

import { queryDatabase } from "@/lib/db";

export async function getPublicHolidays() {
  const rows = await queryDatabase<{ date: string; name: string }>(
    "SELECT date, name FROM PublicHoliday"
  );
  const holidays: Record<string, string> = {};
  for (const r of rows) {
    holidays[r.date] = r.name.replace("Koenige", "Könige");
  }
  return holidays;
}
