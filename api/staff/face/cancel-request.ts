/**
 * Vercel Serverless Function: POST /api/staff/face/cancel-request
 *
 * Staff cancels their pending Face Change Request.
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
  const method = (req.method || "POST").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, { success: false, error: "Method not allowed. Use POST." });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
    });
  }

  // Authenticate Staff Member
  const token = extractStaffToken(req);
  const auth = verifyStaffToken(token);
  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: auth.error || "Authentication required to access face registration.",
    });
  }

  const staffCode = (auth.payload.staff_code || auth.payload.staffId || auth.payload.sub || "").toUpperCase();

  try {
    const { error: cancelErr } = await supabase
      .from("security_events")
      .delete()
      .eq("staff", staffCode)
      .eq("result", "Flagged")
      .ilike("event", "FACE_CHANGE_REQUEST%");

    if (cancelErr) {
      return sendJsonResponse(res, 500, {
        success: false,
        error: "Failed to cancel face change request.",
      });
    }

    return sendJsonResponse(res, 200, {
      success: true,
      message: "Pending face change request cancelled.",
    });
  } catch (err: any) {
    console.error("[api/staff/face/cancel-request] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error.",
    });
  }
}
