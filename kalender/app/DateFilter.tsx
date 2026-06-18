"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

interface DateFilterProps {
  currentStartMonth: number;
  currentStartYear: number;
  currentEndMonth: number;
  currentEndYear: number;
}

export default function DateFilter({
  currentStartMonth,
  currentStartYear,
  currentEndMonth,
  currentEndYear,
}: DateFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const months = [
    { value: "0", label: "Januar" },
    { value: "1", label: "Februar" },
    { value: "2", label: "März" },
    { value: "3", label: "April" },
    { value: "4", label: "Mai" },
    { value: "5", label: "Juni" },
    { value: "6", label: "Juli" },
    { value: "7", label: "August" },
    { value: "8", label: "September" },
    { value: "9", label: "Oktober" },
    { value: "10", label: "November" },
    { value: "11", label: "Dezember" },
  ];

  const years = [2025, 2026, 2027, 2028];

  const [startMonth, setStartMonth] = useState(String(currentStartMonth));
  const [startYear, setStartYear] = useState(String(currentStartYear));
  const [endMonth, setEndMonth] = useState(String(currentEndMonth));
  const [endYear, setEndYear] = useState(String(currentEndYear));

  const handleApply = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("startMonth", startMonth);
    params.set("startYear", startYear);
    params.set("endMonth", endMonth);
    params.set("endYear", endYear);

    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      {/* VON */}
      <div className="flex items-center gap-1">
        <span className="text-zinc-400 font-medium">Von:</span>
        <select
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800 px-2 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={startYear}
          onChange={(e) => setStartYear(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800 px-2 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 focus:outline-none"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="text-zinc-400 font-medium px-0.5">bis</div>

      {/* BIS */}
      <div className="flex items-center gap-1">
        <select
          value={endMonth}
          onChange={(e) => setEndMonth(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800 px-2 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select
          value={endYear}
          onChange={(e) => setEndYear(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-zinc-50 dark:bg-zinc-950 dark:border-zinc-800 px-2 py-1.5 font-semibold text-zinc-700 dark:text-zinc-300 focus:outline-none"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={handleApply}
        className="ml-2 px-3 py-1.5 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
      >
        OK
      </button>
    </div>
  );
}