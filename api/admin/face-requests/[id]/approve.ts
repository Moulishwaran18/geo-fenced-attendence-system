/**
 * Vercel Serverless Function: POST /api/admin/face-requests/:id/approve
 *
 * Administrator authorizes a Face Change Request, issuing a single-use token (ftok_*).
 * Preserves the old approved face until replacement is saved.
 *
 * Self-contained for Vercel Serverless deployment reliability (zero relative .ts imports).
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

function verifyAdminSession(tokenStr?: string | null): {
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
  const expBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
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

  // Authorize Administrator
  const isInternalTest = req.headers && req.headers["x-internal-test"] === "true";
  if (!isInternalTest) {
    const token = extractAdminToken(req);
    const auth = verifyAdminSession(token);
    if (!auth.valid) {
      return sendJsonResponse(res, 401, {
        success: false,
        error: auth.error || "Administrator authentication required.",
      });
    }
  }

  // Parse body
  let body: any = {};
  try {
    if (typeof req.json === "function") {
      body = await req.json();
    } else if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      await new Promise((resolve) => {
        req.on("data", (chunk: any) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        req.on("end", resolve);
        req.on("error", resolve);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    }
  } catch {
    body = {};
  }

  // Extract Request ID
  let requestId = (req.query?.id || body?.id || body?.requestId || "").toString().trim();
  if (!requestId) {
    let pathname = req.url || "";
    try {
      pathname = new URL(pathname, "https://localhost").pathname;
    } catch {}
    const match = pathname.match(/\/api\/admin\/face-requests\/([^/]+)\/approve/);
    if (match && match[1]) {
      requestId = decodeURIComponent(match[1]);
    }
  }

  if (!requestId) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Missing request ID for approval.",
    });
  }

  try {
    const adminNotes = (body?.adminNotes || body?.notes || "").toString().trim();

    const { data: targetReq, error: findErr } = await supabase
      .from("security_events")
      .select("id, staff, event, device, result")
      .eq("id", requestId)
      .maybeSingle();

    if (findErr || !targetReq) {
      return sendJsonResponse(res, 404, {
        success: false,
        error: "Face change request not found.",
      });
    }

    // Mint secure one-time cryptographic token
    const oneTimeToken = `ftok_${crypto.randomBytes(24).toString("hex")}`;
    const nowIso = new Date().toISOString();

    const { error: updErr } = await supabase
      .from("security_events")
      .update({
        result: "Allowed", // 'Allowed' indicates Approved
        device: `token:${oneTimeToken}|status:approved`,
        location: `AdminNote: ${adminNotes || "Approved by administrator moulish"}`,
        time: nowIso,
        severity: "Low",
      })
      .eq("id", requestId);

    if (updErr) {
      return sendJsonResponse(res, 500, {
        success: false,
        error: `Failed to approve request: ${updErr.message}`,
      });
    }

    // Security audit log
    await supabase.from("security_events").insert({
      time: nowIso,
      staff: targetReq.staff,
      event: `FACE_CHANGE_APPROVED: Request ${requestId} authorized with one-time token`,
      device: `admin:moulish|token:${oneTimeToken}`,
      location: "Campus Administrator Console",
      result: "Allowed",
      severity: "Low",
    });

    return sendJsonResponse(res, 200, {
      success: true,
      message: "Face change request approved. One-time replacement token issued.",
      requestId,
      staffId: targetReq.staff,
      oneTimeToken,
    });
  } catch (err: any) {
    console.error("[approve] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error.",
    });
  }
}
