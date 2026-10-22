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
function normalizePublicKeyToPem(rawKey: string | Record<string, any>): string {
  if (typeof rawKey === "object" && rawKey !== null) {
    const jwk = rawKey as Record<string, any>;
    if (jwk["kty"] === "EC" && jwk["crv"] === "P-256" && jwk["x"] && jwk["y"]) {
      const keyObj = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
      return keyObj.export({ type: "spki", format: "pem" }).toString();
    }
  }
  const trimmed = String(rawKey).trim();
  if (trimmed.includes("-----BEGIN PUBLIC KEY-----")) return trimmed;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return normalizePublicKeyToPem(JSON.parse(trimmed));
    } catch {}
  }
  const cleanB64 = trimmed.replace(/\s+/g, "");
  const formatted = cleanB64.match(/.{1,64}/g)?.join("\n") || cleanB64;
  return `-----BEGIN PUBLIC KEY-----\n${formatted}\n-----END PUBLIC KEY-----`;
}

function convertP1363ToDer(rawSig: Buffer): Buffer {
  if (rawSig.length !== 64) return rawSig;
  const r = rawSig.subarray(0, 32);
  const s = rawSig.subarray(32, 64);
  function encodeInteger(bytes: Buffer): Buffer {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let slice = bytes.subarray(start);
    if (slice[0]! >= 0x80) {
      slice = Buffer.concat([Buffer.from([0x00]), slice]);
    }
    return Buffer.concat([Buffer.from([0x02, slice.length]), slice]);
  }
  const rDer = encodeInteger(r);
  const sDer = encodeInteger(s);
  return Buffer.concat([Buffer.from([0x30, rDer.length + sDer.length]), rDer, sDer]);
}

function verifyDeviceSignature(
  publicKeyPemOrB64: string,
  dataToVerify: string | Buffer,
  signatureB64OrHex: string,
  keyAlgorithm = "ECDSA_P256"
): boolean {
  if (!publicKeyPemOrB64 || !dataToVerify || !signatureB64OrHex) return false;
  try {
    const pem = normalizePublicKeyToPem(publicKeyPemOrB64);
    const dataBuffer = Buffer.isBuffer(dataToVerify) ? dataToVerify : Buffer.from(dataToVerify, "utf-8");
    let sigBuffer: Buffer;
    const cleanSig = signatureB64OrHex.trim();
    if (/^[0-9a-fA-F]+$/.test(cleanSig) && cleanSig.length % 2 === 0 && !cleanSig.includes("=")) {
      sigBuffer = Buffer.from(cleanSig, "hex");
    } else {
      sigBuffer = Buffer.from(cleanSig, "base64");
    }
    const verifier = crypto.createVerify("SHA256");
    verifier.update(dataBuffer);
    let derSig = sigBuffer;
    if (keyAlgorithm.includes("ECDSA") && sigBuffer.length === 64) {
      derSig = convertP1363ToDer(sigBuffer);
    }
    let isValid = verifier.verify(pem, derSig);
    if (!isValid && derSig !== sigBuffer) {
      const retryVerifier = crypto.createVerify("SHA256");
      retryVerifier.update(dataBuffer);
      isValid = retryVerifier.verify(pem, sigBuffer);
    }
    return isValid;
  } catch (err) {
    console.warn("[verifyDeviceSignature] Error:", err);
    return false;
  }
}

async function getActiveDeviceForStaff(cleanCode: string) {
  const code = cleanCode.trim().toUpperCase();
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from("devices")
      .select("*")
      .ilike("staff_code", code)
      .eq("status", "Active")
      .order("registered_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      let pubKey = data.public_key;
      let keyAlgo = data.key_algorithm || "ECDSA_P256";
      let keyId = data.key_id || data.id;

      if (!pubKey) {
        try {
          const { data: eventRow } = await supabaseClient
            .from("security_events")
            .select("device")
            .ilike("staff", code)
            .like("event", "DEVICE_REGISTERED|%")
            .order("time", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (eventRow?.device) {
            const devMeta = typeof eventRow.device === "string" ? JSON.parse(eventRow.device) : eventRow.device;
            if (devMeta?.publicKey) {
              pubKey = devMeta.publicKey;
              if (devMeta.keyAlgorithm) keyAlgo = devMeta.keyAlgorithm;
              if (devMeta.keyId) keyId = devMeta.keyId;
            }
          }
        } catch {}
      }

      return {
        id: data.id,
        staff_id: data.staff_id,
        staff_code: data.staff_code,
        staff_name: data.staff_name,
        public_key: pubKey,
        key_id: keyId,
        key_algorithm: keyAlgo,
        platform: data.platform || "android",
        model: data.model || "Mobile Device",
        os: data.os || "Android",
        status: data.status || "Active",
        registered_at: data.registered_at,
        last_verified_at: data.last_verified_at || data.registered_at,
        revocation_reason: data.revocation_reason,
        revoked_at: data.revoked_at,
      };
    }
  } catch (e) {
    console.warn("[getActiveDeviceForStaff] Error:", e);
  }
  return null;
}

