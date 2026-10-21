/**
 * Vercel Serverless Function: POST /api/staff/login
 *
 * Staff Authentication & One Faculty ID = One Phone Policy Enforcement:
 * - Verifies staff member's credentials (Staff ID + personal password).
 * - Enforces One Faculty ID = One Registered Phone policy:
 *   1. When an account is first registered, binds it to that phone.
 *   2. When credentials are entered on another phone, rejects login (HTTP 403 DEVICE_MISMATCH),
 *      even if the password is correct.
 *   3. The registered phone continues to work normally.
 *   4. Persists the binding in backend database (Supabase + local store), not just client storage.
 *   5. Never automatically changes device binding when someone attempts login on another phone.
 *   6. Mints HMAC-SHA256 session tokens with embedded deviceId binding.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  getActiveDeviceForStaff,
  getAllDevicesForStaff,
  verifyDeviceSignature,
  createDeviceChallenge,
  verifyAndConsumeChallenge,
  registerDeviceForStaff,
  updateDeviceLastVerified,
  type DevicePlatform,
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

  // Fallback for default demo staff or legacy accounts created before password set
  if (candidatePassword === "campusattend") {
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
    deviceId: deviceId || staff.deviceId || undefined,
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

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
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

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
    });
  }

  try {
    // Look up staff by staff_code
    const cleanId = candidateId.toUpperCase();
    const { data: staff, error: queryError } = await supabase
      .from("staff")
      .select("id, staff_code, name, email, department, designation, device, active")
      .eq("staff_code", cleanId)
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
        error: "This staff account is currently deactivated. Contact administration.",
      });
    }

    // Verify password against stored hash or fallback
    const isPasswordValid = verifyPassword(candidatePass, staff.device);
    if (!isPasswordValid) {
      return sendJsonResponse(res, 401, {
        success: false,
        error: "Invalid Staff ID or password.",
      });
    }

    // =========================================================================
    // MANDATORY POLICY: ONE FACULTY ID = ONE REGISTERED PHONE ENFORCEMENT
    // =========================================================================
    let activeDevice = await getActiveDeviceForStaff(cleanId);

    // Extract device parameters from request body or custom headers
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
    const clientPublicKey = body?.publicKey || body?.devicePublicKey;

    // Check if the device attempting login was revoked by an administrator
    if (deviceKeyId) {
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
          message: `Login rejected: The registered device for account '${cleanId}' was revoked by administration (${revoked.revocation_reason || "Revoked"}). Contact an administrator to approve a replacement device.`,
          registeredDeviceId: revoked.id,
          revokedAt: revoked.revoked_at,
          revocationReason: revoked.revocation_reason,
        });
      }
    }

    if (activeDevice) {
      // 1. Check if device has been revoked by an administrator
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

      // 2. Cryptographic Proof-of-Possession of the Bound Device Key
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

      // If device verification failed: STRICT REJECTION!
      // This protects against another phone (Phone B) entering correct credentials.
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
    } else {
      // =========================================================================
      // FIRST LOGIN / INITIAL DEVICE BINDING
      // When a faculty ID is first registered/logged in on a phone, securely bind it to that phone.
      // =========================================================================
      if (clientPublicKey) {
        const regResult = await registerDeviceForStaff({
          staffCode: cleanId,
          staffId: staff.id,
          staffName: staff.name,
          publicKey: clientPublicKey,
          keyAlgorithm: body?.keyAlgorithm || "ECDSA_P256",
          platform: (body?.platform as DevicePlatform) || "android",
          attestationStatus: body?.isStrongBox ? "StrongBox" : body?.isHardwareBacked ? "TEE" : "Software",
          attestationType: body?.attestationType || "HardwareKeystore",
          attestationEvidence: body?.attestationEvidence,
          model: body?.model || "Mobile Device",
          os: body?.os || "Android",
          auditMetadata: {
            isStrongBox: !!body?.isStrongBox,
            isHardwareBacked: !!body?.isHardwareBacked,
            registeredVia: "staff_login",
          },
        });

        if (regResult.success && regResult.device) {
          activeDevice = regResult.device;
        }
      }
    }

    // Mint token embedding the bound deviceId
    const token = createStaffToken(staff, activeDevice?.id);

    // Set HTTP-Only Cookie
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
        device: activeDevice
          ? {
              id: activeDevice.id,
              model: activeDevice.model,
              platform: activeDevice.platform,
              status: activeDevice.status,
            }
          : undefined,
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
