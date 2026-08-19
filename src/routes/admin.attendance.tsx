import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { departments, todaysAttendance } from "@/mocks/data";

export const Route = createFileRoute("/admin/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Records — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Review institution-wide staff attendance records by department, status and staff name for any working day.",
      },
      { property: "og:title", content: "Attendance Records — CampusAttend Admin" },
      { property: "og:description", content: "Institution-wide attendance records." },
    ],
  }),
  component: AdminAttendancePage,
});

function AdminAttendancePage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dept, setDept] = useState("all");

  const rows = useMemo(
    () =>
      todaysAttendance.filter(
        (r) =>
          (status === "all" || r.status.toLowerCase() === status) &&
          (dept === "all" || r.department === dept) &&
          `${r.name} ${r.staffId}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, status, dept],
  );

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Attendance"
        description="19 August 2026 · All departments"
        actions={
          <Button variant="outline" onClick={() => toast.success("CSV export queued (mock)")}>
            <Download className="mr-2 size-4" /> Export CSV
          </Button>
        }
      />

      <Section>
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
          <div className="relative">
            <label htmlFor="att-search" className="sr-only">Search staff</label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="att-search"
              className="pl-9"
              placeholder="Search staff…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger aria-label="Filter by department"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="present">Present</SelectItem>
              <SelectItem value="late">Late</SelectItem>
              <SelectItem value="absent">Absent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No records match" description="Try clearing the filters or search term." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                    {["Staff ID", "Name", "Department", "Time", "Location", "Status", "Verification"].map((h) => (
                      <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.staffId} className="border-b border-border last:border-0 hover:bg-muted/60">
                      <td className="px-5 py-3.5 font-mono text-xs">{r.staffId}</td>
                      <td className="px-5 py-3.5 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{r.department}</td>
                      <td className="px-5 py-3.5 tabular-nums">{r.time}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-muted-foreground">{r.location}</td>
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
              {rows.map((r) => (
                <li key={r.staffId} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.staffId} · {r.time}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </AppShell>
  );
}
