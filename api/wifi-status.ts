/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * Provides campus network verification on deployed Vercel production environment.
 * Evaluates server-observable evidence (Client Public Egress IP / CIDR)
 * and native bridge telemetry (SSID name-based rules).
 *
 * Rule:
 * 1. Native bridge: normalizedSsid === "m" || normalizedSsid.includes("sona")
 * 2. Mobile Chrome / Web: Client IP matches authorized campus network egress ranges
 *    (AUTHORIZED_CAMPUS_IPS, AUTHORIZED_M_PUBLIC_IP, AUTHORIZED_SONA_PUBLIC_IP)
 *
 * Note: Never trusts client-controlled { authorized: true } or query parameters.
 */

// Helper to check IPv4 CIDR matching
function matchCidr(ip: string, cidr: string): boolean {
  try {
    const parts = cidr.split("/");
    const range = parts[0];
    const bitsStr = parts[1];
    if (!range || !bitsStr) return false;

    const bits = parseInt(bitsStr, 10);
    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    const ipParts = ip.split(".").map(Number);
    const rangeParts = range.split(".").map(Number);
    if (ipParts.length !== 4 || rangeParts.length !== 4) return false;
    if (ipParts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
    if (rangeParts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;

    const ip0 = ipParts[0] ?? 0;
    const ip1 = ipParts[1] ?? 0;
    const ip2 = ipParts[2] ?? 0;
    const ip3 = ipParts[3] ?? 0;

    const r0 = rangeParts[0] ?? 0;
    const r1 = rangeParts[1] ?? 0;
    const r2 = rangeParts[2] ?? 0;
    const r3 = rangeParts[3] ?? 0;

    const ipNum = ((ip0 << 24) | (ip1 << 16) | (ip2 << 8) | ip3) >>> 0;
    const rangeNum = ((r0 << 24) | (r1 << 16) | (r2 << 8) | r3) >>> 0;

    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

function matchesIpPattern(clientIp: string, pattern: string): boolean {
  if (!clientIp || clientIp === "unknown" || !pattern) return false;
  const cleanClient = clientIp.trim().toLowerCase().replace(/^::ffff:/, "");
  const cleanPattern = pattern.trim().toLowerCase().replace(/^::ffff:/, "");

  if (cleanClient === cleanPattern) return true;
  if (cleanPattern.endsWith(".") && cleanClient.startsWith(cleanPattern)) return true;
  if (cleanPattern.endsWith(":") && cleanClient.startsWith(cleanPattern)) return true;
  if (cleanPattern.includes("/") && matchCidr(cleanClient, cleanPattern)) return true;

  return false;
}

function extractClientPublicIp(req: any): string {
  const getHeader = (name: string): string => {
    if (!req) return "";
    if (req.headers && typeof req.headers.get === "function") {
      return req.headers.get(name) || "";
    }
    if (req.headers) {
      const val = req.headers[name.toLowerCase()] ?? req.headers[name];
      if (Array.isArray(val)) return val[0] || "";
      if (typeof val === "string") return val;
    }
    return "";
  };

  const raw =
    getHeader("x-forwarded-for") ||
    getHeader("x-real-ip") ||
    getHeader("x-vercel-forwarded-for") ||
    getHeader("cf-connecting-ip") ||
    getHeader("x-client-ip") ||
    req?.socket?.remoteAddress ||
    req?.connection?.remoteAddress ||
    "";

  if (!raw) return "unknown";

  const first = raw.split(",")[0]?.trim() ?? "";
  const unmapped = first.replace(/^::ffff:/, "");
  if (/^[0-9.]+:[0-9]+$/.test(unmapped)) {
    return unmapped.split(":")[0] ?? unmapped;
  }
  return unmapped || "unknown";
}

function checkCampusIpAuthorization(clientIp: string): {
  authorized: boolean;
  matchedNetwork: string | null;
  reason: string;
} {
  const envCampus = (process.env["AUTHORIZED_CAMPUS_IPS"] || "").trim();
  const envM = (process.env["AUTHORIZED_M_PUBLIC_IP"] || "").trim();
  const envSona = (process.env["AUTHORIZED_SONA_PUBLIC_IP"] || "").trim();

  // If no environment variables configured, cannot verify campus IP
  if (!envCampus && !envM && !envSona) {
    return {
      authorized: false,
      matchedNetwork: null,
      reason: "No authorized campus egress IP ranges configured on server (AUTHORIZED_CAMPUS_IPS, AUTHORIZED_M_PUBLIC_IP, AUTHORIZED_SONA_PUBLIC_IP).",
    };
  }

  // Check M network
  if (envM) {
    const entries = envM.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "M",
          reason: "Verified via authorized campus network egress (M).",
        };
      }
    }
  }

  // Check SONA network
  if (envSona) {
    const entries = envSona.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "SONA-WIFI",
          reason: "Verified via authorized campus network egress (SONA-WIFI).",
        };
      }
    }
  }

  // Check general campus network
  if (envCampus) {
    const entries = envCampus.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "CAMPUS",
          reason: "Verified via authorized campus network egress.",
        };
      }
    }
  }

  return {
    authorized: false,
    matchedNetwork: null,
    reason: `Unauthorized Wi-Fi network. Public IP (${clientIp}) does not match authorized campus network egress signatures.`,
  };
}

