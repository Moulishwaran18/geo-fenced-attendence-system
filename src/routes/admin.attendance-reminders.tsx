/**
 * CampusAttend — Administrator Attendance Reminder Settings Page
 *
 * Route: /admin/attendance-reminders
 *
 * Implements:
 * 1. Administrator-only access control.
 * 2. Real-time configuration of automatic reminder times, working days, and timezone.
 * 3. Daily delivery statistics and active attendance status dashboard.
 * 4. Manual single-staff test notification trigger (zero side-effects on attendance records).
 * 5. Immediate manual scheduler execution.
 * 6. Audit logs showing delivery status, idempotency keys, and errors.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  Smartphone,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminAuth, getAdminAuthHeaders } from "@/lib/admin-auth";
import { staffDirectory } from "@/mocks/data";

export const Route = createFileRoute("/admin/attendance-reminders")({
  head: () => ({
    meta: [
      { title: "Attendance Reminder Settings — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Configure automated server-side attendance reminder notifications, applicable working schedules, and monitor institutional delivery telemetry.",
      },
      { property: "og:title", content: "Attendance Reminder Settings — CampusAttend Admin" },
      {
        property: "og:description",
        content: "Administrator control panel for daily staff attendance push notifications.",
      },
    ],
  }),
  component: AdminAttendanceRemindersPage,
});

const ALL_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface ReminderSettingsState {
  enabled: boolean;
  reminder_time_1: string;
  reminder_time_2_enabled: boolean;
  reminder_time_2: string;
  applicable_days: string[];
  timezone: string;
  title: string;
  message: string;
  updated_at?: string;
  updated_by?: string;
}

interface StatsState {
  total_active_staff: number;
  marked_attendance_count: number;
  unmarked_attendance_count: number;
  notifications_sent_today: number;
  notifications_failed_today: number;
  last_execution_run?: any;
  server_ist_time?: {
    dateStr: string;
    time24: string;
    time12: string;
    dayName: string;
    isWorkingDay: boolean;
  };
}

function AdminAttendanceRemindersPage() {
  const { authenticated: isAdmin, loading: isAuthLoading } = useAdminAuth();

  const [settings, setSettings] = useState<ReminderSettingsState>({
    enabled: true,
    reminder_time_1: "09:30",
    reminder_time_2_enabled: false,
    reminder_time_2: "10:00",
    applicable_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    timezone: "Asia/Kolkata",
    title: "CampusAttend – Attendance Reminder",
    message:
      "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification.",
  });

  const [stats, setStats] = useState<StatsState>({
    total_active_staff: 0,
    marked_attendance_count: 0,
    unmarked_attendance_count: 0,
    notifications_sent_today: 0,
    notifications_failed_today: 0,
  });

  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isRunningManual, setIsRunningManual] = useState<boolean>(false);
  const [testStaffCode, setTestStaffCode] = useState<string>("SCT-001");

  // Fetch reminder configuration & telemetry from server
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = { Accept: "application/json", ...getAdminAuthHeaders() };
      const res = await fetch("/api/admin/attendance-reminders", {
        headers,
        credentials: "include",
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          if (json.settings) setSettings(json.settings);
          if (json.stats) setStats(json.stats);
          if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
          if (Array.isArray(json.recentRuns)) setRecentRuns(json.recentRuns);
        }
      } else if (res.status === 401) {
        toast.error("Administrator session required.");
      }
    } catch (err) {
      console.warn("[AdminAttendanceRemindersPage] Failed to fetch settings:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      void loadData();
    }
  }, [isAdmin, loadData]);

  // Handle Save Settings
  const handleSaveSettings = async () => {
    try {
      setIsSaving(true);
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...getAdminAuthHeaders(),
      };

      const res = await fetch("/api/admin/attendance-reminders", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "save-settings",
          ...settings,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Reminder Settings Saved", {
          description: "Automated schedule and notification payload updated successfully.",
        });
        if (json.settings) setSettings(json.settings);
        if (json.stats) setStats(json.stats);
      } else {
        toast.error("Failed to save settings", {
          description: json.message || "Server rejected settings update.",
        });
      }
    } catch (err: any) {
      console.error("[AdminAttendanceRemindersPage] Save error:", err);
      toast.error("Failed to save settings", {
        description: err?.message || "Check server connectivity.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Send Test Notification
  const handleSendTestNotification = async () => {
    try {
      setIsTesting(true);
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...getAdminAuthHeaders(),
      };

      const res = await fetch("/api/admin/attendance-reminders", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "test-notification",
          staffCode: testStaffCode,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Test Notification Dispatched", {
          description: `Dispatched test reminder to ${testStaffCode}. Attendance records unaffected.`,
        });
        if (json.stats) setStats(json.stats);
        if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
      } else {
        toast.error("Test notification failed", {
          description: json.message || "Failed to deliver test notification.",
        });
      }
    } catch (err: any) {
      toast.error("Test Notification Error", {
        description: err?.message || "Network error.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Handle Manual Immediate Scheduler Run
  const handleRunSchedulerNow = async (slot: "first" | "second" = "first") => {
    try {
      setIsRunningManual(true);
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...getAdminAuthHeaders(),
      };

      const res = await fetch("/api/admin/attendance-reminders", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "run-now",
          slot,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success("Scheduler Executed", {
          description: json.result?.summaryMessage || "Attendance reminders evaluated and sent.",
        });
        if (json.stats) setStats(json.stats);
        if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
        if (Array.isArray(json.recentRuns)) setRecentRuns(json.recentRuns);
      } else {
        toast.error("Manual execution failed", {
          description: json.message || "Scheduler returned error.",
        });
      }
    } catch (err: any) {
      toast.error("Scheduler Run Error", {
        description: err?.message || "Execution exception.",
      });
    } finally {
      setIsRunningManual(false);
    }
  };

  // Format 24h to 12h display helper
  const format12h = (t24: string) => {
    if (!t24 || !t24.includes(":")) return t24;
    const [hStr, mStr] = t24.split(":");
    const h = parseInt(hStr || "0", 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, "0")}:${mStr} ${ampm}`;
  };

  // Toggle weekday selection
  const toggleWeekday = (day: string) => {
    setSettings((prev) => {
      const exists = prev.applicable_days.includes(day);
      const updated = exists
        ? prev.applicable_days.filter((d) => d !== day)
        : [...prev.applicable_days, day];
      return { ...prev, applicable_days: updated };
    });
  };

  if (!isAuthLoading && !isAdmin) {
    return (
      <AppShell nav={adminNav} role="admin">
        <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
          <ShieldAlert className="size-12 text-rose-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            This module is reserved exclusively for institution administrators. Please sign in with administrator credentials.
          </p>
          <Button asChild className="mt-4">
            <Link to="/admin">Go to Admin Login</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Attendance Reminder Settings"
        description="Configure automated server-side attendance reminders, applicable working schedules, and monitor institutional delivery telemetry."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadData()}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRunSchedulerNow("first")}
              disabled={isRunningManual || isLoading}
              className="gap-1.5"
            >
              {isRunningManual ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  Run Scheduler Now
                </>
              )}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Live Active Configuration Summary Card */}
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex size-10 items-center justify-center rounded-xl ${
                  settings.enabled
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {settings.enabled ? <BellRing className="size-5" /> : <BellOff className="size-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">Automatic Reminder Status</h3>
                  <Badge variant={settings.enabled ? "default" : "secondary"}>
                    {settings.enabled ? "ACTIVE" : "DISABLED"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Server-side scheduler runs automatically via Vercel Cron in{" "}
                  <strong>{settings.timezone}</strong> timezone.
                </p>
              </div>
            </div>

            {stats.server_ist_time && (
              <div className="flex items-center gap-2 text-xs font-mono bg-muted/40 px-3 py-1.5 rounded-lg text-muted-foreground">
                <Clock className="size-3.5 text-primary" />
                <span>IST Time:</span>
                <strong className="text-foreground">{stats.server_ist_time.time12}</strong>
                <span>•</span>
                <span>{stats.server_ist_time.dayName}</span>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
            <div>
              <span className="text-muted-foreground block">First Reminder:</span>
              <strong className="text-foreground text-sm font-semibold">
                {format12h(settings.reminder_time_1)}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Second Reminder:</span>
              <strong className="text-foreground text-sm font-semibold">
                {settings.reminder_time_2_enabled ? format12h(settings.reminder_time_2) : "Disabled"}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Applicable Days:</span>
              <strong className="text-foreground text-sm font-semibold">
                {settings.applicable_days.length === 6 && !settings.applicable_days.includes("Sunday")
                  ? "Mon to Sat"
                  : `${settings.applicable_days.length} days/week`}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Timezone:</span>
              <strong className="text-foreground text-sm font-semibold">{settings.timezone}</strong>
            </div>
          </div>
        </div>

        {/* Realtime Attendance & Delivery Statistics */}
        <Section title="Today's Attendance & Delivery Telemetry">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard
              label="Total Active Staff"
              value={stats.total_active_staff}
              hint="Registered faculty members"
              icon={Users}
              tone="primary"
            />
            <StatCard
              label="Marked Today"
              value={stats.marked_attendance_count}
              hint="Verified attendance records"
              icon={CheckCircle2}
              tone="success"
            />
            <StatCard
              label="Unmarked Today"
              value={stats.unmarked_attendance_count}
              hint="Eligible for reminders"
              icon={Clock}
              tone={stats.unmarked_attendance_count > 0 ? "warning" : "neutral"}
            />
            <StatCard
              label="Notifications Sent"
              value={stats.notifications_sent_today}
              hint="Delivered to devices today"
              icon={Send}
              tone="success"
            />
            <StatCard
              label="Notifications Failed"
              value={stats.notifications_failed_today}
              hint="Errors or missing tokens"
              icon={XCircle}
              tone={stats.notifications_failed_today > 0 ? "danger" : "neutral"}
            />
          </div>
        </Section>

        {/* Configuration Editor Form */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
          <div className="border-b border-border/60 pb-3">
            <h3 className="text-base font-semibold text-foreground">Configure Attendance Reminder Schedule</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set exact daily reminder times and select working days. The scheduler evaluates live attendance before dispatching.
            </p>
          </div>

          <div className="space-y-6">
            {/* Master Toggle */}
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
              <div className="space-y-0.5">
                <Label htmlFor="master-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                  Enable Automatic Attendance Reminders
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, un-marked staff automatically receive push notifications at the configured times.
                </p>
              </div>
              <Switch
                id="master-toggle"
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enabled: checked }))}
              />
            </div>

            {/* Time Configuration Grid */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {/* Reminder Slot 1 */}
              <div className="space-y-2 rounded-xl border border-border/60 p-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="reminder-1" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    First Reminder Time (IST)
                  </Label>
                  <Badge variant="outline" className="text-xs font-mono">
                    {format12h(settings.reminder_time_1)}
                  </Badge>
                </div>
                <Input
                  id="reminder-1"
                  type="time"
                  value={settings.reminder_time_1}
                  onChange={(e) => setSettings((prev) => ({ ...prev, reminder_time_1: e.target.value }))}
                  className="font-mono text-base"
                />
                <p className="text-[11px] text-muted-foreground">
                  Daily primary reminder time for faculty who have not marked attendance.
                </p>
              </div>

              {/* Reminder Slot 2 (Optional) */}
              <div className="space-y-2 rounded-xl border border-border/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="reminder-2" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Second Reminder Time (Optional)
                    </Label>
                    <Switch
                      id="reminder-2-toggle"
                      checked={settings.reminder_time_2_enabled}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({ ...prev, reminder_time_2_enabled: checked }))
                      }
                    />
                  </div>
                  {settings.reminder_time_2_enabled && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {format12h(settings.reminder_time_2)}
                    </Badge>
                  )}
                </div>
                <Input
                  id="reminder-2"
                  type="time"
                  disabled={!settings.reminder_time_2_enabled}
                  value={settings.reminder_time_2}
                  onChange={(e) => setSettings((prev) => ({ ...prev, reminder_time_2: e.target.value }))}
                  className="font-mono text-base disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  Second reminder checks the database again and excludes staff who marked attendance after reminder 1.
                </p>
              </div>
            </div>

            {/* Applicable Working Days */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                Applicable Working Days
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
                {ALL_WEEKDAYS.map((day) => {
                  const isSelected = settings.applicable_days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      className={`flex h-10 items-center justify-center rounded-lg border text-xs font-medium transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground font-semibold"
                          : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Currently selected: <strong>{settings.applicable_days.join(", ") || "None"}</strong>. Reminders are automatically skipped on unselected days.
              </p>
            </div>

            {/* Institution Timezone */}
            <div className="space-y-2">
              <Label htmlFor="timezone-select" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Institution Timezone
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="timezone-select"
                  value={settings.timezone}
                  onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="max-w-xs font-mono"
                />
                <Badge variant="outline" className="gap-1 text-xs">
                  <Globe className="size-3" /> Asia/Kolkata (IST +05:30)
                </Badge>
              </div>
            </div>

            {/* Notification Title & Body */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="notif-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notification Title
                </Label>
                <Input
                  id="notif-title"
                  value={settings.title}
                  onChange={(e) => setSettings((prev) => ({ ...prev, title: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notif-message" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notification Message Body
                </Label>
                <Textarea
                  id="notif-message"
                  rows={2}
                  value={settings.message}
                  onChange={(e) => setSettings((prev) => ({ ...prev, message: e.target.value }))}
                />
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                onClick={handleSaveSettings}
                disabled={isSaving}
                className="gap-2 min-w-[140px]"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" />
                    Save Settings
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Administrator Manual Test Notification Panel */}
        <Section
          title="Manual Test Notification Dispatcher"
          description="Test mobile push notification delivery to a specific faculty member's device without altering attendance records or sending bulk notifications."
        >
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2 flex-1 max-w-sm">
                <Label htmlFor="test-staff-code" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Target Staff Member for Test
                </Label>
                <Select value={testStaffCode} onValueChange={(val) => setTestStaffCode(val)}>
                  <SelectTrigger id="test-staff-code">
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
              </div>

              <Button
                variant="outline"
                onClick={handleSendTestNotification}
                disabled={isTesting}
                className="gap-2"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending Test…
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Send Test Notification
                  </>
                )}
              </Button>
            </div>
          </div>
        </Section>

        {/* Recent Delivery Audit Trail Table */}
        <Section
          title="Recent Reminder Notification Logs"
          description="Detailed delivery audit trail with unique idempotency keys ensuring zero duplicate notifications."
        >
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Timestamp (IST)</th>
                    <th className="px-4 py-3">Slot</th>
                    <th className="px-4 py-3">Staff Code</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Idempotency Key</th>
                    <th className="px-4 py-3">Error / Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recentLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                        No notification logs recorded yet. Run a test notification or wait for the scheduled time.
                      </td>
                    </tr>
                  ) : (
                    recentLogs.map((log, idx) => {
                      const isDelivered = log.status === "delivered";
                      const isFailed = log.status === "failed";
                      const isSkipped = log.status === "skipped";

                      return (
                        <tr key={log.id || log.idempotency_key || idx} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {log.sent_at ? new Date(log.sent_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium uppercase">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {log.reminder_slot}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                            {log.staff_code}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isDelivered && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <CheckCircle2 className="size-3" /> DELIVERED
                              </span>
                            )}
                            {isFailed && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                                <XCircle className="size-3" /> FAILED
                              </span>
                            )}
                            {isSkipped && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                SKIPPED
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground truncate max-w-[180px]">
                            {log.idempotency_key}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {log.error_message || "Delivered successfully"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
