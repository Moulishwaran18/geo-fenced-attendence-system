/**
 * Vercel Serverless Function: /api/admin/attendance-reminders
 *
 * Provides Administrator Attendance Reminder Endpoints:
 * - GET  /api/admin/attendance-reminders: Query settings, stats, and audit logs
 * - POST /api/admin/attendance-reminders: Save settings, dispatch test notification, or manual trigger
 */

import crypto from "node:crypto";
import {
  getReminderSettings,
  saveReminderSettings,
  getReminderDashboardStats,
  getRecentReminderLogs,
  getRecentExecutionRuns,
  executeAttendanceReminders,
  registerStaffDeviceToken,
  dispatchPushNotification,
  type ReminderSettings,
} from "../../src/server/attendance-reminder-service";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["ADMIN_SESSION_SECRET"] ||
      process.env["ADMIN_TOKEN_SECRET"])) ||
  "campusattend-admin-auth-session-sec-key-2026";

function extractBearerOrCookieToken(req: any): string | null {
  if (!req) return null;
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };

  const authHeader = getHeader("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }

  const customHeader = getHeader("x-admin-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

function verifyAdminToken(tokenStr?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "MISSING_ADMIN_TOKEN" };
  }
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "INVALID_TOKEN_FORMAT" };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "MALFORMED_TOKEN" };
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
    return { valid: false, error: "SIGNATURE_MISMATCH" };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, error: "SESSION_EXPIRED" };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, error: "DECODE_ERROR" };
  }
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") return chained.json(payload);
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") res.end(JSON.stringify(payload));
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function parseJsonBody(req: any): Promise<any> {
  if (!req) return {};
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.json === "function") {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }
  if (typeof req.text === "function") {
    try {
      const raw = await req.text();
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let body = "";
    req.on?.("data", (chunk: any) => {
      body += chunk;
    });
    req.on?.("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on?.("error", () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  const method = (req.method || "GET").toUpperCase();

  // Verify administrator identity
  const token = extractBearerOrCookieToken(req);
  const auth = verifyAdminToken(token);

  if (!auth.valid) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Administrator authentication required to access attendance reminder settings.",
    });
  }

  const adminUsername = auth.payload?.username || "admin";

  if (method === "GET") {
    try {
      const settings = await getReminderSettings();
      const stats = await getReminderDashboardStats();
      const recentLogs = await getRecentReminderLogs(50);
      const recentRuns = await getRecentExecutionRuns(20);

      return sendJsonResponse(res, 200, {
        success: true,
        settings,
        stats,
        recentLogs,
        recentRuns,
      });
    } catch (err: any) {
      console.error("[api/admin/attendance-reminders] GET error:", err);
      return sendJsonResponse(res, 500, {
        success: false,
        error: "INTERNAL_ERROR",
        message: err?.message || "Failed to retrieve attendance reminder configuration.",
      });
    }
  }

  if (method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const action = (body.action || "").toLowerCase();

      // Action 1: Save settings
      if (action === "save-settings" || action === "save" || !action) {
        const {
          enabled,
          reminder_time_1,
          reminder_time_2_enabled,
          reminder_time_2,
          applicable_days,
          timezone,
          title,
          message,
        } = body;

        const updates: Partial<ReminderSettings> = {};
        if (typeof enabled === "boolean") updates.enabled = enabled;
        if (typeof reminder_time_1 === "string" && reminder_time_1.includes(":")) {
          updates.reminder_time_1 = reminder_time_1.trim();
        }
        if (typeof reminder_time_2_enabled === "boolean") {
          updates.reminder_time_2_enabled = reminder_time_2_enabled;
        }
        if (typeof reminder_time_2 === "string" && reminder_time_2.includes(":")) {
          updates.reminder_time_2 = reminder_time_2.trim();
        }
        if (Array.isArray(applicable_days)) {
          updates.applicable_days = applicable_days;
        }
        if (typeof timezone === "string") updates.timezone = timezone.trim();
        if (typeof title === "string" && title.trim()) updates.title = title.trim();
        if (typeof message === "string" && message.trim()) updates.message = message.trim();

        const saved = await saveReminderSettings(updates, adminUsername);
        const stats = await getReminderDashboardStats();

        return sendJsonResponse(res, 200, {
          success: true,
          message: "Attendance reminder settings saved successfully.",
          settings: saved,
          stats,
        });
      }

      // Action 2: Send test notification
      if (action === "test-notification" || action === "test") {
        const testStaffCode = (body.staffCode || "SCT-001").trim().toUpperCase();
        const testDeviceId = body.deviceId || "DEV_ADMIN_TEST";
        const testToken = body.token || `TEST_DEVICE_TOKEN_${testStaffCode}`;

        // Ensure token is registered for the test staff code
        await registerStaffDeviceToken({
          staffCode: testStaffCode,
          deviceId: testDeviceId,
          token: testToken,
          platform: "android",
        });

        // Trigger single test reminder
        const testResult = await executeAttendanceReminders({
          forceSlot: "test",
          testStaffCode,
          isManual: true,
        });

        const stats = await getReminderDashboardStats();
        const recentLogs = await getRecentReminderLogs(50);

        return sendJsonResponse(res, 200, {
          success: true,
          message: `Test notification sent to staff ${testStaffCode}.`,
          result: testResult,
          stats,
          recentLogs,
        });
      }

      // Action 3: Run scheduler immediately
      if (action === "run-now" || action === "run") {
        const slot = body.slot === "second" ? "second" : "first";
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

      return sendJsonResponse(res, 400, {
        success: false,
        error: "INVALID_ACTION",
        message: `Unknown action '${action}'. Supported actions: save-settings, test-notification, run-now.`,
      });
    } catch (err: any) {
      console.error("[api/admin/attendance-reminders] POST error:", err);
      return sendJsonResponse(res, 500, {
        success: false,
        error: "INTERNAL_ERROR",
        message: err?.message || "Failed to process attendance reminder operation.",
      });
    }
  }

  return sendJsonResponse(res, 405, {
    success: false,
    error: "METHOD_NOT_ALLOWED",
    message: `Method ${method} not allowed.`,
  });
}

