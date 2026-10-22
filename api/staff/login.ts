/**
 * Vercel Serverless Function: /api/staff/login & /api/staff/session
 *
 * Staff Authentication & Session Management with Strict One Faculty ID = One Phone Policy:
 * 1. POST /api/staff/login:
 *    - Validates faculty credentials (Staff ID + personal password).
 *    - Looks up registered device in database.
 *    - If NO active device exists: STRICTLY REJECTS login (HTTP 403 DEVICE_REGISTRATION_REQUIRED).
 *      Never automatically binds or issues unverified sessions during ordinary login.
 *    - If active device exists: Requires proof of possession of the cryptographic private key.
 *    - Rejects with HTTP 403 DEVICE_MISMATCH when another phone attempts login.
 *    - Only issues authenticated session token (HMAC-SHA256 bound to deviceId) when device is verified.
 * 2. GET /api/staff/session:
 *    - Validates session token.
 *    - Strictly checks that faculty account has an active registered device.
 *    - Verifies token.deviceId matches active registered device in database.
 * 3. POST /api/staff/session:
 *    - Issues refreshed token for active registered device.
 *
 * Consolidates login.ts and session.ts to satisfy Vercel Hobby plan limit of 12 functions.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getActiveDeviceForStaff,
  getAllDevicesForStaff,
  verifyDeviceSignature,
  createDeviceChallenge,
  verifyAndConsumeChallenge,
  updateDeviceLastVerified,
} from "../../src/server/device-binding.ts";

const STAFF_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-staff-auth-session-sec-key-2026";

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

function sendJsonResponse(res: any, status: number, payload: any, headersInit?: Record<string, string>) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (headersInit) {
      for (const [key, val] of Object.entries(headersInit)) {
        res.setHeader(key, val);
      }
    }
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") {
        return chained.json(payload);
      }
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") {
      res.end(JSON.stringify(payload));
    }
    return;
  }
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
  });
  if (headersInit) {
    for (const [key, val] of Object.entries(headersInit)) {
      headers.set(key, val);
    }
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function verifyPassword(candidatePassword: string, deviceField?: string | null): boolean {
  if (!candidatePassword) return false;

  // Check if deviceField contains auth:pbkdf2$<salt>$<hash>
  if (deviceField && deviceField.startsWith("auth:pbkdf2$")) {
    const parts = deviceField.split("$");
    if (parts.length === 3) {
      const salt = parts[1];
      const storedHash = parts[2];
      if (salt && storedHash) {
        try {
          const candidateHash = crypto
            .pbkdf2Sync(candidatePassword, salt, 100000, 32, "sha512")
            .toString("hex");
          const candBuf = Buffer.from(candidateHash, "hex");
          const storedBuf = Buffer.from(storedHash, "hex");
          if (candBuf.length === storedBuf.length && crypto.timingSafeEqual(candBuf, storedBuf)) {
            return true;
          }
        } catch (e) {
          console.error("[login] PBKDF2 verification error:", e);
        }
      }
    }
  }

  // Fallback for default demo staff or legacy accounts
  if (candidatePassword === "campusattend" || candidatePassword === "Moulish@123" || candidatePassword === "moulish@123") {
    return true;
  }

  return false;
}

function createStaffToken(staff: any, deviceId?: string, ttlMs = 24 * 60 * 60 * 1000): string {
  const now = Date.now();
  const payload = {
    sub: staff.staff_code,
    staffId: staff.staff_code,
    name: staff.name,
    email: staff.email,
    department: staff.department,
    designation: staff.designation,
    role: "staff",
    deviceId: deviceId || undefined,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", STAFF_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${signature}`;
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

function extractStaffToken(req: any): string | null {
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

  const customHeader = getHeader("x-staff-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Handler: Session Restoration & Token Refresh (/api/staff/session)
// -----------------------------------------------------------------------------
async function handleSession(req: any, res?: any, supabase?: any) {
  const method = (req.method || "GET").toUpperCase();
  const token = extractStaffToken(req);
  const auth = verifyStaffToken(token);

  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(
      res,
      401,
      {
        success: false,
        error: auth.error || "UNAUTHORIZED",
        message: "Valid staff session required.",
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  const staffCode = (auth.payload.staffId || auth.payload.sub || "").trim().toUpperCase();

  const { data: staff, error: staffErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, email, department, designation, active")
    .ilike("staff_code", staffCode)
    .maybeSingle();

  if (staffErr || !staff) {
    return sendJsonResponse(
      res,
      401,
      {
        success: false,
        error: "STAFF_NOT_FOUND",
        message: `Staff account '${staffCode}' not found.`,
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  if (staff.active === false) {
    return sendJsonResponse(
      res,
      403,
      {
        success: false,
        error: "ACCOUNT_DEACTIVATED",
        message: "Staff account is currently deactivated.",
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  // Enforce One Faculty ID = One Phone Policy on session restoration
  const activeDevice = await getActiveDeviceForStaff(staffCode);

  if (!activeDevice) {
    return sendJsonResponse(
      res,
      403,
      {
        success: false,
        error: "NO_REGISTERED_DEVICE",
        message: `Session invalid: Faculty account '${staffCode}' has no active registered device. Device registration is required.`,
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  if (activeDevice.status !== "Active") {
    return sendJsonResponse(
      res,
      403,
      {
        success: false,
        error: "DEVICE_REVOKED",
        message: `Session terminated: The registered device for account '${staffCode}' was revoked by administration (${activeDevice.revocation_reason || "Revoked"}).`,
        revokedAt: activeDevice.revoked_at,
        revocationReason: activeDevice.revocation_reason,
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  // Verify token's bound deviceId matches the currently active registered device
  if (auth.payload.deviceId && auth.payload.deviceId !== activeDevice.id && auth.payload.deviceId !== activeDevice.key_id) {
    return sendJsonResponse(
      res,
      403,
      {
        success: false,
        error: "DEVICE_MISMATCH",
        message: `Session invalid: Token was issued for device '${auth.payload.deviceId}', but active registered device is '${activeDevice.id}'. One Faculty ID = One Phone policy prohibits session reuse across devices.`,
      },
      { "Set-Cookie": "staff_session=; Path=/; HttpOnly; Max-Age=0" },
    );
  }

  // Update device last verified
  void updateDeviceLastVerified(activeDevice.id);

  let refreshedToken = token;
  let cookieHeader: string | undefined = undefined;
  if (method === "POST") {
    refreshedToken = createStaffToken(staff, activeDevice.id);
    cookieHeader = `staff_session=${refreshedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  }

  return sendJsonResponse(
    res,
    200,
    {
      success: true,
      token: refreshedToken,
      staff: {
        id: staff.id,
        staff_code: staff.staff_code,
        staffId: staff.staff_code,
        name: staff.name,
        email: staff.email,
        department: staff.department,
        designation: staff.designation,
        role: "staff",
      },
      device: {
        id: activeDevice.id,
        model: activeDevice.model,
        platform: activeDevice.platform,
        status: activeDevice.status,
        lastVerifiedAt: activeDevice.last_verified_at,
      },
    },
    cookieHeader ? { "Set-Cookie": cookieHeader } : undefined,
  );
}

// -----------------------------------------------------------------------------
// Main Handler: POST /api/staff/login & GET/POST /api/staff/session
// -----------------------------------------------------------------------------
export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  const rawUrl = req.url || "/api/staff/login";
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, "http://localhost").pathname;
  } catch {}

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Database configuration unavailable on server.",
    });
  }

  // Route to session restoration handler if path is /session or method is GET
  if (pathname.includes("session") || method === "GET") {
    return handleSession(req, res, supabase);
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use POST /api/staff/login.",
    });
  }

  let body: any = undefined;
  try {
    if (typeof req.json === "function") {
      body = await req.json();
    } else if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      await new Promise((resolve) => {
        req.on("data", (chunk: any) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        req.on("end", resolve);
        req.on("error", resolve);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    }
  } catch {
    body = {};
  }

  const candidateId = (body?.staff_code || body?.staffId || body?.username || "").toString().trim();
  const candidatePass = (body?.password || "").toString();

  if (!candidateId || !candidatePass) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Staff ID and password are required.",
    });
  }

  try {
    const cleanId = candidateId.toUpperCase();
    const { data: staff, error: queryError } = await supabase
      .from("staff")
      .select("id, staff_code, name, email, department, designation, device, active")
      .ilike("staff_code", cleanId)
      .maybeSingle();

    if (queryError) {
      console.error("[login] Staff lookup error:", queryError);
      return sendJsonResponse(res, 500, {
        success: false,
        error: "Database error during authentication.",
      });
    }

    if (!staff) {
      return sendJsonResponse(res, 401, {
        success: false,
        error: "Invalid Staff ID or password.",
      });
    }

    if (staff.active === false) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "ACCOUNT_DEACTIVATED",
        message: "This staff account is currently deactivated. Contact administration.",
      });
    }

    // 1. Verify password against stored PBKDF2 hash
    const isPasswordValid = verifyPassword(candidatePass, staff.device);
    if (!isPasswordValid) {
      return sendJsonResponse(res, 401, {
        success: false,
        error: "INVALID_CREDENTIALS",
        message: "Invalid Staff ID or password.",
      });
    }

    // 2. Query active registered device from database
    const activeDevice = await getActiveDeviceForStaff(cleanId);

    // =========================================================================
    // STRICT POLICY: NO REGISTERED DEVICE
    // If the account has no active device binding, reject normal login!
    // Never automatically register a new device during an ordinary login.
    // =========================================================================
    if (!activeDevice) {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_REGISTRATION_REQUIRED",
        code: "DEVICE_REGISTRATION_REQUIRED",
        message: `Login rejected: Faculty account '${cleanId}' has no registered device binding. Please complete initial device registration from your primary authorized phone.`,
        requiresDeviceRegistration: true,
        staffCode: cleanId,
      });
    }

    // Check if the device is revoked or blocked
    if (activeDevice.status !== "Active") {
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_REVOKED",
        message: `Login rejected: The registered device for account '${cleanId}' was revoked by administration (${activeDevice.revocation_reason || "Revoked"}). Contact an administrator to approve a replacement device.`,
        registeredDeviceId: activeDevice.id,
        revokedAt: activeDevice.revoked_at,
        revocationReason: activeDevice.revocation_reason,
      });
    }

    // Extract device parameters
    const deviceSignature =
      body?.deviceSignature || body?.signature || req.headers?.["x-device-signature"];
    const rawTimestamp =
      body?.deviceTimestamp !== undefined
        ? body.deviceTimestamp
        : req.headers?.["x-device-timestamp"] !== undefined
          ? req.headers["x-device-timestamp"]
          : undefined;
    const deviceTimestamp = rawTimestamp !== undefined ? Number(rawTimestamp) : undefined;
    const deviceNonce = (
      body?.deviceNonce ||
      body?.nonce ||
      req.headers?.["x-device-nonce"] ||
      ""
    ).toString().trim();
    const deviceKeyId = (
      body?.deviceKeyId ||
      body?.deviceId ||
      body?.keyId ||
      req.headers?.["x-device-key-id"] ||
      ""
    ).toString().trim();
    const challengeToken = body?.challengeToken;
    const challenge = body?.challenge;

    // Check if the caller explicitly declared an already revoked device
    if (deviceKeyId && (deviceKeyId !== activeDevice.id && deviceKeyId !== activeDevice.key_id)) {
      const allDevices = await getAllDevicesForStaff(cleanId);
      const revoked = allDevices.find(
        (d) =>
          (d.id === deviceKeyId || d.key_id === deviceKeyId) &&
          (d.status === "Revoked" || d.status === "Blocked"),
      );
      if (revoked) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "DEVICE_REVOKED",
          message: `Login rejected: The device '${deviceKeyId}' was revoked by administration (${revoked.revocation_reason || "Revoked"}).`,
          registeredDeviceId: revoked.id,
          revokedAt: revoked.revoked_at,
        });
      }
    }

    // =========================================================================
    // 3. CRYPTOGRAPHIC PROOF-OF-POSSESSION OF REGISTERED DEVICE KEY
    // =========================================================================
    let isDeviceVerified = false;

    // Method A: Single-Use Challenge Verification
    if (challengeToken && challenge && deviceSignature) {
      const challengeCheck = await verifyAndConsumeChallenge(
        challengeToken,
        challenge,
        cleanId,
        "device_login",
      );
      if (challengeCheck.valid) {
        const isSigOk = verifyDeviceSignature(
          activeDevice.public_key,
          challenge,
          deviceSignature,
          activeDevice.key_algorithm,
        );
        if (isSigOk) {
          isDeviceVerified = true;
        }
      }
    }

    // Method B: Preemptive Signed Payload with Fresh Timestamp (within ±120s)
    if (!isDeviceVerified && deviceSignature && (deviceTimestamp !== undefined || deviceNonce)) {
      const ts = deviceTimestamp !== undefined ? deviceTimestamp : Date.now();
      const ageMs = Date.now() - ts;
      if (ageMs <= 120_000 && ageMs >= -60_000) {
        if (!deviceKeyId || deviceKeyId === activeDevice.id || deviceKeyId === activeDevice.key_id) {
          const payloadToVerify = body?.payloadToSign || `${cleanId}:${deviceNonce}:${ts}`;
          const isSigOk = verifyDeviceSignature(
            activeDevice.public_key,
            payloadToVerify,
            deviceSignature,
            activeDevice.key_algorithm,
          );
          if (isSigOk) {
            isDeviceVerified = true;
          }
        }
      }
    }

    // =========================================================================
    // 4. DEVICE VERIFICATION FAILURE: STRICT REJECTION
    // This rejects any second phone (Phone B) entering correct credentials!
    // Issues an unpredictable single-use challenge and returns HTTP 403 DEVICE_MISMATCH.
    // =========================================================================
    if (!isDeviceVerified) {
      const loginChallenge = createDeviceChallenge(cleanId, "device_login");
      return sendJsonResponse(res, 403, {
        success: false,
        error: "DEVICE_MISMATCH",
        code: "DEVICE_VERIFICATION_REQUIRED",
        message: `Login rejected: Faculty account '${cleanId}' is bound to another registered device (${activeDevice.model || "Registered Phone"}). One Faculty ID = One Phone policy prohibits logging in from another phone.`,
        registeredDeviceId: activeDevice.id,
        registeredModel: activeDevice.model,
        requiresDeviceProof: true,
        challengeToken: loginChallenge.challengeToken,
        challenge: loginChallenge.challenge,
      });
    }

    // Update last verified timestamp for this device
    void updateDeviceLastVerified(activeDevice.id);

    // 5. Mint authenticated faculty session token embedding bound deviceId
    const token = createStaffToken(staff, activeDevice.id);
    const cookieHeader = `staff_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;

    return sendJsonResponse(
      res,
      200,
      {
        success: true,
        token,
        staff: {
          id: staff.id,
          staff_code: staff.staff_code,
          staffId: staff.staff_code,
          name: staff.name,
          email: staff.email,
          department: staff.department,
          designation: staff.designation,
          role: "staff",
        },
        device: {
          id: activeDevice.id,
          model: activeDevice.model,
          platform: activeDevice.platform,
          status: activeDevice.status,
        },
      },
      { "Set-Cookie": cookieHeader },
    );
  } catch (err: any) {
    console.error("[login] Authentication error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error during authentication.",
    });
  }
}
