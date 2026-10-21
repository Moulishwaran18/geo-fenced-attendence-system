/**
 * Vercel Serverless Function: POST /api/device/challenge
 *
 * Issues a fresh, cryptographically signed challenge token for device registration.
 *
 * Workflow:
 * 1. Verifies that request originates from an authenticated faculty account.
 * 2. Checks whether the faculty member already has an active registered device.
 *    If active device already exists, returns 409 Conflict.
 * 3. Generates a cryptographically strong 32-byte random challenge nonce.
 * 4. Mints a tamper-proof HMAC-SHA256 signed challenge token with 5-minute TTL.
 * 5. Returns challenge and challenge token to device.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createDeviceChallenge, getActiveDeviceForStaff } from "../../src/server/device-binding.ts";

const STAFF_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-staff-auth-session-sec-key-2026";

function verifyStaffToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };
  try {
    const expectedSig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(payloadB64).digest("base64url");
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
  const customHeader = getHeader("x-staff-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return null;
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

  if (method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use POST /api/device/challenge.",
    });
  }

  // 1. Authenticate faculty session
  const token = extractBearerOrCookieToken(req);
  const auth = verifyStaffToken(token);

  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Authenticated faculty session required to request a device registration challenge.",
    });
  }

  const staffId = (auth.payload.staffId || auth.payload.sub || "").trim().toUpperCase();

  // 2. Policy Check: Check if an active registered device already exists
  try {
    const existingActive = await getActiveDeviceForStaff(staffId);
    if (existingActive) {
      return sendJsonResponse(res, 409, {
        success: false,
        error: "DEVICE_ALREADY_REGISTERED",
        message: `Faculty account '${staffId}' already has an active registered device (${existingActive.model}, ID: ${existingActive.id}).`,
        device: {
          id: existingActive.id,
          model: existingActive.model,
          platform: existingActive.platform,
          registeredAt: existingActive.registered_at,
          status: existingActive.status,
        },
      });
    }

    // 3. Generate fresh, tamper-proof challenge
    const challengeData = createDeviceChallenge(staffId, "device_registration", 300_000);

    return sendJsonResponse(res, 200, {
      success: true,
      staffId,
      challenge: challengeData.challenge,
      challengeToken: challengeData.challengeToken,
      expiresAt: challengeData.expiresAt,
    });
  } catch (err: any) {
    console.error("[api/device/challenge] Error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: err?.message || "Internal server error issuing device registration challenge.",
    });
  }
}
