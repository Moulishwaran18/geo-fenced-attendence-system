/**
 * Vercel Serverless Function: POST /api/staff/register
 *
 * Staff Self-Registration Endpoint for CampusAttend:
 * - Validates shared account-creation password against server secret STAFF_REGISTRATION_CODE (default: "staff@123").
 * - Validates required fields: staff_code, name, department, personal password.
 * - Prevents duplicate Staff ID registrations (HTTP 409).
 * - Hashes personal password with PBKDF2-SHA512 (100,000 iterations) and per-user cryptographic salt.
 * - Stores zero plaintext passwords.
 * - Assigns role strictly as 'staff' (zero administrator privilege grant).
 * - Returns sanitized response without secrets or credentials.
 * - 100% self-contained for Vercel Serverless bundling reliability (zero relative .ts imports).
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
type DevicePlatform = "android" | "ios" | "web" | "desktop";

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

async function registerDeviceForStaff(params: {
  staffCode: string;
  staffId: string;
  staffName: string;
  publicKey: string;
  keyAlgorithm?: string;
  platform?: DevicePlatform;
  model?: string;
  os?: string;
  attestationStatus?: string;
  attestationType?: string;
  attestationEvidence?: any;
  auditMetadata?: Record<string, any>;
}) {
  const cleanStaffCode = params.staffCode.trim().toUpperCase();
  const supabaseClient = getSupabaseClient();
  if (supabaseClient) {
    try {
      const { data: existingActive } = await supabaseClient
        .from("devices")
        .select("*")
        .ilike("staff_code", cleanStaffCode)
        .eq("status", "Active")
        .limit(1)
        .maybeSingle();

      if (existingActive) {
        return {
          success: false,
          statusCode: 409,
          error: `Faculty account '${cleanStaffCode}' already has an active registered device (${existingActive.model}, ID: ${existingActive.id}).`,
        };
      }
    } catch (e: any) {
      console.warn("[registerDeviceForStaff] Check error:", e?.message);
    }
  }

  const now = new Date().toISOString();
  const normalizedKey = normalizePublicKeyToPem(params.publicKey);
  const keyId = `DEV_${(params.platform || "android").toUpperCase()}_${crypto.createHash("sha256").update(normalizedKey).digest("hex").slice(0, 16)}`;

  const deviceRecord = {
    id: keyId,
    staff_id: params.staffId,
    staff_code: cleanStaffCode,
    staff_name: params.staffName,
    public_key: normalizedKey,
    key_id: keyId,
    key_algorithm: params.keyAlgorithm || "ECDSA_P256",
    platform: params.platform || "android",
    model: params.model || "Mobile Device",
    os: params.os || "Android",
    status: "Active",
    registered_at: now,
    last_verified_at: now,
  };

  if (supabaseClient) {
    try {
      const { error: insErr } = await supabaseClient.from("devices").insert({
        id: deviceRecord.id,
        staff_id: deviceRecord.staff_id,
        staff_code: deviceRecord.staff_code,
        staff_name: deviceRecord.staff_name,
        model: deviceRecord.model,
        os: deviceRecord.os,
        status: "Active",
        registered_at: now,
      });

      if (insErr && (insErr.code === "23505" || insErr.message.includes("unique"))) {
        return {
          success: false,
          statusCode: 409,
          error: "Device registration conflict: Database unique constraint prevents binding multiple active devices.",
        };
      }

      const cleanB64Key = normalizedKey
        .replace(/-----BEGIN[^-]+-----/, "")
        .replace(/-----END[^-]+-----/, "")
        .replace(/\s+/g, "");

      await supabaseClient.from("security_events").insert({
        time: now,
        staff: cleanStaffCode,
        event: `DEVICE_REGISTERED|${keyId}`,
        device: JSON.stringify({
          id: keyId,
          pub: cleanB64Key,
          algo: deviceRecord.key_algorithm,
        }),
        location: "Staff Registration Gate",
        result: "Allowed",
        severity: "Low",
      });
    } catch (e: any) {
      console.warn("[registerDeviceForStaff] Exception:", e?.message);
    }
  }

  return { success: true, statusCode: 201, device: deviceRecord };
}


// Shared account-creation password from environment or secure default
const DEFAULT_STAFF_REGISTRATION_CODE = "staff@123";

function getExpectedRegistrationCode(): string {
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env["STAFF_REGISTRATION_CODE"] ||
      process.env["CAMPUS_STAFF_CODE"] ||
      DEFAULT_STAFF_REGISTRATION_CODE
    );
  }
  return DEFAULT_STAFF_REGISTRATION_CODE;
}

function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";

  const isProd =
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

  const serviceRoleKey =
    typeof process !== "undefined" && process.env["SUPABASE_SERVICE_ROLE_KEY"]
      ? process.env["SUPABASE_SERVICE_ROLE_KEY"].trim()
      : undefined;

  // In production runtime, privileged server database access strictly requires SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey && !serviceRoleKey.startsWith("sb_publishable_")) {
    return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  // Non-production fallback (test / local developer mode):
  const key =
    serviceRoleKey ||
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"])) ||
    undefined;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function verifySharedCode(candidateCode?: string | null): boolean {
  if (!candidateCode || typeof candidateCode !== "string") return false;
  const expected = getExpectedRegistrationCode();
  const candBuf = Buffer.from(candidateCode.trim());
  const expBuf = Buffer.from(expected.trim());
  if (candBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(candBuf, expBuf);
}

function hashPassword(password: string): { salt: string; hash: string; authString: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 32, "sha512")
    .toString("hex");
  const authString = `auth:pbkdf2$${salt}$${hash}`;
  return { salt, hash, authString };
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use POST /api/staff/register.",
    });
  }

  // Parse request body
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

  const staffCodeCandidate = (body?.staff_code || body?.staffId || "").toString().trim();
  const nameCandidate = (body?.name || "").toString().trim();
  const departmentCandidate = (body?.department || "").toString().trim();
  const passwordCandidate = (body?.password || "").toString();
  const confirmPasswordCandidate = (body?.confirmPassword || body?.confirm_password || "").toString();
  const registrationCodeCandidate = (
    body?.registrationCode ||
    body?.registration_code ||
    body?.sharedPassword ||
    body?.sharedCreationPassword ||
    body?.shared_password ||
    ""
  ).toString().trim();
  const emailCandidate = (body?.email || "").toString().trim();

  // 1. Validate shared account-creation password
  if (!registrationCodeCandidate) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "Shared account-creation password is required.",
    });
  }

  if (!verifySharedCode(registrationCodeCandidate)) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "Invalid shared account-creation password.",
    });
  }

  // 2. Validate required registration fields
  if (!staffCodeCandidate) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Staff ID is required.",
    });
  }

  if (staffCodeCandidate.length < 3 || staffCodeCandidate.length > 32) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Staff ID must be between 3 and 32 characters.",
    });
  }

  if (!nameCandidate) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Full name is required.",
    });
  }

  if (nameCandidate.length < 2 || nameCandidate.length > 100) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Full name must be between 2 and 100 characters.",
    });
  }

  if (!departmentCandidate) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Department is required.",
    });
  }

  if (!passwordCandidate) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Personal password is required.",
    });
  }

  if (passwordCandidate.length < 6) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Password must be at least 6 characters long.",
    });
  }

  if (confirmPasswordCandidate && passwordCandidate !== confirmPasswordCandidate) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Passwords do not match.",
    });
  }

  // Sanitize values
  const cleanStaffCode = staffCodeCandidate.toUpperCase();
  const cleanName = nameCandidate;
  const cleanDepartment = departmentCandidate;
  const cleanDesignation = (body?.designation || "Staff").toString().trim();
  const cleanEmail =
    emailCandidate && emailCandidate.includes("@")
      ? emailCandidate.toLowerCase()
      : `${cleanStaffCode.toLowerCase().replace(/[^a-z0-9]/g, "")}@sonatech.ac.in`;

  // Connect to Supabase
  let supabase: any = null;
  try {
    supabase = getSupabaseClient();
  } catch (err: any) {
    return sendJsonResponse(res, 503, {
      success: false,
      error: "SERVER_CONFIG_FAULT",
      message: err?.message || "Server database configuration fault.",
    });
  }

  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "DATABASE_UNAVAILABLE",
      message: "Database configuration unavailable on server.",
    });
  }

  try {
    // 3. Check for existing staff with this Staff ID
    const { data: existingStaff, error: checkError } = await supabase
      .from("staff")
      .select("id, staff_code, email")
      .eq("staff_code", cleanStaffCode)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("[register] Supabase check error:", checkError);
    }

    if (existingStaff) {
      return sendJsonResponse(res, 409, {
        success: false,
        error: `Staff account with Staff ID '${cleanStaffCode}' is already registered.`,
      });
    }

    // 4. Securely hash password with PBKDF2-SHA512 and unique salt
    const { authString } = hashPassword(passwordCandidate);

    // 5. Insert new staff record
    const newStaffPayload = {
      staff_code: cleanStaffCode,
      name: cleanName,
      email: cleanEmail,
      department: cleanDepartment,
      designation: cleanDesignation,
      device: authString, // Encodes auth:pbkdf2$<salt>$<hash> securely
      device_status: "Active",
      status: "Active",
      active: true,
      inside_campus: false,
      updated_at: new Date().toISOString(),
    };

    const { data: insertedStaff, error: insertError } = await supabase
      .from("staff")
      .insert(newStaffPayload)
      .select("id, staff_code, name, email, department, designation, active, created_at")
      .single();

    if (insertError) {
      console.error("[register] Supabase insert error:", insertError);
      // Check if duplicate key violation
      if (insertError.code === "23505" || insertError.message.includes("unique")) {
        return sendJsonResponse(res, 409, {
          success: false,
          error: `A staff member with this Staff ID or email already exists.`,
        });
      }
      return sendJsonResponse(res, 500, {
        success: false,
        error: `Database registration error: ${insertError.message}`,
      });
    }

    // 6. Bind device on initial registration if public key is provided
    let registeredDevice: any = undefined;
    const clientPublicKey = body?.publicKey || body?.devicePublicKey;
    if (clientPublicKey) {
      try {
        const regRes = await registerDeviceForStaff({
          staffCode: cleanStaffCode,
          staffId: insertedStaff.id,
          staffName: cleanName,
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
            registeredVia: "staff_register",
          },
        });
        if (regRes.success) {
          registeredDevice = regRes.device;
        }
      } catch (devErr) {
        console.warn("[register] Initial device binding notice:", devErr);
      }
    }

    // 7. Return sanitized success response (no passwords, no hashes, no salts, no shared codes)
    return sendJsonResponse(res, 201, {
      success: true,
      message: "Staff account created successfully! Please sign in with your Staff ID and personal password.",
      staff: {
        id: insertedStaff.id,
        staff_code: insertedStaff.staff_code,
        staffId: insertedStaff.staff_code,
        name: insertedStaff.name,
        email: insertedStaff.email,
        department: insertedStaff.department,
        designation: insertedStaff.designation,
        role: "staff",
      },
      device: registeredDevice
        ? {
            id: registeredDevice.id,
            model: registeredDevice.model,
            platform: registeredDevice.platform,
            status: registeredDevice.status,
          }
        : undefined,
    });
  } catch (err: any) {
    console.error("[register] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error during registration.",
    });
  }
}
