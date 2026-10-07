/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Notice: SONA-WIFI Campus Network Authorization uses SERVER-SIDE DUAL-EGRESS
 * VERIFICATION (Option B) for normal Android Chrome and desktop browsers, alongside
 * native Android bridge compatibility for the existing APK.
 *
 * Authorized SONA-WIFI Egress IPs:
 * - 111.92.42.18 (Asianet Broadband - Dynamic lease)
 * - 115.247.87.98 (Reliance Jio Enterprise - AS55836)
 */

const VERIFIED_SONA_EGRESS_IPS = ["111.92.42.18", "115.247.87.98"];

function getAuthorizedCampusEgressIps(): string[] {
  const envVal =
    (typeof process !== "undefined" && process.env?.AUTHORIZED_CAMPUS_EGRESS_IPS) ||
    (typeof process !== "undefined" && process.env?.VITE_AUTHORIZED_CAMPUS_EGRESS_IPS);
  if (envVal) {
    const list = envVal
      .split(",")
      .map((ip: string) => ip.trim())
      .filter((ip: string) => ip.length > 0);
    if (list.length > 0) return list;
  }
  return [...VERIFIED_SONA_EGRESS_IPS];
}

function sanitizeIp(ip?: string | null): string {
  if (!ip) return "";
  let clean = String(ip).trim().toLowerCase();
  if (clean.startsWith("::ffff:")) clean = clean.slice(7);
  clean = clean.split("%")[0].trim();
  const portMatch = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (portMatch) clean = portMatch[1];
  return clean;
}

function isPrivateIp(ip: string): boolean {
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    ip === "::1" ||
    ip === "localhost"
  ) {
    return true;
  }
  const match172 = ip.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const octet = parseInt(match172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

function extractTrustedClientIp(req: any): string {
  if (!req) return "unknown";
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };

  const vercelForwarded = getHeader("x-vercel-forwarded-for");
  if (vercelForwarded) {
    const ips = vercelForwarded.split(",").map((s: string) => sanitizeIp(s)).filter(Boolean);
    if (ips.length > 0) return ips[0];
  }

  const realIp = getHeader("x-real-ip");
  if (realIp) {
    const clean = sanitizeIp(realIp);
    if (clean) return clean;
  }

  const fwd = getHeader("x-forwarded-for");
  if (fwd) {
    const ips = fwd.split(",").map((s: string) => sanitizeIp(s)).filter(Boolean);
    if (ips.length > 0) {
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = ips[i];
        if (!isPrivateIp(ip)) return ip;
      }
      return ips[0];
    }
  }

  const remote =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.info?.remoteAddress ||
    req.ip ||
    "";
  if (remote) {
    const clean = sanitizeIp(remote);
    if (clean) return clean;
  }

  return "unknown";
}

export default async function handler(req: any, res?: any) {
  const clientIp = extractTrustedClientIp(req);
  const authorizedIps = getAuthorizedCampusEgressIps();
  const isMatch = authorizedIps.includes(clientIp);

  const payload = {
    authModel: "SONA_CAMPUS_DUAL_EGRESS_IP_AUTHENTICATION",
    network: "SONA-WIFI",
    targetBrowsers: "Android Chrome, Laptop/Desktop Chrome, Edge, Safari",
    clientPublicIp: clientIp !== "unknown" ? clientIp : undefined,
    isAuthorized: isMatch,
    authorizedEgressIps: authorizedIps,
    message:
      "Normal Android Chrome connects directly without APK or native bridge. Vercel independently inspects the real incoming public egress IP.",
    dynamicIpNotice:
      "111.92.42.18 is dynamic Asianet and SONA-WIFI uses Multi-WAN load-balancing. IPs are configurable via AUTHORIZED_CAMPUS_EGRESS_IPS environment variable.",
    timestamp: new Date().toISOString(),
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(payload);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
    return;
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
