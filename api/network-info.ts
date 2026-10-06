/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Exposes client public IP diagnostic information for campus Wi-Fi "M" verification.
 * Automatically deployed by Vercel as a Serverless API route from the root /api directory.
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

// Helper to check if client IP matches authorized M config
function isAuthorizedMPublicIp(clientIp?: string, configuredAuthorizedIp?: string): boolean {
  if (!clientIp || clientIp === "unknown") return false;
  const config =
    configuredAuthorizedIp?.trim() ||
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string).trim()
      : "");

  if (!config) return false;

  const cleanClient = clientIp.trim().toLowerCase().replace(/^::ffff:/, "");

  const allowedEntries = config
    .split(",")
    .map((e) => e.trim().toLowerCase().replace(/^::ffff:/, ""))
    .filter(Boolean);

  for (const entry of allowedEntries) {
    if (cleanClient === entry) return true;
    if (entry.endsWith(".") && cleanClient.startsWith(entry)) return true;
    if (entry.includes("/") && matchCidr(cleanClient, entry)) return true;
  }

  return false;
}

// Extracts real client public IP from Vercel / proxy headers
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
  const configuredIp = (
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string)
      : "") || ""
  ).trim();

  const isMatch = isAuthorizedMPublicIp(clientIp, configuredIp);

  let networkCheck = "UNAUTHORIZED (Does not match AUTHORIZED_M_PUBLIC_IP)";
  if (!configuredIp) {
    networkCheck = "NOT_CONFIGURED (Please set AUTHORIZED_M_PUBLIC_IP in environment)";
  } else if (isMatch) {
    networkCheck = "AUTHORIZED (Matches AUTHORIZED_M_PUBLIC_IP)";
  }

  const payload = {
    publicIp: clientIp,
    networkCheck,
    configuredAuthorizedIp: configuredIp ? "[CONFIGURED]" : "[NOT SET]",
    isAuthorized: isMatch,
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
