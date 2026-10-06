/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * Provides campus Wi-Fi verification on deployed Vercel production environment.
 */
import {
  verifyCampusWifi,
  extractClientPublicIpFromHeaders,
} from "../src/lib/wifi-config.ts";

export default async function handler(req: any, res?: any) {
  // Support both Web Request and Node IncomingMessage
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

  const clientPublicIp = extractClientPublicIpFromHeaders(req.headers || {});
  const configuredAuthorizedIp = (
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string)
      : "") || ""
  ).trim();

  const verification = verifyCampusWifi({
    ...body,
    clientPublicIp: clientPublicIp || body.clientPublicIp || body.clientIp || body.ip,
    authorizedMPublicIp: configuredAuthorizedIp,
  });

  const responsePayload = {
    isSonaWifi: verification.authorized,
    authorized: verification.authorized,
    ssid: verification.ssid,
    bssid: verification.bssid,
    ip: verification.ip || clientPublicIp,
    publicIp: clientPublicIp,
    gateway: verification.gateway,
    dns: verification.dns,
    state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
    reason: verification.reason,
    stage: verification.stage,
    bssidStatusMessage: verification.bssidStatusMessage,
    networkSummary: verification.networkSummary,
    authMethod: verification.authMethod,
    timestamp: verification.timestamp,
    signal: body.signal || (body.rssi ? `${body.rssi} dBm` : verification.signal || ""),
    band: body.band || (body.frequency ? (body.frequency >= 4900 ? "5 GHz" : "2.4 GHz") : verification.band) || "",
    auth: body.auth || body.security || verification.auth || "",
    frequency: body.frequency,
    linkSpeed: body.linkSpeed,
    rssi: body.rssi,
  };

  // Node.js Serverless runtime
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

  // Web API / Edge runtime
  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
