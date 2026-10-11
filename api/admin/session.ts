/**
 * Vercel Serverless Function: GET /api/admin/session
 *
 * Self-contained session verification endpoint for CampusAttend.
 * Validates active administrator HMAC-SHA256 session token.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

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

async function verifyToken(
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

    if (supabase) {
      const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");

      // 1. Dedicated table check
      try {
        const { data: dedicated, error: dedicatedErr } = await supabase
          .from("admin_token_revocations")
          .select("token_id")
          .eq("token_id", tokenId)
          .maybeSingle();

        if (dedicatedErr) {
          if (!isTableMissingError(dedicatedErr)) {
            console.warn("[api/admin/session] Dedicated table query warning:", dedicatedErr);
          }
        } else if (dedicated && dedicated.token_id) {
          return { valid: false, statusCode: 401, errorCode: "TOKEN_REVOKED", error: "Administrator session has been revoked. Please log in again." };
        }
      } catch (dedEx: any) {
        if (!isTableMissingError(dedEx)) {
          console.warn("[api/admin/session] Exception querying admin_token_revocations:", dedEx);
        }
      }

      // 2. security_events fallback check
      try {
        const { data: secEvents, error: secErr } = await supabase
          .from("security_events")
          .select("id")
          .eq("event", `ADMIN_TOKEN_REVOKED|${tokenId}`)
          .limit(1);

        if (secErr) {
          return {
            valid: false,
            statusCode: 503,
            errorCode: "SESSION_REVOCATION_UNAVAILABLE",
            error: "Authentication service temporarily unavailable. Revocation status could not be verified.",
          };
        }

        if (secEvents && secEvents.length > 0) {
          return { valid: false, statusCode: 401, errorCode: "TOKEN_REVOKED", error: "Administrator session has been revoked. Please log in again." };
        }
      } catch (secEx: any) {
        return {
          valid: false,
          statusCode: 503,
          errorCode: "SESSION_REVOCATION_UNAVAILABLE",
          error: "Authentication service temporarily unavailable. Revocation status could not be verified.",
        };
      }
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, statusCode: 401, errorCode: "DECODE_FAILED", error: "Failed to decode administrator session token." };
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
    const supabase = getSupabaseClient();
    const token = extractToken(req);
    const sessionRes = await verifyToken(token, supabase);

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
  } catch (err: any) {
    console.error("[api/admin/session] Verification error:", err);
    return sendJsonResponse(res, 500, {
      authenticated: false,
      error: "Server error during session verification.",
    });
  }
}
