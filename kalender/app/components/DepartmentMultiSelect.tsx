"use client";

import { useState } from "react";

export default function DepartmentMultiSelect({ allDepartments }: { allDepartments: { id: string, name: string }[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);

  const toggleDept = (deptId: string) => {
    setSelectedDepts(prev => 
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    );
  };

  return (
    <div className="relative">
      <div 
        className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm cursor-pointer dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedDepts.length > 0 ? `${selectedDepts.length} Abteilung(en) gewählt` : "-- Abteilung wählen --"}
      </div>
      
      {/* Hidden inputs to hold the selected values for the form submission */}
      {selectedDepts.map(deptId => (
        <input key={deptId} type="hidden" name="departmentIds" value={deptId} />
      ))}

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-40 overflow-y-auto dark:bg-zinc-900 dark:border-zinc-700">
          {allDepartments.map(dept => (
            <div 
              key={dept.id} 
              className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${selectedDepts.includes(dept.id) ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
              onClick={() => toggleDept(dept.id)}
            >
              {dept.name}
              {selectedDepts.includes(dept.id) && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
