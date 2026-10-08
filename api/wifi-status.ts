/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * HYBRID CAMPUS NETWORK VERIFICATION ENGINE:
 * 1. Web Browsers (Android Chrome & Desktop Chrome):
 *    - Authenticates connection using REAL server-observed public egress IP.
 *    - Validates against authorized SONA-WIFI egress IPs (111.92.42.18, 115.247.87.98).
 *    - Anti-spoofing: Rejects forged client headers via trusted Vercel infrastructure extraction.
 *    - Zero Client Trust: Mints a cryptographically signed `networkAuthToken` for attendance gating.
 * 2. Native Android Bridge (Existing APK WebView compatibility):
 *    - Retains native network-layer LinkProperties & ConnectivityManager fingerprint validation.
 *
 * AUTHORIZED SONA-WIFI EGRESS IPS:
 * - 111.92.42.18 (Asianet Broadband - Dynamic IP warning applies)
 * - 115.247.87.98 (Reliance Jio Enterprise - AS55836)
 */

import crypto from "node:crypto";

const VERIFIED_SONA_EGRESS_IPS = ["111.92.42.18", "115.247.87.98"];
const TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] || process.env["NETWORK_AUTH_SECRET"])) ||
  "sona-campus-wifi-egress-auth-secret-key-2026";
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getAuthorizedCampusEgressIps(): string[] {
  const envVal =
    (typeof process !== "undefined" &&
      (process.env["AUTHORIZED_CAMPUS_EGRESS_IPS"] || process.env["VITE_AUTHORIZED_CAMPUS_EGRESS_IPS"])) ||
    "";
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
  const split0 = clean.split("%")[0];
  if (split0) clean = split0.trim();
  const portMatch = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
  if (portMatch && portMatch[1]) clean = portMatch[1];
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
  if (match172 && match172[1]) {
    const octet = parseInt(match172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }
  return false;
}

export function isVercelOrProduction(req?: any): boolean {
  if (typeof process !== "undefined") {
    if (
      process.env["VERCEL"] === "1" ||
      process.env["VERCEL"] === "true" ||
      Boolean(process.env["VERCEL_ENV"])
    ) {
      return true;
    }
    if (process.env["NODE_ENV"] === "production") {
      return true;
    }
  }

  if (req) {
    const headers = req.headers || {};
    const getHeader = (name: string): string => {
      if (typeof headers.get === "function") return headers.get(name) || "";
      const lower = name.toLowerCase();
      return headers[name] || headers[lower] || "";
    };

    if (
      getHeader("x-vercel-forwarded-for") ||
      getHeader("x-vercel-id") ||
      getHeader("x-vercel-deployment-url")
    ) {
      return true;
    }
  }

  return false;
}

let devServerPublicIpOverrideForTesting: string | null = null;
let cachedDevEgressIp: { ip: string; timestamp: number } | null = null;
const DEV_EGRESS_CACHE_TTL_MS = 15000;

export function setDevServerPublicIpForTesting(ip: string | null) {
  devServerPublicIpOverrideForTesting = ip;
}

export async function fetchDevServerPublicEgressIp(): Promise<string | null> {
  // STRICT GUARD: Must NEVER execute in production or Vercel environment
  if (isVercelOrProduction()) {
    return null;
  }

  if (devServerPublicIpOverrideForTesting !== null) {
    return devServerPublicIpOverrideForTesting;
  }

  const now = Date.now();
  if (cachedDevEgressIp && now - cachedDevEgressIp.timestamp < DEV_EGRESS_CACHE_TTL_MS) {
    return cachedDevEgressIp.ip;
  }

  const endpoints = [
    {
      url: "https://api.ipify.org?format=json",
      parse: (text: string) => {
        try {
          const json = JSON.parse(text);
          return json?.ip ? String(json.ip).trim() : null;
        } catch {
          return null;
        }
      },
    },
    {
      url: "https://icanhazip.com",
      parse: (text: string) => text.trim(),
    },
    {
      url: "https://checkip.amazonaws.com",
      parse: (text: string) => text.trim(),
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(endpoint.url, {
        signal: controller.signal,
        headers: { "User-Agent": "SONA-Campus-Attendance-Dev/1.0" },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        const extracted = sanitizeIp(endpoint.parse(text));
        if (extracted && /^(\d{1,3}\.){3}\d{1,3}$/.test(extracted)) {
          cachedDevEgressIp = { ip: extracted, timestamp: now };
          return extracted;
        }
      }
    } catch {
      // Continue to next reflector endpoint
    }
  }

  return null;
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
    const firstIp = ips[0];
    if (firstIp) return firstIp;
  }

  // In local development (NOT Vercel / production), do NOT trust client x-real-ip or x-forwarded-for.
  // Instead, treat the socket peer IP directly.
  if (!isVercelOrProduction(req)) {
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
    return "127.0.0.1";
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
        if (ip && !isPrivateIp(ip)) return ip;
      }
      const fallbackIp = ips[0];
      if (fallbackIp) return fallbackIp;
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

function isAuthorizedCampusEgressIp(ip?: string | null): {
  authorized: boolean;
  matchedIp?: string;
  reason: string;
} {
  const cleanIp = sanitizeIp(ip);
  if (!cleanIp || cleanIp === "unknown") {
    return {
      authorized: false,
      reason: "No valid incoming public IP could be determined from trusted server infrastructure.",
    };
  }
  const authorizedIps = getAuthorizedCampusEgressIps();
  if (authorizedIps.includes(cleanIp)) {
    return {
      authorized: true,
      matchedIp: cleanIp,
      reason: `Verified connection originates from authorized SONA-WIFI campus egress IP (${cleanIp}).`,
    };
  }
  return {
    authorized: false,
    reason: `Network verification rejected. Server observed public IP ${cleanIp} does not match authorized campus network egress IPs.`,
  };
}

function parseIpv4(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function isIpInSubnet(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;
  const [subnetIp, maskBitsStr] = cidr.split("/");
  if (!subnetIp || !maskBitsStr) return false;
  const maskBits = parseInt(maskBitsStr, 10);
  if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;
  const ipNum = parseIpv4(ip);
  const subnetNum = parseIpv4(subnetIp);
  if (ipNum === null || subnetNum === null) return false;
  if (maskBits === 0) return true;
  const mask = ((0xffffffff << (32 - maskBits)) >>> 0);
  return (ipNum & mask) === (subnetNum & mask);
}

export function createNetworkAuthToken(verifiedIp: string): string {
  const payload = {
    authorized: true,
    verifiedIp,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    network: "SONA Campus Network",
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr, "utf-8").toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

interface FingerprintEvaluation {
  authorized: boolean;
  networkType: "SONA" | "M" | "UNAUTHORIZED" | "UNAVAILABLE";
  networkSummary: string;
  reason: string;
  stage: "VERIFIED" | "FINGERPRINT_CHECK_FAILED" | "DISCONNECTED" | "UNABLE_TO_VERIFY";
}

function evaluateNetworkFingerprint(payload: any): FingerprintEvaluation {
  const transport = String(payload?.transport || "").toLowerCase();
  const isWifi = payload?.isWifi === true || transport === "wifi";

  if (!isWifi || transport === "cellular" || transport === "none") {
    if (transport === "cellular") {
      return {
        authorized: false,
        networkType: "UNAUTHORIZED",
        networkSummary: "Mobile Data",
        reason: "Device is connected to mobile data, not campus Wi-Fi.",
        stage: "FINGERPRINT_CHECK_FAILED",
      };
    }
    if (transport === "none" || payload?.state === "disconnected") {
      return {
        authorized: false,
        networkType: "UNAVAILABLE",
        networkSummary: "Disconnected",
        reason: "Device is disconnected from all networks.",
        stage: "DISCONNECTED",
      };
    }
    return {
      authorized: false,
      networkType: "UNAUTHORIZED",
      networkSummary: "Non-Wi-Fi Network",
      reason: "Network transport is not Wi-Fi.",
      stage: "FINGERPRINT_CHECK_FAILED",
    };
  }

  const ipv4 = String(payload?.ipv4 || "").trim();
  const gateway = String(payload?.gateway || "").trim();
  const rawDns = Array.isArray(payload?.dnsServers)
    ? payload.dnsServers
    : typeof payload?.dnsServers === "string"
      ? [payload.dnsServers]
      : [];
  const dnsServers = rawDns.map((d: any) => String(d).trim().toLowerCase());
  const ipv4Subnet = String(payload?.ipv4Subnet || "").trim();

  if (!ipv4 && !gateway && dnsServers.length === 0) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Unable to verify network fingerprint",
      reason: "No network fingerprint telemetry returned from native network layer.",
      stage: "UNABLE_TO_VERIFY",
    };
  }

  // FINGERPRINT 1: SONA Campus Network
  const isSonaGateway = gateway === "172.16.16.16";
  const isSonaDns = dnsServers.includes("172.16.16.16");
  const sonaSubnetBase = ipv4Subnet ? (ipv4Subnet.split("/")[0] || "") : "";
  const isSonaSubnet =
    isIpInSubnet(ipv4, "172.16.0.0/12") ||
    (sonaSubnetBase ? isIpInSubnet(sonaSubnetBase, "172.16.0.0/12") : false);

  if ((isSonaGateway || isSonaDns) && isSonaSubnet) {
    return {
      authorized: true,
      networkType: "SONA",
      networkSummary: "SONA Campus Network",
      reason: "Verified SONA campus network fingerprint (Gateway/DNS: 172.16.16.16, Subnet: 172.16.0.0/12)",
      stage: "VERIFIED",
    };
  }

  // FINGERPRINT 2: M Institutional Network (Preserved for APK)
  const isMDns =
    dnsServers.includes("10.220.86.133") ||
    dnsServers.some((d: string) => d.includes("2409:40f4:311d:b23a"));
  const mSubnetBase = ipv4Subnet ? (ipv4Subnet.split("/")[0] || "") : "";
  const isMSubnet =
    isIpInSubnet(ipv4, "10.220.86.0/24") ||
    isIpInSubnet(ipv4, "10.220.0.0/16") ||
    (mSubnetBase ? isIpInSubnet(mSubnetBase, "10.220.0.0/16") : false);
  const isMGateway =
    gateway === "10.220.86.1" ||
    gateway === "10.220.86.133" ||
    gateway.startsWith("10.220.86.");

  if ((isMDns || isMGateway) && isMSubnet) {
    return {
      authorized: true,
      networkType: "M",
      networkSummary: "M Institutional Network",
      reason: "Verified M campus network fingerprint (DNS: 10.220.86.133, Subnet: 10.220.86.0/24)",
      stage: "VERIFIED",
    };
  }

  return {
    authorized: false,
    networkType: "UNAUTHORIZED",
    networkSummary: "Unauthorized Network",
    reason: `Network fingerprint rejected. Observed Gateway: ${gateway || "none"}, DNS: ${dnsServers.join(", ") || "none"}, IP: ${ipv4 || "none"} do not match authorized campus network fingerprints.`,
    stage: "FINGERPRINT_CHECK_FAILED",
  };
}

export default async function handler(req: any, res?: any) {
  let body: any = {};

  if (req.method === "POST") {
    try {
      if (typeof req.json === "function") {
        body = await req.json();
      } else if (req.body) {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } else if (typeof req.on === "function") {
        const chunks: Buffer[] = [];
        await new Promise((resolve) => {
          req.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on("end", resolve);
          req.on("error", resolve);
        });
        const str = Buffer.concat(chunks).toString("utf-8");
        body = str ? JSON.parse(str) : {};
      }
    } catch {
      body = {};
    }
  }

  const timestamp = new Date().toISOString();

  // 1. Native Android Bridge network fingerprint evaluation (Preserves APK compatibility)
  if (body && body.isNativeBridge === true && (body.transport || body.ipv4 || body.gateway || body.dnsServers)) {
    const result = evaluateNetworkFingerprint(body);
    const networkAuthToken = result.authorized ? createNetworkAuthToken("native-bridge") : undefined;

    const payload = {
      isSonaWifi: result.authorized,
      authorized: result.authorized,
      network: result.networkSummary,
      networkType: result.networkType,
      networkSummary: result.networkSummary,
      verificationMethod: "NATIVE_BRIDGE",
      reason: result.reason,
      state: result.stage === "DISCONNECTED" ? "disconnected" : "connected",
      stage: result.stage,
      timestamp,
      ipv4: body.ipv4 || null,
      ipv4Subnet: body.ipv4Subnet || null,
      gateway: body.gateway || null,
      dnsServers: body.dnsServers || [],
      networkAuthToken,
      isNativeBridge: true,
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
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // 2. Normal Android Chrome & Laptop / Desktop Browser Verification
  // Server inspects trusted incoming public egress IP from Vercel edge
  const clientIp = extractTrustedClientIp(req);
  const egressResult = isAuthorizedCampusEgressIp(clientIp);

  if (egressResult.authorized) {
    const verifiedIp = egressResult.matchedIp || clientIp;
    const networkAuthToken = createNetworkAuthToken(verifiedIp);

    const authorizedPayload = {
      authorized: true,
      network: "SONA Campus Network",
      verificationMethod: "SERVER_EGRESS_IP",
      verifiedIp,
      isSonaWifi: true,
      networkType: "SONA",
      networkSummary: "SONA Campus Network",
      reason: egressResult.reason,
      state: "connected",
      stage: "VERIFIED",
      networkAuthToken,
      timestamp,
      isNativeBridge: false,
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader(
        "Set-Cookie",
        `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=300`
      );
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(200).json(authorizedPayload);
      }
      res.statusCode = 200;
      res.end(JSON.stringify(authorizedPayload));
      return;
    }
    return new Response(JSON.stringify(authorizedPayload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        "set-cookie": `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=300`,
      },
    });
  }

  // 3. Local Development Egress Verification:
  // When running locally on developer machine (NOT on Vercel / production),
  // incoming client connection is loopback/private (127.0.0.1, localhost, private IP).
  // The local Node server determines its own real public Internet egress IP server-side.
  // NEVER authorize simply because the request is 127.0.0.1 / localhost / private IP.
  // Compare the server-observed public IP ONLY against 111.92.42.18 & 115.247.87.98.
  if (!egressResult.authorized && !isVercelOrProduction(req) && isPrivateIp(clientIp)) {
    const devServerPublicIp = await fetchDevServerPublicEgressIp();
    const devEgressResult = isAuthorizedCampusEgressIp(devServerPublicIp);

    if (devEgressResult.authorized && devServerPublicIp) {
      const verifiedIp = devEgressResult.matchedIp || devServerPublicIp;
      const networkAuthToken = createNetworkAuthToken(verifiedIp);

      const devAuthorizedPayload = {
        authorized: true,
        network: "SONA Campus Network",
        verificationMethod: "SERVER_DEV_EGRESS_IP",
        verifiedIp,
        isSonaWifi: true,
        networkType: "SONA",
        networkSummary: "SONA Campus Network",
        reason: `Verified connection originates from authorized SONA-WIFI campus egress IP (${verifiedIp}) via local dev egress verification.`,
        state: "connected",
        stage: "VERIFIED",
        networkAuthToken,
        timestamp,
        isNativeBridge: false,
      };

      if (res && typeof res.setHeader === "function") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader(
          "Set-Cookie",
          `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300`
        );
        if (typeof res.status === "function" && typeof res.json === "function") {
          return res.status(200).json(devAuthorizedPayload);
        }
        res.statusCode = 200;
        res.end(JSON.stringify(devAuthorizedPayload));
        return;
      }
      return new Response(JSON.stringify(devAuthorizedPayload), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
          "set-cookie": `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=300`,
        },
      });
    } else {
      // Local dev egress IP does not match authorized campus IPs, or could not be determined
      const devUnauthorizedPayload = {
        authorized: false,
        network: "Unauthorized Network",
        verificationMethod: "SERVER_DEV_EGRESS_IP",
        verifiedIp: devServerPublicIp || clientIp,
        isSonaWifi: false,
        networkType: "UNAUTHORIZED",
        networkSummary: "Unauthorized Network",
        reason: devServerPublicIp
          ? `Network verification rejected. Server observed public IP ${devServerPublicIp} does not match authorized campus network egress IPs.`
          : `Network verification rejected. Local dev server could not determine public egress IP, and local client IP ${clientIp} is not an authorized campus egress IP.`,
        state: "connected",
        stage: "FINGERPRINT_CHECK_FAILED",
        timestamp,
        isNativeBridge: false,
      };

      if (res && typeof res.setHeader === "function") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        if (typeof res.status === "function" && typeof res.json === "function") {
          return res.status(200).json(devUnauthorizedPayload);
        }
        res.statusCode = 200;
        res.end(JSON.stringify(devUnauthorizedPayload));
        return;
      }
      return new Response(JSON.stringify(devUnauthorizedPayload), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, no-cache, must-revalidate",
        },
      });
    }
  }

  // Unauthorized Network Response
  const unauthorizedPayload = {
    authorized: false,
    network: "Unauthorized Network",
    verificationMethod: "SERVER_EGRESS_IP",
    verifiedIp: clientIp !== "unknown" ? clientIp : undefined,
    isSonaWifi: false,
    networkType: "UNAUTHORIZED",
    networkSummary: "Unauthorized Network",
    reason: egressResult.reason,
    state: "connected",
    stage: "FINGERPRINT_CHECK_FAILED",
    timestamp,
    isNativeBridge: false,
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(unauthorizedPayload);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(unauthorizedPayload));
    return;
  }
  return new Response(JSON.stringify(unauthorizedPayload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
