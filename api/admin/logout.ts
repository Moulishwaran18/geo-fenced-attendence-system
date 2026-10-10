/**
 * Vercel Serverless Function: /api/admin/logout
 *
 * Terminates administrator session and clears session cookie.
 */

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

  const cookieHeader =
    "admin_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

  return sendJsonResponse(
    res,
    200,
    { success: true, message: "Logged out successfully." },
    { "Set-Cookie": cookieHeader },
  );
}
