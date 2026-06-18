"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface DepartmentFilterProps {
  departments: string[];
  selectedDepartment: string;
}

export default function DepartmentFilter({ departments, selectedDepartment }: DepartmentFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    
    if (value === "Alle") {
      params.delete("department");
    } else {
      params.set("department", value);
    }
    
    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-3">
      <label htmlFor="department-select" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Abteilung:
      </label>
      <select
        id="department-select"
        value={selectedDepartment}
        onChange={handleChange}
        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 transition-colors"
      >
        {departments.map((dept) => (
          <option key={dept} value={dept}>
            {dept}
          </option>
        ))}
      </select>
    </div>
  );
}
