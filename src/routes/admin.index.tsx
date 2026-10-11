import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatIndiaDate, formatIndiaTime, useIndiaTime } from "@/lib/india-time";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Clock, MapPinned, UserCheck, UserX, Users } from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { getAdminAuthHeaders } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — CampusAttend" },
      {
        name: "description",
        content:
          "College administration overview: staff present today, absentees, late entries, department summary and live campus status.",
      },
      { property: "og:title", content: "Admin Dashboard — CampusAttend" },
      { property: "og:description", content: "Institution-wide staff attendance overview." },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const now = useIndiaTime();
  const [totalStaff, setTotalStaff] = useState<number>(0);
  const [liveRows, setLiveRows] = useState<any[]>([]);
  const [deptStats, setDeptStats] = useState<{ department: string; present: number; total: number; rate: number }[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ day: string; present: number; absent: number }[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadDashboardData() {
      setIsLoading(true);
      try {
        const todayIST = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());

        // 1. Fetch registered staff count & departments
        const { data: staffList } = await supabase
          .from("staff")
          .select("id, staff_code, name, department, active")
          .eq("active", true);

        const count = staffList ? staffList.length : 0;
        setTotalStaff(count);

        // 2. Fetch today's real attendance records
        let records: any[] = [];
        try {
          const headers = { Accept: "application/json", ...getAdminAuthHeaders() };
          const res = await fetch(`/api/attendance?limit=100&date=${todayIST}`, {
            headers,
            credentials: "include",
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.records)) {
              records = json.records;
            }
          }
        } catch {}

        if (records.length === 0) {
          const { data: dbData } = await supabase
            .from("attendance_records")
            .select("*")
            .eq("date", todayIST)
            .order("created_at", { ascending: false });
          if (dbData) records = dbData;
        }

        const mapped = records.map((r: any) => ({
          staffId: r.staff_code,
          name: r.staff_name,
          department: r.department,
          time: r.time,
          location: r.location || "Main Campus",
          status: r.status,
          verification: r.verification,
        }));
        setLiveRows(mapped);

        // 3. Dynamic Department Summary
        const deptMap: Record<string, { total: number; present: number }> = {};
        (staffList || []).forEach((s) => {
          const d = s.department || "General";
          if (!deptMap[d]) deptMap[d] = { total: 0, present: 0 };
          deptMap[d]!.total++;
        });

        records.forEach((r) => {
          const d = r.department || "General";
          if (deptMap[d]) {
            if (r.status === "Present" || r.status === "Late") deptMap[d]!.present++;
          } else {
            deptMap[d] = { total: 1, present: 1 };
          }
        });

        const calculatedDepts = Object.entries(deptMap).map(([deptName, s]) => ({
          department: deptName,
          present: s.present,
          total: s.total,
          rate: s.total > 0 ? Math.min(100, Math.round((s.present / s.total) * 100)) : 0,
        }));
        setDeptStats(calculatedDepts);

        // 4. Past 7 days attendance overview
        const { data: past7Records } = await supabase
          .from("attendance_records")
          .select("date, day, status")
          .order("date", { ascending: false })
          .limit(300);

        const daysList: { day: string; present: number; absent: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dStr = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(d);
          const dayName = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
          const dayRows = (past7Records || []).filter((r) => r.date === dStr);
          const pres = dayRows.filter((r) => r.status === "Present" || r.status === "Late").length;
          const abs = Math.max(0, count - pres);
          daysList.push({ day: dayName, present: pres, absent: abs });
        }
        setWeeklyData(daysList);
      } finally {
        setIsLoading(false);
      }
    }
    void loadDashboardData();
  }, []);

  const presentToday = useMemo(
    () => liveRows.filter((r) => r.status === "Present").length,
    [liveRows],
  );
  const lateToday = useMemo(
    () => liveRows.filter((r) => r.status === "Late").length,
    [liveRows],
  );
  const absentToday = useMemo(
    () => Math.max(0, totalStaff - (presentToday + lateToday)),
    [totalStaff, presentToday, lateToday],
  );
  const warningsCount = useMemo(
    () => liveRows.filter((r) => r.verification && r.verification !== "Verified").length,
    [liveRows],
  );
  const presenceRateText = useMemo(() => {
    if (totalStaff === 0) return "0% of registered workforce";
    const pct = ((presentToday + lateToday) / totalStaff) * 100;
    return `${pct.toFixed(1)}% of workforce`;
  }, [totalStaff, presentToday, lateToday]);

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Administration Dashboard"
        description={now ? `${formatIndiaDate(now)} · ${formatIndiaTime(now)} IST · Live` : "Live"}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Staff"
          value={totalStaff}
          hint={deptStats.length > 0 ? `Across ${deptStats.length} departments` : "Registered accounts"}
          icon={Users}
          tone="primary"
        />
        <StatCard
          label="Present Today"
          value={presentToday}
          hint={presenceRateText}
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          label="Absent Today"
          value={absentToday}
          hint={absentToday === 0 ? "Full attendance" : "Pending or away"}
          icon={UserX}
          tone="danger"
        />
        <StatCard
          label="Late"
          value={lateToday}
          hint={lateToday > 0 ? "Logged after standard window" : "Zero late entries"}
          icon={Clock}
          tone="warning"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Today's attendance" description="Authoritative recorded entries">
          {liveRows.length > 0 ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                      {["Staff ID", "Name", "Department", "Time", "Location", "Status", "Verification"].map((h) => (
                        <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {liveRows.map((r) => (
                      <tr key={r.staffId} className="border-b border-border last:border-0 hover:bg-muted/60">
                        <td className="px-5 py-3.5 font-mono text-xs">{r.staffId}</td>
                        <td className="px-5 py-3.5 font-medium whitespace-nowrap">{r.name}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{r.department}</td>
                        <td className="px-5 py-3.5 tabular-nums">{r.time}</td>
                        <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap">{r.location}</td>
                        <td className="px-5 py-3.5"><StatusBadge status={r.status} /></td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={r.verification} tone={r.verification === "Warning" ? "warning" : undefined} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border md:hidden">
                {liveRows.map((r) => (
                  <li key={r.staffId} className="flex items-start justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.staffId} · {r.time}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.location}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {isLoading ? "Loading attendance records from database…" : "No attendance records recorded yet today."}
            </div>
          )}
        </Section>

        <Section title="Live campus status" description="Real-time verified status">
          <div className="space-y-3 p-5">
            <StatusRow icon={MapPinned} tone="success" label="Staff inside campus" value={String(presentToday)} />
            <StatusRow icon={UserX} tone="danger" label="Staff outside campus" value={String(absentToday)} />
            <StatusRow icon={AlertTriangle} tone="warning" label="Verification warnings" value={String(warningsCount)} />
            <div className="rounded-lg border border-border bg-secondary/60 p-4 text-sm">
              <p className="font-medium">Boundary status</p>
              <p className="mt-1 text-muted-foreground">
                Authoritative 13-point campus polygon geofence active. Server network gate enabled.
              </p>
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Attendance overview" description="Past 7 days from database">
          <div className="h-[300px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="present" name="Present" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="absent" name="Absent" fill="var(--chart-4)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Department summary">
          {deptStats.length > 0 ? (
            <ul className="divide-y divide-border">
              {deptStats.map((d) => (
                <li key={d.department} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{d.department}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.present}/{d.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${d.rate}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No registered staff departments found.
            </div>
          )}
        </Section>
      </div>
    </AppShell>
  );
}

function StatusRow({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Users;
  tone: "success" | "danger" | "warning";
  label: string;
  value: string;
}) {
  const tones = {
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-destructive",
    warning: "bg-warning-soft text-warning-foreground",
  };
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <span className={`grid size-9 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon className="size-4.5" aria-hidden />
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="ml-auto text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
