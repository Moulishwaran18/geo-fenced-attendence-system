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

function getSupabaseClient(req?: any) {
  if (req?.supabaseClient) return req.supabaseClient;
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

  const supabase = getSupabaseClient(req);
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
      // Query device-local enrollment events from security_events or legacy embeddings
      const { data: priorEvents } = await supabase
        .from("security_events")
        .select("id, device, event")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%")
        .order("time", { ascending: false })
        .limit(1);

      const isEnrolled = Boolean(priorEvents && priorEvents.length > 0);
      let embeddingCount = 0;
      if (isEnrolled && priorEvents && priorEvents[0]) {
        const countMatch = (priorEvents[0]?.device || "").match(/count:(\d+)/);
        embeddingCount = countMatch && countMatch[1] ? parseInt(countMatch[1], 10) : 3;
      }

      // Query any face change or enrollment requests in security_events
      const { data: requests, error: reqErr } = await supabase
        .from("security_events")
        .select("id, time, staff, event, device, location, result, severity, created_at")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%,event.ilike.FACE_REQUEST_%")
        .order("created_at", { ascending: false })
        .limit(5);

      let pendingRequest: any = null;
      let approvedRequest: any = null;
      let rejectedRequest: any = null;
      let expiredRequest: any = null;

      if (requests && requests.length > 0) {
        for (const r of requests) {
          const isConsumed = Boolean(r.device && r.device.includes("status:consumed"));
          const isApproved = r.result === "Allowed" && Boolean(r.device && r.device.includes("status:approved"));
          const isRejected = r.result === "Blocked" || (Boolean(r.device && r.device.includes("status:rejected")) && !isApproved);
          const isPending = r.result === "Flagged" || (!isApproved && !isRejected && !isConsumed && Boolean(r.device && r.device.includes("status:pending")));

          const tokenMatch = r.device ? r.device.match(/token:([^|]+)/) : null;
          const expiresMatch = r.device ? r.device.match(/expires_at:([^|\s]+)/) : null;
          const approvedMatch = r.device ? r.device.match(/approved_at:([^|\s]+)/) : null;
          const devMatch = r.device ? r.device.match(/device_id:([^|]+)/) : null;
          const countMatch = r.device ? r.device.match(/count:(\d+)/) : null;
          const typeMatch = r.device ? r.device.match(/type:([^|]+)/) : null;

          const expiresAtIso = expiresMatch ? expiresMatch[1] : null;
          const approvedAtIso = approvedMatch ? approvedMatch[1] : null;
          const nowMs = Date.now();
          const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : 0;
          const isExpired = expiresMs > 0 && nowMs > expiresMs;

          const cleanReason = r.event
            .replace(/^FACE_(?:CHANGE|ENROLLMENT)_REQUEST:\s*/i, "")
            .replace(/^FACE_REQUEST_[^:]+:\s*/i, "");

          const reqType = typeMatch ? typeMatch[1] : (r.event.includes("FACE_ENROLLMENT_REQUEST") ? "initial" : "replacement");

          if (isPending && !pendingRequest) {
            pendingRequest = {
              id: r.id,
              reason: cleanReason,
              status: "pending",
              deviceId: devMatch ? devMatch[1] : null,
              sampleCount: countMatch ? parseInt(countMatch[1], 10) : 1,
              requestType: reqType,
              created_at: r.created_at || r.time,
            };
          } else if (isApproved && !isConsumed && !approvedRequest) {
            if (isExpired) {
              expiredRequest = {
                id: r.id,
                status: "expired",
                expires_at: expiresAtIso,
                approved_at: approvedAtIso,
                adminNotes: r.location?.replace(/^AdminNote:\s*/, "") || "",
                created_at: r.created_at || r.time,
              };
            } else {
              approvedRequest = {
                id: r.id,
                status: "approved",
                oneTimeToken: tokenMatch ? tokenMatch[1] : null,
                deviceId: devMatch ? devMatch[1] : null,
                sampleCount: countMatch ? parseInt(countMatch[1], 10) : 1,
                requestType: reqType,
                created_at: r.created_at || r.time,
                approved_at: approvedAtIso,
                expires_at: expiresAtIso,
                remaining_seconds: expiresMs ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000)) : null,
                adminNotes: r.location?.replace(/^AdminNote:\s*/, "") || "",
              };
            }
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
      // 'not_registered' | 'pending_approval' | 'approved' | 'rejected' | 'expired'
      let status: "not_registered" | "pending_approval" | "approved" | "rejected" | "expired" = "not_registered";
      let isLocked = false;
      let canEdit = false;
      let oneTimeToken: string | null = null;

      if (!isEnrolled) {
        if (pendingRequest) {
          status = "pending_approval";
          isLocked = true;
          canEdit = false;
        } else if (approvedRequest && approvedRequest.oneTimeToken) {
          status = "approved";
          isLocked = false;
          canEdit = true;
          oneTimeToken = approvedRequest.oneTimeToken;
        } else if (rejectedRequest) {
          status = "rejected";
          isLocked = false;
          canEdit = true; // Eligible to retry enrollment
        } else {
          status = "not_registered";
          isLocked = false;
          canEdit = true; // Eligible for initial face enrollment
        }
      } else {
        // Enrolled on device -> permanently locked unless admin approved change request within 24h
        isLocked = true;
        status = "approved"; // Registered and approved for attendance
        canEdit = false;

        if (approvedRequest && approvedRequest.oneTimeToken) {
          // Admin approved change request within 24 hours -> grant single-use editing window
          isLocked = false;
          canEdit = true;
          oneTimeToken = approvedRequest.oneTimeToken;
        } else if (pendingRequest) {
          status = "pending_approval";
          isLocked = true;
          canEdit = false;
        } else if (expiredRequest && !pendingRequest) {
          status = "expired";
          isLocked = true;
          canEdit = false;
        } else if (rejectedRequest) {
          status = "rejected";
          isLocked = true;
          canEdit = false;
        }
      }

      // DEVICE-ONLY POLICY: Zero raw photos or biometric vectors returned
      const sanitizedSamples: any[] = [];

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
        approvedRequest: approvedRequest ? { id: approvedRequest.id, status: "approved", expires_at: approvedRequest.expires_at, remaining_seconds: approvedRequest.remaining_seconds } : null,
        expiredRequest,
        isExpired: Boolean(expiredRequest && !approvedRequest && !pendingRequest),
        oneTimeToken,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 2: POST /api/staff/face/enroll
    // Save Initial Face Registration OR One-Time Approved Replacement (24-Hour Window)
    // -------------------------------------------------------------------------
    if ((pathname.endsWith("/enroll") || pathname.endsWith("/save")) && method === "POST") {
      // -----------------------------------------------------------------------
      // MANDATORY PRIVACY CHECK:
      // Reject any incoming request that sends samples, embeddings, descriptors, or photo data.
      // Biometrics must remain exclusively on the staff member's Android device.
      // -----------------------------------------------------------------------
      if (
        body?.samples !== undefined ||
        body?.embedding !== undefined ||
        body?.descriptor !== undefined ||
        body?.photoData !== undefined ||
        body?.photo_data !== undefined
      ) {
        return sendJsonResponse(res, 400, {
          success: false,
          code: "BIOMETRIC_CLOUD_STORAGE_PROHIBITED",
          error:
            "Biometric templates, vectors, and photos must remain exclusively on the staff member's device. Uploading biometric data to the server is strictly prohibited.",
          isLocked: true,
        });
      }

      // Check for prior enrollment in security_events
      const { data: priorEvents } = await supabase
        .from("security_events")
        .select("id, device, event")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%")
        .limit(1);

      const isReplacement = Boolean(priorEvents && priorEvents.length > 0);
      const candidateToken = (body?.oneTimeToken || body?.token || req.headers?.["x-one-time-token"] || "").toString().trim();
      const deviceId = (body?.deviceId || req.headers?.["x-device-id"] || "android-keystore").toString().trim();
      const templateCount = typeof body?.templateCount === "number" ? body.templateCount : (typeof body?.count === "number" ? body.count : 3);

      let approvedRow: any = null;

      // If a candidate token is provided (initial or replacement approval) OR if replacement is locked:
      if (candidateToken) {
        // Verify the one-time token matches an unconsumed approved request for this staff member
        const { data: rowData, error: checkRowErr } = await supabase
          .from("security_events")
          .select("id, staff, device, result, time")
          .eq("staff", staffCode)
          .eq("result", "Allowed")
          .ilike("device", `%token:${candidateToken}%`)
          .maybeSingle();

        approvedRow = rowData;

        if (checkRowErr || !approvedRow || approvedRow.device?.includes("status:consumed")) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
            code: "INVALID_OR_CONSUMED_TOKEN",
            isLocked: true,
          });
        }

        // Verify device identity binding
        const devMatch = (approvedRow.device || "").match(/device_id:([^|]+)/);
        if (devMatch && devMatch[1] && deviceId && devMatch[1] !== deviceId) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Face approval request is bound to a different device identity.",
            code: "DEVICE_MISMATCH",
            isLocked: true,
          });
        }
      } else if (isReplacement) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "Your face registration is locked. Request administrator approval to change it.",
          code: "FACE_REGISTRATION_LOCKED",
          isLocked: true,
        });
      }

      if (approvedRow) {

        // Enforce 24-hour expiration based on server time (FAIL CLOSED)
        const expiresMatch = (approvedRow.device || "").match(/expires_at:([^|\s]+)/);
        if (!expiresMatch || !expiresMatch[1]) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Approval record is missing a valid expiration timestamp. Replacement rejected.",
            code: "INVALID_EXPIRY",
            isLocked: true,
          });
        }

        const expiresMs = new Date(expiresMatch[1]).getTime();
        if (Number.isNaN(expiresMs)) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Approval record has a malformed expiration timestamp. Replacement rejected.",
            code: "MALFORMED_EXPIRY",
            isLocked: true,
          });
        }

        if (Date.now() > expiresMs) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Your 24-hour administrator approval window has expired. Please submit a new face change request.",
            code: "EXPIRED_APPROVAL_TOKEN",
            isLocked: true,
          });
        }

        // ---------------------------------------------------------------------
        // REPLACEMENT SAVE: EXECUTE ATOMIC APPROVAL TOKEN CONSUMPTION RPC
        // ---------------------------------------------------------------------
        let rpcData: any = null;
        let rpcErr: any = null;

        const resConsume = await supabase.rpc("atomic_consume_face_approval_token", {
          p_staff_code: staffCode,
          p_token: candidateToken,
          p_device_id: deviceId,
        });
        rpcData = resConsume.data;
        rpcErr = resConsume.error;

        if (rpcErr && rpcErr.message?.includes("does not exist")) {
          const resFallback = await supabase.rpc("atomic_replace_face_biometrics", {
            p_staff_code: staffCode,
            p_token: candidateToken,
            p_samples: null,
          });
          rpcData = resFallback.data;
          rpcErr = resFallback.error;
        }

        if (rpcErr || !rpcData) {
          console.error("[face-replace] atomic_consume_face_approval_token RPC unavailable or failed:", rpcErr?.message || "No RPC data");
          return sendJsonResponse(res, 503, {
            success: false,
            error: "Face replacement service is temporarily unavailable. Existing face templates and approval state remain unchanged.",
            code: "RPC_UNAVAILABLE",
            isLocked: true,
          });
        }

        if (!rpcData.success) {
          const statusMap: Record<string, number> = {
            TOKEN_INVALID_OR_CONSUMED: 403,
            INVALID_OR_CONSUMED_TOKEN: 403,
            EXPIRED_APPROVAL_TOKEN: 403,
            INVALID_EXPIRY: 403,
            MALFORMED_EXPIRY: 403,
            TOKEN_MISSING: 400,
            STAFF_CODE_MISSING: 400,
            STAFF_NOT_FOUND: 404,
            TRANSACTION_ROLLBACK: 500,
          };
          const httpStatus = statusMap[rpcData.code] || 400;

          return sendJsonResponse(res, httpStatus, {
            success: false,
            error: rpcData.error || "Failed to replace face registration.",
            code: rpcData.code,
            isLocked: true,
          });
        }

        return sendJsonResponse(res, 200, {
          success: true,
          message: rpcData.message || "Face registration updated and permanently locked. Single-use authorization consumed.",
          isLocked: true,
          count: templateCount,
          enrolledCount: templateCount,
          deviceId,
        });
      }

      // -----------------------------------------------------------------------
      // INITIAL ENROLLMENT: Register device-local enrollment in audit log
      // -----------------------------------------------------------------------
      const nowIso = new Date().toISOString();
      await supabase.from("security_events").insert({
        time: nowIso,
        staff: staffCode,
        event: `FACE_INITIAL_ENROLLMENT: Device-local enrollment registered (${templateCount} templates)`,
        device: `device_id:${deviceId}|count:${templateCount}`,
        location: "CampusAttend Biometric System",
        result: "Allowed",
        severity: "Low",
      });

      return sendJsonResponse(res, 201, {
        success: true,
        message: "Initial face registration saved successfully and permanently locked.",
        isLocked: true,
        count: templateCount,
        enrolledCount: templateCount,
        deviceId,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 3: POST /api/staff/face/request OR /api/staff/face/request-change
    // Submit Face Approval Request to Administrator (Initial or Replacement)
    // -------------------------------------------------------------------------
    if (
      (pathname.endsWith("/request") ||
        pathname.endsWith("/request-change") ||
        pathname.endsWith("/request-enrollment")) &&
      method === "POST"
    ) {
      if (
        body?.samples !== undefined ||
        body?.embedding !== undefined ||
        body?.descriptor !== undefined ||
        body?.photoData !== undefined ||
        body?.photo_data !== undefined
      ) {
        return sendJsonResponse(res, 400, {
          success: false,
          code: "BIOMETRIC_CLOUD_STORAGE_PROHIBITED",
          error:
            "Biometric templates, vectors, and photos must remain exclusively on the staff member's device. Uploading biometric data to the server is strictly prohibited.",
        });
      }

      const { data: priorEvents } = await supabase
        .from("security_events")
        .select("id")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%")
        .limit(1);

      const hasEnrollment = Boolean(priorEvents && priorEvents.length > 0);

      // Preserve legacy /request-change contract: requires prior enrollment
      if (pathname.endsWith("/request-change") && !pathname.endsWith("/request") && !hasEnrollment) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "You have not registered a face yet. Use initial face enrollment.",
        });
      }

      const rawReason = (body?.reason || "").toString().trim();
      const defaultReason = hasEnrollment
        ? "Face biometric re-enrollment request"
        : "Initial face biometric registration";
      const reasonCandidate = rawReason || defaultReason;

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
        .or("event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%")
        .maybeSingle();

      if (existingPending) {
        return sendJsonResponse(res, 409, {
          success: false,
          error: "A face approval request is already pending administrator approval. Please wait for a decision.",
          requestId: existingPending.id,
        });
      }

      const deviceId = (body?.deviceId || req.headers?.["x-device-id"] || "android-device").toString().trim();
      const sampleCount =
        typeof body?.sampleCount === "number"
          ? body.sampleCount
          : typeof body?.templateCount === "number"
          ? body.templateCount
          : 1;

      const nowIso = new Date().toISOString();
      const reqType = hasEnrollment ? "replacement" : "initial";
      const eventPrefix = hasEnrollment ? "FACE_CHANGE_REQUEST" : "FACE_ENROLLMENT_REQUEST";

      const { data: createdReq, error: reqInsErr } = await supabase
        .from("security_events")
        .insert({
          time: nowIso,
          staff: staffCode,
          event: `${eventPrefix}: ${reasonCandidate.slice(0, 180)}`,
          device: `status:pending|device_id:${deviceId}|count:${sampleCount}|type:${reqType}`,
          location: `Staff: ${staffRecord.name.slice(0, 80)}`,
          result: "Flagged", // 'Flagged' indicates Pending Approval
          severity: "Medium",
        })
        .select()
        .single();

      if (reqInsErr) {
        console.error("[face-request] Insert error:", reqInsErr);
        return sendJsonResponse(res, 500, {
          success: false,
          error: "Failed to submit face approval request.",
        });
      }

      return sendJsonResponse(res, 201, {
        success: true,
        message: hasEnrollment
          ? "Face change request submitted successfully. Awaiting administrator approval."
          : "Face enrollment request submitted successfully. Awaiting administrator approval.",
        requestId: createdReq.id,
        request: {
          id: createdReq.id,
          status: "pending",
          reason: reasonCandidate,
          deviceId,
          sampleCount,
          requestType: reqType,
          created_at: createdReq.created_at || nowIso,
        },
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 4: POST /api/staff/face/cancel-request
    // Cancel Pending Face Approval Request
    // -------------------------------------------------------------------------
    if (pathname.endsWith("/cancel-request") && method === "POST") {
      const { error: cancelErr } = await supabase
        .from("security_events")
        .delete()
        .eq("staff", staffCode)
        .eq("result", "Flagged")
        .or("event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%");

      if (cancelErr) {
        return sendJsonResponse(res, 500, {
          success: false,
          error: "Failed to cancel face approval request.",
        });
      }

      return sendJsonResponse(res, 200, {
        success: true,
        message: "Pending face approval request cancelled.",
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
