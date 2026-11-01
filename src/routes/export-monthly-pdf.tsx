import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  FileDown,
  FileText,
  Filter,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav, adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAttendance } from "@/hooks/use-attendance";
import { useActiveStaff } from "@/lib/staff-auth";
import { useAdminAuth } from "@/lib/admin-auth";
import { currentStaff, staffDirectory } from "@/mocks/data";
import {
  downloadMonthlyAttendancePdf,
  computeMonthlyAttendanceRows,
  formatIndiaDateTime,
  openDownloadedPdf,
  isNativeAndroid,
  type MonthlyPdfDownloadResult,
} from "@/lib/attendance-pdf-export";

export const Route = createFileRoute("/export-monthly-pdf")({
  head: () => ({
    meta: [
      { title: "Export Monthly Attendance PDF — CampusAttend" },
      {
        name: "description",
        content:
          "Generate and download official A4 monthly attendance reports for institutional records with daily attendance breakdown and statistics.",
      },
      { property: "og:title", content: "Export Monthly Attendance PDF — CampusAttend" },
      {
        property: "og:description",
        content: "Authoritative monthly staff attendance PDF generator.",
      },
    ],
  }),
  component: ExportMonthlyPdfPage,
});

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const YEARS = [2024, 2025, 2026, 2027];

