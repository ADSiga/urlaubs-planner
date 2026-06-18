"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getPublicHolidays } from "./actions_holidays";
import DepartmentFilter from "./DepartmentFilter";
import DateFilter from "./DateFilter";

interface LeaveRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  status: string;
  userName?: string;
  userDepartment?: string;
  substituteName?: string;
  userColor?: string;
}

interface CalendarGridProps {
  leaveRequests: LeaveRequest[];
  startMonth: number;
  startYear: number;
  endMonth: number;
  endYear: number;
  departments: string[];
  selectedDepartment: string;
}

export default function CalendarGrid({ 
  leaveRequests, 
  startMonth, 
  startYear, 
  endMonth, 
  endYear,
  departments,
  selectedDepartment
}: CalendarGridProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentDepartment = searchParams.get("department");
  const [publicHolidays, setPublicHolidays] = useState<Record<string, string>>({});

  useEffect(() => {
    getPublicHolidays().then(setPublicHolidays);
  }, []);

  // Hilfsfunktion: Generiert alle Monate im ausgewählten Zeitraum
  const getMonthsInRange = (sMonth: number, sYear: number, eMonth: number, eYear: number) => {
    const range = [];
    let month = sMonth;
    let year = sYear;

    while (year < eYear || (year === eYear && month <= eMonth)) {
      range.push({ month, year });
      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }
    return range;
  };

  const monthsToShow = getMonthsInRange(startMonth, startYear, endMonth, endYear);

  // Eindeutige Nutzer für die Legende extrahieren
  const uniqueUsers = Array.from(
    new Map(
      leaveRequests
        .filter(req => req.userName)
        .map(req => [req.userId, { name: req.userName, color: req.userColor || "#3B82F6" }])
    ).values()
  ).sort((a, b) => a.name!.localeCompare(b.name!));

  // Navigation URLs bauen (basiert auf dem Startmonat für Vor/Zurück)
  const buildNavigationUrl = (sMonth: number, sYear: number, eMonth: number, eYear: number) => {
    const params = new URLSearchParams();
    params.set("startMonth", sMonth.toString());
    params.set("startYear", sYear.toString());
    params.set("endMonth", eMonth.toString());
    params.set("endYear", eYear.toString());
    if (currentDepartment) params.set("department", currentDepartment);
    return `/?${params.toString()}`;
  };

  const handlePrevMonth = () => {
    let newStartMonth = startMonth - 1;
    let newStartYear = startYear;
    if (newStartMonth < 0) {
      newStartMonth = 11;
      newStartYear -= 1;
    }
    // Zeitraum-Breite beibehalten (Differenz berechnen)
    const monthDiff = (endYear - startYear) * 12 + (endMonth - startMonth);
    let newEndMonth = newStartMonth + monthDiff;
    let newEndYear = newStartYear;
    while (newEndMonth > 11) {
      newEndMonth -= 12;
      newEndYear += 1;
    }
    router.push(buildNavigationUrl(newStartMonth, newStartYear, newEndMonth, newEndYear));
  };

  const handleNextMonth = () => {
    let newStartMonth = startMonth + 1;
    let newStartYear = startYear;
    if (newStartMonth > 11) {
      newStartMonth = 0;
      newStartYear += 1;
    }
    const monthDiff = (endYear - startYear) * 12 + (endMonth - startMonth);
    let newEndMonth = newStartMonth + monthDiff;
    let newEndYear = newStartYear;
    while (newEndMonth > 11) {
      newEndMonth -= 12;
      newEndYear += 1;
    }
    router.push(buildNavigationUrl(newStartMonth, newStartYear, newEndMonth, newEndYear));
  };

  const getAbsencesForDay = (dayNumber: number, month: number, year: number) => {
    const currentCalendarDate = new Date(year, month, dayNumber);
    return leaveRequests.filter((req) => {
      const start = new Date(req.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(req.endDate);
      end.setHours(23, 59, 59, 999);
      return currentCalendarDate >= start && currentCalendarDate <= end;
    });
  };

  return (
    <div className="space-y-6">
      
      {/* Globale Navigation Bar oben drüber */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 shrink-0">Belegungsplan</h2>
            <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800 hidden lg:block" />
            
            <div className="flex flex-wrap items-center gap-4">
              <DepartmentFilter 
                departments={departments} 
                selectedDepartment={selectedDepartment} 
              />
              <DateFilter 
                currentStartMonth={startMonth} 
                currentStartYear={startYear} 
                currentEndMonth={endMonth}
                currentEndYear={endYear}
              />
            </div>
          </div>

          <div className="flex flex-row items-center gap-2 border-t border-zinc-100 pt-4 lg:border-t-0 lg:pt-0">
            <button 
              onClick={handlePrevMonth}
              className="!flex flex-row items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span>Zurück</span>
            </button>
            <button 
              onClick={() => router.push(currentDepartment ? `/?department=${currentDepartment}` : "/")}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Heute
            </button>
            <button 
              onClick={handleNextMonth}
              className="!flex flex-row items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              <span>Vor</span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Kompakter Jahres-Grid */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[1200px]">
            {/* Header: Tag-Nummern */}
            <div className="grid grid-cols-[140px_repeat(31,1fr)] border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
              <div className="p-3 font-bold text-zinc-500 border-r border-zinc-200 dark:border-zinc-800">
                Monat
              </div>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <div key={day} className="p-2 text-center text-[10px] font-bold text-zinc-400 border-r border-zinc-100 dark:border-zinc-800/50 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>

            {/* Zeilen: Monate */}
            {monthsToShow.map(({ month, year }) => {
              const monthName = new Date(year, month).toLocaleDateString("de-DE", { month: "long" });
              const totalDays = new Date(year, month + 1, 0).getDate();

              return (
                <div key={`${year}-${month}`} className="grid grid-cols-[140px_repeat(31,1fr)] border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/30 transition-colors">
                  <div className="p-3 font-semibold text-sm text-zinc-900 dark:text-zinc-100 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/30 flex items-center">
                    {monthName}
                  </div>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                    if (day > totalDays) {
                      return <div key={day} className="bg-zinc-50/50 dark:bg-zinc-900/20 border-r border-zinc-100/50 dark:border-zinc-800/30 last:border-r-0" />;
                    }

                    const absences = getAbsencesForDay(day, month, year);
                    const currentCalendarDate = new Date(year, month, day);
                    const dayOfWeek = currentCalendarDate.getDay(); 
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const holidayName = publicHolidays[dateStr];
                    const isHoliday = !!holidayName;

                    let bgClass = "bg-white dark:bg-zinc-900";
                    if (isHoliday) bgClass = "bg-blue-50/50 dark:bg-blue-900/20";
                    else if (isWeekend) bgClass = "bg-zinc-100/30 dark:bg-zinc-800/20";

                    return (
                      <div 
                        key={day} 
                        className={`relative min-h-[42px] border-r border-zinc-100 dark:border-zinc-800 last:border-r-0 flex flex-col gap-0.5 p-1 ${bgClass}`}
                        title={isHoliday ? holidayName : absences.map(a => `${a.userName}${a.substituteName ? ` (Vertretung: ${a.substituteName})` : ''}`).join(', ')}
                      >
                        {isHoliday && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                            <span className="text-[6px] font-bold text-blue-600 dark:text-blue-400 rotate-45 truncate px-1">
                              {holidayName}
                            </span>
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5 relative z-10 max-h-[34px] overflow-y-auto">
                          {absences.map((abs) => (
                            <div 
                              key={abs.id} 
                              className="h-1.5 w-full rounded-full shadow-sm shrink-0"
                              style={{ backgroundColor: abs.userColor || "#3B82F6" }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legende der Mitarbeiter */}
      {uniqueUsers.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-4">Legende</h3>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {uniqueUsers.map((user) => (
              <div key={user.name} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full shadow-sm" 
                  style={{ backgroundColor: user.color }}
                />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {user.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
