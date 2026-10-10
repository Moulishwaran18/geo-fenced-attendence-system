import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wifi,
  XCircle,
  Lock,
  ScanFace,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { AttendanceTable } from "@/components/common/AttendanceTable";
import { AttendanceDetailDialog } from "@/components/common/AttendanceDetailDialog";
import { AlertBanner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProfile } from "@/lib/profile-store";
import { formatIndiaDate, formatIndiaTime, useIndiaTime } from "@/lib/india-time";
import { useAttendance, type AttendanceRecord } from "@/hooks/use-attendance";
import { useGeofence } from "@/hooks/use-geofence";
import { useWifiStatus } from "@/hooks/use-wifi-status";
import { getStaffFaceStatus, type StaffFaceStatusResponse } from "@/lib/staff-face";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Staff Dashboard — CampusAttend" },
      {
        name: "description",
        content:
          "Daily attendance overview for college staff: today's status, marking time, monthly rate and campus location status.",
      },
      { property: "og:title", content: "Staff Dashboard — CampusAttend" },
      { property: "og:description", content: "Your attendance overview for today." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();
  const now = useIndiaTime();
  const { profile } = useProfile();
  const {
    records,
    recentRecords,
    todayRecord,
    todayStatus,
    todayMarkingTime,
    monthlyStats,
    isLoading,
    error,
    refresh,
  } = useAttendance();

  // Live GPS Geofence & Wi-Fi state
  const geofence = useGeofence(true);
  const { status: wifiStatus, isChecking: isWifiChecking } = useWifiStatus();

  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [isRefreshingGps, setIsRefreshingGps] = useState(false);
  const [faceStatus, setFaceStatus] = useState<StaffFaceStatusResponse | null>(null);

  useEffect(() => {
    void getStaffFaceStatus().then(setFaceStatus).catch(() => {});
  }, []);

  const hour = now
    ? Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          hour12: false,
        }).format(now),
      )
    : 9;
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  // Location display resolution
  const locationLabel =
    geofence.status === "inside"
      ? "Inside Campus"
      : geofence.status === "outside"
      ? "Outside Campus"
      : geofence.status === "acquiring"
      ? "Acquiring GPS…"
      : geofence.status === "location_services_off"
      ? "Location Services OFF"
      : geofence.status === "permission_prompt"
      ? "Permission Required"
      : geofence.status === "permission_denied"
      ? "GPS Denied"
      : geofence.status === "insufficient_accuracy" ||
        (geofence.accuracy !== null && geofence.accuracy > 20)
      ? "Low Accuracy"
      : geofence.status === "position_unavailable" || geofence.status === "timeout"
      ? "GPS Unavailable"
      : "Inside Campus";

  const locationHint =
    geofence.accuracy !== null
      ? `GPS accuracy ${Math.round(geofence.accuracy)} m`
      : geofence.statusMessage || "Checking location…";

  const locationTone =
    geofence.status === "inside"
      ? ("success" as const)
      : geofence.status === "acquiring"
      ? ("primary" as const)
      : ("warning" as const);

  // Ready State evaluation
  const isWifiOk = Boolean(wifiStatus?.isSonaWifi);
  const isGpsOk = geofence.isInside === true;
  const isAttendanceReady = isWifiOk && isGpsOk;

  // Handle GPS manual refresh
  const handleRefreshLocation = async () => {
    setIsRefreshingGps(true);
    toast.info("Updating GPS Location…", {
      description: "Requesting fresh high-accuracy position from device.",
    });
    try {
      await geofence.refreshLocation();
      toast.success("Location Updated", {
        description:
          geofence.accuracy !== null
            ? `Accuracy: ±${Math.round(geofence.accuracy)}m (${geofence.status === "inside" ? "Inside Campus" : "Outside Campus"})`
            : "Location received.",
      });
    } catch {
      toast.error("Location Update Failed");
    } finally {
      setIsRefreshingGps(false);
    }
  };

  // Card interaction handlers
  const handleTodayStatusClick = () => {
    if (todayRecord) {
      setSelectedRecord(todayRecord);
      setDetailOpen(true);
    } else {
      void navigate({ to: "/mark-attendance" });
    }
  };

  const handleMarkingTimeClick = () => {
    if (todayRecord) {
      setSelectedRecord(todayRecord);
      setDetailOpen(true);
    } else {
      toast.info("Attendance Window", {
        description: "Standard daily window: 8:45 AM – 9:10 AM IST.",
      });
    }
  };

  const handleMonthlyClick = () => {
    void navigate({ to: "/history" });
  };

  return (
    <AppShell nav={staffNav} role="staff">
      {/* Attendance Record Detail Modal */}
      <AttendanceDetailDialog
        record={selectedRecord}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />

      <PageHeader
        title={`${greeting}, ${profile.name.split(" ").slice(0, 2).join(" ")}`}
        description={
          now
            ? `${formatIndiaDate(now)} · ${formatIndiaTime(now)} IST`
            : "Your attendance overview for today."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refresh();
                toast.success("Attendance records refreshed");
              }}
              aria-label="Refresh attendance records"
              title="Refresh attendance data"
              disabled={isLoading}
            >
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
              <span className="ml-1.5 hidden sm:inline">Refresh</span>
            </Button>
            <Button asChild size="default" className="shadow-sm">
              <Link to="/mark-attendance">
                <MapPin className="mr-2 size-4" /> Mark Attendance
              </Link>
            </Button>
          </div>
        }
      />

      {/* Top 4 Interactive KPI Stat Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {/* Today's Status */}
        <StatCard
          label="Today's Status"
          value={todayStatus}
          hint={
            todayRecord
              ? `Marked at ${todayRecord.time}`
              : "Window 8:45 – 9:10 AM · Tap to mark"
          }
          icon={todayRecord ? CheckCircle2 : Clock}
          tone={
            todayStatus === "Present"
              ? "success"
              : todayStatus === "Late"
              ? "warning"
              : todayStatus === "Absent"
              ? "danger"
              : "neutral"
          }
          loading={isLoading}
          onClick={handleTodayStatusClick}
        />

        {/* Today's Marking Time */}
        <StatCard
          label="Today's Marking Time"
          value={todayMarkingTime}
          hint={todayRecord ? "Recorded via Authoritative System" : "Window 8:45 – 9:10 AM"}
          icon={Clock}
          tone="primary"
          loading={isLoading}
          onClick={handleMarkingTimeClick}
        />

        {/* Monthly Attendance */}
        <StatCard
          label="Monthly Attendance"
          value={`${monthlyStats.attendanceRate}%`}
          hint={`${monthlyStats.presentCount} of ${monthlyStats.workingDays} working days · View all`}
          icon={TrendingUp}
          tone="primary"
          loading={isLoading}
          onClick={handleMonthlyClick}
        />

        {/* Current Location */}
        <StatCard
          label="Current Location"
          value={locationLabel}
          hint={`${locationHint} · Tap to update`}
          icon={Navigation}
          tone={locationTone}
          onClick={handleRefreshLocation}
        />
      </div>

      {/* Face Authentication & Biometric Status Banner / Card */}
      <div className="mt-6">
        <div className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm backdrop-blur-sm transition-all sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span
                className={`grid size-12 shrink-0 place-items-center rounded-2xl ${
                  faceStatus?.enrollmentStatus === "approved"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : faceStatus?.enrollmentStatus === "pending_approval"
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : faceStatus?.enrollmentStatus === "rejected"
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                    : "bg-primary/15 text-primary"
                }`}
              >
                <ScanFace className="size-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                    Face Authentication & Biometrics
                  </h3>
                  {faceStatus?.isLocked ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      <Lock className="size-3" />
                      Approved & Locked
                    </Badge>
                  ) : faceStatus?.canSaveReplacement ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Token Active (Ready to Update)
                    </Badge>
                  ) : faceStatus?.enrollmentStatus === "pending_approval" ? (
                    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      Pending Approval
                    </Badge>
                  ) : faceStatus?.enrollmentStatus === "rejected" ? (
                    <Badge variant="outline" className="gap-1 border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">
                      Change Rejected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary">
                      Not Registered
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  {faceStatus?.isLocked
                    ? `Your face registration is locked (${faceStatus.sampleCount ?? 0} sample${faceStatus.sampleCount === 1 ? "" : "s"} enrolled). Request administrator approval to change it.`
                    : faceStatus?.canSaveReplacement
                    ? "Administrator approval received! You may now capture or upload your updated face reference samples."
                    : faceStatus?.enrollmentStatus === "pending_approval"
                    ? `Change request submitted on ${faceStatus.activeRequest?.created_at ? new Date(faceStatus.activeRequest.created_at).toLocaleDateString() : "recently"}. Awaiting administrator review.`
                    : "Register your face reference photos to enable live biometric face recognition for daily attendance marking."}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button asChild variant={faceStatus?.enrollmentStatus === "approved" ? "outline" : "default"} size="sm">
                <Link to="/face-enrollment">
                  <ScanFace className="mr-1.5 size-4" />
                  {faceStatus?.enrollmentStatus === "approved"
                    ? "Manage Biometrics"
                    : faceStatus?.canSaveReplacement
                    ? "Update Face Now"
                    : "Register Your Face"}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Attendance Ready Section + This Month Sidebar */}
      <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-3">
        <Section className="xl:col-span-2">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span
                  className={`grid size-12 sm:size-14 shrink-0 place-items-center rounded-2xl ${
                    isAttendanceReady
                      ? "bg-success-soft text-success"
                      : "bg-warning-soft text-warning-foreground"
                  }`}
                >
                  {isAttendanceReady ? (
                    <ShieldCheck className="size-6 sm:size-7" aria-hidden />
                  ) : (
                    <ShieldAlert className="size-6 sm:size-7" aria-hidden />
                  )}
                </span>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
                    {isAttendanceReady ? "Attendance Ready" : "Attendance Checks Active"}
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    {isAttendanceReady
                      ? "All presence checks have passed for your registered device."
                      : !isWifiOk
                      ? "Authorized campus Wi-Fi connection required to enable attendance marking."
                      : !isGpsOk
                      ? "Move inside campus boundary polygon to complete verification."
                      : "Multi-factor presence checks are currently verifying."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshLocation}
                  disabled={isRefreshingGps}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/80 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Check location status"
                >
                  <RefreshCw className={`size-3 ${isRefreshingGps ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">Check</span>
                </button>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    isAttendanceReady
                      ? "bg-success-soft text-success"
                      : "bg-warning-soft text-warning-foreground"
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-current animate-pulse" aria-hidden />
                  Live
                </span>
              </div>
            </div>

            <dl className="mt-6 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Location",
                  value: locationLabel,
                  desc: geofence.status === "inside" ? "Within Geofence Polygon" : "Campus Perimeter",
                },
                {
                  label: "GPS Accuracy",
                  value: geofence.accuracy !== null ? `±${Math.round(geofence.accuracy)} m` : "—",
                  desc: geofence.isAcceptableAccuracy ? "High precision fix" : "Acquiring precision",
                },
                {
                  label: "Verification Status",
                  value: isAttendanceReady ? "Ready" : isWifiOk ? "Wi-Fi OK · GPS Check" : "Wi-Fi Required",
                  desc: isAttendanceReady ? "All factors passed" : "Presence check active",
                },
                {
                  label: "Attendance Window",
                  value: "8:45 – 9:10 AM",
                  desc: "IST Daily Window",
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="rounded-lg border border-border bg-secondary/50 p-3 sm:p-3.5 transition-colors hover:bg-secondary/70"
                >
                  <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 text-sm font-semibold truncate">{row.value}</dd>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.desc}</p>
                </div>
              ))}
            </dl>

            <Button asChild size="lg" className="mt-6 w-full text-sm sm:text-base font-medium shadow-sm">
              <Link to="/mark-attendance">
                <MapPin className="mr-2 size-5" /> Mark Attendance
              </Link>
            </Button>
          </div>
        </Section>

        {/* Sidebar: Window Info & This Month Breakdown */}
        <div className="space-y-4">
          <AlertBanner
            tone="info"
            icon={CalendarCheck}
            title="Attendance window closes at 9:10 AM"
            description="Entries after the window need admin approval."
          />

          <Section
            title="This month"
            description="Summary of marked attendance"
            actions={
              <Button variant="ghost" size="sm" asChild className="h-8 text-xs">
                <Link to="/history">Details</Link>
              </Button>
            }
          >
            <ul className="divide-y divide-border text-sm">
              {[
                ["Working days", String(monthlyStats.workingDays)],
                ["Present", String(monthlyStats.presentCount)],
                ["Late", String(monthlyStats.lateCount)],
                ["Absent", String(monthlyStats.absentCount)],
                ["Attendance rate", `${monthlyStats.attendanceRate}%`],
              ].map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold tabular-nums text-foreground">{v}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {/* Recent Attendance Table Section */}
      <Section
        className="mt-6"
        title="Recent attendance"
        description="Your latest marked entries from attendance records"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/history">View all</Link>
          </Button>
        }
      >
        {error ? (
          <div className="p-6 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-danger-soft text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <p className="mt-3 text-sm font-semibold">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Unable to load attendance records from the server.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>
              <RefreshCw className="mr-2 size-3.5" /> Retry
            </Button>
          </div>
        ) : (
          <AttendanceTable
            records={recentRecords}
            isLoading={isLoading}
            onSelectRecord={(r) => {
              setSelectedRecord(r);
              setDetailOpen(true);
            }}
          />
        )}
      </Section>
    </AppShell>
  );
}
