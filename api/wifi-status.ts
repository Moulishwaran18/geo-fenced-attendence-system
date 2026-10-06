/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * Provides campus Wi-Fi verification on deployed Vercel production environment.
 * Uses ONLY SSID name-based authorization.
 *
 * Rule:
 * normalizedSsid === "m" || normalizedSsid.includes("sona")
 *
 * If SSID cannot be provided by browser, returns SSID_UNAVAILABLE and fails.
 */
import { verifyCampusWifi } from "../src/lib/wifi-config.ts";

export default async function handler(req: any, res?: any) {
  let body: any = {};

  if (req.method === "POST") {
    try {
      if (typeof req.json === "function") {
        body = await req.json();
      } else if (req.body) {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      }
    } catch {
      body = {};
    }
  }

  // Extract SSID from POST body or query parameter
  let querySsid = "";
  try {
    if (req.url) {
      const parsedUrl = new URL(req.url, "http://localhost");
      querySsid = parsedUrl.searchParams.get("ssid") || "";
    } else if (req.query?.ssid) {
      querySsid = String(req.query.ssid);
    }
  } catch {
    querySsid = "";
  }

  const requestedSsid = body.ssid !== undefined ? body.ssid : querySsid;

  // Browser limitation: if no valid SSID provided, do NOT fabricate an SSID.
  // Return SSID_UNAVAILABLE and mark Wi-Fi verification as FAILED/UNKNOWN.
  const ssidToVerify =
    requestedSsid !== null && requestedSsid !== undefined && String(requestedSsid).trim() !== ""
      ? String(requestedSsid)
      : "SSID_UNAVAILABLE";

  const verification = verifyCampusWifi({
    ssid: ssidToVerify,
    state: body.state,
    signal: body.signal,
    band: body.band,
    auth: body.auth,
  });

  const responsePayload = {
    isSonaWifi: verification.authorized,
    authorized: verification.authorized,
    ssid: verification.ssid,
    networkSummary: verification.networkSummary,
    reason: verification.reason,
    state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
    stage: verification.stage,
    timestamp: verification.timestamp,
  };

  // Node.js Serverless runtime (req, res)
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(responsePayload);
    }
    if (typeof res.writeHead === "function") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
    }
    if (typeof res.end === "function") {
      return res.end(JSON.stringify(responsePayload));
    }
  }

  // Web API / Edge runtime (Response)
  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
