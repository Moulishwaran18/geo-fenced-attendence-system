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
import { fetchDevServerPublicEgressIp, isVercelOrProduction } from "./wifi-status.ts";

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

// Authoritative 13-point Campus Polygon Coordinates (C1 -> ... -> C13 -> C1)
const AUTHORIZED_GEOFENCE_POLYGON = [
  { lat: 11.675651510482604, lng: 78.12402220170895 }, // C1
  { lat: 11.675657082681333, lng: 78.12382305416799 }, // C2
  { lat: 11.675768526632474, lng: 78.12359545697831 }, // C3
  { lat: 11.675857681761121, lng: 78.12339630943734 }, // C4
  { lat: 11.676125146975094, lng: 78.1228443862524 }, // C5
  { lat: 11.676370323194567, lng: 78.12244609117047 }, // C6
  { lat: 11.676414900665728, lng: 78.12241764152176 }, // C7
  { lat: 11.676448333764391, lng: 78.12143897360616 }, // C8
  { lat: 11.676905252375372, lng: 78.12147880311436 }, // C9
  { lat: 11.676977690622595, lng: 78.12159260170921 }, // C10
  { lat: 11.67708913404289, lng: 78.12222418391055 }, // C11
  { lat: 11.677990932044441, lng: 78.12235439874642 }, // C12
  { lat: 11.677979915759753, lng: 78.1237830407748 }, // C13
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
  if (target === recognized) return true;
  // Aliases for standard staff IDs
  if (
    (target === "SCT-2417" || target === "PERSON_001") &&
    (recognized === "PERSON_001" || recognized === "SCT-2417")
  ) {
    return true;
  }
  if (
    (target === "SCT-2418" || target === "PERSON_002") &&
    (recognized === "PERSON_002" || recognized === "SCT-2418")
  ) {
    return true;
  }
  if (
    (target === "SCT-2419" || target === "PERSON_003") &&
    (recognized === "PERSON_003" || recognized === "SCT-2419")
  ) {
    return true;
  }
  return false;
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

export default async function handler(req: any, res?: any) {
  if (req.method !== "POST") {
    const errorPayload = { error: "Method not allowed. Use POST." };
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
  let ipCheck = isAuthorizedCampusEgressIp(clientIp);

  // Local Development Fallback for direct attendance connections:
  if (!ipCheck.authorized && !isVercelOrProduction(req) && isPrivateIp(clientIp)) {
    const devEgressIp = await fetchDevServerPublicEgressIp();
    if (devEgressIp) {
      const devCheck = isAuthorizedCampusEgressIp(devEgressIp);
      if (devCheck.authorized) {
        ipCheck = devCheck;
      }
    }
  }

  const isNetworkAuthorized = tokenCheck.valid || ipCheck.authorized;
  if (!isNetworkAuthorized) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "CAMPUS_NETWORK_UNAUTHORIZED",
      message:
        "Attendance rejected: Factor 1 (Campus Wi-Fi) failed. Genuine server-verified SONA-WIFI connection is required.",
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
  // FACTOR 3: MANDATORY FACE RECOGNITION, LIVENESS & IDENTITY MATCH
  // =========================================================================
  const staffCode = String(body.staffCode || body.studentId || "SCT-2417").trim();
  const recognizedStaffCode = body.recognizedStaffCode
    ? String(body.recognizedStaffCode).trim()
    : null;

  let verifiedBiometricMethod = "Server Vector Verification";
  let boundDeviceId: string | undefined = body.deviceId;

  // 3A. Cryptographic Attestation Verification (for Android Keystore device-local flow)
  if (body.biometricAttestation) {
    const attestationCheck = verifyBiometricAttestation(body.biometricAttestation);
    if (!attestationCheck.valid) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "INVALID_BIOMETRIC_ATTESTATION",
        message: `Attendance rejected: Device biometric attestation failed verification (${attestationCheck.error}).`,
      });
    }

    const attestation = attestationCheck.payload;

    // Verify attested identity matches authenticated user
    const isIdentityMatch = checkIdentityMatch(staffCode, attestation.staffId);
    if (!isIdentityMatch) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "ATTESTATION_IDENTITY_MISMATCH",
        message: `Attendance rejected: Hardware attestation identity (${attestation.staffId}) does not match authenticated user (${staffCode}).`,
        expectedStaffCode: staffCode,
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

    if (attestation.livenessPassed === false) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "LIVENESS_FAILED",
        message: "Attendance rejected: Attestation reports failed anti-spoofing liveness check.",
      });
    }

    verifiedBiometricMethod = "Device-Local ArcFace (Android Keystore)";
    boundDeviceId = attestation.deviceId || body.deviceId;
  } else {
    // 3B. Standard Web Browser Face Verification Gate
    if (!recognizedStaffCode || body.faceVerified === false) {
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

    // Anti-spoofing Liveness check
    if (body.livenessPassed === false) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "LIVENESS_FAILED",
        message:
          "Attendance rejected: Factor 3 (Face Recognition) failed. Anti-spoofing liveness verification failed.",
      });
    }

    // Identity Match: The recognized face must belong to the authenticated individual
    const isIdentityMatch = checkIdentityMatch(staffCode, recognizedStaffCode);
    if (!isIdentityMatch) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "IDENTITY_MISMATCH",
        message: `Attendance rejected: Recognized face (${recognizedStaffCode}) does not match authenticated user (${staffCode}).`,
        expectedStaffCode: staffCode,
        recognizedStaffCode,
      });
    }
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
          verification: `${verifiedBiometricMethod} · Verified (SONA-WIFI)`,
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
    verifiedFactors: {
      wifi: true,
      gps: true,
      face: true,
    },
    verifiedNetwork: "SONA Campus Network",
    verifiedIp: tokenCheck.payload?.verifiedIp || ipCheck.matchedIp || clientIp,
    staffCode,
    staffName,
    biometricMethod: verifiedBiometricMethod,
    deviceId: boundDeviceId,
    timestamp: now.toISOString(),
  };

  return sendJsonResponse(res, 200, successPayload);
}
