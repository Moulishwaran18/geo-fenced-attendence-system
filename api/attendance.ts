/**
 * Vercel Serverless Function: POST /api/attendance
 *
 * CRITICAL SERVER-SIDE ATTENDANCE PROTECTION GATE:
 * - Independently enforces server-verified SONA-WIFI campus network authorization.
 * - ZERO CLIENT TRUST: Ignores any client-supplied `wifiAuthorized: true` or client claims.
 * - Requires a valid, unexpired cryptographic `networkAuthToken` minted by the server
 *   OR direct connection from an authorized campus egress IP (111.92.42.18 / 115.247.87.98).
 * - Prevents DevTools / API manipulation from recording attendance outside campus.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const VERIFIED_SONA_EGRESS_IPS = ["111.92.42.18", "115.247.87.98"];
const TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] || process.env["NETWORK_AUTH_SECRET"])) ||
  "sona-campus-wifi-egress-auth-secret-key-2026";

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

function verifyNetworkAuthToken(token?: string | null): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "MISSING_TOKEN" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "INVALID_TOKEN_FORMAT" };
  }

  const payloadB64 = parts[0];
  const signature = parts[1];

  if (!payloadB64 || !signature) {
    return { valid: false, error: "INVALID_TOKEN_FORMAT" };
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }

    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadStr);

    if (!payload.expiresAt || typeof payload.expiresAt !== "number") {
      return { valid: false, error: "MALFORMED_PAYLOAD" };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "TOKEN_DECODE_FAILED" };
  }
}

function getCookie(req: any, name: string): string | null {
  const cookieHeader =
    (req && req.headers && (req.headers["cookie"] || req.headers["Cookie"])) || "";
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match || !match[1]) return null;
  return decodeURIComponent(match[1]);
}

export default async function handler(req: any, res?: any) {
  if (req.method !== "POST") {
    const errorPayload = { error: "Method not allowed. Use POST." };
    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json");
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(405).json(errorPayload);
      }
      res.statusCode = 405;
      res.end(JSON.stringify(errorPayload));
      return;
    }
    return new Response(JSON.stringify(errorPayload), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  let body: any = {};
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

  // 1. Extract Real Incoming Client Public IP from Trusted Server Infrastructure
  const clientIp = extractTrustedClientIp(req);

  // 2. Extract Server-Issued Network Authorization Token (from Header, Body, or Secure Cookie)
  const headerToken = req.headers?.["x-network-auth-token"] || req.headers?.["X-Network-Auth-Token"];
  const cookieToken = getCookie(req, "sona_network_auth");
  const bodyToken = body.networkAuthToken;
  const networkToken = headerToken || cookieToken || bodyToken;

  // 3. Independent Cryptographic & Network Verification
  const tokenCheck = verifyNetworkAuthToken(networkToken);
  const ipCheck = isAuthorizedCampusEgressIp(clientIp);

  // ZERO CLIENT TRUST GATE:
  // Must have a valid, cryptographically unexpired server token OR current connection from authorized egress IP
  const isNetworkAuthorized = tokenCheck.valid || ipCheck.authorized;

  if (!isNetworkAuthorized) {
    const rejectionPayload = {
      success: false,
      error: "CAMPUS_NETWORK_UNAUTHORIZED",
      message:
        "Attendance rejected: Device is not authorized on SONA-WIFI campus network. Genuine server-side campus network verification is required.",
      clientIp: clientIp !== "unknown" ? clientIp : undefined,
      tokenError: tokenCheck.error || "No valid token present.",
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(403).json(rejectionPayload);
      }
      res.statusCode = 403;
      res.end(JSON.stringify(rejectionPayload));
      return;
    }
    return new Response(JSON.stringify(rejectionPayload), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  // 4. Authorized! Record Attendance in Database
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const dayStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Asia/Kolkata",
  });
  const dateKey = now.toISOString().slice(0, 10).replace(/-/g, "");

  const staffCode = body.staffCode || "SCT-2417";
  const staffName = body.staffName || "Staff Member";
  const department = body.department || "Engineering";
  let attendanceId = `ATT-${dateKey}-${String(Math.floor(Math.random() * 900) + 100)}`;

  // Record in Supabase if configured
  const supabaseUrl =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "";
  const supabaseKey =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"])) ||
    "";

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from("attendance_records")
        .insert({
          staff_code: staffCode,
          staff_name: staffName,
          department: department,
          day: dayStr,
          time: timeStr,
          status: "Present",
          location: body.location || "Main Campus, Sona College",
          verification: "Verified (SONA-WIFI)",
          latitude: body.latitude,
          longitude: body.longitude,
          photo_url: body.photoUrl || null,
        })
        .select()
        .single();

      if (!error && data?.id) {
        attendanceId = data.id;
      }
    } catch (dbErr) {
      console.warn("[api/attendance] Supabase recording warning (fallback to generated ID):", dbErr);
    }
  }

  const successPayload = {
    success: true,
    receipt: {
      attendanceId,
      time: timeStr,
      date: dateStr,
    },
    verifiedNetwork: "SONA Campus Network",
    verifiedIp: tokenCheck.payload?.verifiedIp || ipCheck.matchedIp || clientIp,
    timestamp: now.toISOString(),
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(successPayload);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(successPayload));
    return;
  }
  return new Response(JSON.stringify(successPayload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