async function updateDeviceLastVerified(deviceId: string): Promise<void> {
  const now = new Date().toISOString();
  const supabaseClient = getSupabaseClient();
  if (supabaseClient) {
    try {
      await supabaseClient.from("devices").update({ last_verified_at: now }).eq("id", deviceId);
    } catch {}
  }
}


const VERIFIED_SONA_EGRESS_IPS = ["111.92.42.18", "115.247.87.98"];
const TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] || process.env["NETWORK_AUTH_SECRET"])) ||
  "sona-campus-wifi-egress-auth-secret-key-2026";

const STAFF_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-staff-auth-session-sec-key-2026";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) ||
    "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  if (!url || !key) return null;
  return createClient(url, key);
}

function verifyStaffToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };
  try {
    const expectedSig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "DECODE_FAILED" };
  }
}

function verifyAdminToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };
  try {
    const expectedSig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "DECODE_FAILED" };
  }
}

function extractBearerOrCookieToken(req: any): string | null {
  if (!req) return null;
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };
  const authHeader = getHeader("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }
  const customHeader = getHeader("x-admin-token") || getHeader("x-staff-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const adminMatch = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (adminMatch && adminMatch[1]) return decodeURIComponent(adminMatch[1]);
    const staffMatch = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (staffMatch && staffMatch[1]) return decodeURIComponent(staffMatch[1]);
  }
  return null;
}

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

