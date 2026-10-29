import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, RefreshCw, Search } from "lucide-react";
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
import { departments } from "@/mocks/data";
import { formatIndiaDate, useIndiaTime } from "@/lib/india-time";
import { getAdminAuthHeaders } from "@/lib/admin-auth";
import { supabase } from "@/lib/supabase";

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

interface DisplayAttendanceRow {
  staffId: string;
  name: string;
  department: string;
  time: string;
  date?: string;
  location: string;
  status: "Present" | "Late" | "Absent";
  verification: "Verified" | "Failed" | "Manual" | "Warning";
}

function AdminAttendancePage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dept, setDept] = useState("all");
  const [dbRecords, setDbRecords] = useState<DisplayAttendanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const now = useIndiaTime(60000);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      let fetched: any[] | null = null;

      // 1. Fetch from serverless API with admin auth
      try {
        const headers = {
          Accept: "application/json",
          ...getAdminAuthHeaders(),
        };
        const res = await fetch("/api/attendance?limit=200", {
          headers,
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.records)) {
            fetched = json.records;
          }
        }
      } catch (e) {
        console.warn("[AdminAttendance] /api/attendance notice:", e);
      }

      // 2. Direct Supabase fallback (graceful fail-safe)
      if (!fetched) {
        try {
          const { data, error } = await supabase
            .from("attendance_record")
            .select("*")
            .order("date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(200);

          if (!error && data) {
            fetched = data;
          }
        } catch {}
      }

      if (fetched && fetched.length > 0) {
        const mapped: DisplayAttendanceRow[] = fetched.map((r) => ({
          staffId: r.staff_code,
          name: r.staff_name,
          department: r.department,
          time: r.time,
          date: r.date,
          location: r.location || "Main Campus, Sona College",
          status: (r.status as "Present" | "Late" | "Absent") || "Present",
          verification: (r.verification as any) || "Verified",
        }));
        setDbRecords(mapped);
      } else {
        setDbRecords([]);
      }
    } catch (err: any) {
      console.error("[AdminAttendance] Error fetching records:", err);
      toast.error("Failed to load records from database.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const effectiveSource = useMemo(() => {
    return dbRecords;
  }, [dbRecords]);

  const rows = useMemo(
    () =>
      effectiveSource.filter(
        (r) =>
          (status === "all" || r.status.toLowerCase() === status.toLowerCase()) &&
          (dept === "all" || r.department === dept) &&
          `${r.name} ${r.staffId}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [effectiveSource, query, status, dept],
  );

  const handleExportCsv = () => {
    if (rows.length === 0) {
      toast.error("No records available to export.");
      return;
    }
    const header = ["Staff ID", "Name", "Department", "Date", "Time", "Location", "Status", "Verification"];
    const csvRows = rows.map((r) => [
      r.staffId,
      `"${r.name}"`,
      `"${r.department}"`,
      r.date || "Today",
      r.time,
      `"${r.location}"`,
      r.status,
      r.verification,
    ]);
    const csvContent = [header.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `campusattend-attendance-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} records to CSV`);
  };

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Attendance"
        description={
          now
            ? `${formatIndiaDate(now, false)} · Authoritative Database Records (${dbRecords.length} live)`
            : "Authoritative Database Records"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await fetchRecords();
                toast.success("Attendance records refreshed");
              }}
              disabled={isLoading}
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="mr-1.5 size-3.5" /> Export CSV
            </Button>
          </div>
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
