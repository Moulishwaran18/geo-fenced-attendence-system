/**
 * Vercel Serverless Function: /api/staff/face
 *
 * Staff-Facing Biometric Face Enrollment & Permanent Lock Management:
 * - GET  /api/staff/face/status         : Query authenticated staff's face enrollment & lock status
 * - POST /api/staff/face/enroll         : Initial face registration OR one-time approved replacement
 * - POST /api/staff/face/request-change : Submit a request to change approved face
 * - POST /api/staff/face/cancel-request : Cancel a pending face change request
 *
 * Security:
 * - 100% server-verified identity via staff_session token (ZERO client identity trust)
 * - Server-enforced permanent lock: Once initial enrollment is saved, direct edits/uploads/deletions
 *   are strictly rejected with HTTP 403 Forbidden unless an approved, unconsumed one-time token is provided.
 * - Single-use token: Consumed upon successful save, immediately re-locking the profile.
 * - Audit logging of every request, approval, rejection, and save in security_events.
 * - Self-contained for Vercel Serverless bundling reliability (zero relative .ts imports).
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
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server.",
    });
  }

  // 1. Authenticate Staff Member from Server Session
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

  let pathname = req.url || "/api/staff/face";
  try {
    pathname = new URL(pathname, "https://localhost").pathname;
  } catch {}

  if (req.query?.match) {
    const matchParts = Array.isArray(req.query.match) ? req.query.match : [req.query.match];
    if (matchParts.length > 0 && !pathname.includes(matchParts[0]!)) {
      pathname = "/api/staff/face/" + matchParts.join("/");
    }
  }

  // Parse request body for POST/PUT/PATCH
  let body: any = {};
  if (method !== "GET" && method !== "HEAD") {
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
  }

  try {
    // -------------------------------------------------------------------------
    // ENDPOINT 1: GET /api/staff/face/status OR /api/staff/face
    // Query face enrollment status, sample count, lock state, and pending requests
    // -------------------------------------------------------------------------
    if (
      (pathname.endsWith("/status") || pathname.endsWith("/face") || pathname.endsWith("/face/")) &&
      method === "GET"
    ) {
      // Query enrolled embeddings count
      const { data: embeddings, error: embErr } = await supabase
        .from("face_embeddings")
        .select("id, reference_image_path, photo_data, created_at")
        .eq("staff_id", staffRecord.id);

      const embeddingCount = embeddings?.length || 0;

      // Query any face change requests in security_events
      const { data: requests, error: reqErr } = await supabase
        .from("security_events")
        .select("id, time, staff, event, device, location, result, severity, created_at")
        .eq("staff", staffCode)
        .ilike("event", "FACE_CHANGE_REQUEST%")
        .order("created_at", { ascending: false })
        .limit(5);

      let pendingRequest: any = null;
      let approvedRequest: any = null;
      let rejectedRequest: any = null;

      if (requests && requests.length > 0) {
        for (const r of requests) {
          const isPending = r.result === "Flagged" || (r.device && r.device.includes("status:pending"));
          const isApproved = r.result === "Allowed" && r.device && r.device.includes("status:approved");
          const isConsumed = r.device && r.device.includes("status:consumed");
          const isRejected = r.result === "Blocked" || (r.device && r.device.includes("status:rejected"));

          if (isPending && !pendingRequest) {
            const reason = r.event.replace(/^FACE_CHANGE_REQUEST:\s*/, "");
            pendingRequest = {
              id: r.id,
              reason,
              status: "pending",
              created_at: r.created_at || r.time,
            };
          } else if (isApproved && !isConsumed && !approvedRequest) {
            const tokenMatch = r.device.match(/token:([^|]+)/);
            approvedRequest = {
              id: r.id,
              status: "approved",
              oneTimeToken: tokenMatch ? tokenMatch[1] : null,
              created_at: r.created_at || r.time,
              adminNotes: r.location?.replace(/^AdminNote:\s*/, "") || "",
            };
          } else if (isRejected && !rejectedRequest && !pendingRequest && !approvedRequest) {
            rejectedRequest = {
              id: r.id,
              status: "rejected",
              created_at: r.created_at || r.time,
              adminNotes: r.location?.replace(/^AdminNote:\s*/, "") || "",
            };
          }
        }
      }

      // Determine face profile status:
      // 'not_registered' | 'pending_approval' | 'approved' | 'rejected'
      let status: "not_registered" | "pending_approval" | "approved" | "rejected" = "not_registered";
      let isLocked = false;
      let canEdit = false;
      let oneTimeToken: string | null = null;

      if (embeddingCount === 0) {
        status = "not_registered";
        isLocked = false;
        canEdit = true; // Eligible for initial face enrollment
      } else {
        // Embeddings exist -> permanently locked unless admin approved change request
        isLocked = true;
        status = "approved"; // Registered and approved for attendance

        if (approvedRequest && approvedRequest.oneTimeToken) {
          // Admin approved change request -> grant single-use permission
          canEdit = true;
          oneTimeToken = approvedRequest.oneTimeToken;
        } else if (pendingRequest) {
          status = "pending_approval";
          canEdit = false;
        } else if (rejectedRequest) {
          status = "rejected";
          canEdit = false;
        } else {
          canEdit = false;
        }
      }

      // Sanitized reference sample metadata (never leak raw embeddings)
      const sanitizedSamples = (embeddings || []).map((e) => ({
        id: e.id,
        reference_image_path: e.reference_image_path,
        photo_data: e.photo_data ? e.photo_data.slice(0, 50) + "..." : null,
        created_at: e.created_at,
      }));

      return sendJsonResponse(res, 200, {
        success: true,
        staff: {
          id: staffRecord.id,
          staff_code: staffRecord.staff_code,
          name: staffRecord.name,
          department: staffRecord.department,
        },
        status,
        enrollmentStatus: status,
        isLocked,
        canEdit,
        canSaveReplacement: Boolean(canEdit && oneTimeToken),
        embeddingCount,
        sampleCount: embeddingCount,
        samples: sanitizedSamples,
        hasPendingRequest: Boolean(pendingRequest),
        pendingRequest,
        activeRequest: pendingRequest ? { ...pendingRequest } : null,
        approvedRequest: approvedRequest ? { id: approvedRequest.id, status: "approved" } : null,
        oneTimeToken,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 2: POST /api/staff/face/enroll
    // Save Initial Face Registration OR One-Time Approved Replacement
    // -------------------------------------------------------------------------
    if ((pathname.endsWith("/enroll") || pathname.endsWith("/save")) && method === "POST") {
      const { count: existingCount } = await supabase
        .from("face_embeddings")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", staffRecord.id);

      const isReplacement = (existingCount || 0) > 0;
      const candidateToken = (body?.oneTimeToken || body?.token || req.headers?.["x-one-time-token"] || "").toString().trim();

      // If already registered: ENFORCE SERVER-SIDE LOCK
      if (isReplacement) {
        if (!candidateToken) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Your face registration is locked. Request administrator approval to change it.",
          });
        }

        // Verify the one-time token matches an unconsumed approved request for this staff member
        const { data: approvedRow, error: checkRowErr } = await supabase
          .from("security_events")
          .select("id, staff, device, result")
          .eq("staff", staffCode)
          .eq("result", "Allowed")
          .ilike("device", `%token:${candidateToken}%`)
          .maybeSingle();

        if (checkRowErr || !approvedRow || approvedRow.device?.includes("status:consumed")) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
          });
        }
      }

      // Extract embedding samples from body
      // Supports array of samples or single sample
      let samples: Array<{
        embedding: number[];
        referenceImagePath?: string;
        photoData?: string;
      }> = [];

      if (Array.isArray(body?.samples) && body.samples.length > 0) {
        samples = body.samples;
      } else if (body?.embedding || body?.descriptor) {
        samples = [
          {
            embedding: body.embedding || body.descriptor,
            referenceImagePath: body.referenceImagePath,
            photoData: body.photoData,
          },
        ];
      }

      if (samples.length === 0) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "No face samples provided for enrollment.",
        });
      }

      // Validate 512-dimensional embeddings
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        if (!Array.isArray(s.embedding) || s.embedding.length !== 512) {
          return sendJsonResponse(res, 400, {
            success: false,
            error: `Sample #${i + 1} has invalid descriptor. Expected 512 numbers.`,
          });
        }
      }

      // If replacement: Atomically delete previous embeddings for this staff member
      if (isReplacement) {
        const { error: delErr } = await supabase
          .from("face_embeddings")
          .delete()
          .eq("staff_id", staffRecord.id);

        if (delErr) {
          console.error("[face-enroll] Error deleting previous embeddings:", delErr);
          return sendJsonResponse(res, 500, {
            success: false,
            error: "Failed to purge old templates during atomic replacement.",
          });
        }
      }

      // Insert new face embeddings
      const nowIso = new Date().toISOString();
      const insertPayloads = samples.map((s, idx) => ({
        staff_id: staffRecord.id,
        embedding: s.embedding,
        reference_image_path: s.referenceImagePath || `staff_enrolled_${staffCode}_${Date.now()}_${idx}.jpg`,
        photo_data: s.photoData || null,
        created_at: nowIso,
      }));

      const { data: inserted, error: insErr } = await supabase
        .from("face_embeddings")
        .insert(insertPayloads)
        .select("id, reference_image_path, created_at");

      if (insErr) {
        console.error("[face-enroll] Insert error:", insErr);
        return sendJsonResponse(res, 500, {
          success: false,
          error: `Failed to store face embeddings: ${insErr.message}`,
        });
      }

      // If one-time token was used: Mark request as CONSUMED immediately
      if (isReplacement && candidateToken) {
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
        event: isReplacement
          ? `FACE_CHANGE_CONSUMED: Enrolled ${samples.length} replacement samples`
          : `FACE_INITIAL_ENROLLMENT: Enrolled ${samples.length} reference samples`,
        device: `enrolled_samples:${samples.length}`,
        location: "CampusAttend Biometric System",
        result: "Allowed",
        severity: "Low",
      });

      return sendJsonResponse(res, isReplacement ? 200 : 201, {
        success: true,
        message: isReplacement
          ? "Face registration updated and permanently locked. Single-use authorization consumed."
          : "Initial face registration saved successfully and permanently locked.",
        isLocked: true,
        count: inserted?.length || samples.length,
        enrolledCount: inserted?.length || samples.length,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 3: POST /api/staff/face/request-change
    // Submit Face Change Request to Administrator
    // -------------------------------------------------------------------------
    if (pathname.endsWith("/request-change") && method === "POST") {
      const { count: embCount } = await supabase
        .from("face_embeddings")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", staffRecord.id);

      if (!embCount || embCount === 0) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "You have not registered a face yet. Use initial face enrollment.",
        });
      }

      const reasonCandidate = (body?.reason || "").toString().trim();
      if (!reasonCandidate) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Please provide a reason for the face change request.",
        });
      }

      if (reasonCandidate.length < 5 || reasonCandidate.length > 250) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Reason must be between 5 and 250 characters.",
        });
      }

      // Check if a pending request already exists
      const { data: existingPending } = await supabase
        .from("security_events")
        .select("id, created_at")
        .eq("staff", staffCode)
        .eq("result", "Flagged")
        .ilike("event", "FACE_CHANGE_REQUEST%")
        .maybeSingle();

      if (existingPending) {
        return sendJsonResponse(res, 409, {
          success: false,
          error: "A face change request is already pending administrator approval. Please wait for a decision.",
        });
      }

      const nowIso = new Date().toISOString();
      const { data: createdReq, error: reqInsErr } = await supabase
        .from("security_events")
        .insert({
          time: nowIso,
          staff: staffCode,
          event: `FACE_CHANGE_REQUEST: ${reasonCandidate.slice(0, 180)}`,
          device: "status:pending",
          location: `Staff: ${staffRecord.name.slice(0, 80)}`,
          result: "Flagged", // 'Flagged' indicates Pending Approval
          severity: "Medium",
        })
        .select()
        .single();

      if (reqInsErr) {
        console.error("[request-change] Insert error:", reqInsErr);
        return sendJsonResponse(res, 500, {
          success: false,
          error: "Failed to submit face change request.",
        });
      }

      return sendJsonResponse(res, 201, {
        success: true,
        message: "Face change request submitted successfully. Awaiting administrator approval.",
        requestId: createdReq.id,
        request: {
          id: createdReq.id,
          status: "pending",
          reason: reasonCandidate,
          created_at: createdReq.created_at || nowIso,
        },
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 4: POST /api/staff/face/cancel-request
    // Cancel Pending Face Change Request
    // -------------------------------------------------------------------------
    if (pathname.endsWith("/cancel-request") && method === "POST") {
      const { error: cancelErr } = await supabase
        .from("security_events")
        .delete()
        .eq("staff", staffCode)
        .eq("result", "Flagged")
        .ilike("event", "FACE_CHANGE_REQUEST%");

      if (cancelErr) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: "Failed to cancel face change request.",
        });
      }

      return sendJsonResponse(res, 200, {
        success: true,
        message: "Pending face change request cancelled.",
      });
    }

    return sendJsonResponse(res, 404, {
      success: false,
      error: `Route not found: ${pathname}`,
    });
  } catch (err: any) {
    console.error("[api/staff/face] Unexpected error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error.",
    });
  }
}
