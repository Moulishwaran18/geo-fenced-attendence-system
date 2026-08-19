import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, Search, TrendingUp, XCircle } from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { AttendanceTable } from "@/components/common/AttendanceTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recentAttendance } from "@/mocks/data";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Attendance History — CampusAttend" },
      {
        name: "description",
        content:
          "Browse monthly staff attendance history with status filters, search and a summary of present, late and absent days.",
      },
      { property: "og:title", content: "Attendance History — CampusAttend" },
      { property: "og:description", content: "Monthly attendance records and summary." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");

  const records = useMemo(
    () =>
      recentAttendance.filter(
        (r) =>
          (status === "all" || r.status.toLowerCase() === status) &&
          (query === "" ||
            `${r.date} ${r.location} ${r.status}`.toLowerCase().includes(query.toLowerCase())) &&
          (date === "" || r.date.startsWith(date.split("-")[2] ?? "")),
      ),
    [status, query, date],
  );

  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader title="Attendance History" description="August 2026 · Sona College of Technology" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Working Days" value={22} icon={CalendarDays} tone="primary" />
        <StatCard label="Present" value={21} hint="Includes 2 late entries" icon={CheckCircle2} tone="success" />
        <StatCard label="Absent" value={1} hint="13 Aug 2026" icon={XCircle} tone="danger" />
        <StatCard label="Attendance Rate" value="96%" hint="+2% vs July" icon={TrendingUp} tone="success" />
      </div>

      <Section className="mt-6">
        <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="month">Month</Label>
            <Select defaultValue="2026-08">
              <SelectTrigger id="month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2026-08">August 2026</SelectItem>
                <SelectItem value="2026-07">July 2026</SelectItem>
                <SelectItem value="2026-06">June 2026</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="search">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Date or location…"
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <AttendanceTable records={records} showDay />
      </Section>
    </AppShell>
  );
}
