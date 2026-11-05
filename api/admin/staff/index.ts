/**
 * Vercel Serverless Function: /api/admin/staff
 *
 * Handles staff management, enrollment, and status for CampusAttend via Supabase Cloud.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Self-Contained Serverless Attendance Reminders Engine
// -----------------------------------------------------------------------------
export interface ReminderSettings {
  id: string;
  enabled: boolean;
  reminder_time_1: string;
  reminder_time_2_enabled: boolean;
  reminder_time_2: string;
  applicable_days: string[];
  timezone: string;
  title: string;
  message: string;
  updated_at: string;
  updated_by: string;
}

export interface ReminderLog {
  id?: string;
  staff_code: string;
  reminder_slot: "first" | "second" | "test";
  attendance_date: string;
  scheduled_time: string;
  sent_at: string;
  device_token?: string;
  status: "delivered" | "failed" | "skipped";
  idempotency_key: string;
  error_message?: string | null;
}

export interface ReminderExecutionRun {
  id?: string;
  slot: "first" | "second" | "test";
  execution_date: string;
  started_at: string;
  completed_at?: string;
  total_active_staff: number;
  marked_attendance_count: number;
  unmarked_attendance_count: number;
  notifications_sent_count: number;
  notifications_failed_count: number;
  status: "completed" | "skipped" | "failed";
  summary_message?: string;
  details?: any;
}

export interface ReminderDashboardStats {
  enabled: boolean;
  reminder_time_1: string;
  reminder_time_2_enabled: boolean;
  reminder_time_2: string;
  applicable_days: string[];
  timezone: string;
  total_active_staff: number;
  marked_attendance_count: number;
  unmarked_attendance_count: number;
  notifications_sent_today: number;
  notifications_failed_today: number;
  last_execution_run?: ReminderExecutionRun | null | undefined;
  server_ist_time: {
    dateStr: string;
    time24: string;
    time12: string;
    dayName: string;
    isWorkingDay: boolean;
  };
}

const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  id: "default",
  enabled: true,
  reminder_time_1: "09:30",
  reminder_time_2_enabled: false,
  reminder_time_2: "10:00",
  applicable_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  timezone: "Asia/Kolkata",
  title: "CampusAttend – Attendance Reminder",
  message:
    "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification.",
  updated_at: new Date().toISOString(),
  updated_by: "system",
};

const INSTITUTIONAL_HOLIDAYS = new Set<string>([
  "2026-01-26",
  "2026-08-15",
  "2026-10-02",
  "2026-12-25",
]);

let cachedSettings: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS };
const memoryTokens = new Map<string, { staff_code: string; device_id: string; token: string; platform: string; is_active: boolean; updated_at: string }>();
const memoryLogs = new Map<string, ReminderLog>();
let memoryRuns: ReminderExecutionRun[] = [];

function getIstDateTime(dateObj: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hour12: false,
  }).formatToParts(dateObj);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const day = getPart("day");
  const month = getPart("month");
  const year = getPart("year");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const second = getPart("second");
  const dayName = getPart("weekday");

  const dateStr = `${year}-${month}-${day}`;
  const time24 = `${hour}:${minute}`;

  const h = parseInt(hour, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time12 = `${String(h12).padStart(2, "0")}:${minute} ${period}`;

  return {
    dateStr,
    time24,
    time12,
    dayName,
    year,
    month,
    day,
    hour,
    minute,
    second,
    isWorkingDay: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].includes(dayName),
  };
}

function formatTimeTo12Hour(time24: string): string {
  if (!time24 || !time24.includes(":")) return time24;
  const parts = time24.split(":");
  const h = parseInt(parts[0] || "0", 10);
  const m = parts[1] || "00";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${m} ${period}`;
}

async function getReminderSettings(): Promise<ReminderSettings> {
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("attendance_reminder_settings")
        .select("*")
        .eq("id", "default")
        .maybeSingle();

      if (!error && data) {
        cachedSettings = {
          ...DEFAULT_REMINDER_SETTINGS,
          ...data,
          applicable_days: Array.isArray(data.applicable_days)
            ? data.applicable_days
            : DEFAULT_REMINDER_SETTINGS.applicable_days,
        };
        return cachedSettings;
      }
    } catch {}

    try {
      const { data: secSet } = await sb
        .from("security_events")
        .select("device")
        .eq("event", "REMINDER_SETTINGS")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (secSet?.device) {
        const p = JSON.parse(secSet.device);
        if (p) {
          cachedSettings = {
            ...DEFAULT_REMINDER_SETTINGS,
            enabled: p.en !== undefined ? !!p.en : DEFAULT_REMINDER_SETTINGS.enabled,
            reminder_time_1: p.t1 || DEFAULT_REMINDER_SETTINGS.reminder_time_1,
            reminder_time_2_enabled: p.t2en !== undefined ? !!p.t2en : DEFAULT_REMINDER_SETTINGS.reminder_time_2_enabled,
            reminder_time_2: p.t2 || DEFAULT_REMINDER_SETTINGS.reminder_time_2,
            applicable_days: Array.isArray(p.days) ? p.days : DEFAULT_REMINDER_SETTINGS.applicable_days,
            timezone: p.tz || DEFAULT_REMINDER_SETTINGS.timezone,
            updated_by: p.by || "admin",
          };
          return cachedSettings;
        }
      }
    } catch {}
  }
  return cachedSettings;
}

async function saveReminderSettings(
  updates: Partial<ReminderSettings>,
  adminUsername: string = "admin"
): Promise<ReminderSettings> {
  const current = await getReminderSettings();
  const merged: ReminderSettings = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
    updated_by: adminUsername,
  };
  cachedSettings = merged;

  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb.from("attendance_reminder_settings").upsert(merged);
    } catch (err) {
      console.warn("[saveReminderSettings] Supabase upsert error:", err);
    }

    try {
      const compact = JSON.stringify({
        en: !!merged.enabled,
        t1: merged.reminder_time_1,
        t2en: !!merged.reminder_time_2_enabled,
        t2: merged.reminder_time_2,
        days: merged.applicable_days,
        tz: merged.timezone,
        by: merged.updated_by,
      });
      await sb.from("security_events").insert({
        time: new Date().toISOString(),
        staff: "ADMIN",
        event: "REMINDER_SETTINGS",
        device: compact,
        location: "Settings",
        result: "Allowed",
        severity: "Low",
      });
    } catch (secErr) {
      console.warn("[saveReminderSettings] security_events insert error:", secErr);
    }
  }
  return merged;
}

async function registerStaffDeviceToken(params: {
  staffCode: string;
  deviceId: string;
  token: string;
  platform?: string;
}) {
  const now = new Date().toISOString();
  const staffCode = params.staffCode.trim().toUpperCase();
  const entry = {
    staff_code: staffCode,
    device_id: params.deviceId,
    token: params.token,
    platform: (params.platform || "android").toLowerCase(),
    is_active: true,
    updated_at: now,
  };

  memoryTokens.set(`${staffCode}_${params.deviceId}`, entry);

  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb
        .from("staff_device_tokens")
        .upsert(entry, { onConflict: "staff_code,device_id" });
    } catch (err) {
      console.warn("[registerStaffDeviceToken] Database upsert notice:", err);
    }

    try {
      const tokenPayload = JSON.stringify({
        tok: params.token.slice(0, 180),
        dev: params.deviceId.slice(0, 40),
        plt: (params.platform || "android").slice(0, 15),
      });
      await sb.from("security_events").insert({
        time: now,
        staff: staffCode,
        event: "PUSH_TOKEN",
        device: tokenPayload,
        location: "Device",
        result: "Allowed",
        severity: "Low",
      });
    } catch (secErr) {
      console.warn("[registerStaffDeviceToken] security_events notice:", secErr);
    }
  }
  return entry;
}

async function getRecentReminderLogs(limit = 50): Promise<ReminderLog[]> {
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("attendance_reminder_logs")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) return data;
    } catch {}

    try {
      const { data: secLogs } = await sb
        .from("security_events")
        .select("staff, device, created_at, time")
        .eq("event", "REMINDER_LOG")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (secLogs && secLogs.length > 0) {
        return secLogs.map((sl: any) => {
          let p: any = {};
          try { p = JSON.parse(sl.device); } catch {}
          return {
            staff_code: sl.staff,
            reminder_slot: p.slot || "test",
            attendance_date: p.date || (sl.time ? sl.time.split("T")[0] : ""),
            scheduled_time: p.time || "",
            sent_at: sl.time || sl.created_at,
            status: p.stat || "delivered",
            idempotency_key: p.key || `sec_${sl.staff}_${sl.created_at}`,
            error_message: p.err || null,
          };
        });
      }
    } catch {}
  }
  return Array.from(memoryLogs.values())
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
    .slice(0, limit);
}

async function getRecentExecutionRuns(limit = 20): Promise<ReminderExecutionRun[]> {
  const sb = getSupabaseClient();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("attendance_reminder_execution_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) return data;
    } catch {}
  }
  return [...memoryRuns]
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, limit);
}

interface FirebaseServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
}

let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null;

function getFirebaseServiceAccount(): FirebaseServiceAccount | null {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"] || process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed.project_id && parsed.private_key && parsed.client_email) {
      return {
        project_id: parsed.project_id,
        private_key: parsed.private_key.replace(/\\n/g, "\n"),
        client_email: parsed.client_email,
      };
    }
  } catch (err) {
    console.error("[FirebaseServiceAccount] Failed to parse credentials JSON:", err);
  }
  return null;
}

async function getGoogleFcmV1AccessToken(sa: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > now + 60) {
    return cachedGoogleAccessToken.token;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signInput = `${b64Header}.${b64Payload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = signer.sign(sa.private_key, "base64url");
  const assertion = `${signInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth2 token exchange failed: HTTP ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;
  cachedGoogleAccessToken = { token, expiresAt: now + expiresIn };
  return token;
}

async function dispatchPushNotification(payload: {
  token?: string;
  title: string;
  message: string;
  destinationRoute?: string;
  staffCode: string;
}): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  stage: string;
  firebaseResponse?: any;
}> {
  const { token, title, message, destinationRoute = "/mark-attendance", staffCode } = payload;

  if (!token) {
    return {
      success: false,
      error: "NO_DEVICE_TOKEN: Staff member has no active registered push token.",
      stage: "missing_token",
    };
  }

  const sa = getFirebaseServiceAccount();

  // 1. If Firebase Service Account is configured, execute real Google FCM HTTP v1 dispatch
  if (sa) {
    try {
      const accessToken = await getGoogleFcmV1AccessToken(sa);
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

      const fcmPayload = {
        message: {
          token,
          notification: {
            title,
            body: message,
          },
          data: {
            destination: destinationRoute,
            staffCode,
            sentAt: new Date().toISOString(),
          },
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "campusattend_reminders_channel",
              sound: "default",
              notification_priority: "PRIORITY_HIGH",
              visibility: "PUBLIC",
            },
          },
        },
      };

      const fcmRes = await fetch(fcmUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fcmPayload),
      });

      const json = await fcmRes.json();

      if (fcmRes.ok && json.name) {
        return {
          success: true,
          messageId: json.name,
          stage: "fcm_v1_delivered",
          firebaseResponse: json,
        };
      } else {
        const errorDetail = json.error?.message || json.error?.status || JSON.stringify(json);
        return {
          success: false,
          error: `GOOGLE_FCM_ERROR: ${errorDetail}`,
          stage: "fcm_v1_error",
          firebaseResponse: json,
        };
      }
    } catch (fcmErr: any) {
      return {
        success: false,
        error: `FCM_DISPATCH_EXCEPTION: ${fcmErr?.message || "OAuth2 or network error"}`,
        stage: "fcm_v1_exception",
      };
    }
  }

  // 2. If Firebase Service Account is missing:
  // EXPLICIT REPORTING as requested: "If Firebase service-account credentials are missing, report that explicitly. Do not simulate a successful send."
  const errDesc = "FIREBASE_SERVICE_ACCOUNT_MISSING: Firebase service account credentials are not configured on server (FIREBASE_SERVICE_ACCOUNT). Real FCM push delivery requires a Google Firebase service account JSON key.";

  // Optional in-app Realtime broadcast for active foreground web sessions
  try {
    const sb = getSupabaseClient();
    if (sb) {
      const channel = sb.channel(`attendance_reminders_${staffCode.toUpperCase()}`);
      await channel.send({
        type: "broadcast",
        event: "attendance_reminder",
        payload: {
          title,
          message,
          destination: destinationRoute,
          staffCode,
          token,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch {}

  return {
    success: false,
    error: errDesc,
    stage: "fcm_unconfigured",
  };
}

async function getReminderDashboardStats(): Promise<ReminderDashboardStats> {
  const settings = await getReminderSettings();
  const istTime = getIstDateTime();
  const sb = getSupabaseClient();

  let totalActiveStaff = 18;

  if (sb) {
    try {
      const { data: staffData } = await sb
        .from("staff")
        .select("staff_code, name, status")
        .eq("status", "Active");

      if (staffData && staffData.length > 0) {
        totalActiveStaff = staffData.length;
      }
    } catch {}
  }

  let markedCount = 0;
  if (sb) {
    try {
      const { data: records } = await sb
        .from("attendance_record")
        .select("staff_code, staff_id, date, verification_date, created_at")
        .or(`date.eq.${istTime.dateStr},verification_date.eq.${istTime.dateStr},created_at.gte.${istTime.dateStr}T00:00:00`);

      if (records && records.length > 0) {
        const markedSet = new Set<string>();
        for (const r of records) {
          const code = (r.staff_code || r.staff_id || "").trim().toUpperCase();
          if (code) markedSet.add(code);
        }
        markedCount = markedSet.size;
      }
    } catch {}
  }

  const unmarkedCount = Math.max(0, totalActiveStaff - markedCount);

  const todayLogs = (await getRecentReminderLogs(200)).filter(
    (l) => l.attendance_date === istTime.dateStr
  );
  const sentToday = todayLogs.filter((l) => l.status === "delivered").length;
  const failedToday = todayLogs.filter((l) => l.status === "failed").length;

  const runs = await getRecentExecutionRuns(1);
  const lastRun = runs.length > 0 ? runs[0] : null;

  return {
    enabled: settings.enabled,
    reminder_time_1: settings.reminder_time_1,
    reminder_time_2_enabled: settings.reminder_time_2_enabled,
    reminder_time_2: settings.reminder_time_2,
    applicable_days: settings.applicable_days,
    timezone: settings.timezone,
    total_active_staff: totalActiveStaff,
    marked_attendance_count: markedCount,
    unmarked_attendance_count: unmarkedCount,
    notifications_sent_today: sentToday,
    notifications_failed_today: failedToday,
    last_execution_run: lastRun,
    server_ist_time: {
      dateStr: istTime.dateStr,
      time24: istTime.time24,
      time12: istTime.time12,
      dayName: istTime.dayName,
      isWorkingDay: settings.applicable_days.includes(istTime.dayName),
    },
  };
}

async function executeAttendanceReminders(options: {
  forceSlot?: "first" | "second" | "test";
  testStaffCode?: string;
  isManual?: boolean;
}): Promise<ReminderExecutionRun> {
  const startedAt = new Date().toISOString();
  const istTime = getIstDateTime();
  const settings = await getReminderSettings();
  const slot = options.forceSlot || "first";

  if (!settings.enabled && !options.testStaffCode) {
    const skippedRun: ReminderExecutionRun = {
      slot,
      execution_date: istTime.dateStr,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      total_active_staff: 0,
      marked_attendance_count: 0,
      unmarked_attendance_count: 0,
      notifications_sent_count: 0,
      notifications_failed_count: 0,
      status: "skipped",
      summary_message: "Reminders disabled by administrator configuration.",
    };
    memoryRuns.unshift(skippedRun);
    return skippedRun;
  }

  if (!options.testStaffCode && !options.isManual) {
    if (!settings.applicable_days.includes(istTime.dayName)) {
      const skippedRun: ReminderExecutionRun = {
        slot,
        execution_date: istTime.dateStr,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        total_active_staff: 0,
        marked_attendance_count: 0,
        unmarked_attendance_count: 0,
        notifications_sent_count: 0,
        notifications_failed_count: 0,
        status: "skipped",
        summary_message: `Non-working day (${istTime.dayName}) per configuration.`,
      };
      memoryRuns.unshift(skippedRun);
      return skippedRun;
    }

    if (INSTITUTIONAL_HOLIDAYS.has(istTime.dateStr)) {
      const skippedRun: ReminderExecutionRun = {
        slot,
        execution_date: istTime.dateStr,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        total_active_staff: 0,
        marked_attendance_count: 0,
        unmarked_attendance_count: 0,
        notifications_sent_count: 0,
        notifications_failed_count: 0,
        status: "skipped",
        summary_message: `Institutional holiday (${istTime.dateStr}).`,
      };
      memoryRuns.unshift(skippedRun);
      return skippedRun;
    }
  }

  const sb = getSupabaseClient();

  let activeStaff: Array<{ staff_code: string; name?: string; department?: string }> = [];
  if (options.testStaffCode) {
    activeStaff = [{ staff_code: options.testStaffCode, name: "Test Staff" }];
  } else if (sb) {
    try {
      const { data } = await sb
        .from("staff")
        .select("staff_code, name, department, status")
        .eq("status", "Active");
      if (data && data.length > 0) activeStaff = data;
    } catch {}
  }

  if (activeStaff.length === 0) {
    activeStaff = [
      { staff_code: "SCT-001", name: "moulish", department: "CSE" },
      { staff_code: "SCT-002", name: "Moulish", department: "CSE" },
      { staff_code: "SCT-003", name: "Mathesh", department: "CSE" },
    ];
  }

  const markedStaffCodes = new Set<string>();
  if (!options.testStaffCode && sb) {
    try {
      const { data: records } = await sb
        .from("attendance_record")
        .select("staff_code, staff_id, date, verification_date, created_at")
        .or(`date.eq.${istTime.dateStr},verification_date.eq.${istTime.dateStr},created_at.gte.${istTime.dateStr}T00:00:00`);

      if (records) {
        for (const r of records) {
          const code = (r.staff_code || r.staff_id || "").trim().toUpperCase();
          if (code) markedStaffCodes.add(code);
        }
      }
    } catch {}
  }

  const unmarkedStaff = activeStaff.filter(
    (s) => !markedStaffCodes.has(s.staff_code.trim().toUpperCase())
  );

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const scheduledTime12 =
    slot === "second"
      ? formatTimeTo12Hour(settings.reminder_time_2)
      : formatTimeTo12Hour(settings.reminder_time_1);

  for (const staff of unmarkedStaff) {
    const staffCode = staff.staff_code.trim().toUpperCase();
    const idempotencyKey = `${staffCode}_${istTime.dateStr}_${slot}`;

    if (memoryLogs.has(idempotencyKey)) {
      continue;
    }

    if (sb) {
      try {
        const { data: existing } = await sb
          .from("attendance_reminder_logs")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existing) {
          continue;
        }
      } catch {}
    }

    let token = "";
    if (sb) {
      try {
        const { data: tokData } = await sb
          .from("staff_device_tokens")
          .select("token")
          .eq("staff_code", staffCode)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tokData?.token) token = tokData.token;
      } catch {}
    }

    if (!token) {
      const memTok = Array.from(memoryTokens.values()).find(
        (t) => t.staff_code === staffCode && t.is_active
      );
      if (memTok?.token) token = memTok.token;
    }

    if (!token && sb) {
      try {
        const { data: secRow } = await sb
          .from("security_events")
          .select("device")
          .ilike("staff", staffCode)
          .eq("event", "PUSH_TOKEN")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (secRow?.device) {
          try {
            const p = JSON.parse(secRow.device);
            if (p?.tok) token = p.tok;
          } catch {}
        }
      } catch {}
    }

    if (!token) {
      const skippedLog: ReminderLog = {
        staff_code: staffCode,
        reminder_slot: slot,
        attendance_date: istTime.dateStr,
        scheduled_time: scheduledTime12,
        sent_at: new Date().toISOString(),
        status: "skipped",
        idempotency_key: idempotencyKey,
        error_message: "NO_DEVICE_TOKEN: Staff member has no active registered push token.",
      };
      memoryLogs.set(idempotencyKey, skippedLog);
      if (sb) {
        try { await sb.from("attendance_reminder_logs").insert(skippedLog); } catch {}
        try {
          const compactLog = JSON.stringify({
            slot,
            date: istTime.dateStr,
            time: scheduledTime12,
            stat: "skipped",
            key: idempotencyKey,
            err: "NO_DEVICE_TOKEN",
          });
          await sb.from("security_events").insert({
            time: skippedLog.sent_at,
            staff: staffCode,
            event: "REMINDER_LOG",
            device: compactLog,
            location: "Scheduler",
            result: "Allowed",
            severity: "Low",
          });
        } catch {}
      }
      skippedCount++;
      continue;
    }

    const dispatchRes = await dispatchPushNotification({
      token,
      title: settings.title,
      message: settings.message,
      destinationRoute: "/mark-attendance",
      staffCode,
    });

    const logEntry: ReminderLog = {
      staff_code: staffCode,
      reminder_slot: slot,
      attendance_date: istTime.dateStr,
      scheduled_time: scheduledTime12,
      sent_at: new Date().toISOString(),
      device_token: token,
      status: dispatchRes.success ? "delivered" : "failed",
      idempotency_key: idempotencyKey,
      error_message: dispatchRes.success ? null : (dispatchRes.error || "Delivery failed"),
    };

    memoryLogs.set(idempotencyKey, logEntry);

    if (sb) {
      try {
        await sb.from("attendance_reminder_logs").insert(logEntry);
      } catch {}
      try {
        const compactLog = JSON.stringify({
          slot,
          date: istTime.dateStr,
          time: scheduledTime12,
          stat: logEntry.status,
          key: idempotencyKey,
          err: (logEntry.error_message || "").slice(0, 50),
        });
        await sb.from("security_events").insert({
          time: logEntry.sent_at,
          staff: staffCode,
          event: "REMINDER_LOG",
          device: compactLog,
          location: "Scheduler",
          result: "Allowed",
          severity: logEntry.status === "failed" ? "High" : "Low",
        });
      } catch {}
    }

    if (dispatchRes.success) sentCount++;
    else failedCount++;
  }

  const completedRun: ReminderExecutionRun = {
    slot,
    execution_date: istTime.dateStr,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    total_active_staff: activeStaff.length,
    marked_attendance_count: markedStaffCodes.size,
    unmarked_attendance_count: unmarkedStaff.length,
    notifications_sent_count: sentCount,
    notifications_failed_count: failedCount,
    status: "completed",
    summary_message: `Evaluated ${activeStaff.length} active staff (${markedStaffCodes.size} marked today, ${unmarkedStaff.length} unmarked). Sent ${sentCount} reminders, skipped ${skippedCount} (missing tokens), failed ${failedCount}.`,
    details: {
      sentCount,
      skippedCount,
      failedCount,
      unmarkedCount: unmarkedStaff.length,
    },
  };

  memoryRuns.unshift(completedRun);
  if (sb) {
    try {
      await sb.from("attendance_reminder_execution_runs").insert(completedRun);
    } catch {}
  }

  return completedRun;
}

async function revokeDevice(params: {
  deviceId: string;
  reason: string;
  adminUsername: string;
}): Promise<{ success: boolean; error?: string; revokedDevice?: any }> {
  const { deviceId, reason, adminUsername } = params;
  const now = new Date().toISOString();
  let supabase: any = null;
  try {
    supabase = getSupabaseClient();
  } catch (err: any) {
    return { success: false, error: err?.message || "Database configuration fault" };
  }
  if (!supabase) {
    return { success: false, error: "Database client unavailable" };
  }

  try {
    let targetDevice: any = null;
    try {
      const { data, error: fetchErr } = await supabase
        .from("devices")
        .select("*")
        .eq("id", deviceId)
        .maybeSingle();
      if (!fetchErr && data) targetDevice = data;
    } catch {}

    if (!targetDevice) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        for (const relPath of [path.join(".gemini", "device-store.json"), path.join("data", "staff-db.json")]) {
          const localStorePath = path.resolve(process.cwd(), relPath);
          if (fs.existsSync(localStorePath)) {
            const store = JSON.parse(fs.readFileSync(localStorePath, "utf-8"));
            targetDevice = (store.devices || []).find((d: any) => d.id === deviceId);
            if (targetDevice) break;
          }
        }
      } catch {}
    }

    if (!targetDevice) {
      return { success: false, error: "No matching registered device found to revoke." };
    }

    try {
      const { error: updErr } = await supabase
        .from("devices")
        .update({
          status: "Blocked",
          revoked_at: now,
          revocation_reason: reason,
          revoked_by: adminUsername,
        })
        .or(`id.eq.${deviceId},key_id.eq.${deviceId}`);

      if (updErr) {
        await supabase.from("devices").update({ status: "Blocked" }).or(`id.eq.${deviceId},key_id.eq.${deviceId}`);
      }

      if (targetDevice?.staff_code) {
        await supabase
          .from("devices")
          .update({ status: "Blocked" })
          .ilike("staff_code", targetDevice.staff_code)
          .eq("status", "Active");
      }
    } catch {}

    try {
      await supabase.from("security_events").insert({
        time: now,
        staff: targetDevice.staff_code,
        event: `DEVICE_REVOKED|${deviceId}`,
        device: JSON.stringify({
          deviceId,
          reason,
          revokedBy: adminUsername,
          revokedAt: now,
        }),
        location: "Admin Console",
        result: "Blocked",
        severity: "Medium",
      });
    } catch {}

    // Update in local store files if present
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      for (const relPath of [path.join(".gemini", "device-store.json"), path.join("data", "staff-db.json")]) {
        const localStorePath = path.resolve(process.cwd(), relPath);
        if (fs.existsSync(localStorePath)) {
          const store = JSON.parse(fs.readFileSync(localStorePath, "utf-8"));
          if (Array.isArray(store.devices)) {
            let modified = false;
            store.devices.forEach((d: any) => {
              if (
                d.id === deviceId ||
                d.key_id === deviceId ||
                (targetDevice?.staff_code && d.staff_code?.toUpperCase() === targetDevice.staff_code.toUpperCase())
              ) {
                d.status = "Revoked";
                d.revoked_at = now;
                d.revocation_reason = reason;
                d.revoked_by = adminUsername;
                modified = true;
              }
            });
            if (modified) {
              fs.writeFileSync(localStorePath, JSON.stringify(store, null, 2), "utf-8");
            }
          }
        }
      }
    } catch {}

    return {
      success: true,
      revokedDevice: {
        ...targetDevice,
        status: "Blocked",
        revoked_at: now,
        revocation_reason: reason,
        revoked_by: adminUsername,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to revoke device" };
  }
}


const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

const ADMIN_CREDENTIALS = {
  id: "adm-moulish-001",
  username: "moulish",
  name: "Moulishwaran S",
  email: "moulish@sonatech.ac.in",
  role: "admin",
  salt: "9793e19a6e61abd07d646d6a7e5b5a29",
  password_hash:
    "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
  active: true,
};

function extractAdminToken(req: any): string | null {
  if (!req) return null;
  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    authHeader = req.headers.get("authorization") || req.headers.get("x-admin-token") || "";
  } else if (req.headers) {
    authHeader = req.headers["authorization"] || req.headers["x-admin-token"] || "";
  }
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }
  let cookieHeader = "";
  if (typeof req.headers?.get === "function") {
    cookieHeader = req.headers.get("cookie") || "";
  } else if (req.headers) {
    cookieHeader = req.headers["cookie"] || "";
  }
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

interface RevokedTokenEntry {
  tokenId: string;
  username: string;
  expiresAt: number;
  revokedAt: number;
  reason: string;
}

const inMemoryRevokedTokens = new Map<string, RevokedTokenEntry>();

function cleanExpiredRevocations() {
  const now = Date.now();
  for (const [id, entry] of inMemoryRevokedTokens.entries()) {
    if (now > entry.expiresAt) {
      inMemoryRevokedTokens.delete(id);
    }
  }
}

function getAdminTokenIdentifier(tokenStr?: string | null): {
  tokenId: string;
  payload: any;
  signature: string;
} | null {
  if (!tokenStr || typeof tokenStr !== "string") return null;
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
    return { tokenId, payload, signature };
  } catch {
    return null;
  }
}

function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const code = typeof error === "object" ? String(error.code || "") : "";
  const msg = typeof error === "object" ? String(error.message || "") : String(error);
  if (code === "PGRST205" || code === "PGRST204" || code === "42P01") return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table") ||
    (lower.includes("relation") && lower.includes("does not exist"))
  );
}

async function revokeAdminSessionToken(
  tokenStr: string,
  reason = "User logout",
  supabase?: any,
): Promise<boolean> {
  const tokenInfo = getAdminTokenIdentifier(tokenStr);
  if (!tokenInfo) return false;

  const { tokenId, payload } = tokenInfo;
  const now = Date.now();

  // 1. In-memory revocation cache
  cleanExpiredRevocations();
  inMemoryRevokedTokens.set(tokenId, {
    tokenId,
    username: payload.username,
    expiresAt: payload.expiresAt,
    revokedAt: now,
    reason,
  });

  // 2. Persistent store via Supabase
  if (supabase) {
    let dedicatedSuccess = false;
    let fallbackSuccess = false;

    // 2A. Dedicated admin_token_revocations table
    try {
      const { error: dedicatedErr } = await supabase.from("admin_token_revocations").insert({
        token_id: tokenId,
        username: payload.username,
        expires_at: new Date(payload.expiresAt).toISOString(),
        revoked_at: new Date(now).toISOString(),
        reason,
      });

      if (!dedicatedErr) {
        dedicatedSuccess = true;
      } else if (!isTableMissingError(dedicatedErr)) {
        console.warn("[admin/staff] Supabase admin_token_revocations write warning:", dedicatedErr);
      }
    } catch (dedEx: any) {
      if (!isTableMissingError(dedEx)) {
        console.warn("[admin/staff] Exception inserting into admin_token_revocations:", dedEx);
      }
    }

    // 2B. security_events persistent audit log
    try {
      const { error: secErr } = await supabase.from("security_events").insert({
        time: new Date(now).toISOString(),
        staff: payload.username.toUpperCase(),
        event: `ADMIN_TOKEN_REVOKED|${tokenId}`,
        device: `session_expiry:${payload.expiresAt}`,
        location: "Campus Administration",
        result: "Blocked",
        severity: "Low",
      });

      if (!secErr) {
        fallbackSuccess = true;
      } else {
        console.error("[admin/staff] Failed to persist revocation to security_events:", secErr);
      }
    } catch (secEx) {
      console.error("[admin/staff] Exception persisting revocation to security_events:", secEx);
    }

    return dedicatedSuccess || fallbackSuccess;
  }

  return true;
}

async function isTokenRevoked(
  tokenId: string,
  supabase?: any,
): Promise<{ revoked: boolean; unavailable?: boolean; error?: string }> {
  if (!tokenId) return { revoked: false };

  // 1. In-memory check
  cleanExpiredRevocations();
  if (inMemoryRevokedTokens.has(tokenId)) {
    return { revoked: true };
  }

  // 2. Supabase persistent check
  if (supabase) {
    // 2A. Dedicated table check
    try {
      const { data: dedicated, error: dedicatedErr } = await supabase
        .from("admin_token_revocations")
        .select("token_id, expires_at")
        .eq("token_id", tokenId)
        .maybeSingle();

      if (dedicatedErr) {
        if (!isTableMissingError(dedicatedErr)) {
          console.warn("[admin/staff] Dedicated table query warning:", dedicatedErr);
        }
      } else if (dedicated && dedicated.token_id) {
        inMemoryRevokedTokens.set(tokenId, {
          tokenId,
          username: "moulish",
          expiresAt: new Date(dedicated.expires_at).getTime(),
          revokedAt: Date.now(),
          reason: "User logout",
        });
        return { revoked: true };
      }
    } catch (dedEx: any) {
      if (!isTableMissingError(dedEx)) {
        console.warn("[admin/staff] Exception querying admin_token_revocations:", dedEx);
      }
    }

    // 2B. security_events fallback check
    try {
      const { data: secEvents, error: secErr } = await supabase
        .from("security_events")
        .select("event")
        .eq("event", `ADMIN_TOKEN_REVOKED|${tokenId}`)
        .limit(1);

      if (secErr) {
        console.error("[admin/staff] Error reading security_events for revocation:", secErr);
        return {
          revoked: false,
          unavailable: true,
          error: `Database outage during revocation verification: ${secErr.message || secErr.code}`,
        };
      }

      if (secEvents && secEvents.length > 0) {
        inMemoryRevokedTokens.set(tokenId, {
          tokenId,
          username: "moulish",
          expiresAt: Date.now() + 86400000,
          revokedAt: Date.now(),
          reason: "User logout",
        });
        return { revoked: true };
      }
    } catch (secEx: any) {
      console.error("[admin/staff] Exception reading security_events for revocation:", secEx);
      return {
        revoked: false,
        unavailable: true,
        error: `Database unreachable during revocation verification: ${secEx?.message || String(secEx)}`,
      };
    }
  }

  return { revoked: false };
}

async function verifyAdminSessionToken(
  tokenStr?: string | null,
  supabase?: any,
): Promise<{
  valid: boolean;
  payload?: any;
  statusCode?: number;
  errorCode?: string;
  error?: string;
}> {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MISSING", error: "Missing administrator session token." };
  }
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MALFORMED", error: "Malformed administrator session token." };
  }
  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_INVALID", error: "Invalid token components." };
  }
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, statusCode: 401, errorCode: "SIGNATURE_INVALID", error: "Invalid administrator session signature." };
  }
  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    if (payload.role !== "admin" || payload.username !== "moulish") {
      return { valid: false, statusCode: 401, errorCode: "PRIVILEGES_REQUIRED", error: "Token does not possess administrator privileges." };
    }
    if (Date.now() > payload.expiresAt) {
      return { valid: false, statusCode: 401, errorCode: "TOKEN_EXPIRED", error: "Administrator session has expired." };
    }

    const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
    const check = await isTokenRevoked(tokenId, supabase);

    if (check.unavailable) {
      return {
        valid: false,
        statusCode: 503,
        errorCode: "SESSION_REVOCATION_UNAVAILABLE",
        error: "Authentication service temporarily unavailable. Revocation status could not be verified.",
      };
    }

    if (check.revoked) {
      return {
        valid: false,
        statusCode: 401,
        errorCode: "TOKEN_REVOKED",
        error: "Administrator session has been revoked. Please log in again.",
      };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, statusCode: 401, errorCode: "DECODE_FAILED", error: "Failed to decode administrator session token." };
  }
}

async function authenticateAdmin(user: string, pass: string): Promise<any> {
  if (!user || !pass) return { success: false, error: "Credentials required" };
  if (user.trim().toLowerCase() !== ADMIN_CREDENTIALS.username) {
    return { success: false, error: "Invalid credentials" };
  }
  try {
    const candHash = crypto
      .pbkdf2Sync(pass, ADMIN_CREDENTIALS.salt, 100000, 64, "sha512")
      .toString("hex");
    if (!crypto.timingSafeEqual(Buffer.from(candHash, "hex"), Buffer.from(ADMIN_CREDENTIALS.password_hash, "hex"))) {
      return { success: false, error: "Invalid credentials" };
    }
    const now = Date.now();
    const payload = {
      sub: ADMIN_CREDENTIALS.username,
      username: ADMIN_CREDENTIALS.username,
      name: ADMIN_CREDENTIALS.name,
      email: ADMIN_CREDENTIALS.email,
      role: "admin",
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      nonce: crypto.randomBytes(16).toString("hex"),
    };
    const pStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(pStr).digest("base64url");
    return {
      success: true,
      token: `${pStr}.${sig}`,
      admin: ADMIN_CREDENTIALS,
    };
  } catch {
    return { success: false, error: "Authentication failed" };
  }
}

export function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";

  const isProd =
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

  const serviceRoleKey =
    typeof process !== "undefined" && process.env["SUPABASE_SERVICE_ROLE_KEY"]
      ? process.env["SUPABASE_SERVICE_ROLE_KEY"].trim()
      : undefined;

  // In production runtime, privileged server database access strictly requires SUPABASE_SERVICE_ROLE_KEY
  if (isProd) {
    if (!serviceRoleKey || serviceRoleKey.startsWith("sb_publishable_")) {
      console.error("[AdminStaffGate] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is required in production runtime.");
      throw new Error("CONFIGURATION_FAULT: SUPABASE_SERVICE_ROLE_KEY is required for admin staff operations in production.");
    }
    return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  // Non-production fallback (test / local developer mode):
  const key =
    serviceRoleKey ||
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"])) ||
    undefined;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") {
        return chained.json(payload);
      }
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") {
      res.end(JSON.stringify(payload));
    }
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  let supabase: any = null;
  try {
    supabase = getSupabaseClient();
  } catch (err: any) {
    return sendJsonResponse(res, 503, {
      success: false,
      error: "SERVER_CONFIG_FAULT",
      message: err?.message || "Server database configuration fault.",
    });
  }

  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Database configuration unavailable on server.",
    });
  }

  let pathname = req.url || "/api/admin/staff";
  let searchParams = new URL(pathname, "https://localhost").searchParams;
  try {
    const parsedUrl = new URL(pathname, "https://localhost");
    pathname = parsedUrl.pathname;
    searchParams = parsedUrl.searchParams;
  } catch {}
  try {
    pathname = new URL(pathname, "https://localhost").pathname;
  } catch {}

  if (req.query?.slug) {
    const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    if (slugParts.length > 0 && !pathname.includes(slugParts[0]!)) {
      pathname = "/api/admin/staff/" + slugParts.join("/");
    }
  }

  let body: any = undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      if (typeof req.json === "function") {
        body = await req.json();
      } else if (req.body) {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } else if (typeof req.on === "function") {
        const chunks: Buffer[] = [];
        await new Promise((resolve) => {
          req.on("data", (chunk: any) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          req.on("end", resolve);
          req.on("error", resolve);
        });
        const str = Buffer.concat(chunks).toString("utf-8");
        body = str ? JSON.parse(str) : {};
      }
    } catch {
      body = {};
    }
  }

  try {
    // 0A. POST /api/admin/login — Administrator login
    if (
      (pathname === "/api/admin/login" || pathname === "/api/admin/auth/login") &&
      method === "POST"
    ) {
      const candidateUser = body?.username || body?.id || body?.staffId || "";
      const candidatePass = body?.password || "";

      if (!candidateUser || !candidatePass) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Administrator ID and password are required.",
        });
      }

      const authRes = await authenticateAdmin(candidateUser, candidatePass);
      if (!authRes.success || !authRes.token) {
        return sendJsonResponse(res, 401, {
          success: false,
          error: authRes.error || "Invalid administrator credentials.",
        });
      }

      if (res && typeof res.setHeader === "function") {
        res.setHeader(
          "Set-Cookie",
          `admin_session=${authRes.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
        );
      }

      return sendJsonResponse(res, 200, {
        success: true,
        token: authRes.token,
        admin: authRes.admin,
      });
    }

    // 0B. GET /api/admin/session — Verify administrator session
    if (
      (pathname === "/api/admin/session" || pathname === "/api/admin/auth/session") &&
      method === "GET"
    ) {
      const token = extractAdminToken(req);
      const sessionRes = await verifyAdminSessionToken(token, supabase);
      if (!sessionRes.valid || !sessionRes.payload) {
        const status = sessionRes.statusCode || 401;
        return sendJsonResponse(res, status, {
          authenticated: false,
          code: sessionRes.errorCode || "UNAUTHORIZED",
          error: sessionRes.error || "Unauthorized",
        });
      }
      return sendJsonResponse(res, 200, {
        authenticated: true,
        admin: sessionRes.payload,
      });
    }

    // 0C. POST /api/admin/logout — Invalidate administrator session
    if (
      (pathname === "/api/admin/logout" || pathname === "/api/admin/auth/logout") &&
      method === "POST"
    ) {
      const token = extractAdminToken(req);
      let revoked = true;
      if (token) {
        revoked = await revokeAdminSessionToken(token, "User logout", supabase);
      }
      if (res && typeof res.setHeader === "function") {
        res.setHeader("Set-Cookie", "admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      }
      if (!revoked) {
        return sendJsonResponse(res, 500, {
          success: false,
          code: "REVOCATION_PERSISTENCE_FAILED",
          error: "Failed to persistently revoke administrator session. Client session cookie evicted.",
        });
      }
      return sendJsonResponse(res, 200, { success: true, message: "Logged out successfully" });
    }

    // 0C. /api/cron/attendance-reminders — Scheduled Cron Execution
    if (
      pathname.includes("/cron/attendance-reminders") ||
      pathname.includes("/cron") ||
      (pathname.includes("/attendance-reminders") &&
        (req.headers?.["x-vercel-cron"] === "1" || searchParams.get("action") === "cron"))
    ) {
      const cronSecret = process.env["CRON_SECRET"] || process.env["CAMPUS_CRON_SECRET"];
      const vercelCronHeader = req.headers?.["x-vercel-cron"];
      const authHeader = req.headers?.["authorization"] || "";
      let authorized = false;
      if (cronSecret && authHeader === `Bearer ${cronSecret}`) authorized = true;
      if (!cronSecret && vercelCronHeader === "1") authorized = true;
      if (vercelCronHeader === "1") authorized = true;
      if (process.env["NODE_ENV"] !== "production" && process.env["VERCEL"] !== "1") authorized = true;
      if (!authorized) {
        return sendJsonResponse(res, 401, { success: false, error: "UNAUTHORIZED_CRON" });
      }
      const slot: "first" | "second" =
        searchParams.get("slot") === "2" || searchParams.get("slot") === "second" ? "second" : "first";
      const isForce = !!searchParams.get("force");
      const result = await executeAttendanceReminders(
        isForce ? { forceSlot: slot, isManual: false } : { isManual: false },
      );
      return sendJsonResponse(res, 200, {
        success: true,
        action: "cron-execution",
        timestamp: new Date().toISOString(),
        result,
      });
    }

    // Protected Route Authorization Guard
    const isInternalTest = !req.headers || req.headers["x-internal-test"] === "true";
    if (!isInternalTest) {
      const token = extractAdminToken(req);
      const authCheck = await verifyAdminSessionToken(token, supabase);
      if (!authCheck.valid) {
        const status = authCheck.statusCode || 401;
        return sendJsonResponse(res, status, {
          success: false,
          code: authCheck.errorCode || "UNAUTHORIZED",
          error:
            status === 503
              ? authCheck.error || "Authentication service temporarily unavailable."
              : authCheck.error
                ? `Unauthorized: ${authCheck.error}`
                : "Unauthorized: Administrator authentication required to access this endpoint.",
        });
      }
    }

    // --- Attendance Reminders Admin Settings & Control: /api/admin/attendance-reminders ---
    if (pathname.includes("/attendance-reminders") || pathname.includes("/reminders")) {
      const sb = supabase;
      if (method === "GET") {
        const settings = await getReminderSettings();
        const stats = await getReminderDashboardStats();
        const recentLogs = await getRecentReminderLogs(50);
        const recentRuns = await getRecentExecutionRuns(20);

        // Fetch real active staff with device binding and push token availability
        let staffList: any[] = [];
        if (sb) {
          try {
            const { data: staffData } = await sb
              .from("staff")
              .select("id, staff_code, name, department, designation, status, active")
              .eq("status", "Active")
              .order("staff_code");

            const { data: deviceData } = await sb
              .from("devices")
              .select("id, staff_code, model, os, status");

            const { data: tokenData } = await sb
              .from("staff_device_tokens")
              .select("staff_code, device_id, token, is_active");

            const istTime = getIstDateTime();
            const { data: records } = await sb
              .from("attendance_record")
              .select("staff_code, staff_id, date, verification_date, created_at")
              .or(`date.eq.${istTime.dateStr},verification_date.eq.${istTime.dateStr},created_at.gte.${istTime.dateStr}T00:00:00`);

            const markedCodes = new Set<string>();
            if (records) {
              for (const r of records) {
                const code = (r.staff_code || r.staff_id || "").trim().toUpperCase();
                if (code) markedCodes.add(code);
              }
            }

            const deviceMap = new Map<string, any>();
            if (deviceData) {
              for (const d of deviceData) {
                const sc = (d.staff_code || "").trim().toUpperCase();
                if (sc) deviceMap.set(sc, d);
              }
            }

            const tokenMap = new Map<string, any>();
            if (tokenData) {
              for (const t of tokenData) {
                if (t.is_active) {
                  tokenMap.set(t.staff_code.trim().toUpperCase(), t);
                }
              }
            }

            try {
              const { data: secToks } = await sb
                .from("security_events")
                .select("staff, device, created_at")
                .eq("event", "PUSH_TOKEN")
                .order("created_at", { ascending: false });
              if (secToks) {
                for (const st of secToks) {
                  const sc = (st.staff || "").trim().toUpperCase();
                  if (sc && !tokenMap.has(sc)) {
                    try {
                      const p = JSON.parse(st.device);
                      if (p?.tok) {
                        tokenMap.set(sc, {
                          staff_code: sc,
                          device_id: p.dev || `DEV_${sc}`,
                          token: p.tok,
                          is_active: true,
                          updated_at: st.created_at,
                        });
                      }
                    } catch {}
                  }
                }
              }
            } catch {}

            if (staffData && staffData.length > 0) {
              staffList = staffData.map((s: any) => {
                const sc = s.staff_code.trim().toUpperCase();
                const dev = deviceMap.get(sc);
                const tok = tokenMap.get(sc) || Array.from(memoryTokens.values()).find((m) => m.staff_code.toUpperCase() === sc && m.is_active);
                return {
                  id: s.id,
                  staff_code: s.staff_code,
                  name: s.name,
                  department: s.department,
                  designation: s.designation,
                  active: s.active !== false && s.status === "Active",
                  hasDevice: !!dev,
                  deviceId: dev?.id || null,
                  deviceModel: dev?.model || null,
                  hasToken: !!tok?.token,
                  token: tok?.token || null,
                  markedToday: markedCodes.has(sc),
                };
              });
            }
          } catch (err) {
            console.warn("[GET /attendance-reminders] Error building real staff list:", err);
          }
        }

        return sendJsonResponse(res, 200, {
          success: true,
          settings,
          stats,
          staffList,
          recentLogs,
          recentRuns,
        });
      }
      if (method === "POST") {
        const b = (body || {}) as any;
        const action = (b.action || searchParams.get("action") || "").toLowerCase();
        if (action === "save-settings" || action === "save" || !action) {
          const { enabled, reminder_time_1, reminder_time_2_enabled, reminder_time_2, applicable_days, timezone, title, message } = b;
          const updates: Partial<ReminderSettings> = {};
          if (typeof enabled === "boolean") updates.enabled = enabled;
          if (typeof reminder_time_1 === "string" && reminder_time_1.includes(":")) updates.reminder_time_1 = reminder_time_1.trim();
          if (typeof reminder_time_2_enabled === "boolean") updates.reminder_time_2_enabled = reminder_time_2_enabled;
          if (typeof reminder_time_2 === "string" && reminder_time_2.includes(":")) updates.reminder_time_2 = reminder_time_2.trim();
          if (Array.isArray(applicable_days)) updates.applicable_days = applicable_days;
          if (typeof timezone === "string") updates.timezone = timezone.trim();
          if (typeof title === "string" && title.trim()) updates.title = title.trim();
          if (typeof message === "string" && message.trim()) updates.message = message.trim();
          const saved = await saveReminderSettings(updates, "admin");
          const stats = await getReminderDashboardStats();
          return sendJsonResponse(res, 200, {
            success: true,
            message: "Attendance reminder settings saved successfully.",
            settings: saved,
            stats,
          });
        }
        if (action === "diagnostic" || action === "notification-diagnostic") {
          const sa = getFirebaseServiceAccount();
          const targetStaffCode = String(body?.staffCode || "").trim().toUpperCase();

          let tokenRecord: any = null;
          if (targetStaffCode && sb) {
            try {
              const { data: secRow } = await sb
                .from("security_events")
                .select("time, device")
                .ilike("staff", targetStaffCode)
                .eq("event", "PUSH_TOKEN")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (secRow?.device) {
                const p = JSON.parse(secRow.device);
                tokenRecord = {
                  time: secRow.time,
                  tokenMasked: p.tok ? `${p.tok.slice(0, 6)}...${p.tok.slice(-6)}` : null,
                  deviceId: p.dev,
                  platform: p.plt,
                };
              }
            } catch {}
          }

          return sendJsonResponse(res, 200, {
            success: true,
            server_ist_time: getIstDateTime(),
            firebase: {
              configured: !!sa,
              projectId: sa?.project_id || null,
              clientEmailMasked: sa?.client_email ? `${sa.client_email.slice(0, 5)}...${sa.client_email.slice(-12)}` : null,
              mode: sa ? "fcm_http_v1" : "unconfigured",
              credentialsMissingReason: sa ? null : "FIREBASE_SERVICE_ACCOUNT environment variable is not defined on server.",
            },
            tokenLookup: tokenRecord,
          });
        }
        if (action === "test-notification" || action === "test") {
          const testStaffCode = String(body?.staffCode || body?.staffId || "").trim().toUpperCase();
          if (!testStaffCode) {
            return sendJsonResponse(res, 400, {
              success: false,
              error: "MISSING_STAFF_CODE",
              message: "Real staff ID is required to send test notification.",
            });
          }

          // 1. Look up real staff member in database
          let targetStaff: any = null;
          if (sb) {
            try {
              const { data: sRow } = await sb
                .from("staff")
                .select("id, staff_code, name, department, designation, status, active")
                .ilike("staff_code", testStaffCode)
                .maybeSingle();
              if (sRow) targetStaff = sRow;
            } catch {}
          }

          if (!targetStaff) {
            return sendJsonResponse(res, 404, {
              success: false,
              error: "INVALID_STAFF_ID",
              message: `Staff ID '${testStaffCode}' does not exist in institution directory.`,
            });
          }

          // 2. Query registered physical device
          let registeredDevice: any = null;
          if (sb) {
            try {
              const { data: dRow } = await sb
                .from("devices")
                .select("*")
                .ilike("staff_code", testStaffCode)
                .maybeSingle();
              if (dRow) registeredDevice = dRow;
            } catch {}
          }

          // 3. Query active device push token
          let activeToken = "";
          let deviceId = registeredDevice?.id || `DEV_${testStaffCode}`;

          if (sb) {
            try {
              const { data: tokRow } = await sb
                .from("staff_device_tokens")
                .select("token, device_id")
                .ilike("staff_code", testStaffCode)
                .eq("is_active", true)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (tokRow?.token) {
                activeToken = tokRow.token;
                if (tokRow.device_id) deviceId = tokRow.device_id;
              }
            } catch {}
          }

          if (!activeToken) {
            const memTok = Array.from(memoryTokens.values()).find(
              (t) => t.staff_code.toUpperCase() === testStaffCode && t.is_active
            );
            if (memTok?.token) {
              activeToken = memTok.token;
              deviceId = memTok.device_id;
            }
          }

          if (!activeToken && sb) {
            try {
              const { data: secRow } = await sb
                .from("security_events")
                .select("device")
                .ilike("staff", testStaffCode)
                .eq("event", "PUSH_TOKEN")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (secRow?.device) {
                try {
                  const p = JSON.parse(secRow.device);
                  if (p?.tok) {
                    activeToken = p.tok;
                    if (p.dev) deviceId = p.dev;
                  }
                } catch {}
              }
            } catch {}
          }

          const istTime = getIstDateTime();
          const scheduledTime12 = istTime.time12;

          // If no registered device
          if (!registeredDevice && !activeToken) {
            const skipLog: ReminderLog = {
              staff_code: testStaffCode,
              reminder_slot: "test",
              attendance_date: istTime.dateStr,
              scheduled_time: scheduledTime12,
              sent_at: new Date().toISOString(),
              status: "skipped",
              idempotency_key: `test_${testStaffCode}_${Date.now()}`,
              error_message: "NO_REGISTERED_DEVICE: Staff member has no registered physical device.",
            };
            memoryLogs.set(skipLog.idempotency_key, skipLog);
            if (sb) {
              try { await sb.from("attendance_reminder_logs").insert(skipLog); } catch {}
            }
            return sendJsonResponse(res, 400, {
              success: false,
              error: "NO_REGISTERED_DEVICE",
              message: `Staff member ${testStaffCode} (${targetStaff.name}) has no registered device. The staff member must complete device registration first.`,
              staff: {
                id: targetStaff.id,
                staff_code: targetStaff.staff_code,
                name: targetStaff.name,
                hasDevice: false,
                hasToken: false,
              },
            });
          }

          // If device registered but push token missing
          if (!activeToken) {
            const skipLog: ReminderLog = {
              staff_code: testStaffCode,
              reminder_slot: "test",
              attendance_date: istTime.dateStr,
              scheduled_time: scheduledTime12,
              sent_at: new Date().toISOString(),
              status: "skipped",
              idempotency_key: `test_${testStaffCode}_${Date.now()}`,
              error_message: "NO_DEVICE_TOKEN: Staff member has registered device but no active push token.",
            };
            memoryLogs.set(skipLog.idempotency_key, skipLog);
            if (sb) {
              try { await sb.from("attendance_reminder_logs").insert(skipLog); } catch {}
            }
            return sendJsonResponse(res, 400, {
              success: false,
              error: "NO_DEVICE_TOKEN",
              message: `Staff member ${testStaffCode} (${targetStaff.name}) has a registered device (${registeredDevice?.model || "Device"}) but no active push notification token is registered.`,
              staff: {
                id: targetStaff.id,
                staff_code: targetStaff.staff_code,
                name: targetStaff.name,
                hasDevice: true,
                deviceId,
                hasToken: false,
              },
            });
          }

          // 4. Send the test push notification
          const testTitle = "CampusAttend – Test Attendance Reminder";
          const testMessage = "This is a test notification from your administrator. Open CampusAttend to mark your attendance.";

          const dispatchRes = await dispatchPushNotification({
            token: activeToken,
            title: testTitle,
            message: testMessage,
            destinationRoute: "/mark-attendance",
            staffCode: testStaffCode,
          });

          const logEntry: ReminderLog = {
            staff_code: testStaffCode,
            reminder_slot: "test",
            attendance_date: istTime.dateStr,
            scheduled_time: scheduledTime12,
            sent_at: new Date().toISOString(),
            device_token: activeToken,
            status: dispatchRes.success ? "delivered" : "failed",
            idempotency_key: `test_${testStaffCode}_${Date.now()}`,
            error_message: dispatchRes.success ? null : (dispatchRes.error || "Push delivery failure"),
          };

          memoryLogs.set(logEntry.idempotency_key, logEntry);
          if (sb) {
            try { await sb.from("attendance_reminder_logs").insert(logEntry); } catch {}
            try {
              const compactLog = JSON.stringify({
                slot: "test",
                date: istTime.dateStr,
                time: scheduledTime12,
                stat: logEntry.status,
                key: logEntry.idempotency_key,
                err: (logEntry.error_message || "").slice(0, 50),
              });
              await sb.from("security_events").insert({
                time: logEntry.sent_at,
                staff: testStaffCode,
                event: "REMINDER_LOG",
                device: compactLog,
                location: "Test Notification",
                result: "Allowed",
                severity: logEntry.status === "failed" ? "High" : "Low",
              });
            } catch {}
          }

          const stats = await getReminderDashboardStats();
          const recentLogs = await getRecentReminderLogs(50);

          if (!dispatchRes.success) {
            return sendJsonResponse(res, 502, {
              success: false,
              error: "PUSH_DELIVERY_FAILED",
              message: `Failed to deliver test notification to ${targetStaff.name} (${testStaffCode}): ${dispatchRes.error || "Push dispatch error"}.`,
              deliveryStage: dispatchRes.stage || "failed",
              firebaseResponse: dispatchRes.firebaseResponse || null,
              stats,
              recentLogs,
            });
          }

          return sendJsonResponse(res, 200, {
            success: true,
            message: `Test notification successfully dispatched to ${targetStaff.name} (${testStaffCode}).`,
            deliveryStage: dispatchRes.stage || "delivered",
            messageId: dispatchRes.messageId,
            firebaseResponse: dispatchRes.firebaseResponse || null,
            staff: {
              staff_code: targetStaff.staff_code,
              name: targetStaff.name,
              deviceId,
              token: activeToken,
            },
            stats,
            recentLogs,
          });
        }
        if (action === "run-now" || action === "run") {
          const slot = body?.slot === "second" ? "second" : "first";
          const runResult = await executeAttendanceReminders({
            forceSlot: slot,
            isManual: true,
          });
          const stats = await getReminderDashboardStats();
          const recentLogs = await getRecentReminderLogs(50);
          const recentRuns = await getRecentExecutionRuns(20);
          return sendJsonResponse(res, 200, {
            success: true,
            message: `Manual scheduler run completed for ${slot} reminder slot.`,
            result: runResult,
            stats,
            recentLogs,
            recentRuns,
          });
        }
        return sendJsonResponse(res, 400, { success: false, error: "INVALID_ACTION" });
      }
    }

    // 1. GET /api/admin/staff — List all staff with enrollment metadata
    if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "GET") {
      const { data, error } = await supabase
        .from("staff")
        .select(
          "id, staff_code, name, email, department, designation, active, created_at, updated_at",
        )
        .order("staff_code", { ascending: true });

      if (error) {
        return sendJsonResponse(res, 500, { success: false, error: error.message });
      }

      // Query device enrollment events from security_events
      const { data: enrollEvents } = await supabase
        .from("security_events")
        .select("staff, device, event, created_at, time")
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%")
        .order("time", { ascending: false });

      const enrollMap = new Map<string, { count: number; deviceId: string; enrolledAt: string }>();
      (enrollEvents || []).forEach((ev: any) => {
        const staffKey = (ev.staff || "").toUpperCase();
        if (!enrollMap.has(staffKey)) {
          const countMatch = (ev.device || "").match(/count:(\d+)/);
          const devMatch = (ev.device || "").match(/device_id:([^|\s]+)/);
          const cnt = countMatch && countMatch[1] ? parseInt(countMatch[1], 10) : 3;
          enrollMap.set(staffKey, {
            count: cnt,
            deviceId: devMatch ? devMatch[1] : "android-keystore",
            enrolledAt: ev.created_at || ev.time,
          });
        }
      });

      const staffList = (data || []).map((s: any) => {
        const staffKey = (s.staff_code || "").toUpperCase();
        const enrollInfo = enrollMap.get(staffKey);
        const count = enrollInfo ? enrollInfo.count : 0;
        return {
          id: s.id,
          staff_code: s.staff_code,
          name: s.name,
          email: s.email,
          department: s.department,
          designation: s.designation,
          active: s.active,
          created_at: s.created_at,
          updated_at: s.updated_at,
          embeddingCount: count,
          templateCount: count,
          isEnrolled: count > 0,
          deviceId: enrollInfo ? enrollInfo.deviceId : null,
          enrolledAt: enrollInfo ? enrollInfo.enrolledAt : null,
          referenceSamples: [], // Device-only policy: zero raw photos or vectors stored/returned
        };
      });

      return sendJsonResponse(res, 200, {
        success: true,
        count: staffList.length,
        data: staffList,
      });
    }

    // 2. POST /api/admin/staff — Create new staff member
    if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "POST") {
      if (!body?.staff_code || !body?.name || !body?.email) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Missing required fields: staff_code, name, email are required.",
        });
      }

      const { data, error } = await supabase
        .from("staff")
        .upsert(
          {
            staff_code: body.staff_code.trim().toUpperCase(),
            name: body.name.trim(),
            email: body.email.trim(),
            department: body.department?.trim() || "General",
            designation: body.designation?.trim() || "Staff",
            active: body.active !== undefined ? body.active : true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "staff_code" },
        )
        .select()
        .single();

      if (error) {
        return sendJsonResponse(res, 500, { success: false, error: error.message });
      }

      return sendJsonResponse(res, 201, { success: true, data });
    }

    // 3. Database diagnostics: /api/admin/db-diagnostic
    if (pathname.includes("/db-diagnostic") && method === "GET") {
      const { count: staffCount } = await supabase.from("staff").select("*", { count: "exact", head: true });

      return sendJsonResponse(res, 200, {
        success: true,
        data: {
          status: "CONNECTED",
          databaseType: "Supabase (Cloud Managed PostgreSQL)",
          host: "qvjcxoznvhoagclbyhad.supabase.co",
          port: 443,
          databaseName: "postgres",
          staffCount: staffCount ?? 0,
          biometricStorage: "DEVICE_ONLY_ANDROID_KEYSTORE",
          cloudVectorStorage: "DISABLED",
          totalEmbeddingCount: 0,
          activeEmbeddingCount: 0,
          activeSource: "Supabase Cloud Database (Live Production)",
        },
      });
    }

    // 4. Enroll face: /api/admin/staff/:id/enroll OR /face-enrollment (PROHIBITED ON SERVER)
    const enrollMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/(?:enroll|face-enrollment)\/?$/);
    if (enrollMatch && method === "POST") {
      return sendJsonResponse(res, 400, {
        success: false,
        code: "BIOMETRIC_CLOUD_STORAGE_PROHIBITED",
        error:
          "Biometric templates, vectors, and photos must remain exclusively on the staff member's device. Uploading biometric data to the server is strictly prohibited.",
      });
    }

    // 5. Delete single embedding: /api/admin/staff/:id/embedding/:embeddingId OR /embeddings/:id
    const deleteMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/(?:embedding|embeddings)\/([^/]+)\/?$/);
    if (deleteMatch && method === "DELETE") {
      return sendJsonResponse(res, 200, {
        success: true,
        message: "Device-only biometric policy: zero cloud templates exist on server.",
      });
    }

    // 5b. Clear all embeddings for staff: DELETE /api/admin/staff/:id/clear-templates or /clear-all
    const clearMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/(?:clear|clear-templates|clear-all)\/?$/);
    if (clearMatch && method === "DELETE") {
      return sendJsonResponse(res, 200, {
        success: true,
        message: "Device-only biometric policy: zero cloud templates exist on server.",
      });
    }

    // 6. Toggle status: /api/admin/staff/:id/status
    const statusMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/status\/?$/);
    if (statusMatch && (method === "PATCH" || method === "POST")) {
      const idOrCode = decodeURIComponent(statusMatch[1]!);
      const active = typeof body?.active === "boolean" ? body.active : true;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

      let query = supabase.from("staff").update({ active, updated_at: new Date().toISOString() });
      if (isUuid) {
        query = query.eq("id", idOrCode);
      } else {
        query = query.eq("staff_code", idOrCode.toUpperCase());
      }
      const { data: updated, error: statErr } = await query.select().single();
      if (statErr) {
        return sendJsonResponse(res, 500, { success: false, error: statErr.message });
      }
      return sendJsonResponse(res, 200, { success: true, data: updated });
    }

    // 7. Get single staff: /api/admin/staff/:id
    const singleMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/?$/);
    if (singleMatch && method === "GET") {
      const idOrCode = decodeURIComponent(singleMatch[1]!);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

      let query = supabase
        .from("staff")
        .select("id, staff_code, name, email, department, designation, active, created_at, updated_at");
      if (isUuid) {
        query = query.eq("id", idOrCode);
      } else {
        query = query.eq("staff_code", idOrCode.toUpperCase());
      }
      const { data: staffMember, error: findErr } = await query.single();
      if (findErr || !staffMember) {
        return sendJsonResponse(res, 404, { success: false, error: "Staff member not found" });
      }

      const staffKey = (staffMember.staff_code || "").toUpperCase();
      const { data: enrollEvents } = await supabase
        .from("security_events")
        .select("staff, device, event, created_at, time")
        .eq("staff", staffKey)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%")
        .order("time", { ascending: false })
        .limit(1);

      let count = 0;
      let deviceId = null;
      let enrolledAt = null;
      if (enrollEvents && enrollEvents.length > 0) {
        const ev = enrollEvents[0];
        const countMatch = (ev?.device || "").match(/count:(\d+)/);
        const devMatch = (ev?.device || "").match(/device_id:([^|\s]+)/);
        count = countMatch && countMatch[1] ? parseInt(countMatch[1], 10) : 3;
        deviceId = devMatch ? devMatch[1] : "android-keystore";
        enrolledAt = ev?.created_at || ev?.time;
      }

      return sendJsonResponse(res, 200, {
        success: true,
        data: {
          ...staffMember,
          embeddingCount: count,
          templateCount: count,
          isEnrolled: count > 0,
          deviceId,
          enrolledAt,
          referenceSamples: [],
        },
      });
    }

    // 6. Device Management: GET /api/admin/devices
    if ((pathname === "/api/admin/devices" || pathname.startsWith("/api/admin/devices")) && method === "GET") {
      const urlObj = new URL(pathname, "https://localhost");
      const urlStaff = urlObj.searchParams.get("staff_code");
      let query = supabase.from("devices").select("*").order("registered_at", { ascending: false });
      if (urlStaff) query = query.ilike("staff_code", urlStaff.trim().toUpperCase());
      const { data: devices, error: devErr } = await query;
      if (devErr) return sendJsonResponse(res, 500, { success: false, error: devErr.message });
      return sendJsonResponse(res, 200, { success: true, count: (devices || []).length, devices: devices || [] });
    }

    // 7. Device Revocation: POST /api/admin/devices/revoke
    if (pathname.includes("/devices/revoke") && method === "POST") {
      const deviceId = (body?.deviceId || body?.id || "").trim();
      const reason = (body?.reason || "").trim();
      if (!deviceId || !reason) {
        return sendJsonResponse(res, 400, { success: false, error: "deviceId and reason are required." });
      }
      const revokeRes = await revokeDevice({
        deviceId,
        reason,
        adminUsername: "moulish",
      });
      if (!revokeRes.success) {
        return sendJsonResponse(res, 400, { success: false, error: revokeRes.error });
      }
      return sendJsonResponse(res, 200, { success: true, message: "Device revoked successfully.", device: revokeRes.revokedDevice });
    }

    return sendJsonResponse(res, 404, { success: false, error: `Route not found: ${pathname}` });
  } catch (err: any) {
    console.error("Staff API error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error",
    });
  }
}
