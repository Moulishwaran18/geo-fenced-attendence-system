/**
 * Vercel Serverless Function: POST /api/admin/devices/revoke
 *
 * Administrator-controlled device revocation workflow:
 * - Requires verified administrator session (moulish).
 * - Invalidates active device registration.
 * - Records audit trail in security_events.
 * - Requires explicit revocation reason.
 */

import crypto from "node:crypto";
import { revokeDevice } from "../../../src/server/device-binding.ts";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

function verifyAdminToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };
  try {
    const expectedSig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(payloadB64).digest("base64url");
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

function extractAdminToken(req: any): string | null {
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
      error: "Method not allowed. Use POST /api/admin/devices/revoke.",
    });
  }

  // 1. Authenticate administrator session
  const token = extractAdminToken(req);
  const adminAuth = verifyAdminToken(token);

  const role = String(adminAuth.payload?.role || "").toLowerCase();
  if (!adminAuth.valid || !adminAuth.payload || (role !== "admin" && role !== "superadmin")) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Administrator privilege required to revoke registered devices.",
    });
  }

  const adminUsername = adminAuth.payload.username || "moulish";

  // Parse request body
  let body: any = {};
  try {
    if (typeof req.json === "function") {
      body = await req.json();
    } else if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      await new Promise((resolve) => {
        req.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", resolve);
        req.on("error", resolve);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    }
  } catch {
    body = {};
  }

  const deviceId = body?.deviceId ? String(body.deviceId).trim() : undefined;
  const staffCode = body?.staffCode || body?.staffId ? String(body.staffCode || body.staffId).trim().toUpperCase() : undefined;
  const reason = String(body?.reason || "").trim();

  if (!deviceId && !staffCode) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "MISSING_IDENTIFIER",
      message: "deviceId or staffCode is required for revocation.",
    });
  }

  if (!reason || reason.length < 3) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "MISSING_REASON",
      message: "A documented revocation reason is mandatory (minimum 3 characters).",
    });
  }

  try {
    const result = await revokeDevice({
      deviceId,
      staffCode,
      reason,
      adminUsername,
    });

    if (!result.success) {
      return sendJsonResponse(res, 404, {
        success: false,
        error: result.error || "DEVICE_REVOCATION_FAILED",
        message: result.error,
      });
    }

    return sendJsonResponse(res, 200, {
      success: true,
      message: `Device '${result.revokedDevice?.id}' successfully revoked by administrator '${adminUsername}'.`,
      revokedDevice: {
        id: result.revokedDevice?.id,
        staffCode: result.revokedDevice?.staff_code,
        model: result.revokedDevice?.model,
        status: "Revoked",
        revokedAt: result.revokedDevice?.revoked_at,
        revocationReason: reason,
        revokedBy: adminUsername,
      },
    });
  } catch (err: any) {
    console.error("[api/admin/devices/revoke] Error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: err?.message || "Internal server error during device revocation.",
    });
  }
}
