/**
 * CampusAttend — Administrator Attendance Reminder Settings Page
 *
 * Route: /admin/attendance-reminders
 *
 * Implements:
 * 1. Administrator-only access control.
 * 2. Real-time configuration of automatic reminder times, working days, and timezone.
 * 3. Daily delivery statistics and active attendance status dashboard.
 * 4. Manual single-staff test notification trigger (uses ONLY real database staff).
 * 5. Immediate manual scheduler execution with confirmation dialog and eligibility breakdown.
 * 6. Audit logs showing delivery status, idempotency keys, and error reasons.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  CalendarCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAdminAuth, getAdminAuthHeaders } from "@/lib/admin-auth";

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

export interface RealStaffItem {
  id: string;
  staff_code: string;
  name: string;
  department: string;
  designation?: string;
  active: boolean;
  hasDevice: boolean;
  deviceId?: string | null;
  deviceModel?: string | null;
  hasToken: boolean;
  token?: string | null;
  markedToday?: boolean;
}

interface TestDeliveryResult {
  success: boolean;
  staffCode: string;
  message: string;
  stage?: string;
  messageId?: string;
  error?: string;
  timestamp: string;
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

  const [staffList, setStaffList] = useState<RealStaffItem[]>([]);
  const [testStaffCode, setTestStaffCode] = useState<string>("");
  const [testResult, setTestResult] = useState<TestDeliveryResult | null>(null);

  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isRunningManual, setIsRunningManual] = useState<boolean>(false);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState<boolean>(false);

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
          if (json.settings) {
          setSettings(json.settings);
          const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
          if (bridge && typeof bridge.syncReminderSchedule === "function" && json.settings.enabled) {
            bridge.syncReminderSchedule(
              json.settings.reminder_time_1 || "09:00",
              json.settings.reminder_time_2 || "10:00",
              !!json.settings.reminder_time_2_enabled,
              (json.settings.applicable_days || []).join(","),
              json.settings.timezone || "Asia/Kolkata"
            );
          }
        }
          if (json.stats) setStats(json.stats);
          if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
          if (Array.isArray(json.recentRuns)) setRecentRuns(json.recentRuns);

          if (Array.isArray(json.staffList)) {
            setStaffList(json.staffList);
            if (!testStaffCode && json.staffList.length > 0) {
              setTestStaffCode(json.staffList[0].staff_code);
            }
          }

          // Sync reminder times to Android native AlarmManager for background alarms
          const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
          if (bridge && typeof bridge.syncReminderSchedule === "function" && json.settings?.enabled) {
            bridge.syncReminderSchedule(
              json.settings.reminder_time_1 || "09:00",
              json.settings.reminder_time_2 || "10:00",
              !!json.settings.reminder_time_2_enabled,
              (json.settings.applicable_days || []).join(","),
              json.settings.timezone || "Asia/Kolkata"
            );
          }
        }
      } else if (res.status === 401) {
        toast.error("Administrator session required.");
      }
    } catch (err) {
      console.warn("[AdminAttendanceRemindersPage] Failed to fetch settings:", err);
    } finally {
      setIsLoading(false);
    }
  }, [testStaffCode]);

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
        if (json.settings) {
          setSettings(json.settings);
          const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
          if (bridge && typeof bridge.syncReminderSchedule === "function" && json.settings.enabled) {
            bridge.syncReminderSchedule(
              json.settings.reminder_time_1 || "09:00",
              json.settings.reminder_time_2 || "10:00",
              !!json.settings.reminder_time_2_enabled,
              (json.settings.applicable_days || []).join(","),
              json.settings.timezone || "Asia/Kolkata"
            );
          }
        }
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

  // Handle Send Test Notification (Strictly Isolated to Single Staff)
  const handleSendTestNotification = async () => {
    if (!testStaffCode) {
      toast.error("Select a staff member first.");
      return;
    }

    try {
      setIsTesting(true);
      setTestResult(null);

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
      const timestamp = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

      if (res.ok && json.success) {
        toast.success("Test Notification Dispatched", {
          description: json.message || `Dispatched test reminder to ${testStaffCode}. Attendance records unaffected.`,
        });
        setTestResult({
          success: true,
          staffCode: testStaffCode,
          message: json.message,
          stage: json.deliveryStage || "delivered",
          messageId: json.messageId,
          timestamp,
        });
        if (json.stats) setStats(json.stats);
        if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
      } else {
        const errorDesc = json.message || json.error || "Failed to deliver test notification.";
        toast.error("Test Notification Failed", {
          description: errorDesc,
        });
        setTestResult({
          success: false,
          staffCode: testStaffCode,
          message: errorDesc,
          stage: json.deliveryStage || "failed",
          error: json.error || "DELIVERY_ERROR",
          timestamp,
        });
        if (json.stats) setStats(json.stats);
        if (Array.isArray(json.recentLogs)) setRecentLogs(json.recentLogs);
      }
    } catch (err: any) {
      const errorMsg = err?.message || "Network communication error.";
      toast.error("Test Notification Error", {
        description: errorMsg,
      });
      setTestResult({
        success: false,
        staffCode: testStaffCode,
        message: errorMsg,
        stage: "network_error",
        error: "NETWORK_EXCEPTION",
        timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Handle Local / Native Android Background Alarm Test (5 seconds delay)
  const handleTestNativeAlarm = () => {
    const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
    if (bridge && typeof bridge.scheduleTestReminder === "function") {
      const ok = bridge.scheduleTestReminder(
        5,
        "CampusAttend • Background Push Test",
        `Test push for ${testStaffCode || "faculty"}. Fired via Android AlarmManager even when app is closed!`
      );
      if (ok) {
        toast.success("Background Alarm Armed (5s)", {
          description: "Close or background CampusAttend immediately. The notification will trigger in 5 seconds via Android AlarmManager.",
        });
      } else {
        toast.error("Failed to arm native alarm", {
          description: "Check Android exact alarm permission.",
        });
      }
    } else {
      toast.info("Armed 5-Second Test Timer", {
        description: "Testing in browser mode. In Android APK, this tests native AlarmManager when closed.",
      });
      setTimeout(() => {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("CampusAttend • Attendance Reminder", {
            body: `Test reminder for ${testStaffCode || "faculty"}. Please mark your attendance.`,
            icon: "/icons/icon-192x192.png",
          });
        }
      }, 5000);
    }
  };

  // Handle Manual Bulk Scheduler Run
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
        const summary = json.result?.summary_message || json.message || "Attendance reminders evaluated and sent.";
        toast.success("Scheduler Executed Successfully", {
          description: summary,
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

  // Compute Next Expected Scheduler Run Time
  const nextExpectedRun = useMemo(() => {
    if (!settings.enabled) return "Disabled (Scheduler paused)";
    const currentTime = stats.server_ist_time?.time24 || "09:00";
    if (currentTime < settings.reminder_time_1) {
      return `Today at ${format12h(settings.reminder_time_1)} (First Reminder)`;
    }
    if (settings.reminder_time_2_enabled && currentTime < settings.reminder_time_2) {
      return `Today at ${format12h(settings.reminder_time_2)} (Second Reminder)`;
    }
    return `Tomorrow at ${format12h(settings.reminder_time_1)} (First Reminder)`;
  }, [settings.enabled, settings.reminder_time_1, settings.reminder_time_2, settings.reminder_time_2_enabled, stats.server_ist_time]);

  // Selected staff member record
  const selectedStaff = useMemo(() => {
    return staffList.find((s) => s.staff_code.toUpperCase() === testStaffCode.toUpperCase()) || null;
  }, [staffList, testStaffCode]);

  // Missing token count for unmarked faculty
  const missingTokenCount = useMemo(() => {
    return staffList.filter((s) => !s.markedToday && !s.hasToken).length;
  }, [staffList]);

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
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/notification-diagnostic">
                <Activity className="size-3.5 text-primary" />
                Push Diagnostics
              </Link>
            </Button>
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
              onClick={() => setIsConfirmDialogOpen(true)}
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

      {/* Confirmation Dialog for Bulk Manual Scheduler Execution */}
      <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-foreground">
              <Play className="size-5 text-primary" /> Confirm Manual Scheduler Execution
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Run the attendance reminder scheduler now? This will evaluate attendance for all active faculty and send notifications to eligible staff who have not marked attendance today.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-xl border border-border/80 bg-muted/40 p-4 space-y-3">
            <div className="font-semibold text-foreground text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Info className="size-3.5 text-primary" /> Live Scheduler Evaluation Preview (Asia/Kolkata)
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-card p-2.5 border border-border/60">
                <span className="text-muted-foreground block">Total Active Staff:</span>
                <strong className="text-foreground text-sm font-semibold">{stats.total_active_staff}</strong>
              </div>
              <div className="rounded-lg bg-card p-2.5 border border-border/60">
                <span className="text-muted-foreground block">Marked Attendance:</span>
                <strong className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
                  {stats.marked_attendance_count}
                </strong>
              </div>
              <div className="rounded-lg bg-card p-2.5 border border-border/60">
                <span className="text-muted-foreground block">Eligible for Reminder:</span>
                <strong className="text-amber-600 dark:text-amber-400 text-sm font-semibold">
                  {stats.unmarked_attendance_count}
                </strong>
              </div>
              <div className="rounded-lg bg-card p-2.5 border border-border/60">
                <span className="text-muted-foreground block">Missing Push Tokens:</span>
                <strong className="text-rose-500 text-sm font-semibold">
                  {missingTokenCount}
                </strong>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Staff who have already marked attendance or who already received a reminder for this slot today will be safely skipped.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunningManual}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsConfirmDialogOpen(false);
                void handleRunSchedulerNow("first");
              }}
              disabled={isRunningManual}
              className="gap-1.5"
            >
              {isRunningManual ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Confirm & Run Scheduler
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  Server-side scheduler executes automated reminders according to <strong>{settings.timezone}</strong> timezone.
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
              <span className="text-muted-foreground block">Applicable Schedule:</span>
              <strong className="text-foreground text-sm font-semibold">
                {settings.applicable_days.length === 6 && !settings.applicable_days.includes("Sunday")
                  ? "Mon to Sat"
                  : `${settings.applicable_days.length} days/week`}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground block">Next Expected Run:</span>
              <strong className="text-primary text-sm font-semibold">{nextExpectedRun}</strong>
            </div>
          </div>
        </div>

        {/* Realtime Attendance & Delivery Statistics */}
        <Section title="Today's Attendance & Delivery Telemetry">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard
              label="Total Active Staff"
              value={stats.total_active_staff}
              hint="Real database faculty records"
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
              hint="Delivered push alerts today"
              icon={Send}
              tone="success"
            />
            <StatCard
              label="Notifications Skipped/Failed"
              value={stats.notifications_failed_today}
              hint="Missing tokens or errors"
              icon={XCircle}
              tone={stats.notifications_failed_today > 0 ? "danger" : "neutral"}
            />
          </div>
        </Section>

        {/* Administrator Manual Test Notification Panel */}
        <Section
          title="Manual Test Notification Dispatcher"
          description="Send an isolated test attendance reminder to a specific faculty member's physical device without affecting attendance records or running bulk notifications."
        >
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2 flex-1 max-w-md">
                <Label htmlFor="test-staff-code" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Target Staff Member (Real Database Records Only)
                </Label>
                <Select value={testStaffCode} onValueChange={(val) => setTestStaffCode(val)}>
                  <SelectTrigger id="test-staff-code" className="font-medium">
                    <SelectValue placeholder="Select Real Staff Member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.length === 0 ? (
                      <SelectItem disabled value="none">
                        No active faculty accounts in database
                      </SelectItem>
                    ) : (
                      staffList.map((s) => (
                        <SelectItem key={s.staff_code} value={s.staff_code}>
                          {s.name} ({s.staff_code}) — {s.department}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleSendTestNotification}
                  disabled={isTesting || !testStaffCode}
                  className="gap-2 min-w-[190px]"
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending Test Push…
                    </>
                  ) : (
                    <>
                      <Send className="size-4" />
                      Send Test Notification
                    </>
                  )}
                </Button>

                <Button
                  variant="secondary"
                  onClick={handleTestNativeAlarm}
                  className="gap-2"
                  title="Test notification trigger after 5 seconds via Android AlarmManager (test while app is closed)"
                >
                  <Clock className="size-4" />
                  Test Background OS Alert (5s)
                </Button>
              </div>
            </div>

            {/* Selected Faculty Diagnostics Card */}
            {selectedStaff && (
              <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-sm">{selectedStaff.name}</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {selectedStaff.staff_code}
                    </Badge>
                    <span className="text-xs text-muted-foreground">• {selectedStaff.department}</span>
                  </div>
                  <Badge variant={selectedStaff.active ? "default" : "destructive"}>
                    {selectedStaff.active ? "Active Faculty" : "Inactive"}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {/* Physical Device Binding */}
                  {selectedStaff.hasDevice ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1">
                      <Smartphone className="size-3" />
                      Device: {selectedStaff.deviceModel || selectedStaff.deviceId}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-300 gap-1">
                      <AlertTriangle className="size-3" />
                      No Physical Device Registered
                    </Badge>
                  )}

                  {/* FCM / Push Token Status */}
                  {selectedStaff.hasToken ? (
                    <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 gap-1">
                      <BellRing className="size-3" />
                      Push Token Registered
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-rose-500 border-rose-300 gap-1">
                      <BellOff className="size-3" />
                      No Push Token Registered
                    </Badge>
                  )}

                  {/* Today's Attendance Record */}
                  {selectedStaff.markedToday ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1">
                      <CheckCircle2 className="size-3" />
                      Attendance Marked Today
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground gap-1">
                      <Clock className="size-3" />
                      Attendance Not Yet Marked
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Test Notification Real-Time Dispatch Result */}
            {testResult && (
              <div
                className={`rounded-xl border p-4 text-xs space-y-1.5 ${
                  testResult.success
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-200"
                    : "border-rose-500/30 bg-rose-500/5 text-rose-950 dark:text-rose-200"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    {testResult.success ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircle className="size-4 text-rose-600 dark:text-rose-400" />
                    )}
                    <span>
                      {testResult.success
                        ? `Test Push Delivered to ${testResult.staffCode}`
                        : `Test Push Not Delivered to ${testResult.staffCode}`}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">{testResult.timestamp}</span>
                </div>
                <p className="text-muted-foreground">{testResult.message}</p>
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] pt-1">
                  <span>Delivery Stage: <strong>{testResult.stage}</strong></span>
                  {testResult.messageId && (
                    <>
                      <span>•</span>
                      <span>Message ID: <strong>{testResult.messageId}</strong></span>
                    </>
                  )}
                </div>
              </div>
            )}
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
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {log.sent_at
                              ? new Date(log.sent_at).toLocaleTimeString("en-IN", {
                                  timeZone: "Asia/Kolkata",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                  hour12: true,
                                })
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs uppercase">
                              {log.reminder_slot}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                            {log.staff_code}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant={
                                isDelivered ? "default" : isSkipped ? "secondary" : "destructive"
                              }
                              className="text-xs"
                            >
                              {log.status.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground max-w-[180px] truncate">
                            {log.idempotency_key || "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {log.error_message || (isDelivered ? "Successfully dispatched" : "—")}
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
