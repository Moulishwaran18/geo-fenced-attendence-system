/**
 * Vercel Serverless Function: GET /api/staff/face/status
 *
 * Query authenticated staff member's face enrollment status, sample count,
 * permanent lock state, and active change authorization.
 *
 * Self-contained for Vercel Serverless deployment reliability (zero relative .ts imports).
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const STAFF_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-staff-auth-session-sec-key-2026";

function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) ||
    "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  if (!url || !key) return null;
  return createClient(url, key);
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

function extractStaffToken(req: any): string | null {
  if (!req) return null;
  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    authHeader = req.headers.get("authorization") || req.headers.get("x-staff-token") || "";
  } else if (req.headers) {
    authHeader = req.headers["authorization"] || req.headers["x-staff-token"] || "";
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
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

function verifyStaffToken(tokenStr?: string | null): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing authentication session. Please sign in." };
  }
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed authentication token." };
  }
  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "Invalid token components." };
  }
  const expectedSignature = crypto
    .createHmac("sha256", STAFF_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { valid: false, error: "Invalid session signature." };
  }
  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    if (payload.role !== "staff" || (!payload.sub && !payload.staff_code && !payload.staffId)) {
      return { valid: false, error: "Token does not possess valid staff credentials." };
    }
    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Staff session has expired. Please sign in again." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode session token." };
  }
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
    });
  }

  // 1. Authenticate Staff Member from Server Session
  const token = extractStaffToken(req);
  const auth = verifyStaffToken(token);
  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: auth.error || "Authentication required to access face registration.",
    });
  }

  const staffCode = (auth.payload.staff_code || auth.payload.staffId || auth.payload.sub || "").toUpperCase();

  // Resolve staff database record
  const { data: staffRecord, error: staffFindErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, email, department, designation, device, active")
    .eq("staff_code", staffCode)
    .maybeSingle();

  if (staffFindErr || !staffRecord) {
    return sendJsonResponse(res, 404, {
      success: false,
      error: `Staff account '${staffCode}' not found in database.`,
    });
  }

  if (staffRecord.active === false) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "Staff account is deactivated.",
    });
  }

  try {
    // Count enrolled embeddings for this staff
    const { count: embCount, error: embErr } = await supabase
      .from("face_embeddings")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffRecord.id);

    if (embErr) {
      console.error("[api/staff/face/status] Embedding query error:", embErr);
    }

    const enrolledCount = embCount || 0;
    const isEnrolled = enrolledCount > 0;
    const isLocked = isEnrolled;

    // Check recent face change requests in security_events
    const { data: recentEvents } = await supabase
      .from("security_events")
      .select("id, time, event, device, location, result, severity, created_at")
      .eq("staff", staffCode)
      .ilike("event", "FACE_CHANGE_%")
      .order("created_at", { ascending: false })
      .limit(5);

    let activeRequest: any = null;
    let oneTimeToken: string | null = null;
    let enrollmentStatus: "not_registered" | "approved" | "pending_approval" | "rejected" = isEnrolled
      ? "approved"
      : "not_registered";

    if (recentEvents && recentEvents.length > 0) {
      for (const ev of recentEvents) {
        const evType = (ev.event || "").toUpperCase();

        if (evType.startsWith("FACE_CHANGE_REQUEST") && ev.result === "Flagged") {
          enrollmentStatus = "pending_approval";
          const reasonMatch = ev.event?.match(/^FACE_CHANGE_REQUEST:\s*(.*)$/i);
          activeRequest = {
            id: ev.id,
            status: "pending",
            reason: reasonMatch ? reasonMatch[1] : ev.event,
            created_at: ev.created_at || ev.time,
          };
          break;
        }

        if (ev.result === "Allowed" && (ev.device || "").includes("status:approved")) {
          const tokenMatch = (ev.device || "").match(/token:([a-zA-Z0-9_-]+)/);
          if (tokenMatch && tokenMatch[1]) {
            enrollmentStatus = "approved";
            oneTimeToken = tokenMatch[1];
            activeRequest = {
              id: ev.id,
              status: "approved",
              oneTimeToken: tokenMatch[1],
              created_at: ev.created_at || ev.time,
            };
            break;
          }
        }

        if (ev.result === "Blocked" && evType.startsWith("FACE_CHANGE_REQUEST")) {
          enrollmentStatus = "rejected";
          const reasonMatch = ev.event?.match(/^FACE_CHANGE_REQUEST:\s*(.*)$/i);
          activeRequest = {
            id: ev.id,
            status: "rejected",
            reason: reasonMatch ? reasonMatch[1] : ev.event,
            adminNotes: (ev.location || "").replace(/^AdminNote:\s*/i, ""),
            created_at: ev.created_at || ev.time,
          };
          break;
        }

        if ((ev.device || "").includes("status:consumed")) {
          break;
        }
      }
    }

    return sendJsonResponse(res, 200, {
      success: true,
      staff: {
        id: staffRecord.id,
        staff_code: staffRecord.staff_code,
        name: staffRecord.name,
        department: staffRecord.department,
      },
      enrolled: isEnrolled,
      isLocked,
      count: enrolledCount,
      enrolledCount,
      sampleCount: enrolledCount,
      enrollmentStatus,
      canSaveReplacement: Boolean(oneTimeToken),
      oneTimeToken: oneTimeToken || undefined,
      activeRequest: activeRequest || undefined,
    });
  } catch (err: any) {
    console.error("[api/staff/face/status] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error.",
    });
  }
}