function isSsidAuthorized(ssid?: string | null | undefined): boolean {
  if (!ssid) return false;
  const trimmed = ssid.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return false;
  const normalizedSsid = trimmed.toLowerCase();

  if (
    normalizedSsid === "unknown" ||
    normalizedSsid === "unavailable" ||
    normalizedSsid === "hidden" ||
    normalizedSsid === "<unknown ssid>" ||
    normalizedSsid === "none" ||
    normalizedSsid === "ssid_unavailable" ||
    normalizedSsid === "unavailable in browser"
  ) {
    return false;
  }

  return normalizedSsid === "m" || normalizedSsid.includes("sona");
}

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

  const clientIp = extractClientPublicIp(req);
  const timestamp = new Date().toISOString();

  let isAuthorized = false;
  let networkSummary = "Unauthorized Wi-Fi network";
  let displaySsid = "Unavailable in browser";
  let reason = "Unauthorized Wi-Fi network.";
  let stage: "VERIFIED" | "SSID_CHECK_FAILED" | "UNABLE_TO_VERIFY" = "UNABLE_TO_VERIFY";

  // Case 1: Native bridge provided a genuine SSID (e.g. from Android app)
  if (body.isNativeBridge === true && body.ssid) {
    const rawSsid = String(body.ssid).trim().replace(/^["']|["']$/g, "");
    if (isSsidAuthorized(rawSsid)) {
      isAuthorized = true;
      displaySsid = rawSsid;
      networkSummary = "Authorized campus network";
      reason = `Verified Campus Wi-Fi "${rawSsid}" via native bridge`;
      stage = "VERIFIED";
    } else {
      isAuthorized = false;
      displaySsid = rawSsid;
      networkSummary = "Unauthorized Wi-Fi network";
      reason = `Unauthorized Wi-Fi network "${rawSsid}". Only authorized campus networks (M or SONA) are permitted.`;
      stage = "SSID_CHECK_FAILED";
    }
  } else {
    // Case 2: Web browser (Mobile Chrome on Android)
    // Server-observable network evidence: verify public IP
    const ipAuth = checkCampusIpAuthorization(clientIp);

    if (ipAuth.authorized) {
      isAuthorized = true;
      displaySsid = "Unavailable in browser";
      networkSummary = "Authorized campus network";
      reason = ipAuth.reason;
      stage = "VERIFIED";
    } else {
      isAuthorized = false;
      displaySsid = "Unavailable in browser";
      networkSummary = "Unauthorized Wi-Fi network";
      reason = ipAuth.reason;
      stage = "UNABLE_TO_VERIFY";
    }
  }

  const responsePayload = {
    isSonaWifi: isAuthorized,
    authorized: isAuthorized,
    ssid: displaySsid,
    networkSummary,
    reason,
    state: "connected",
    stage,
    publicIp: clientIp,
    timestamp,
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
