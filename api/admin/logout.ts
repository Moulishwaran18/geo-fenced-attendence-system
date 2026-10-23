/**
 * Vercel Serverless Function: POST /api/admin/logout
 *
 * Terminates administrator session by revoking the HMAC token in storage
 * and invalidating the admin_session cookie.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

function sendJsonResponse(
  res: any,
  status: number,
  payload: any,
  headersInit?: Record<string, string>,
) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (headersInit) {
      for (const [key, val] of Object.entries(headersInit)) {
        res.setHeader(key, val);
      }
    }
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
      ...(headersInit || {}),
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
      error: "Method not allowed. Use POST to terminate administrator session.",
    });
  }

  const token = extractAdminToken(req);
  const clearCookieHeader = "admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure";

  if (token) {
    try {
      const parts = token.trim().split(".");
      if (parts.length === 2 && parts[0]) {
        const jsonStr = Buffer.from(parts[0], "base64url").toString("utf-8");
        const payload = JSON.parse(jsonStr);
        const tokenId =
          payload.nonce ||
          crypto.createHash("sha256").update(parts[1] || "").digest("hex");
        const now = Date.now();
        const supabase = getSupabaseClient();

        if (supabase) {
          try {
            await supabase.from("admin_token_revocations").insert({
              token_id: tokenId,
              username: payload.username || "moulish",
              expires_at: new Date(payload.expiresAt || now + 86400000).toISOString(),
              revoked_at: new Date(now).toISOString(),
              reason: "User logout",
            });
          } catch {}

          try {
            await supabase.from("security_events").insert({
              time: new Date(now).toISOString(),
              staff: (payload.username || "MOULISH").toUpperCase(),
              event: `ADMIN_TOKEN_REVOKED|${tokenId}`,
              device: `session_expiry:${payload.expiresAt || 0}`,
              location: "Campus Administration",
              result: "Blocked",
              severity: "Low",
            });
          } catch {}
        }
      }
    } catch {}
  }

  return sendJsonResponse(
    res,
    200,
    { success: true, message: "Logged out successfully" },
    { "Set-Cookie": clearCookieHeader },
  );
}
