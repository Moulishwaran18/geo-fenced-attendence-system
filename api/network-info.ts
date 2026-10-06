/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Real diagnostic endpoint for discovering client public IP address and
 * testing campus network egress authorization on deployed Vercel production.
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

export default async function handler(req: any, res?: any) {
  const clientIp = extractClientPublicIp(req);

  const envCampus = (process.env["AUTHORIZED_CAMPUS_IPS"] || "").trim();
  const envM = (process.env["AUTHORIZED_M_PUBLIC_IP"] || "").trim();
  const envSona = (process.env["AUTHORIZED_SONA_PUBLIC_IP"] || "").trim();

  let matchedNetwork: string | null = null;
  let isAuthorized = false;

  if (envM && envM.split(",").some((p) => matchesIpPattern(clientIp, p))) {
    isAuthorized = true;
    matchedNetwork = "M";
  } else if (envSona && envSona.split(",").some((p) => matchesIpPattern(clientIp, p))) {
    isAuthorized = true;
    matchedNetwork = "SONA-WIFI";
  } else if (envCampus && envCampus.split(",").some((p) => matchesIpPattern(clientIp, p))) {
    isAuthorized = true;
    matchedNetwork = "CAMPUS";
  }

  const payload = {
    publicIp: clientIp,
    isAuthorized,
    matchedNetwork,
    networkCheck: isAuthorized
      ? `AUTHORIZED (Matches ${matchedNetwork} network signature)`
      : "UNAUTHORIZED (Public IP does not match configured campus ranges)",
    environmentConfig: {
      AUTHORIZED_CAMPUS_IPS: envCampus ? "[CONFIGURED]" : "[NOT SET]",
      AUTHORIZED_M_PUBLIC_IP: envM ? "[CONFIGURED]" : "[NOT SET]",
      AUTHORIZED_SONA_PUBLIC_IP: envSona ? "[CONFIGURED]" : "[NOT SET]",
    },
    headers: {
      "x-forwarded-for": req.headers?.["x-forwarded-for"] || null,
      "x-real-ip": req.headers?.["x-real-ip"] || null,
    },
    instructions:
      "When connected to M or SONA-WIFI on your phone, open this endpoint to inspect the public egress IP. Configure that IP or CIDR in Vercel environment variables to authorize campus attendance.",
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
