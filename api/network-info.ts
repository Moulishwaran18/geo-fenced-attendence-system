/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Notice: IP-based verification has been deprecated.
 * Campus authentication now uses ONLY SSID name-based authorization.
 */

export default async function handler(req: any, res?: any) {
  const payload = {
    status: "DEPRECATED",
    message: "Network IP authentication has been removed. Campus authorization uses ONLY SSID name-based authentication (M or SONA).",
    timestamp: new Date().toISOString(),
  };

  // Node.js Serverless runtime (req, res)
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(payload);
    }
    if (typeof res.writeHead === "function") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
    }
    if (typeof res.end === "function") {
      return res.end(JSON.stringify(payload));
    }
  }

  // Web API / Edge runtime (Response)
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
