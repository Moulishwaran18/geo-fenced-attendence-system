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
  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
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

    // 6. Return sanitized success response (no passwords, no hashes, no salts, no shared codes)
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
    });
  } catch (err: any) {
    console.error("[register] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error during registration.",
    });
  }
}
