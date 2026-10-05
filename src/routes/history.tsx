import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { AttendanceTable } from "@/components/common/AttendanceTable";
import { AttendanceDetailDialog } from "@/components/common/AttendanceDetailDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAttendance, type AttendanceRecord } from "@/hooks/use-attendance";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Attendance History — CampusAttend" },
      {
        name: "description",
        content:
          "Browse staff attendance history with status filters, search, sorting and a summary of present, late and absent days from authoritative records.",
      },
      { property: "og:title", content: "Attendance History — CampusAttend" },
      { property: "og:description", content: "Attendance records and summary." },
    ],
  }),
  component: HistoryPage,
});

const PAGE_SIZE = 15;

function HistoryPage() {
  const { records, availableMonths, isLoading, error, refresh } = useAttendance();

  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [query, setQuery] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [displayLimit, setDisplayLimit] = useState<number>(PAGE_SIZE);

  // Dialog state for viewing full record details
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);

  // Filter records based on month, date, status, search query
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      // Month filter
      if (selectedMonth !== "all") {
        const matchesMonth =
          r.rawDate?.startsWith(selectedMonth) ||
          r.created_at?.startsWith(selectedMonth);
        if (!matchesMonth) return false;
      }

      // Date filter (exact match e.g. "2026-10-04")
      if (date !== "") {
        const matchesDate =
          r.rawDate === date ||
          (r.created_at && r.created_at.startsWith(date)) ||
          r.date.toLowerCase().includes(date.toLowerCase());
        if (!matchesDate) return false;
      }

      // Status filter
      if (status !== "all" && r.status.toLowerCase() !== status.toLowerCase()) {
        return false;
      }

      // Search query (date, day, location, status, time, id)
      if (query.trim() !== "") {
        const searchTarget = `${r.id} ${r.date} ${r.day} ${r.location} ${r.status} ${r.time} ${r.verification}`.toLowerCase();
        if (!searchTarget.includes(query.toLowerCase().trim())) {
          return false;
        }
      }

      return true;
    });
  }, [records, selectedMonth, date, status, query]);

  // Sort records
  const sortedRecords = useMemo(() => {
    const list = [...filteredRecords];
    list.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (sortOrder === "newest") {
        return timeB - timeA;
      }
      return timeA - timeB;
    });
    return list;
  }, [filteredRecords, sortOrder]);

  // Paginated records for display
  const paginatedRecords = useMemo(() => {
    return sortedRecords.slice(0, displayLimit);
  }, [sortedRecords, displayLimit]);

  // Dynamic statistics computed from the filtered view
  const stats = useMemo(() => {
    const totalWorkingDays = Math.max(1, filteredRecords.length);
    const present = filteredRecords.filter((r) => r.status === "Present").length;
    const late = filteredRecords.filter((r) => r.status === "Late").length;
    const absent = filteredRecords.filter((r) => r.status === "Absent").length;
    const rate = Math.min(100, Math.round(((present + late) / totalWorkingDays) * 100));

    return {
      workingDays: totalWorkingDays,
      present,
      late,
      absent,
      rate,
    };
  }, [filteredRecords]);

  const handleRowClick = (record: AttendanceRecord) => {
    setSelectedRecord(record);
    setDetailOpen(true);
  };

  const handleResetFilters = () => {
    setSelectedMonth("all");
    setStatus("all");
    setDate("");
    setQuery("");
    setSortOrder("newest");
    setDisplayLimit(PAGE_SIZE);
  };

  const hasActiveFilters =
    selectedMonth !== "all" || status !== "all" || date !== "" || query !== "" || sortOrder !== "newest";

  return (
    <AppShell nav={staffNav} role="staff">
      {/* Attendance Detail Dialog */}
      <AttendanceDetailDialog
        record={selectedRecord}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      <PageHeader
        title="Attendance History"
        description="Complete chronological staff attendance records from database."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refresh();
                toast.success("Attendance history refreshed");
              }}
              disabled={isLoading}
              title="Refresh database records"
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                Clear filters
              </Button>
            )}
          </div>
        }
      />

      {/* Dynamic Summary Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Records"
          value={stats.workingDays}
          hint={selectedMonth === "all" ? "All recorded entries" : "Entries in selected period"}
          icon={CalendarDays}
          tone="primary"
          loading={isLoading}
        />
        <StatCard
          label="Present"
          value={stats.present}
          hint={stats.late > 0 ? `Includes ${stats.late} late entries` : "Marked present on time"}
          icon={CheckCircle2}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          label="Late / Absent"
          value={stats.late + stats.absent}
          hint={`${stats.late} late · ${stats.absent} absent`}
          icon={XCircle}
          tone={stats.absent > 0 ? "danger" : "warning"}
          loading={isLoading}
        />
        <StatCard
          label="Attendance Rate"
          value={`${stats.rate}%`}
          hint="Calculated from attendance records"
          icon={TrendingUp}
          tone="success"
          loading={isLoading}
        />
      </div>

      {/* Filter and Table Section */}
      <Section className="mt-6">
        <div className="grid gap-3 border-b border-border p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          {/* Month selector */}
          <div className="space-y-1.5">
            <Label htmlFor="month" className="text-xs font-medium">Month</Label>
            <Select value={selectedMonth} onValueChange={(val) => { setSelectedMonth(val); setDisplayLimit(PAGE_SIZE); }}>
              <SelectTrigger id="month" className="h-9 text-xs">
                <SelectValue placeholder="All months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All months</SelectItem>
                {availableMonths.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Picker */}
          <div className="space-y-1.5">
            <Label htmlFor="date" className="text-xs font-medium">Date</Label>
            <Input
              id="date"
              type="date"
              className="h-9 text-xs"
              value={date}
              onChange={(e) => { setDate(e.target.value); setDisplayLimit(PAGE_SIZE); }}
            />
          </div>

          {/* Status selector */}
          <div className="space-y-1.5">
            <Label htmlFor="status" className="text-xs font-medium">Status</Label>
            <Select value={status} onValueChange={(val) => { setStatus(val); setDisplayLimit(PAGE_SIZE); }}>
              <SelectTrigger id="status" className="h-9 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort order selector */}
          <div className="space-y-1.5">
            <Label htmlFor="sort" className="text-xs font-medium">Sort Order</Label>
            <Select value={sortOrder} onValueChange={(val: "newest" | "oldest") => setSortOrder(val)}>
              <SelectTrigger id="sort" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search bar */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="search" className="text-xs font-medium">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Date, location or ID…"
                className="h-9 pl-8 text-xs"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setDisplayLimit(PAGE_SIZE); }}
              />
            </div>
          </div>
        </div>

        {/* Results summary header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{paginatedRecords.length}</strong> of{" "}
            <strong className="text-foreground">{sortedRecords.length}</strong> records
            {hasActiveFilters && " (filtered)"}
          </span>
          <span className="hidden sm:inline">Tap any record to inspect full audit details</span>
        </div>

        {error ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-danger-soft text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <p className="mt-3 text-sm font-semibold">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Failed to connect to attendance database.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>
              <RefreshCw className="mr-2 size-3.5" /> Try Again
            </Button>
          </div>
        ) : (
          <AttendanceTable
            records={paginatedRecords}
            showDay
            isLoading={isLoading}
            onSelectRecord={handleRowClick}
          />
        )}

        {/* Pagination / Load More Controls */}
        {sortedRecords.length > displayLimit && (
          <div className="border-t border-border p-4 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisplayLimit((prev) => prev + PAGE_SIZE)}
              className="text-xs"
            >
              Load more records ({sortedRecords.length - displayLimit} remaining)
            </Button>
          </div>
        )}
      </Section>
    </AppShell>
  );
}