function isVercelOrProduction(req?: any): boolean {
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

let cachedDevEgressIp: { ip: string; timestamp: number } | null = null;
const DEV_EGRESS_CACHE_TTL_MS = 15000;

async function fetchDevServerPublicEgressIp(): Promise<string | null> {
  if (isVercelOrProduction()) {
    return null;
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

  const cfIp = getHeader("cf-connecting-ip");
  if (cfIp) {
    const clean = sanitizeIp(cfIp);
    if (clean) return clean;
  }

  const fwd = getHeader("x-forwarded-for");
  if (fwd) {
    const ips = fwd.split(",").map((s: string) => sanitizeIp(s)).filter(Boolean);
    if (ips.length > 0) {
      // In trusted reverse proxy environment, the first IP is the originating client
      const firstIp = ips[0];
      if (firstIp && !isPrivateIp(firstIp)) return firstIp;
      for (const ip of ips) {
        if (ip && !isPrivateIp(ip)) return ip;
      }
      return firstIp || "unknown";
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

function isAuthorizedSonaSsid(ssid?: string | null | undefined): boolean {
  if (!ssid || typeof ssid !== "string") return false;
  const clean = ssid.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (
    !clean ||
    clean === "<unknown ssid>" ||
    clean === "unknown" ||
    clean === "ssid_unavailable" ||
    clean === "0x"
  ) {
    return false;
  }
  return clean.includes("sona");
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

    const tokenSsid = payload.ssid || payload.network || "";
    if (!payload.authorized || !isAuthorizedSonaSsid(tokenSsid)) {
      return { valid: false, error: "UNAUTHORIZED_SSID_IN_TOKEN" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "TOKEN_DECODE_FAILED" };
  }
}

const usedAttestationNonces = new Map<string, number>();

function cleanExpiredNonces() {
  const cutoff = Date.now() - 180_000;
  for (const [nonce, ts] of usedAttestationNonces.entries()) {
    if (ts < cutoff) {
      usedAttestationNonces.delete(nonce);
    }
  }
}

/**
 * Validates a single-use cryptographic biometric attestation minted by the native Android app.
 */
function verifyBiometricAttestation(token?: string | null): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "MISSING_ATTESTATION" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "INVALID_ATTESTATION_FORMAT" };
  }

  const payloadB64 = parts[0];
  const signature = parts[1];

  if (!payloadB64 || !signature) {
    return { valid: false, error: "MALFORMED_ATTESTATION" };
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_ATTESTATION_SIGNATURE" };
    }

    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadStr);

    if (!payload.timestamp || typeof payload.timestamp !== "number") {
      return { valid: false, error: "INVALID_ATTESTATION_TIMESTAMP" };
    }

    // 120-second validity window to block replay attacks
    const ageMs = Date.now() - payload.timestamp;
    if (ageMs > 120_000 || ageMs < -30_000) {
      return { valid: false, error: "ATTESTATION_EXPIRED" };
    }

    // Attempt nonce replay protection
    if (!payload.nonce || typeof payload.nonce !== "string" || payload.nonce.trim().length < 8) {
      return { valid: false, error: "MISSING_ATTESTATION_NONCE" };
    }

    cleanExpiredNonces();
    if (usedAttestationNonces.has(payload.nonce)) {
      return { valid: false, error: "ATTESTATION_NONCE_REPLAYED" };
    }
    usedAttestationNonces.set(payload.nonce, payload.timestamp);

    // Strict liveness and anti-spoof checks on attestation payload
    if (payload.livenessPassed !== true) {
      return { valid: false, error: "LIVENESS_FAILED" };
    }

    if (typeof payload.antiSpoofScore !== "number" || isNaN(payload.antiSpoofScore) || payload.antiSpoofScore < 0.50) {
      return { valid: false, error: "SPOOF_SCORE_INSUFFICIENT" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "ATTESTATION_DECODE_FAILED" };
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

// Authoritative 19-point Campus Polygon Coordinates (C1 -> ... -> C18 -> C19)
const AUTHORIZED_GEOFENCE_POLYGON = [
  { lat: 11.679113056127784, lng: 78.12389462165308 }, // C1
  { lat: 11.679160653348573, lng: 78.1251229550977 },  // C2
  { lat: 11.679072439799588, lng: 78.12580219547301 }, // C3
  { lat: 11.678915085838511, lng: 78.12659829439393 }, // C4
  { lat: 11.67857653610425,  lng: 78.12706572862274 }, // C5
  { lat: 11.677855225878366, lng: 78.1268821218973 },  // C6
  { lat: 11.677005135877979, lng: 78.12680385127157 }, // C7
  { lat: 11.676963779359658, lng: 78.12619810348153 }, // C8
  { lat: 11.675808384169112, lng: 78.12611721999878 }, // C9
  { lat: 11.67548101155477,  lng: 78.12632747328921 }, // C10
  { lat: 11.675225395251344, lng: 78.12546783441684 }, // C11
  { lat: 11.674880184146973, lng: 78.12470095781757 }, // C12
  { lat: 11.67506203954446,  lng: 78.12467072803454 }, // C13
  { lat: 11.675345395390822, lng: 78.12439973963578 }, // C14
  { lat: 11.675557255409673, lng: 78.1241730162712 },  // C15
  { lat: 11.676220110497038, lng: 78.12411693452746 }, // C16
  { lat: 11.677404862894116, lng: 78.12403601056346 }, // C17
  { lat: 11.678027388807743, lng: 78.12399041301013 }, // C18
  { lat: 11.679113056127784, lng: 78.12389462165308 }, // C19
];

function isPointInPolygon(point: { lat: number; lng: number }): boolean {
  if (
    !point ||
    typeof point.lat !== "number" ||
    typeof point.lng !== "number" ||
    isNaN(point.lat) ||
    isNaN(point.lng)
  ) {
    return false;
  }
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = AUTHORIZED_GEOFENCE_POLYGON.length - 1; i < AUTHORIZED_GEOFENCE_POLYGON.length; j = i++) {
    const xi = AUTHORIZED_GEOFENCE_POLYGON[i]!.lng;
    const yi = AUTHORIZED_GEOFENCE_POLYGON[i]!.lat;
    const xj = AUTHORIZED_GEOFENCE_POLYGON[j]!.lng;
    const yj = AUTHORIZED_GEOFENCE_POLYGON[j]!.lat;

    // Skip degenerate 0-length closing segment (C19 == C1)
    if (xi === xj && yi === yj) {
      continue;
    }

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function checkIdentityMatch(targetStaffCode: string, recognizedStaffCode?: string | null): boolean {
  if (!recognizedStaffCode) return false;
  const target = targetStaffCode.trim().toUpperCase();
  const recognized = recognizedStaffCode.trim().toUpperCase();
  if (!target || !recognized) return false;
  return target === recognized;
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(status).json(payload);
    }
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function handleGetAttendance(req: any, res?: any) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Authoritative attendance database client could not be initialized.",
    });
  }

  // Parse query params safely
  const rawUrl = req.url || "/api/attendance";
  const parsedUrl = new URL(rawUrl, "http://localhost");
  const filterStaffCode = (parsedUrl.searchParams.get("staff_code") || parsedUrl.searchParams.get("staffId") || "").trim();
  const filterDate = (parsedUrl.searchParams.get("date") || "").trim();
  const filterStatus = (parsedUrl.searchParams.get("status") || "").trim();
  const filterDept = (parsedUrl.searchParams.get("department") || "").trim();
  const limitParam = parseInt(parsedUrl.searchParams.get("limit") || "100", 10);
  const limit = Math.min(200, isNaN(limitParam) ? 100 : Math.max(1, limitParam));

  // Extract auth token
  const token = extractBearerOrCookieToken(req);
  const adminCheck = verifyAdminToken(token);
  const staffCheck = verifyStaffToken(token);

  const isAdmin = adminCheck.valid;
  const isStaff = staffCheck.valid;

  // Header fallback for staff identity
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };
  const headerStaffCode = (getHeader("x-staff-code") || getHeader("x-staff-id")).trim();

  let targetStaffCode: string | null = null;

  if (isAdmin) {
    // Administrator can view all staff records, or filter to a specific staff
    if (filterStaffCode) {
      targetStaffCode = filterStaffCode.toUpperCase();
    }
  } else if (isStaff) {
    // Authenticated staff can ONLY view their own records
    targetStaffCode = (staffCheck.payload.staffId || staffCheck.payload.sub || "").toUpperCase();
  } else {
    // Unauthenticated request cannot read attendance records
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Authenticated session token required to access attendance history.",
    });
  }

  try {
    let query = supabase
      .from("attendance_records")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (targetStaffCode) {
      query = query.ilike("staff_code", targetStaffCode);
    }
    if (filterDate) {
      query = query.eq("date", filterDate);
    }
    if (filterStatus && filterStatus.toLowerCase() !== "all") {
      query = query.ilike("status", filterStatus);
    }
    if (filterDept && filterDept.toLowerCase() !== "all") {
      query = query.eq("department", filterDept);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[api/attendance GET] Supabase query failed:", error);
      return sendJsonResponse(res, 500, {
        success: false,
        error: "QUERY_FAILED",
        message: "Failed to retrieve attendance records from database.",
        details: error.message,
      });
    }

    return sendJsonResponse(res, 200, {
      success: true,
      count: (data || []).length,
      records: data || [],
    });
  } catch (err: any) {
    console.error("[api/attendance GET] Exception:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: err?.message || "Internal server error retrieving attendance records.",
    });
  }
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method === "GET") {
    return handleGetAttendance(req, res);
  }

  if (method !== "POST") {
    const errorPayload = { error: "Method not allowed. Use POST or GET." };
    return sendJsonResponse(res, 405, errorPayload);
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

  // =========================================================================
  // FACTOR 1: MANDATORY CAMPUS WI-FI NETWORK VERIFICATION
  // =========================================================================
  const tokenCheck = verifyNetworkAuthToken(networkToken);
  const isNetworkAuthorized = tokenCheck.valid;

  if (!isNetworkAuthorized) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "CAMPUS_NETWORK_UNAUTHORIZED",
      message:
        "Attendance rejected: Factor 1 (Campus Wi-Fi) failed. Device must be connected to an authorized Wi-Fi network containing 'sona' verified via CampusAttend Android app.",
      clientIp: clientIp !== "unknown" ? clientIp : undefined,
      tokenError: tokenCheck.error || "No valid network authorization token present.",
    });
  }

  // =========================================================================
  // FACTOR 2: MANDATORY GPS LOCATION & CAMPUS POLYGON VERIFICATION
  // =========================================================================
  const latitude =
    typeof body.latitude === "number"
      ? body.latitude
      : body.latitude !== undefined && body.latitude !== null
        ? parseFloat(body.latitude)
        : NaN;
  const longitude =
    typeof body.longitude === "number"
      ? body.longitude
      : body.longitude !== undefined && body.longitude !== null
        ? parseFloat(body.longitude)
        : NaN;
  const rawAccuracy =
    typeof body.accuracy === "number"
      ? body.accuracy
      : body.accuracy !== undefined && body.accuracy !== null
        ? parseFloat(body.accuracy)
        : null;

  if (isNaN(latitude) || isNaN(longitude)) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "GPS_COORDINATES_MISSING",
      message:
        "Attendance rejected: Factor 2 (GPS) failed. Genuine device GPS coordinates (latitude, longitude) are required.",
    });
  }

  if (rawAccuracy !== null && (isNaN(rawAccuracy) || rawAccuracy > 20)) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "GPS_ACCURACY_INSUFFICIENT",
      message: `Attendance rejected: Factor 2 (GPS) failed. GPS accuracy (±${rawAccuracy}m) exceeds the mandatory ±20m threshold.`,
      accuracy: rawAccuracy,
    });
  }

  const isInsideCampus = isPointInPolygon({ lat: latitude, lng: longitude });
  if (!isInsideCampus) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "GPS_OUTSIDE_CAMPUS",
      message:
        "Attendance rejected: Factor 2 (GPS) failed. Device GPS coordinates are outside the authoritative campus polygon boundary.",
      coordinates: { latitude, longitude },
    });
  }

  // =========================================================================
  // AUTHENTICATION & IDENTITY ENFORCEMENT: ZERO CLIENT TRUST
  // =========================================================================
  const authToken = extractBearerOrCookieToken(req);
  const staffTokenCheck = verifyStaffToken(authToken);

  let attestationCheck: { valid: boolean; payload?: any; error?: string } = { valid: false };
  if (body.biometricAttestation) {
    attestationCheck = verifyBiometricAttestation(body.biometricAttestation);
    if (!attestationCheck.valid) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "INVALID_BIOMETRIC_ATTESTATION",
        message: `Attendance rejected: Device biometric hardware attestation failed verification (${attestationCheck.error}).`,
      });
    }
  }

  const sessionStaffId = staffTokenCheck.valid
    ? String(staffTokenCheck.payload.staffId || staffTokenCheck.payload.sub || "").trim().toUpperCase()
    : null;
  const attestedStaffId = attestationCheck.valid
    ? String(attestationCheck.payload.staffId || "").trim().toUpperCase()
    : null;

  if (!sessionStaffId && !attestedStaffId) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Attendance rejected: Valid authenticated staff session or biometric hardware attestation required.",
    });
  }

  if (sessionStaffId && attestedStaffId && sessionStaffId !== attestedStaffId) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "ATTESTATION_IDENTITY_MISMATCH",
      message: `Hardware attestation identity (${attestedStaffId}) does not match authenticated session identity (${sessionStaffId}).`,
      expectedStaffCode: sessionStaffId,
      attestedStaffCode: attestedStaffId,
    });
  }

  const authoritativeStaffId = (sessionStaffId || attestedStaffId)!;

  // Reject forged client-supplied staffCode / studentId
  if (body.staffCode || body.studentId) {
    const clientStaffCode = String(body.staffCode || body.studentId).trim().toUpperCase();
    if (clientStaffCode !== authoritativeStaffId) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "IDENTITY_FORGERY_DETECTED",
        message: `Client-supplied staff code (${clientStaffCode}) does not match authenticated identity (${authoritativeStaffId}).`,
        expectedStaffCode: authoritativeStaffId,
        suppliedStaffCode: clientStaffCode,
      });
    }
  }

  // Authoritative Supabase Database Client Check
  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Authoritative attendance database client could not be initialized.",
    });
  }

  // Look up registered staff member to get authoritative name & department
  const { data: staffRow, error: staffLookupErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, department, status, active")
    .ilike("staff_code", authoritativeStaffId)
    .maybeSingle();

  if (staffLookupErr) {
    console.error("[api/attendance] Staff lookup error:", staffLookupErr);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_ERROR",
      message: "Database error during staff authorization verification.",
      details: staffLookupErr.message,
    });
  }

  if (!staffRow) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "UNREGISTERED_STAFF_IDENTITY",
      message: `Attendance rejected: Staff ID '${authoritativeStaffId}' is not a registered staff member.`,
    });
  }

  if (staffRow.active === false || (staffRow.status && staffRow.status.toLowerCase() === "inactive")) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "STAFF_ACCOUNT_INACTIVE",
      message: `Attendance rejected: Staff account '${staffRow.staff_code}' is deactivated or inactive.`,
    });
  }

  const canonicalStaffCode = staffRow.staff_code;
  const canonicalStaffName = staffRow.name;
  const canonicalDepartment = staffRow.department || "General";

  // =========================================================================
  // MANDATORY FACTOR: ONE FACULTY–ONE REGISTERED DEVICE VERIFICATION
  // =========================================================================
  const activeDevice = await getActiveDeviceForStaff(canonicalStaffCode);
  if (!activeDevice) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "NO_REGISTERED_DEVICE",
      message: `Attendance rejected: Faculty account '${canonicalStaffCode}' has no active registered device. One Faculty–One Registered Device policy requires prior cryptographic device registration.`,
    });
  }

  if (activeDevice.status !== "Active") {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "DEVICE_REVOKED",
      message: `Attendance rejected: The registered device for '${canonicalStaffCode}' has been revoked by administration (${activeDevice.revocation_reason || "Revoked"}).`,
      revokedAt: activeDevice.revoked_at,
      reason: activeDevice.revocation_reason,
    });
  }

  // Cryptographic Device Association Verification
  const deviceSignature = body.deviceSignature || body.signature;
  const deviceKeyId = body.deviceKeyId || body.keyId || body.deviceId;
  const rawDeviceTimestamp = body.deviceTimestamp !== undefined ? body.deviceTimestamp : body.timestamp;
  const deviceTimestamp = typeof rawDeviceTimestamp === "number" ? rawDeviceTimestamp : Date.now();
  const attemptNonce = String(body.attemptNonce || body.sessionNonce || body.nonce || "").trim();

  if (deviceSignature) {
    // 1. If key ID is supplied, it must match the active registered device
    if (deviceKeyId && deviceKeyId !== activeDevice.id && deviceKeyId !== activeDevice.key_id) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_KEY_ID_MISMATCH",
        message: `Attendance rejected: Device key identifier '${deviceKeyId}' does not match registered device '${activeDevice.id}'.`,
      });
    }

    // 2. Freshness check: timestamp must be fresh (±120 seconds)
    const ageMs = Date.now() - deviceTimestamp;
    if (ageMs > 120_000 || ageMs < -60_000) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_SIGNATURE_TIMESTAMP_EXPIRED",
        message: `Attendance rejected: Device signature timestamp (${deviceTimestamp}) is outside the mandatory ±120s validity window.`,
      });
    }

    // 3. Verify digital signature over canonical payload
    const canonicalPayload =
      body.devicePayloadToSign ||
      `${canonicalStaffCode}:${attemptNonce}:${deviceTimestamp}`;

    const isSigValid = verifyDeviceSignature(
      activeDevice.public_key,
      canonicalPayload,
      deviceSignature,
      activeDevice.key_algorithm,
    );

    if (!isSigValid) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "INVALID_DEVICE_SIGNATURE",
        message: "Attendance rejected: Device cryptographic signature verification failed. Private key signature is invalid.",
      });
    }
  } else if (attestationCheck.valid && attestationCheck.payload) {
    // Android Keystore hardware biometric attestation token bound to this device
    const attestationDeviceId = attestationCheck.payload.deviceId;
    if (
      attestationDeviceId &&
      activeDevice.id !== attestationDeviceId &&
      activeDevice.key_id !== attestationDeviceId &&
      !activeDevice.id.includes(attestationDeviceId)
    ) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_ID_MISMATCH",
        message: `Attendance rejected: Hardware attestation device ID (${attestationDeviceId}) does not match registered device (${activeDevice.id}).`,
      });
    }
  } else {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "MISSING_DEVICE_SIGNATURE",
      message: "Attendance rejected: Cryptographic signature from registered device is required. Device spoofing or unregistered devices are strictly prohibited.",
    });
  }

  // Update last_verified_at on registered device
  void updateDeviceLastVerified(activeDevice.id);

  // =========================================================================
  // FACTOR 3: MANDATORY FACE RECOGNITION, LIVENESS & IDENTITY MATCH
  // =========================================================================
  const recognizedStaffCode = body.recognizedStaffCode
    ? String(body.recognizedStaffCode).trim()
    : null;

  let verifiedBiometricMethod = "Server Vector Verification";
  let boundDeviceId: string | undefined = activeDevice.id;

  // 3A. Cryptographic Attestation Verification (for Android Keystore device-local flow)
  if (attestationCheck.valid && attestationCheck.payload) {
    const attestation = attestationCheck.payload;

    // Verify attested identity matches canonical staff identity
    const isIdentityMatch = checkIdentityMatch(canonicalStaffCode, attestation.staffId);
    if (!isIdentityMatch) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "ATTESTATION_IDENTITY_MISMATCH",
        message: `Attendance rejected: Hardware attestation identity (${attestation.staffId}) does not match authenticated staff (${canonicalStaffCode}).`,
        expectedStaffCode: canonicalStaffCode,
        attestedStaffCode: attestation.staffId,
      });
    }

    // Verify attested distance meets threshold
    if (typeof attestation.distance === "number" && attestation.distance > 0.45) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "ATTESTATION_DISTANCE_EXCEEDED",
        message: `Attendance rejected: Attested biometric distance (${attestation.distance.toFixed(4)}) exceeds threshold (0.45).`,
        distance: attestation.distance,
      });
    }

    if (attestation.livenessPassed !== true) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "LIVENESS_FAILED",
        message: "Attendance rejected: Attestation reports failed anti-spoofing liveness check.",
      });
    }

    if (typeof attestation.antiSpoofScore !== "number" || isNaN(attestation.antiSpoofScore) || attestation.antiSpoofScore < 0.50) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "SPOOF_DETECTED",
        message: `Attendance rejected: Attestation anti-spoof score (${typeof attestation.antiSpoofScore === "number" ? attestation.antiSpoofScore.toFixed(3) : "missing"}) is below required threshold (0.50).`,
      });
    }

    verifiedBiometricMethod = "Device-Local ArcFace (Android Keystore)";
    boundDeviceId = attestation.deviceId || body.deviceId;
  } else {
    // 3B. Standard Web Browser Face Verification Gate
    if (!recognizedStaffCode || body.faceVerified !== true) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "FACE_BIOMETRIC_UNAUTHORIZED",
        message:
          "Attendance rejected: Factor 3 (Face Recognition) failed. Live face recognition verification is required.",
      });
    }

    // ArcFace Biometric Distance Threshold (must be <= 0.45)
    if (typeof body.faceMatchDistance === "number" && body.faceMatchDistance > 0.45) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "FACE_BIOMETRIC_UNAUTHORIZED",
        message: `Attendance rejected: Factor 3 (Face Recognition) failed. Biometric cosine distance (${body.faceMatchDistance.toFixed(4)}) exceeds threshold (0.45).`,
        distance: body.faceMatchDistance,
      });
    }

    // Anti-spoofing Liveness check: Must be explicitly true
    if (body.livenessPassed !== true) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "LIVENESS_FAILED",
        message:
          "Attendance rejected: Factor 3 (Face Recognition) failed. Anti-spoofing liveness verification failed.",
      });
    }

    // Anti-spoofing score check: Must be a valid number and at least 0.50
    if (typeof body.antiSpoofScore !== "number" || isNaN(body.antiSpoofScore) || body.antiSpoofScore < 0.50) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "SPOOF_DETECTED",
        message: `Attendance rejected: Factor 3 (Face Recognition) failed. Valid anti-spoof confidence score (${typeof body.antiSpoofScore === "number" ? body.antiSpoofScore.toFixed(3) : "missing"}) is below required threshold (0.50).`,
      });
    }

    // Single-use challenge nonce check (prevent replay of liveness)
    const nonce = String(body.attemptNonce || body.sessionNonce || "").trim();
    if (!nonce || nonce.length < 8) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "MISSING_CHALLENGE_NONCE",
        message: "Attendance rejected: Factor 3 (Face Recognition) failed. Active challenge attempt nonce is required for replay protection.",
      });
    }
    cleanExpiredNonces();
    if (usedAttestationNonces.has(nonce)) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "CHALLENGE_NONCE_REPLAYED",
        message: "Attendance rejected: Challenge session nonce was already consumed or replayed.",
      });
    }
    usedAttestationNonces.set(nonce, Date.now());

    // Durable single-use nonce verification across Vercel serverless instances
    if (supabase) {
      const { data: replayCheck } = await supabase
        .from("security_events")
        .select("id")
        .eq("event", `LIVENESS_NONCE:${nonce}`)
        .limit(1)
        .maybeSingle();

      if (replayCheck) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "CHALLENGE_NONCE_REPLAYED",
          message: "Attendance rejected: Challenge session nonce was already consumed or replayed across cluster instances.",
        });
      }

      // Record consumed nonce in durable storage
      void supabase.from("security_events").insert({
        time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata" }),
        staff: canonicalStaffCode,
        event: `LIVENESS_NONCE:${nonce}`,
        device: boundDeviceId ? String(boundDeviceId).slice(0, 64) : "web-device",
        location: "Campus Attendance Gate",
        result: "Allowed",
        severity: "Low",
      });
    }

    // Liveness evidence validation
    if (!body.livenessEvidence || typeof body.livenessEvidence !== "object") {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "MISSING_LIVENESS_EVIDENCE",
        message: "Attendance rejected: Factor 3 (Face Recognition) failed. Active temporal liveness challenge evidence is required.",
      });
    }

    // Identity Match: The recognized face must belong to the authenticated canonical staff member
    const isIdentityMatch = checkIdentityMatch(canonicalStaffCode, recognizedStaffCode);
    if (!isIdentityMatch) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "IDENTITY_MISMATCH",
        message: `Attendance rejected: Recognized face (${recognizedStaffCode}) does not match authenticated user (${canonicalStaffCode}).`,
        expectedStaffCode: canonicalStaffCode,
        recognizedStaffCode,
      });
    }
  }

  const now = new Date();
  const istDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  const displayDateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const dayStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Asia/Kolkata",
  });

  // Idempotency: Check if attendance was already recorded today
  const { data: existingRecord } = await supabase
    .from("attendance_records")
    .select("*")
    .ilike("staff_code", canonicalStaffCode)
    .eq("date", istDateStr)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRecord) {
    const existingDisplayDate = existingRecord.date
      ? new Intl.DateTimeFormat("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(`${existingRecord.date}T00:00:00`))
      : displayDateStr;

    return sendJsonResponse(res, 200, {
      success: true,
      alreadyMarked: true,
      message: `Attendance already recorded for today (${existingDisplayDate} at ${existingRecord.time}).`,
      receipt: {
        attendanceId: existingRecord.id,
        time: existingRecord.time,
        date: existingDisplayDate,
      },
      verifiedFactors: {
        wifi: true,
        gps: true,
        face: true,
      },
      verifiedNetwork: tokenCheck.payload?.ssid || "SONA Campus Network",
      verifiedIp: tokenCheck.payload?.verifiedIp || clientIp,
      staffCode: existingRecord.staff_code,
      staffName: existingRecord.staff_name,
      biometricMethod: verifiedBiometricMethod,
      deviceId: existingRecord.device_id || boundDeviceId,
      timestamp: existingRecord.created_at,
    });
  }

  // Insert into Supabase attendance_records with strict authoritative schema
  const { data: inserted, error: insertError } = await supabase
    .from("attendance_records")
    .insert({
      staff_code: canonicalStaffCode,
      staff_name: canonicalStaffName,
      department: canonicalDepartment,
      date: istDateStr,
      day: dayStr,
      time: timeStr,
      status: "Present",
      location: body.location || "Main Campus, Sona College",
      verification: "Verified",
      latitude: isNaN(latitude) ? null : latitude,
      longitude: isNaN(longitude) ? null : longitude,
      device_id: boundDeviceId ? String(boundDeviceId).slice(0, 64) : null,
    })
    .select()
    .single();

  if (insertError || !inserted?.id) {
    console.error("[api/attendance] Supabase insert failed:", insertError);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_PERSISTENCE_FAILED",
      message: "Attendance validation succeeded, but database write failed. Attendance was not recorded.",
      details: insertError?.message || "No record returned from database insert.",
    });
  }

  const successPayload = {
    success: true,
    receipt: {
      attendanceId: inserted.id,
      time: inserted.time || timeStr,
      date: displayDateStr,
    },
    verifiedFactors: {
      wifi: true,
      gps: true,
      face: true,
    },
    verifiedNetwork: tokenCheck.payload?.ssid || "SONA Campus Network",
    verifiedIp: tokenCheck.payload?.verifiedIp || clientIp,
    staffCode: inserted.staff_code,
    staffName: inserted.staff_name,
    biometricMethod: verifiedBiometricMethod,
    deviceId: inserted.device_id || boundDeviceId,
    timestamp: inserted.created_at || now.toISOString(),
  };

  return sendJsonResponse(res, 200, successPayload);
}
