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
import { departmentSummary, todaysAttendance, weeklyAttendance } from "@/mocks/data";

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
  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Administration Dashboard"
        description={now ? `${formatIndiaDate(now)} · ${formatIndiaTime(now)} IST · Live` : "Live"}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Staff" value={184} hint="Across 6 departments" icon={Users} tone="primary" />
        <StatCard label="Present Today" value={172} hint="93.5% of workforce" icon={UserCheck} tone="success" />
        <StatCard label="Absent Today" value={12} hint="3 on approved leave" icon={UserX} tone="danger" />
        <StatCard label="Late" value={7} hint="After 9:10 AM window" icon={Clock} tone="warning" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Today's attendance" description="Latest marked entries">
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
                {todaysAttendance.map((r) => (
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
            {todaysAttendance.map((r) => (
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
        </Section>

        <Section title="Live campus status" description="Updated 2 minutes ago">
          <div className="space-y-3 p-5">
            <StatusRow icon={MapPinned} tone="success" label="Staff inside campus" value="172" />
            <StatusRow icon={UserX} tone="danger" label="Staff outside campus" value="12" />
            <StatusRow icon={AlertTriangle} tone="warning" label="Verification warnings" value="3" />
            <div className="rounded-lg border border-border bg-secondary/60 p-4 text-sm">
              <p className="font-medium">Boundary status</p>
              <p className="mt-1 text-muted-foreground">
                Geofence active across 4 institutional blocks. No boundary edits pending.
              </p>
            </div>
          </div>
        </Section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Attendance overview" description="Past 7 days">
          <div className="h-[300px] p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyAttendance}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
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
          <ul className="divide-y divide-border">
            {departmentSummary.map((d) => (
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
