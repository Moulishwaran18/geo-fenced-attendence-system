/**
 * Vercel Serverless Function: /api/admin/session
 *
 * Verifies active administrator session token.
 */

import {
  verifyAdminSessionToken,
  extractAdminToken,
} from "./auth-helper.ts";

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
    const token = extractAdminToken(req);
    const sessionRes = verifyAdminSessionToken(token);

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
