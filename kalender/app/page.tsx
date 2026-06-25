import Link from "next/link";
import CalendarGrid from "./CalendarGrid";
import { queryDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

interface DbLeaveRequest {
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

export default async function Home(props: {
  searchParams: Promise<{ 
    startMonth?: string; 
    startYear?: string; 
    endMonth?: string; 
    endYear?: string; 
    department?: string 
  }>;
}) {
  const searchParams = await props.searchParams;
  
  // Defaults setzen (Wenn nichts da ist, standardmäßig das ganze Jahr 2026 anzeigen)
  const currentStartMonth = searchParams.startMonth ? parseInt(searchParams.startMonth, 10) : 0;
  const currentStartYear = searchParams.startYear ? parseInt(searchParams.startYear, 10) : 2026;
  const currentEndMonth = searchParams.endMonth ? parseInt(searchParams.endMonth, 10) : 11;
  const currentEndYear = searchParams.endYear ? parseInt(searchParams.endYear, 10) : currentStartYear;
  
  const selectedDepartment = searchParams.department || "Alle";

  // Berechnen der ISO-Strings für die SQLite WHERE-Klausel (0-basiert zu 1-basiert konvertieren für ISO-Format)
  const startIsoMonth = String(currentStartMonth + 1).padStart(2, "0");
  const endIsoMonth = String(currentEndMonth + 1).padStart(2, "0");
  
  const rangeStart = `${currentStartYear}-${startIsoMonth}-01`;
  const lastDayOfEndMonth = new Date(currentEndYear, currentEndMonth + 1, 0).getDate();
  const rangeEnd = `${currentEndYear}-${endIsoMonth}-${String(lastDayOfEndMonth).padStart(2, '0')}`;

  // SQL-Query mit intelligenter Datumsüberschneidung
  let query = `
    SELECT lr.*, u.name as userName, u.color as userColor, GROUP_CONCAT(d.name) as userDepartment, s.name as substituteName
    FROM LeaveRequest lr
    LEFT JOIN User u ON lr.userId = u.id
    LEFT JOIN User s ON lr.substituteId = s.id
    LEFT JOIN UserDepartment ud ON u.id = ud.userId
    LEFT JOIN Department d ON ud.departmentId = d.id
    WHERE (lr.startDate <= ? AND lr.endDate >= ?)
    GROUP BY lr.id
  `;
  const params: any[] = [rangeEnd, rangeStart];

  if (selectedDepartment !== "Alle") {
    query = `
      SELECT lr.*, u.name as userName, u.color as userColor, GROUP_CONCAT(d.name) as userDepartment, s.name as substituteName
      FROM LeaveRequest lr
      LEFT JOIN User u ON lr.userId = u.id
      LEFT JOIN User s ON lr.substituteId = s.id
      LEFT JOIN UserDepartment ud ON u.id = ud.userId
      LEFT JOIN Department d ON ud.departmentId = d.id
      WHERE (lr.startDate <= ? AND lr.endDate >= ?)
      AND lr.userId IN (SELECT userId FROM UserDepartment ud2 JOIN Department d2 ON ud2.departmentId = d2.id WHERE d2.name = ?)
      GROUP BY lr.id
    `;
    params.push(selectedDepartment);
  }

  query += ` ORDER BY lr.startDate ASC`;

  const leaveRequests = await queryDatabase<DbLeaveRequest>(query, params);
  
  // Abteilungen dynamisch aus der Datenbank laden
  const dbDepts = await queryDatabase<{ name: string }>("SELECT name FROM Department ORDER BY name ASC");
  const departments = ["Alle", ...dbDepts.map(d => d.name)];

  return (
    <main className="mx-auto max-w-full px-6 py-6">
      <div className="space-y-6">
        
        {/* Kalender-Grid */}
        <CalendarGrid 
          leaveRequests={leaveRequests} 
          startMonth={currentStartMonth}
          startYear={currentStartYear}
          endMonth={currentEndMonth}
          endYear={currentEndYear}
          departments={departments}
          selectedDepartment={selectedDepartment}
        />
      </div>
    </main>
  );
}
