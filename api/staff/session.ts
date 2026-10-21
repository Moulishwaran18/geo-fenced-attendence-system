/**
 * Vercel Serverless Function: GET & POST /api/staff/session
 *
 * Session Restoration & Device Policy Enforcement:
 * - Validates HMAC-SHA256 session token from cookie, Authorization header, or x-staff-token.
 * - Enforces that the staff account is active.
 * - Enforces that the account has an active registered device.
 * - Enforces that token.deviceId matches the currently active device in database.
 * - Rejects with 403 DEVICE_REVOKED if device was revoked.
 * - Rejects with 403 DEVICE_MISMATCH if device does not match.
 * - Returns active staff session and registered device info.
 * - POST method issues a refreshed token.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getActiveDeviceForStaff,
  getAllDevicesForStaff,
  verifyDeviceSignature,
  updateDeviceLastVerified,
} from "../../src/server/device-binding.ts";

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

function sendJsonResponse(res: any, status: number, payload: any, headersInit?: Record<string, string>) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (headersInit) {
      for (const [key, val] of Object.entries(headersInit)) {
        res.setHeader(key, val);
      }
    }
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
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
  });
  if (headersInit) {
    for (const [key, val] of Object.entries(headersInit)) {
      headers.set(key, val);
    }
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function extractStaffToken(req: any): string | null {
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

  const customHeader = getHeader("x-staff-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  return null;
}

function verifyStaffToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };

  try {
    const expectedSig = crypto
      .createHmac("sha256", STAFF_TOKEN_SECRET)
      .update(payloadB64)
      .digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "DECODE_FAILED" };
  }
}

function createStaffToken(staff: any, deviceId?: string, ttlMs = 24 * 60 * 60 * 1000): string {
  const now = Date.now();
  const payload = {
    sub: staff.staff_code || staff.staffId,
    staffId: staff.staff_code || staff.staffId,
    name: staff.name,
    email: staff.email,
    department: staff.department,
    designation: staff.designation,
    role: "staff",
    deviceId: deviceId || staff.deviceId || undefined,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", STAFF_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${signature}`;
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "GET" && method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use GET or POST /api/staff/session.",
    });
  }

  const token = extractStaffToken(req);
  const auth = verifyStaffToken(token);

  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(
      res,
      401,
      {
        success: false,
        error: auth.error || "UNAUTHORIZED",
        message: "Valid staff session required.",
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  const staffCode = (auth.payload.staffId || auth.payload.sub || "").trim().toUpperCase();

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Database configuration unavailable.",
    });
  }

  try {
    // 1. Verify staff account is active
    const { data: staff, error: staffErr } = await supabase
      .from("staff")
      .select("id, staff_code, name, email, department, designation, active")
      .eq("staff_code", staffCode)
      .maybeSingle();

    if (staffErr || !staff) {
      return sendJsonResponse(
        res,
        401,
        {
          success: false,
          error: "STAFF_NOT_FOUND",
          message: `Staff account '${staffCode}' not found.`,
        },
        { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
      );
    }

    if (staff.active === false) {
      return sendJsonResponse(
        res,
        403,
        {
          success: false,
          error: "ACCOUNT_DEACTIVATED",
          message: "Staff account is currently deactivated.",
        },
        { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
      );
    }

    // 2. Enforce One Faculty ID = One Phone Policy on session restoration
    const activeDevice = await getActiveDeviceForStaff(staffCode);

    if (!activeDevice) {
      if (auth.payload.deviceId) {
        const allDevices = await getAllDevicesForStaff(staffCode);
        const revoked = allDevices.find(
          (d) =>
            (d.id === auth.payload.deviceId || d.key_id === auth.payload.deviceId) &&
            (d.status === "Revoked" || d.status === "Blocked"),
        );
        if (revoked) {
          return sendJsonResponse(
            res,
            403,
            {
              success: false,
              error: "DEVICE_REVOKED",
              message: `Session terminated: The registered device for account '${staffCode}' was revoked by administration (${revoked.revocation_reason || "Revoked"}).`,
              revokedAt: revoked.revoked_at,
              revocationReason: revoked.revocation_reason,
            },
            { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
          );
        }
      }

      return sendJsonResponse(
        res,
        403,
        {
          success: false,
          error: "NO_REGISTERED_DEVICE",
          message: `Session invalid: Faculty account '${staffCode}' has no active registered device. Device registration is required.`,
        },
        { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
      );
    }

    if (activeDevice.status !== "Active") {
      return sendJsonResponse(
        res,
        403,
        {
          success: false,
          error: "DEVICE_REVOKED",
          message: `Session terminated: The registered device for account '${staffCode}' was revoked by administration (${activeDevice.revocation_reason || "Revoked"}).`,
          revokedAt: activeDevice.revoked_at,
          revocationReason: activeDevice.revocation_reason,
        },
        { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
      );
    }

    // 3. Verify token's bound deviceId matches the currently active registered device
    if (auth.payload.deviceId && auth.payload.deviceId !== activeDevice.id && auth.payload.deviceId !== activeDevice.key_id) {
      return sendJsonResponse(
        res,
        403,
        {
          success: false,
          error: "DEVICE_MISMATCH",
          message: `Session invalid: Token was issued for device '${auth.payload.deviceId}', but active registered device is '${activeDevice.id}'.`,
        },
        { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
      );
    }

    // 4. Update device last verified
    void updateDeviceLastVerified(activeDevice.id);

    // If POST (token refresh), mint a fresh token
    let refreshedToken = token;
    let cookieHeader: string | undefined = undefined;
    if (method === "POST") {
      refreshedToken = createStaffToken(staff, activeDevice.id);
      cookieHeader = `staff_session=${refreshedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
    }

    const responsePayload = {
      success: true,
      token: refreshedToken,
      staff: {
        id: staff.id,
        staff_code: staff.staff_code,
        staffId: staff.staff_code,
        name: staff.name,
        email: staff.email,
        department: staff.department,
        designation: staff.designation,
        role: "staff",
      },
      device: {
        id: activeDevice.id,
        model: activeDevice.model,
        platform: activeDevice.platform,
        status: activeDevice.status,
        lastVerifiedAt: activeDevice.last_verified_at,
      },
    };

    return sendJsonResponse(
      res,
      200,
      responsePayload,
      cookieHeader ? { "Set-Cookie": cookieHeader } : undefined,
    );
  } catch (err: any) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error during session verification.",
    });
  }
}
