/**
 * Vercel Serverless Scheduled Cron Function: /api/cron/attendance-reminders
 *
 * Automatically triggered by Vercel Cron according to Asia/Kolkata timezone.
 *
 * Security:
 * - Validates Vercel CRON_SECRET or authorized scheduler header.
 * - Enforces zero duplicate notifications via database idempotency constraints.
 * - Re-evaluates database attendance records immediately before dispatching.
 */

import {
  getReminderSettings,
  getIstDateTime,
  executeAttendanceReminders,
  getRecentExecutionRuns,
} from "../../src/server/attendance-reminder-service";

function isAuthorizedCron(req: any): boolean {
  if (typeof process === "undefined") return true;

  const cronSecret = process.env["CRON_SECRET"] || process.env["CAMPUS_CRON_SECRET"];
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };

  // 1. If running under Vercel Cron, Vercel supplies `x-vercel-cron: 1`
  const vercelCronHeader = getHeader("x-vercel-cron");
  if (vercelCronHeader === "1") {
    // If CRON_SECRET is configured, check Authorization Bearer header
    if (!cronSecret) return true;
    const authHeader = getHeader("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return true;
  }

  // 2. Direct bearer authorization
  if (cronSecret) {
    const authHeader = getHeader("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return true;
  }

  // 3. Fallback for manual or test trigger in development / non-production
  const isDev = process.env["NODE_ENV"] !== "production" && process.env["VERCEL"] !== "1";
  if (isDev) return true;

  // If no CRON_SECRET is set in production, allow verified Vercel platform requests
  if (!cronSecret && vercelCronHeader === "1") return true;

  return false;
}

function timeDifferenceMinutes(timeA: string, timeB: string): number {
  if (!timeA.includes(":") || !timeB.includes(":")) return 999;
  const partsA = timeA.split(":");
  const partsB = timeB.split(":");
  const hA = parseInt(partsA[0] || "0", 10);
  const mA = parseInt(partsA[1] || "0", 10);
  const hB = parseInt(partsB[0] || "0", 10);
  const mB = parseInt(partsB[1] || "0", 10);
  return Math.abs((hA * 60 + mA) - (hB * 60 + mB));
}

export default async function handler(req: any, res: any) {
  // Allow GET and POST for cron dispatch
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    if (res && typeof res.status === "function") {
      return res.status(405).json({ success: false, error: "METHOD_NOT_ALLOWED" });
    }
    return new Response(JSON.stringify({ success: false, error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  if (!isAuthorizedCron(req)) {
    if (res && typeof res.status === "function") {
      return res.status(401).json({ success: false, error: "UNAUTHORIZED_CRON_TRIGGER" });
    }
    return new Response(JSON.stringify({ success: false, error: "UNAUTHORIZED_CRON_TRIGGER" }), { status: 401 });
  }

  try {
    const settings = await getReminderSettings();
    const ist = getIstDateTime();
    const istDate = ist.dateStr;
    const istTime24 = ist.time24;

    // 1. Check if reminders are enabled
    if (!settings.enabled) {
      const resp = {
        success: true,
        executed: false,
        reason: "REMINDERS_DISABLED",
        message: "Attendance reminders are disabled in settings.",
        istTime: ist.time12,
        istDate,
      };
      if (res && typeof res.json === "function") return res.status(200).json(resp);
      return new Response(JSON.stringify(resp), { status: 200 });
    }

    // 2. Check if today is an applicable working day
    if (!settings.applicable_days.includes(ist.dayName)) {
      const resp = {
        success: true,
        executed: false,
        reason: "NON_WORKING_DAY",
        message: `Today (${ist.dayName}) is not configured as a working day for attendance reminders.`,
        istTime: ist.time12,
        istDate,
      };
      if (res && typeof res.json === "function") return res.status(200).json(resp);
      return new Response(JSON.stringify(resp), { status: 200 });
    }

    // 3. Check if today is an institutional holiday
    if (ist.isHoliday) {
      const resp = {
        success: true,
        executed: false,
        reason: "INSTITUTIONAL_HOLIDAY",
        message: `Today (${istDate}) is an institutional holiday. Reminders skipped.`,
        istTime: ist.time12,
        istDate,
      };
      if (res && typeof res.json === "function") return res.status(200).json(resp);
      return new Response(JSON.stringify(resp), { status: 200 });
    }

    // 4. Query recent execution runs to see if a run for this slot has already executed today
    const recentRuns = await getRecentExecutionRuns(10);

    // Tolerance window for cron check (within 14 minutes to accommodate 15-minute cron frequency)
    const TOLERANCE_MINUTES = 14;

    let targetSlot: "first" | "second" | null = null;

    // Check first reminder slot
    const diff1 = timeDifferenceMinutes(istTime24, settings.reminder_time_1);
    const hasRunFirstToday = recentRuns.some(
      (r) => r.attendance_date === istDate && r.reminder_slot === "first" && r.status === "completed"
    );

    if (diff1 <= TOLERANCE_MINUTES && !hasRunFirstToday) {
      targetSlot = "first";
    }

    // Check second reminder slot (if enabled)
    if (!targetSlot && settings.reminder_time_2_enabled && settings.reminder_time_2) {
      const diff2 = timeDifferenceMinutes(istTime24, settings.reminder_time_2);
      const hasRunSecondToday = recentRuns.some(
        (r) => r.attendance_date === istDate && r.reminder_slot === "second" && r.status === "completed"
      );

      if (diff2 <= TOLERANCE_MINUTES && !hasRunSecondToday) {
        targetSlot = "second";
      }
    }

    // 5. If no slot matches current window or already executed today
    if (!targetSlot) {
      const resp = {
        success: true,
        executed: false,
        reason: "OUTSIDE_SCHEDULE_WINDOW_OR_ALREADY_RUN",
        message: `Current IST time ${ist.time12} does not match any un-executed reminder schedule (Slot 1: ${settings.reminder_time_1}, Slot 2: ${settings.reminder_time_2_enabled ? settings.reminder_time_2 : "Disabled"}).`,
        istTime: ist.time12,
        istDate,
      };
      if (res && typeof res.json === "function") return res.status(200).json(resp);
      return new Response(JSON.stringify(resp), { status: 200 });
    }

    // 6. Execute reminder process for the target slot
    console.log(`[CronScheduler] Executing ${targetSlot} attendance reminder for ${istDate} at ${ist.time12}...`);
    const runResult = await executeAttendanceReminders({
      forceSlot: targetSlot,
      isManual: false,
    });

    const finalResponse = {
      success: true,
      executed: true,
      slot: targetSlot,
      result: runResult,
      istTime: ist.time12,
      istDate,
    };

    if (res && typeof res.json === "function") return res.status(200).json(finalResponse);
    return new Response(JSON.stringify(finalResponse), { status: 200 });
  } catch (err: any) {
    console.error("[api/cron/attendance-reminders] Scheduled cron error:", err);
    const errResp = {
      success: false,
      error: "CRON_EXECUTION_FAILED",
      message: err?.message || "Scheduled attendance reminder execution failed.",
    };
    if (res && typeof res.status === "function") return res.status(500).json(errResp);
    return new Response(JSON.stringify(errResp), { status: 500 });
  }
}

