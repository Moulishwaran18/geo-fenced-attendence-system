import { useEffect, useState, useCallback, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIndiaDate, formatIndiaTime } from "@/lib/india-time";

export const Route = createFileRoute("/admin/audit-logs")({
  head: () => ({
    meta: [
      { title: "Face Detection Audit Logs — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Authoritative server audit logs of successful face recognition and identity authentication events.",
      },
      { property: "og:title", content: "Face Detection Audit Logs — CampusAttend Admin" },
      { property: "og:description", content: "Server-side biometric detection event records." },
    ],
  }),
  component: AdminAuditLogsPage,
});

interface AuditLogRecord {
  id: string;
  user_id: string;
  name: string;
  email: string;
  detected_at: string;
  server_date: string;
  server_time: string;
  created_at: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [pageSize, setPageSize] = useState("10");

  const fetchLogs = useCallback(
    async (pageToLoad: number = 1) => {
      setIsLoading(true);
      try {
        const queryParams = new URLSearchParams();
        queryParams.set("page", String(pageToLoad));
        queryParams.set("limit", pageSize);
        if (search.trim()) queryParams.set("search", search.trim());
        if (dateFilter) queryParams.set("date", dateFilter);

        const res = await fetch(`/api/face-detection-log?${queryParams.toString()}`);
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }
        const json = await res.json();
        if (json.success) {
          setLogs(json.data || []);
          if (json.pagination) {
            setPagination(json.pagination);
          }
        } else {
          throw new Error(json.error || "Failed to load audit logs");
        }
      } catch (err) {
        console.error("Audit logs fetch notice:", err);
        toast.error("Could not load audit logs. Check server connection.");
      } finally {
        setIsLoading(false);
      }
    },
    [search, dateFilter, pageSize],
  );

  useEffect(() => {
    void fetchLogs(1);
  }, [fetchLogs]);

  // Unique users count calculation from loaded records
  const uniqueUsersCount = useMemo(() => {
    const set = new Set(logs.map((l) => l.user_id));
    return set.size;
  }, [logs]);

  // Format timestamp helper
  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return iso;
    }
  };

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Face Detection Audit Logs"
        description="Immutable server-side audit logs recorded upon every successful registered user face authentication."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchLogs(pagination.page)}
            disabled={isLoading}
          >
            <RefreshCw className={`mr-2 size-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {/* Metrics Banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Logged Events"
          value={String(pagination.total)}
          hint="Server-verified authentications"
          icon={Activity}
          tone="primary"
        />
        <StatCard
          label="Unique Users (Current Page)"
          value={String(uniqueUsersCount)}
          hint="Authenticated staff identities"
          icon={Users}
          tone="success"
        />
        <StatCard
          label="Latest Authenticated Event"
          value={logs[0]?.server_time ? logs[0].server_time.slice(0, 8) : "—"}
          hint={logs[0]?.server_date ? `${logs[0].server_date} IST` : "No recent activity"}
          icon={Clock}
          tone="primary"
        />
      </div>

      <Section className="mt-6">
        {/* Search & Filters */}
        <div className="grid gap-3 border-b border-border p-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <label htmlFor="log-search" className="sr-only">
              Search by user ID, name, or email
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="log-search"
              className="pl-9"
              placeholder="Search user ID, staff name, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchLogs(1);
              }}
            />
          </div>

          <div className="relative">
            <label htmlFor="log-date" className="sr-only">
              Filter by date
            </label>
            <Input
              id="log-date"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={pageSize}
              onValueChange={(val) => {
                setPageSize(val);
              }}
            >
              <SelectTrigger aria-label="Page size">
                <SelectValue placeholder="Page size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 per page</SelectItem>
                <SelectItem value="25">25 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
              </SelectContent>
            </Select>

            {(search || dateFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setDateFilter("");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Audit Log Table */}
        {logs.length === 0 ? (
          <EmptyState
            title="No face detection audit logs found"
            description={
              search || dateFilter
                ? "No audit records match your search or date filter. Try clearing filters."
                : "No face authentication logs have been recorded yet. Complete a face scan to generate an audit log."
            }
          />
        ) : (
          <>
            {/* Desktop / Tablet Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Face detection audit logs</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    <th scope="col" className="px-5 py-3.5">User ID</th>
                    <th scope="col" className="px-5 py-3.5">Name</th>
                    <th scope="col" className="px-5 py-3.5">Email</th>
                    <th scope="col" className="px-5 py-3.5">Detection Date</th>
                    <th scope="col" className="px-5 py-3.5">Detection Time</th>
                    <th scope="col" className="px-5 py-3.5">Server Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-5 py-3.5 font-mono text-xs font-semibold text-primary">
                        <Badge variant="outline" className="font-mono bg-primary/5 text-primary border-primary/20">
                          {log.user_id}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-foreground">
                        {log.name}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground font-mono">
                        {log.email}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground tabular-nums">
                        {log.server_date}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono font-medium text-foreground tabular-nums">
                        {log.server_time.slice(0, 8)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-muted-foreground tabular-nums font-mono">
                        {log.detected_at}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <ul className="divide-y divide-border md:hidden">
              {logs.map((log) => (
                <li key={log.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-primary">
                      {log.user_id}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {log.server_time.slice(0, 8)}
                    </Badge>
                  </div>
                  <div className="font-medium text-sm text-foreground">{log.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{log.email}</div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                    <span>Date: {log.server_date}</span>
                    <span className="font-mono">{formatTimestamp(log.detected_at)}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-border px-5 py-3.5 text-sm text-muted-foreground">
              <div>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {logs.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0}
                </span>{" "}
                to{" "}
                <span className="font-medium text-foreground">
                  {Math.min(pagination.page * pagination.limit, pagination.total)}
                </span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{pagination.total}</span> records
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1 || isLoading}
                  onClick={() => void fetchLogs(pagination.page - 1)}
                >
                  <ChevronLeft className="size-4" /> Previous
                </Button>
                <span className="text-xs font-medium px-2">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages || isLoading}
                  onClick={() => void fetchLogs(pagination.page + 1)}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Section>
    </AppShell>
  );
}
