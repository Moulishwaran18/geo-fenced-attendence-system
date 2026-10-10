/**
 * Vercel Serverless Function: /api/admin/login
 *
 * Authenticates administrator credentials:
 * - Administrator ID: moulish
 * - Password: moulish@123
 *
 * Verifies PBKDF2 salted hash on server. Plaintext password is NEVER stored.
 */

import { authenticateAdmin } from "./auth-helper.ts";

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
      error: "Method not allowed. Use POST for administrator authentication.",
    });
  }

  let body: any = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  } else if (!body && typeof req.on === "function") {
    try {
      const chunks: Buffer[] = [];
      await new Promise((resolve, reject) => {
        req.on("data", (chunk: any) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        req.on("end", resolve);
        req.on("error", reject);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    } catch {
      body = {};
    }
  } else if (typeof req.json === "function") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const username = body?.username || body?.id || body?.staffId || "";
  const password = body?.password || "";

  if (!username || !password) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Administrator ID and password are required.",
    });
  }

  try {
    const authRes = await authenticateAdmin(username, password);
    if (!authRes.success || !authRes.token) {
      return sendJsonResponse(res, 401, {
        success: false,
        error: authRes.error || "Invalid administrator credentials.",
      });
    }

    const cookieHeader = `admin_session=${authRes.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;

    return sendJsonResponse(
      res,
      200,
      {
        success: true,
        token: authRes.token,
        admin: authRes.admin,
      },
      { "Set-Cookie": cookieHeader },
    );
  } catch (err: any) {
    console.error("[api/admin/login] Authentication server error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Server error during administrator authentication.",
    });
  }
}
