/**
 * Vercel Serverless Function: POST /api/staff/face/enroll
 *
 * Handles staff initial face registration OR one-time approved face replacement.
 * Enforces permanent lock: rejects direct edits with HTTP 403 unless valid single-use token is supplied.
 * Consumes single-use token immediately on save and re-locks profile.
 *
 * Self-contained for Vercel Serverless deployment reliability (zero relative .ts imports).
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

function extractStaffToken(req: any): string | null {
  if (!req) return null;
  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    authHeader = req.headers.get("authorization") || req.headers.get("x-staff-token") || "";
  } else if (req.headers) {
    authHeader = req.headers["authorization"] || req.headers["x-staff-token"] || "";
  }
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }
  let cookieHeader = "";
  if (typeof req.headers?.get === "function") {
    cookieHeader = req.headers.get("cookie") || "";
  } else if (req.headers) {
    cookieHeader = req.headers["cookie"] || "";
  }
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)staff_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

function verifyStaffToken(tokenStr?: string | null): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing authentication session. Please sign in." };
  }
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed authentication token." };
  }
  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "Invalid token components." };
  }
  const expectedSignature = crypto
    .createHmac("sha256", STAFF_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { valid: false, error: "Invalid session signature." };
  }
  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr);
    if (payload.role !== "staff" || (!payload.sub && !payload.staff_code && !payload.staffId)) {
      return { valid: false, error: "Token does not possess valid staff credentials." };
    }
    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Staff session has expired. Please sign in again." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode session token." };
  }
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "POST").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, { success: false, error: "Method not allowed. Use POST." });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
    });
  }

  // Authenticate Staff Member
  const token = extractStaffToken(req);
  const auth = verifyStaffToken(token);
  if (!auth.valid || !auth.payload) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: auth.error || "Authentication required to access face registration.",
    });
  }

  const staffCode = (auth.payload.staff_code || auth.payload.staffId || auth.payload.sub || "").toUpperCase();

  // Resolve staff database record
  const { data: staffRecord, error: staffFindErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, email, department, designation, device, active")
    .eq("staff_code", staffCode)
    .maybeSingle();

  if (staffFindErr || !staffRecord) {
    return sendJsonResponse(res, 404, {
      success: false,
      error: `Staff account '${staffCode}' not found in database.`,
    });
  }

  if (staffRecord.active === false) {
    return sendJsonResponse(res, 403, {
      success: false,
      error: "Staff account is deactivated.",
    });
  }

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

  try {
    // Check if staff already has registered face
    const { count: existingCount } = await supabase
      .from("face_embeddings")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffRecord.id);

    const isAlreadyEnrolled = (existingCount || 0) > 0;
    const candidateToken = (body?.oneTimeToken || body?.token || "").toString().trim();

    // SERVER PERMANENT LOCK ENFORCEMENT
    if (isAlreadyEnrolled) {
      if (!candidateToken) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "Your face registration is locked. Request administrator approval to change it.",
          code: "FACE_REGISTRATION_LOCKED",
          isLocked: true,
        });
      }

      // Verify single-use token in security_events
      const { data: approvedEvent, error: tokErr } = await supabase
        .from("security_events")
        .select("id, device, result, event")
        .eq("staff", staffCode)
        .eq("result", "Allowed")
        .ilike("device", `%token:${candidateToken}%`)
        .maybeSingle();

      if (tokErr || !approvedEvent || (approvedEvent.device || "").includes("status:consumed")) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
          code: "INVALID_OR_CONSUMED_TOKEN",
          isLocked: true,
        });
      }
    }

    // Validate face samples
    const rawSamples = Array.isArray(body?.samples)
      ? body.samples
      : Array.isArray(body?.descriptors)
        ? body.descriptors
        : body?.descriptor
          ? [body.descriptor]
          : [];

    if (!rawSamples || rawSamples.length === 0) {
      return sendJsonResponse(res, 400, {
        success: false,
        error: "At least one valid face photo/embedding is required for registration.",
      });
    }

    if (rawSamples.length > 10) {
      return sendJsonResponse(res, 400, {
        success: false,
        error: "Maximum of 10 face reference samples allowed.",
      });
    }

    const validatedEmbeddings: number[][] = [];
    for (let i = 0; i < rawSamples.length; i++) {
      const s = rawSamples[i];
      const desc = Array.isArray(s) ? s : Array.isArray(s?.descriptor) ? s.descriptor : null;
      if (!desc || desc.length !== 512 || !desc.every((v: any) => typeof v === "number" && !isNaN(v))) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: `Sample ${i + 1} is invalid. Expected a 512-dimensional ArcFace embedding vector.`,
        });
      }
      validatedEmbeddings.push(desc);
    }

    const nowIso = new Date().toISOString();
    const rowsToInsert = validatedEmbeddings.map((desc, idx) => ({
      staff_id: staffRecord.id,
      embedding: desc,
      label: `Staff Enrolled Photo ${idx + 1}`,
      sample_index: idx + 1,
      total_samples: validatedEmbeddings.length,
      provenance: "client_arcface_onnx",
      quality_score: 0.95,
      created_at: nowIso,
    }));

    // Insert new embeddings
    const { data: inserted, error: insErr } = await supabase
      .from("face_embeddings")
      .insert(rowsToInsert)
      .select("id");

    if (insErr) {
      console.error("[api/staff/face/enroll] Insert embeddings error:", insErr);
      return sendJsonResponse(res, 500, {
        success: false,
        error: `Database insertion failed: ${insErr.message}`,
      });
    }

    // If replacement: remove old embeddings (now safe because new ones are committed)
    if (isAlreadyEnrolled) {
      const newIds = (inserted || []).map((r) => r.id);
      if (newIds.length > 0) {
        await supabase
          .from("face_embeddings")
          .delete()
          .eq("staff_id", staffRecord.id)
          .not("id", "in", `(${newIds.join(",")})`);
      }
    }

    // If one-time token was used: mark request as CONSUMED immediately
    if (isAlreadyEnrolled && candidateToken) {
      await supabase
        .from("security_events")
        .update({
          device: `token:${candidateToken}|status:consumed`,
          time: nowIso,
        })
        .eq("staff", staffCode)
        .ilike("device", `%token:${candidateToken}%`);
    }

    // Record Security Audit Log
    await supabase.from("security_events").insert({
      time: nowIso,
      staff: staffCode,
      event: isAlreadyEnrolled
        ? `FACE_CHANGE_CONSUMED: Enrolled ${validatedEmbeddings.length} replacement samples`
        : `FACE_INITIAL_ENROLLMENT: Enrolled ${validatedEmbeddings.length} reference samples`,
      device: `enrolled_samples:${validatedEmbeddings.length}`,
      location: "CampusAttend Biometric System",
      result: "Allowed",
      severity: "Low",
    });

    return sendJsonResponse(res, isAlreadyEnrolled ? 200 : 201, {
      success: true,
      message: isAlreadyEnrolled
        ? "Face registration updated and permanently locked. Single-use authorization consumed."
        : "Initial face registration saved successfully and permanently locked.",
      isLocked: true,
      count: inserted?.length || validatedEmbeddings.length,
      enrolledCount: inserted?.length || validatedEmbeddings.length,
    });
  } catch (err: any) {
    console.error("[api/staff/face/enroll] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error.",
    });
  }
}
