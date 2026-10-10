/**
 * Vercel Serverless Function: GET /api/admin/session
 *
 * Self-contained session verification endpoint for CampusAttend.
 * Validates active administrator HMAC-SHA256 session token.
 */

import crypto from "node:crypto";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

function extractToken(req: any): string | null {
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

function verifyToken(tokenStr?: string | null): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing administrator session token." };
  }

  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed administrator session token." };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "Invalid token components." };
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
    return { valid: false, error: "Invalid administrator session signature." };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);

    if (payload.role !== "admin" || payload.username !== "moulish") {
      return { valid: false, error: "Token does not possess administrator privileges." };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Administrator session has expired." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode administrator session token." };
  }
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.statusCode = status;
    if (typeof res.json === "function") {
      return res.json(payload);
    }
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

  if (method !== "GET") {
    return sendJsonResponse(res, 405, {
      authenticated: false,
      error: "Method not allowed. Use GET.",
    });
  }

  try {
    const token = extractToken(req);
    const sessionRes = verifyToken(token);

    if (!sessionRes.valid || !sessionRes.payload) {
      return sendJsonResponse(res, 401, {
        authenticated: false,
        error: sessionRes.error || "Unauthorized",
      });
    }

    return sendJsonResponse(res, 200, {
      authenticated: true,
      admin: sessionRes.payload,
    });
  } catch (err: any) {
    console.error("[api/admin/session] Verification error:", err);
    return sendJsonResponse(res, 500, {
      authenticated: false,
      error: "Server error during session verification.",
    });
  }
}
