/**
 * Vercel Serverless Function: GET /api/admin/session
 *
 * Self-contained administrator session verification endpoint for CampusAttend.
 * Validates HMAC-SHA256 session tokens, checks expiration, and checks revocation
 * against persistent storage (Supabase).
 *
 * Supported authentication transports:
 * - Authorization: Bearer <token>
 * - x-admin-token: <token>
 * - Cookie: admin_session=<token>
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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
  role: "admin" as const,
  active: true,
};

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

const inMemoryRevokedTokens = new Map<
  string,
  {
    tokenId: string;
    username: string;
    expiresAt: number;
    revokedAt: number;
    reason: string;
  }
>();

function cleanExpiredRevocations() {
  const now = Date.now();
  for (const [id, entry] of inMemoryRevokedTokens.entries()) {
    if (now > entry.expiresAt) {
      inMemoryRevokedTokens.delete(id);
    }
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

async function isTokenRevoked(
  tokenId: string,
  supabase?: any,
): Promise<{ revoked: boolean; unavailable?: boolean; error?: string }> {
  if (!tokenId) return { revoked: false };

  cleanExpiredRevocations();
  if (inMemoryRevokedTokens.has(tokenId)) {
    return { revoked: true };
  }

  if (supabase) {
    try {
      const { data: dedicated, error: dedicatedErr } = await supabase
        .from("admin_token_revocations")
        .select("token_id, expires_at")
        .eq("token_id", tokenId)
        .maybeSingle();

      if (dedicatedErr) {
        if (!isTableMissingError(dedicatedErr)) {
          console.warn("[admin/session] Dedicated table query warning:", dedicatedErr);
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
        console.warn("[admin/session] Exception querying admin_token_revocations:", dedEx);
      }
    }

    try {
      const { data: secEvents, error: secErr } = await supabase
        .from("security_events")
        .select("event")
        .eq("event", `ADMIN_TOKEN_REVOKED|${tokenId}`)
        .limit(1);

      if (secErr) {
        console.error("[admin/session] Error reading security_events for revocation:", secErr);
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
      console.error("[admin/session] Exception reading security_events for revocation:", secEx);
      return {
        revoked: false,
        unavailable: true,
        error: `Database unreachable during revocation verification: ${secEx?.message || String(secEx)}`,
      };
    }
  }

  return { revoked: false };
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

  if (method !== "GET") {
    return sendJsonResponse(res, 405, {
      authenticated: false,
      error: "Method not allowed. Use GET to verify administrator session.",
    });
  }

  const token = extractAdminToken(req);
  if (!token) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "TOKEN_MISSING",
      error: "Missing administrator session token.",
    });
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "TOKEN_MALFORMED",
      error: "Malformed administrator session token.",
    });
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "TOKEN_INVALID",
      error: "Invalid token components.",
    });
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
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "SIGNATURE_INVALID",
      error: "Invalid administrator session signature.",
    });
  }

  let payload: any;
  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    payload = JSON.parse(jsonStr);
  } catch {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "DECODE_FAILED",
      error: "Failed to decode administrator session token.",
    });
  }

  if (payload.role !== "admin" || payload.username !== ADMIN_CREDENTIALS.username) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "PRIVILEGES_REQUIRED",
      error: "Token does not possess administrator privileges.",
    });
  }

  if (Date.now() > payload.expiresAt) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "TOKEN_EXPIRED",
      error: "Administrator session has expired.",
    });
  }

  const supabase = getSupabaseClient();
  const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
  const check = await isTokenRevoked(tokenId, supabase);

  if (check.unavailable) {
    return sendJsonResponse(res, 503, {
      authenticated: false,
      code: "SESSION_REVOCATION_UNAVAILABLE",
      error: "Authentication service temporarily unavailable. Revocation status could not be verified.",
    });
  }

  if (check.revoked) {
    return sendJsonResponse(res, 401, {
      authenticated: false,
      code: "TOKEN_REVOKED",
      error: "Administrator session has been revoked. Please log in again.",
    });
  }

  return sendJsonResponse(res, 200, {
    authenticated: true,
    admin: {
      id: ADMIN_CREDENTIALS.id,
      username: ADMIN_CREDENTIALS.username,
      name: payload.name || ADMIN_CREDENTIALS.name,
      email: payload.email || ADMIN_CREDENTIALS.email,
      role: ADMIN_CREDENTIALS.role,
    },
  });
}
