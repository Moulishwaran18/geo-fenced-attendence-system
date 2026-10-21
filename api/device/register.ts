/**
 * Vercel Serverless Function: POST /api/device/register
 *
 * Implements Step 2, 3, 4, 6 of One Faculty–One Registered Device Policy:
 * 1. Authenticates faculty session.
 * 2. Validates and atomically consumes the single-use challenge token.
 * 3. Verifies that the cryptographic challenge was signed by the device private key.
 * 4. Verifies platform attestation evidence (Android Keystore / StrongBox / TEE / iOS App Attest / Web).
 * 5. Strictly enforces AT MOST ONE active device per faculty member.
 * 6. Binds faculty account to device and activates registration.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  verifyAndConsumeChallenge,
  verifyDeviceSignature,
  verifyPlatformAttestation,
  registerDeviceForStaff,
  getActiveDeviceForStaff,
  normalizePublicKeyToPem,
  type DevicePlatform,
} from "../../src/server/device-binding.ts";

const STAFF_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-staff-auth-session-sec-key-2026";

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
  const customHeader = getHeader("x-staff-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") return chained.json(payload);
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") res.end(JSON.stringify(payload));
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function getSupabase() {
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

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use POST /api/device/register.",
    });
  }

  // 1. Authenticate faculty session
  const token = extractBearerOrCookieToken(req);
  const auth = verifyStaffToken(token);

  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Authenticated faculty session required for device registration.",
    });
  }

  const staffCode = (auth.payload.staffId || auth.payload.sub || "").trim().toUpperCase();

  // Parse request body
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

  const {
    challengeToken,
    challenge,
    publicKey,
    signature,
    keyAlgorithm = "ECDSA_P256",
    platform = "android",
    model = "Mobile Device",
    os = "Android",
    attestationEvidence,
    isStrongBox,
    isHardwareBacked,
  } = body;

  // 2. Validate required registration parameters
  if (!challengeToken || !challenge || !publicKey || !signature) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "MISSING_REGISTRATION_FIELDS",
      message: "challengeToken, challenge, publicKey, and signature are required.",
    });
  }

  // 3. Concurrency check: Ensure faculty does not already have an active device
  const existingActive = await getActiveDeviceForStaff(staffCode);
  if (existingActive) {
    return sendJsonResponse(res, 409, {
      success: false,
      error: "DEVICE_ALREADY_REGISTERED",
      message: `Faculty account '${staffCode}' already has an active registered device. Only one device per faculty member is permitted.`,
      activeDevice: {
        id: existingActive.id,
        model: existingActive.model,
        platform: existingActive.platform,
        registeredAt: existingActive.registered_at,
      },
    });
  }

  // 4. Validate Challenge Token & Atomic Single-Use Replay Protection
  const challengeCheck = await verifyAndConsumeChallenge(
    challengeToken,
    challenge,
    staffCode,
    "device_registration",
  );

  if (!challengeCheck.valid) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: challengeCheck.error || "INVALID_CHALLENGE",
      message: `Challenge verification failed: ${challengeCheck.error}. Challenges are single-use and valid for 5 minutes.`,
    });
  }

  // 5. Cryptographic Signature Verification
  // The device private key MUST have signed the exact server-issued challenge nonce
  let normalizedKeyPem: string;
  try {
    normalizedKeyPem = normalizePublicKeyToPem(publicKey);
  } catch (keyErr: any) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "INVALID_PUBLIC_KEY_FORMAT",
      message: keyErr?.message || "Public key format could not be decoded.",
    });
  }

  const isSigValid = verifyDeviceSignature(normalizedKeyPem, challenge, signature, keyAlgorithm);
  if (!isSigValid) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "INVALID_DEVICE_SIGNATURE",
      message: "Device registration signature verification failed. Private key proof of possession invalid.",
    });
  }

  // 6. Platform Attestation & Application Integrity Evaluation
  const cleanPlatform: DevicePlatform = ["android", "ios", "web"].includes(String(platform).toLowerCase())
    ? (String(platform).toLowerCase() as DevicePlatform)
    : "android";

  const attestationResult = verifyPlatformAttestation(
    cleanPlatform,
    {
      attestationChain: attestationEvidence?.chain || attestationEvidence,
      playIntegrityToken: attestationEvidence?.playIntegrityToken,
      appAttestStatement: attestationEvidence?.appAttestStatement,
      webAuthnAttestation: attestationEvidence?.webAuthn,
      isStrongBox: Boolean(isStrongBox),
      isHardwareBacked: isHardwareBacked !== false,
    },
    challenge,
    normalizedKeyPem,
  );

  if (!attestationResult.valid) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: attestationResult.error || "ATTESTATION_VERIFICATION_FAILED",
      message: `Platform attestation rejected: ${attestationResult.error}. ${attestationResult.details || ""}`,
    });
  }

  // 7. Lookup faculty database record to bind UUID
  const supabase = getSupabase();
  let facultyStaffId = auth.payload.id || "";
  let facultyStaffName = auth.payload.name || "Faculty Member";

  if (supabase) {
    const { data: staffRow } = await supabase
      .from("staff")
      .select("id, staff_code, name, active")
      .ilike("staff_code", staffCode)
      .maybeSingle();

    if (staffRow) {
      facultyStaffId = staffRow.id;
      facultyStaffName = staffRow.name;
      if (staffRow.active === false) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "FACULTY_ACCOUNT_INACTIVE",
          message: "Cannot register device: Faculty account is deactivated.",
        });
      }
    }
  }

  // 8. Bind Authenticated Faculty Account to Device
  const registrationResult = await registerDeviceForStaff({
    staffId: facultyStaffId,
    staffCode,
    staffName: facultyStaffName,
    publicKey: normalizedKeyPem,
    keyAlgorithm,
    platform: cleanPlatform,
    attestationStatus: attestationResult.securityLevel,
    attestationType: attestationResult.attestationType,
    attestationEvidence: typeof attestationEvidence === "object" ? JSON.stringify(attestationEvidence) : attestationEvidence,
    model: String(model || "Mobile Device").slice(0, 255),
    os: String(os || cleanPlatform).slice(0, 64),
    auditMetadata: {
      attestationDetails: attestationResult.details,
      isHardwareBacked: attestationResult.isHardwareBacked,
      registeredVia: cleanPlatform,
      registeredAt: new Date().toISOString(),
    },
  });

  if (!registrationResult.success) {
    return sendJsonResponse(res, registrationResult.statusCode || 500, {
      success: false,
      error: registrationResult.error || "REGISTRATION_FAILED",
      message: registrationResult.error,
    });
  }

  return sendJsonResponse(res, 201, {
    success: true,
    message: "Device successfully bound and registered! This device is now authorized to mark attendance.",
    device: {
      id: registrationResult.device!.id,
      staffCode: registrationResult.device!.staff_code,
      model: registrationResult.device!.model,
      platform: registrationResult.device!.platform,
      attestationStatus: registrationResult.device!.attestation_status,
      registeredAt: registrationResult.device!.registered_at,
      status: registrationResult.device!.status,
    },
  });
}