function ExportMonthlyPdfPage() {
  const activeStaff = useActiveStaff();
  const { authenticated: isAdmin } = useAdminAuth();

  // Current date defaults (November 2026)
  const today = useMemo(() => new Date(), []);
  const defaultMonth = today.getMonth() + 1; // 1-12
  const defaultYear = today.getFullYear(); // 2026

  const [selectedMonth, setSelectedMonth] = useState<number>(defaultMonth);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedStaffId, setSelectedStaffId] = useState<string>(
    activeStaff?.staffId || currentStaff.staffId || "SCT-2417",
  );
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadResult, setDownloadResult] = useState<MonthlyPdfDownloadResult | null>(null);

  // If user is ordinary staff, enforce their own staff code strictly
  const effectiveStaffCode = isAdmin
    ? selectedStaffId
    : activeStaff?.staffId || currentStaff.staffId || "SCT-2417";

  // Resolve staff metadata
  const selectedStaffMember = useMemo(() => {
    if (isAdmin) {
      const found = staffDirectory.find((s) => s.id === effectiveStaffCode);
      if (found) {
        return {
          staffId: found.id,
          name: found.name,
          department: found.department,
          designation: found.designation,
        };
      }
    }
    return {
      staffId: effectiveStaffCode,
      name: activeStaff?.name || currentStaff.name || "Staff Member",
      department: activeStaff?.department || currentStaff.department || "Computer Science & Engineering",
      designation: activeStaff?.designation || currentStaff.designation || "Faculty",
    };
  }, [isAdmin, effectiveStaffCode, activeStaff]);

  // Fetch actual attendance records for this staff member
  const { records, isLoading, error, refresh } = useAttendance(effectiveStaffCode);

  // Compute monthly rows and summary statistics
  const { rows, summary, maxDay } = useMemo(() => {
    return computeMonthlyAttendanceRows({
      staffCode: selectedStaffMember.staffId,
      staffName: selectedStaffMember.name,
      department: selectedStaffMember.department,
      year: selectedYear,
      month: selectedMonth,
      records,
      currentDate: today,
    });
  }, [selectedStaffMember, selectedYear, selectedMonth, records, today]);

  const selectedMonthName = MONTHS.find((m) => m.value === selectedMonth)?.label || "Selected Month";

  const handleDownloadPdf = async () => {
    try {
      setIsDownloading(true);
      const res = await downloadMonthlyAttendancePdf({
        staffCode: selectedStaffMember.staffId,
        staffName: selectedStaffMember.name,
        department: selectedStaffMember.department,
        designation: selectedStaffMember.designation,
        year: selectedYear,
        month: selectedMonth,
        records,
        institutionName: "Sona College of Technology",
        currentDate: today,
      });

      setDownloadResult(res);

      if (res.isNative) {
        toast.success("PDF Saved to Downloads", {
          description: `${res.filename} saved to ${res.location || "Internal Storage/Download/CampusAttend"}`,
          action: {
            label: "Open PDF",
            onClick: () => {
              openDownloadedPdf(res.uri);
            },
          },
          duration: 9000,
        });
      } else {
        toast.success("Attendance Report Downloaded", {
          description: `${res.filename} (${res.summary.formattedPercentage} attendance)`,
          duration: 5000,
        });
      }
    } catch (err: any) {
      console.error("[ExportMonthlyPdfPage] Download error:", err);
      toast.error("Failed to generate PDF", {
        description: err?.message || "Please check your network and try again.",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <AppShell nav={isAdmin ? adminNav : staffNav} role={isAdmin ? "admin" : "staff"}>
      <PageHeader
        title="Export Monthly Attendance PDF"
        description="Generate, preview, and download authoritative monthly staff attendance reports formatted for institutional compliance and recordkeeping."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              id="top-download-pdf-btn"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isDownloading || isLoading}
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <FileDown className="size-3.5" />
                  Download PDF
                </>
              )}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Configuration Card */}
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Month Selector */}
              <div className="space-y-1.5">
                <Label htmlFor="month-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Month
                </Label>
                <Select
                  value={selectedMonth.toString()}
                  onValueChange={(val) => setSelectedMonth(parseInt(val, 10))}
                >
                  <SelectTrigger id="month-select" className="w-full">
                    <SelectValue placeholder="Select Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={m.value.toString()}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Year Selector */}
              <div className="space-y-1.5">
                <Label htmlFor="year-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Year
                </Label>
                <Select
                  value={selectedYear.toString()}
                  onValueChange={(val) => setSelectedYear(parseInt(val, 10))}
                >
                  <SelectTrigger id="year-select" className="w-full">
                    <SelectValue placeholder="Select Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Staff Member Selector (Admin only; Locked to self for staff) */}
              <div className="space-y-1.5">
                <Label htmlFor="staff-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Staff Member
                </Label>
                {isAdmin ? (
                  <Select
                    value={effectiveStaffCode}
                    onValueChange={(val) => setSelectedStaffId(val)}
                  >
                    <SelectTrigger id="staff-select" className="w-full">
                      <SelectValue placeholder="Select Staff" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffDirectory.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center justify-between rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground">
                    <span className="truncate font-medium">{selectedStaffMember.name}</span>
                    <Badge variant="outline" className="ml-2 gap-1 text-[11px] font-mono text-muted-foreground">
                      <Lock className="size-2.5" />
                      {selectedStaffMember.staffId}
                    </Badge>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Action Button */}
            <div className="shrink-0 pt-1">
              <Button
                id="selection-card-download-pdf-btn"
                onClick={handleDownloadPdf}
                disabled={isDownloading || isLoading}
                className="w-full sm:w-auto h-9 gap-2 font-medium"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating PDF…
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    Download {selectedMonthName} {selectedYear} PDF
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Active Metadata Banner */}
          <div className="mt-5 rounded-xl border border-border/50 bg-muted/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
              <span>
                Institution: <strong className="text-foreground">Sona College of Technology</strong>
              </span>
              <span>•</span>
              <span>
                Staff: <strong className="text-foreground">{selectedStaffMember.name}</strong> ({selectedStaffMember.staffId})
              </span>
              <span>•</span>
              <span>
                Department: <strong className="text-foreground">{selectedStaffMember.department}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <ShieldCheck className="size-4" />
              <span>Standard A4 Printable PDF</span>
            </div>
          </div>
        </div>

        {/* Download Success Banner */}
        {downloadResult && (
          <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 sm:flex-row sm:items-center sm:justify-between text-sm shadow-sm animate-in fade-in-50">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-950 dark:text-emerald-200">
                  Monthly Attendance PDF Saved Successfully
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300 font-mono mt-0.5 break-all">
                  {downloadResult.filename}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Location: <span className="font-semibold text-foreground">{downloadResult.location || "Internal Storage/Download/CampusAttend"}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDownloadedPdf(downloadResult.uri)}
                className="gap-1.5 border-emerald-600/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/15"
              >
                <FileText className="size-3.5" />
                Open PDF
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDownloadResult(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {/* Monthly Summary Statistics Cards */}
        <Section title="Monthly Statistics Summary">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Applicable Working Days"
              value={summary.applicableWorkingDays}
              hint={`Excludes weekends & future dates`}
              icon={CalendarDays}
              tone="primary"
            />
            <StatCard
              label="Total Present Days"
              value={summary.presentDays}
              hint="Verified attendance records"
              tone={summary.presentDays > 0 ? "success" : "neutral"}
              icon={CheckCircle2}
            />
            <StatCard
              label="Total Absent Days"
              value={summary.absentDays}
              hint="Unrecorded working days"
              tone={summary.absentDays > 0 ? "danger" : "neutral"}
              icon={XCircle}
            />
            <StatCard
              label="Attendance Percentage"
              value={summary.formattedPercentage}
              hint="(Present ÷ Working Days) × 100"
              tone={summary.attendancePercentage >= 80 ? "success" : summary.attendancePercentage >= 60 ? "warning" : "danger"}
              icon={FileText}
            />
          </div>
        </Section>

        {/* Daily Breakdown Table Live Preview */}
        <Section
          title="Daily Attendance Report Preview"
          description={`Showing daily attendance breakdown for ${selectedMonthName} ${selectedYear} (${rows.length} days covered up to ${maxDay ? `${maxDay}-${selectedMonthName}` : "current date"}).`}
        >
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-center w-14">S.No</th>
                    <th className="px-4 py-3 text-center">Date</th>
                    <th className="px-4 py-3">Day</th>
                    <th className="px-4 py-3 text-center">Attendance Status</th>
                    <th className="px-4 py-3 text-center">Check-in Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted-foreground">
                        No days to report for this selection.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const isPresent = row.status === "PRESENT";
                      const isAbsent = row.status === "ABSENT";
                      const isWeekend = row.status === "Weekend";

                      return (
                        <tr
                          key={row.sNo}
                          className="transition-colors hover:bg-muted/30"
                        >
                          <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                            {row.sNo}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs font-medium text-foreground">
                            {row.dateStr}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-foreground">
                            {row.dayName}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isPresent && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <CheckCircle2 className="size-3" />
                                PRESENT
                              </span>
                            )}
                            {isAbsent && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                                <XCircle className="size-3" />
                                ABSENT
                              </span>
                            )}
                            {isWeekend && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                                Weekend
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                            {row.checkInTime}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer Summary Banner */}
            <div className="flex flex-col gap-3 border-t border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
              <div>
                Report Target: <strong className="text-foreground">{selectedStaffMember.name}</strong> ({selectedStaffMember.staffId}) • {selectedMonthName} {selectedYear}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  id="table-footer-download-pdf-btn"
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={isDownloading || isLoading}
                  className="gap-1.5"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Saving PDF…
                    </>
                  ) : (
                    <>
                      <FileDown className="size-3.5" />
                      Save & Download PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
