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

  if (staffFindErr) {
    return sendJsonResponse(res, 503, {
      success: false,
      code: "RPC_UNAVAILABLE",
      error: "Biometric authorization service temporarily unavailable. Safe rollback enforced.",
    });
  }

  if (!staffRecord) {
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

  const matchedHeader = (req.headers?.["x-matched-path"] || (typeof req.headers?.get === "function" ? req.headers.get("x-matched-path") : "") || "").toString();
  if (matchedHeader && matchedHeader.startsWith("/api/staff/face")) {
    pathname = matchedHeader;
  } else if (req.query?.subpath) {
    const subpathParts = Array.isArray(req.query.subpath) ? req.query.subpath : [req.query.subpath];
    if (subpathParts.length > 0) {
      pathname = "/api/staff/face/" + subpathParts.join("/");
    }
  } else if (req.query?.match) {
    const matchParts = Array.isArray(req.query.match) ? req.query.match : [req.query.match];
    if (matchParts.length > 0 && !pathname.includes(matchParts[0]!)) {
      pathname = "/api/staff/face/" + matchParts.join("/");
    }
  } else if (req.query?.slug) {
    const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    if (slugParts.length > 0 && !pathname.includes(slugParts[0]!)) {
      pathname = "/api/staff/face/" + slugParts.join("/");
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

  // If URL rewrite collapsed subpath to root, resolve via body.action
  if (pathname === "/api/staff/face" || pathname === "/api/staff/face/") {
    if (
      body?.action === "request-change" ||
      body?.action === "request" ||
      body?.action === "request-enrollment" ||
      body?.action === "request-image-approval"
    ) {
      pathname = "/api/staff/face/request-change";
    } else if (body?.action === "cancel-request" || body?.action === "cancel") {
      pathname = "/api/staff/face/cancel-request";
    } else if (body?.action === "enroll" || body?.action === "save") {
      pathname = "/api/staff/face/enroll";
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
      // Check for prior enrollment across multiple sources (events, staff device, attendance)
      const { data: priorEvents } = await supabase
        .from("security_events")
        .select("id, device, event")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%,event.ilike.FACE_ENROLLMENT%")
        .order("time", { ascending: false })
        .limit(1);

      let isEnrolled = Boolean(priorEvents && priorEvents.length > 0);
      if (!isEnrolled && staffRecord.device && (staffRecord.device.includes("device_id:") || staffRecord.device.includes("auth:"))) {
        const { data: attCheck } = await supabase
          .from("attendance_records")
          .select("id")
          .eq("staff_code", staffCode)
          .limit(1);
        if (attCheck && attCheck.length > 0) {
          isEnrolled = true;
        }
      }
      if (!isEnrolled) {
        const { data: attCheck } = await supabase
          .from("attendance_records")
          .select("id")
          .eq("staff_code", staffCode)
          .limit(1);
        if (attCheck && attCheck.length > 0) {
          isEnrolled = true;
        }
      }

      let embeddingCount = 0;
      if (isEnrolled && priorEvents && priorEvents[0]) {
        const countMatch = (priorEvents[0]?.device || "").match(/count:(\d+)/);
        embeddingCount = countMatch && countMatch[1] ? parseInt(countMatch[1], 10) : 5;
      } else if (isEnrolled) {
        embeddingCount = 5;
      }

      // Query face change or enrollment requests in security_events (newest first)
      // Query face change or enrollment requests in security_events (newest first)
      const { data: requests, error: reqErr } = await supabase
        .from("security_events")
        .select("id, time, staff, event, device, location, result, severity, created_at")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_PERMISSION_REQUEST%,event.ilike.FACE_IMAGE_APPROVAL_REQUEST%,event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%,event.ilike.FACE_REQUEST_%")
        .order("created_at", { ascending: false })
        .limit(10);

      let pendingRequest: any = null;
      let approvedRequest: any = null;
      let rejectedRequest: any = null;
      let expiredRequest: any = null;
      let latestRequest: any = null;

      let hasStage1Permission = false;
      let prepToken: string | null = null;
      let permissionRequestId: string | null = null;
      let hasPendingPermissionRequest = false;
      let hasPendingImageApproval = false;
      let approvedDigest: string | null = null;

      // Scan all recent requests to inspect both Stage 1 permission and Stage 2 image approval
      if (requests && requests.length > 0) {
        // Identify timestamp of latest completed/consumed face replacement cycle
        let lastCompletedMs = 0;
        for (const r of requests) {
          if (r.device && r.device.includes("status:consumed")) {
            const t = new Date(r.created_at || r.time).getTime();
            if (t > lastCompletedMs) {
              lastCompletedMs = t;
            }
          }
        }

        for (const req of requests) {
          const typeMatch = req.device ? req.device.match(/type:([^|]+)/) : null;
          const reqType = typeMatch
            ? typeMatch[1]
            : req.event.includes("FACE_IMAGE_APPROVAL_REQUEST")
            ? "image_approval"
            : req.event.includes("FACE_PERMISSION_REQUEST")
            ? "permission_request"
            : req.event.includes("FACE_ENROLLMENT_REQUEST")
            ? "initial"
            : "replacement";

          const tokenMatch = req.device ? req.device.match(/token:([^|]+)/) : null;
          const expiresMatch = req.device ? req.device.match(/expires_at:([^|\s]+)/) : null;
          const digestMatch = req.device ? req.device.match(/digest:([^|]+)/) : null;
          const expiresAtIso = expiresMatch ? expiresMatch[1] : null;
          const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : 0;
          const isExpired = expiresMs > 0 && Date.now() > expiresMs;
          const isConsumed = Boolean(req.device && req.device.includes("status:consumed"));
          const reqMs = new Date(req.created_at || req.time).getTime();
          const isSupersededByCompletion = lastCompletedMs > 0 && reqMs <= lastCompletedMs;

          // Check if this row is an active Stage 1 permission approval
          if (
            (reqType === "permission_request" || req.event.includes("FACE_PERMISSION_REQUEST")) &&
            req.result === "Allowed" &&
            !isExpired &&
            !isConsumed &&
            !isSupersededByCompletion &&
            !hasStage1Permission
          ) {
            hasStage1Permission = true;
            prepToken = tokenMatch ? tokenMatch[1] : null;
            permissionRequestId = req.id;
          }

          // Check if there is an active pending permission request
          if (
            (reqType === "permission_request" || req.event.includes("FACE_PERMISSION_REQUEST")) &&
            req.result === "Flagged" &&
            !isConsumed &&
            !isSupersededByCompletion
          ) {
            hasPendingPermissionRequest = true;
          }

          // Check if there is an active pending image approval
          if (
            (reqType === "image_approval" || req.event.includes("FACE_IMAGE_APPROVAL_REQUEST")) &&
            req.result === "Flagged" &&
            !isConsumed &&
            !isSupersededByCompletion
          ) {
            hasPendingImageApproval = true;
          }

          // Check if there is an approved Stage 2 image approval
          if (
            (reqType === "image_approval" || req.event.includes("FACE_IMAGE_APPROVAL_REQUEST")) &&
            req.result === "Allowed" &&
            !isExpired &&
            !isConsumed &&
            !isSupersededByCompletion &&
            !approvedDigest &&
            digestMatch
          ) {
            approvedDigest = digestMatch[1];
          }
        }

        // Now evaluate the LATEST request for primary lifecycle state
        const latestR = requests[0]!;
        const isConsumed = Boolean(latestR.device && latestR.device.includes("status:consumed"));
        const isApproved =
          latestR.result === "Allowed" &&
          Boolean(
            latestR.device &&
              (latestR.device.includes("status:approved") || latestR.device.includes("status:prep_approved"))
          );
        const isRejected =
          latestR.result === "Blocked" ||
          (Boolean(latestR.device && latestR.device.includes("status:rejected")) && !isApproved);
        const isPending =
          latestR.result === "Flagged" ||
          (!isApproved && !isRejected && !isConsumed && Boolean(latestR.device && latestR.device.includes("status:pending")));

        const tokenMatch = latestR.device ? latestR.device.match(/token:([^|]+)/) : null;
        const expiresMatch = latestR.device ? latestR.device.match(/expires_at:([^|\s]+)/) : null;
        const approvedMatch = latestR.device ? latestR.device.match(/approved_at:([^|\s]+)/) : null;
        const devMatch = latestR.device ? latestR.device.match(/device_id:([^|]+)/) : null;
        const countMatch = latestR.device ? latestR.device.match(/count:(\d+)/) : null;
        const typeMatch = latestR.device ? latestR.device.match(/type:([^|]+)/) : null;
        const linkedMatch = latestR.device ? latestR.device.match(/linked_req:([^|]+)/) : null;
        const digestMatch = latestR.device ? latestR.device.match(/digest:([^|]+)/) : null;

        const expiresAtIso = expiresMatch ? expiresMatch[1] : null;
        const approvedAtIso = approvedMatch ? approvedMatch[1] : null;
        const nowMs = Date.now();
        const expiresMs = expiresAtIso ? new Date(expiresAtIso).getTime() : 0;
        const isExpired = expiresMs > 0 && nowMs > expiresMs;

        const cleanReason = latestR.event
          .replace(/^FACE_(?:PERMISSION|IMAGE_APPROVAL|CHANGE|ENROLLMENT)_REQUEST:\s*/i, "")
          .replace(/^FACE_REQUEST_[^:]+:\s*/i, "");

        const reqType = typeMatch
          ? typeMatch[1]
          : latestR.event.includes("FACE_IMAGE_APPROVAL_REQUEST")
          ? "image_approval"
          : latestR.event.includes("FACE_PERMISSION_REQUEST")
          ? "permission_request"
          : latestR.event.includes("FACE_ENROLLMENT_REQUEST")
          ? "initial"
          : "replacement";

        if (isConsumed) {
          latestRequest = {
            id: latestR.id,
            reason: cleanReason,
            status: "completed",
            deviceId: devMatch ? devMatch[1] : null,
            sampleCount: countMatch ? parseInt(countMatch[1], 10) : 5,
            requestType: reqType,
            linkedRequestId: linkedMatch ? linkedMatch[1] : null,
            digest: digestMatch ? digestMatch[1] : null,
            created_at: latestR.created_at || latestR.time,
            adminNotes: latestR.location?.replace(/^AdminNote:\s*/, "") || "",
          };
        } else if (isPending) {
          pendingRequest = {
            id: latestR.id,
            reason: cleanReason,
            status: "pending",
            deviceId: devMatch ? devMatch[1] : null,
            sampleCount: countMatch ? parseInt(countMatch[1], 10) : 1,
            requestType: reqType,
            linkedRequestId: linkedMatch ? linkedMatch[1] : null,
            digest: digestMatch ? digestMatch[1] : null,
            created_at: latestR.created_at || latestR.time,
          };
          latestRequest = pendingRequest;
        } else if (isApproved) {
          if (isExpired) {
            expiredRequest = {
              id: latestR.id,
              reason: cleanReason,
              status: "expired",
              expires_at: expiresAtIso,
              approved_at: approvedAtIso,
              requestType: reqType,
              adminNotes: latestR.location?.replace(/^AdminNote:\s*/, "") || "",
              created_at: latestR.created_at || latestR.time,
            };
            latestRequest = expiredRequest;
          } else {
            approvedRequest = {
              id: latestR.id,
              reason: cleanReason,
              status: "approved",
              oneTimeToken: tokenMatch ? tokenMatch[1] : null,
              deviceId: devMatch ? devMatch[1] : null,
              sampleCount: countMatch ? parseInt(countMatch[1], 10) : 1,
              requestType: reqType,
              linkedRequestId: linkedMatch ? linkedMatch[1] : null,
              digest: digestMatch ? digestMatch[1] : null,
              approvedDigest: digestMatch ? digestMatch[1] : null,
              created_at: latestR.created_at || latestR.time,
              approved_at: approvedAtIso,
              expires_at: expiresAtIso,
              remaining_seconds: expiresMs ? Math.max(0, Math.floor((expiresMs - nowMs) / 1000)) : null,
              adminNotes: latestR.location?.replace(/^AdminNote:\s*/, "") || "",
            };
            latestRequest = approvedRequest;
          }
        } else if (isRejected) {
          rejectedRequest = {
            id: latestR.id,
            reason: cleanReason,
            status: "rejected",
            requestType: reqType,
            created_at: latestR.created_at || latestR.time,
            adminNotes: latestR.location?.replace(/^AdminNote:\s*/, "") || "",
          };
          latestRequest = rejectedRequest;
        }
      }

      // Determine face profile status:
      // When enrolled on device/server, face registration is locked and active ("approved")
      // canSaveReplacement is ONLY true when Stage 2 (image approval) OR legacy approved replacement has a fresh token!
      // The first approval (permission_request) gives preparation permission only — NEVER canSaveReplacement!
      let status: "not_registered" | "pending_approval" | "approved" | "rejected" | "expired" = "not_registered";
      let enrollmentStatus: "not_registered" | "pending_approval" | "approved" | "rejected" | "expired" = "not_registered";
      let isLocked = false;
      let canEdit = false;
      let oneTimeToken: string | null = null;

      const isStage2Approved = Boolean(
        approvedRequest &&
        approvedRequest.oneTimeToken &&
        (approvedRequest.requestType === "image_approval" ||
         approvedRequest.requestType === "replacement" ||
         approvedRequest.requestType === "initial") &&
        approvedRequest.requestType !== "permission_request"
      );

      if (isEnrolled) {
        isLocked = true;
        enrollmentStatus = pendingRequest
          ? "pending_approval"
          : expiredRequest
          ? "expired"
          : rejectedRequest
          ? "rejected"
          : "approved";

        if (isStage2Approved && approvedRequest?.oneTimeToken) {
          status = "approved";
          canEdit = true;
          oneTimeToken = approvedRequest.oneTimeToken;
        } else if (pendingRequest) {
          status = "pending_approval";
          canEdit = false;
        } else if (expiredRequest) {
          status = "expired";
          canEdit = false;
        } else if (rejectedRequest) {
          status = "rejected";
          canEdit = false;
        } else {
          status = "approved";
          canEdit = false;
        }
      } else {
        isLocked = false;
        if (pendingRequest) {
          status = "pending_approval";
          enrollmentStatus = "pending_approval";
          isLocked = true;
          canEdit = false;
        } else if (approvedRequest && approvedRequest.oneTimeToken) {
          status = "approved";
          enrollmentStatus = "approved";
          canEdit = true;
          oneTimeToken = approvedRequest.oneTimeToken;
        } else if (rejectedRequest) {
          status = "rejected";
          enrollmentStatus = "rejected";
          canEdit = true;
        } else {
          status = "not_registered";
          enrollmentStatus = "not_registered";
          canEdit = true;
        }
      }

      // DEVICE-ONLY POLICY: Zero raw photos or biometric vectors returned
      const sanitizedSamples: any[] = [];

      const isCompletedRequest = latestRequest?.status === "completed";
      const effectiveStage1Permission = Boolean(hasStage1Permission && !hasPendingImageApproval && !isStage2Approved && !isCompletedRequest);

      return sendJsonResponse(res, 200, {
        success: true,
        staff: {
          id: staffRecord.id,
          staff_code: staffRecord.staff_code,
          name: staffRecord.name,
          department: staffRecord.department,
        },
        status,
        enrollmentStatus,
        isLocked,
        canEdit,
        canSaveReplacement: Boolean(canEdit && oneTimeToken && isStage2Approved),
        canPrepareReplacement: effectiveStage1Permission,
        hasStage1Permission: effectiveStage1Permission,
        hasPendingPermissionRequest: Boolean(hasPendingPermissionRequest),
        hasPendingImageApproval: Boolean(hasPendingImageApproval),
        prepToken: effectiveStage1Permission ? (prepToken || null) : null,
        permissionRequestId: effectiveStage1Permission ? (permissionRequestId || null) : null,
        approvedDigest: approvedDigest || (approvedRequest?.approvedDigest ?? null),
        stage: isCompletedRequest ? 2 : (hasPendingImageApproval ? 2 : (isStage2Approved ? 2 : (effectiveStage1Permission ? 2 : 1))),
        embeddingCount,
        sampleCount: embeddingCount,
        samples: sanitizedSamples,
        hasPendingRequest: Boolean(pendingRequest),
        pendingRequest,
        activeRequest: pendingRequest ? { ...pendingRequest } : (approvedRequest ? { ...approvedRequest } : null),
        approvedRequest: approvedRequest
          ? {
              id: approvedRequest.id,
              status: "approved",
              requestType: approvedRequest.requestType,
              expires_at: approvedRequest.expires_at,
              remaining_seconds: approvedRequest.remaining_seconds,
              oneTimeToken: isStage2Approved ? approvedRequest.oneTimeToken : null,
              approvedDigest: approvedRequest.approvedDigest || null,
            }
          : null,
        expiredRequest,
        latestRequest,
        latestRequestStatus: latestRequest?.status || (isEnrolled ? "none" : "not_registered"),
        isExpired: Boolean(expiredRequest && !approvedRequest && !pendingRequest),
        oneTimeToken: isStage2Approved ? oneTimeToken : null,
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

      // Check for prior enrollment across multiple sources (events, staff device, attendance)
      const { data: priorEvents } = await supabase
        .from("security_events")
        .select("id, device, event")
        .eq("staff", staffCode)
        .or("event.ilike.FACE_INITIAL_ENROLLMENT%,event.ilike.FACE_CHANGE_CONSUMED%,event.ilike.FACE_ENROLLMENT%")
        .order("time", { ascending: false })
        .limit(1);

      let isEnrolled = Boolean(priorEvents && priorEvents.length > 0);
      if (!isEnrolled && staffRecord.device && (staffRecord.device.includes("device_id:") || staffRecord.device.includes("auth:"))) {
        const { data: attCheck } = await supabase
          .from("attendance_records")
          .select("id")
          .eq("staff_code", staffCode)
          .limit(1);
        if (attCheck && attCheck.length > 0) {
          isEnrolled = true;
        }
      }
      if (!isEnrolled) {
        const { data: attCheck } = await supabase
          .from("attendance_records")
          .select("id")
          .eq("staff_code", staffCode)
          .limit(1);
        if (attCheck && attCheck.length > 0) {
          isEnrolled = true;
        }
      }

      const candidateToken = (body?.oneTimeToken || body?.token || req.headers?.["x-one-time-token"] || "").toString().trim();
      const deviceId = (body?.deviceId || req.headers?.["x-device-id"] || "android-keystore").toString().trim();
      const targetRequestId = (body?.requestId || req.headers?.["x-request-id"] || "").toString().trim();
      const templateCount = typeof body?.templateCount === "number" ? body.templateCount : (typeof body?.count === "number" ? body.count : 5);

      // SECURITY ENFORCEMENT: If already enrolled, replacement requires a fresh, unconsumed administrator approval token
      if (isEnrolled && !candidateToken) {
        return sendJsonResponse(res, 403, {
          success: false,
          error: "Your face registration is locked. A fresh administrator approval is required for face replacement.",
          code: "FACE_REGISTRATION_LOCKED",
          isLocked: true,
        });
      }

      let approvedRow: any = null;

      // Validate candidate token (mandatory for replacement, or for approved initial enrollment)
      if (candidateToken) {
        // Enforce token format
        if (!/^ftok_[a-zA-Z0-9_-]{12,64}$/.test(candidateToken)) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
            code: "INVALID_OR_CONSUMED_TOKEN",
            isLocked: true,
          });
        }

        // Query matching approval request for this staff member
        const { data: matchingRequests, error: checkRowErr } = await supabase
          .from("security_events")
          .select("id, staff, device, result, time, created_at, event")
          .eq("staff", staffCode)
          .eq("result", "Allowed")
          .ilike("device", `%token:${candidateToken}%`)
          .or("event.ilike.FACE_IMAGE_APPROVAL_REQUEST%,event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%")
          .order("created_at", { ascending: false })
          .limit(1);

        if (checkRowErr) {
          return sendJsonResponse(res, 503, {
            success: false,
            error: "Biometric authorization service temporarily unavailable. Safe rollback enforced.",
            code: "RPC_UNAVAILABLE",
            isLocked: true,
          });
        }

        if (!matchingRequests || matchingRequests.length === 0) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
            code: "INVALID_OR_CONSUMED_TOKEN",
            isLocked: true,
          });
        }

        approvedRow = matchingRequests[0];

        // Fail closed if token was already consumed or is not approved
        if (
          !approvedRow ||
          approvedRow.device?.includes("status:consumed") ||
          !approvedRow.device?.includes("status:approved")
        ) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
            code: "INVALID_OR_CONSUMED_TOKEN",
            isLocked: true,
          });
        }

        // Validate request ID binding if specified by client
        if (targetRequestId && targetRequestId !== approvedRow.id) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Authorization token does not match the specified face change request.",
            code: "REQUEST_MISMATCH",
            isLocked: true,
          });
        }

        // Verify device identity binding
        const devMatch = (approvedRow.device || "").match(/device_id:([^|]+)/);
        const boundDev = devMatch && devMatch[1] ? devMatch[1].trim() : "";
        if (boundDev && boundDev !== "android-device" && boundDev !== "android-keystore" && deviceId && boundDev !== deviceId) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Face approval request is bound to a different device identity.",
            code: "DEVICE_MISMATCH",
            isLocked: true,
          });
        }

        // Verify cryptographic template digest binding (Stage 2)
        const digestMatch = (approvedRow.device || "").match(/digest:([^|]+)/);
        const boundDigest = digestMatch && digestMatch[1] ? digestMatch[1].trim() : "";
        const candidateDigest = (body?.digest || req.headers?.["x-digest"] || "").toString().trim();
        if (boundDigest && candidateDigest && boundDigest !== candidateDigest) {
          return sendJsonResponse(res, 403, {
            success: false,
            error: "Cryptographic digest of submitted templates does not match administrator-approved digest.",
            code: "DIGEST_MISMATCH",
            isLocked: true,
          });
        }
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
        // REPLACEMENT SAVE: EXECUTE ATOMIC APPROVAL TOKEN CONSUMPTION
        // ---------------------------------------------------------------------
        const nowIso = new Date().toISOString();

        // 1. Try atomic RPC if available, detecting service connection failure
        if (typeof supabase.rpc === "function") {
          try {
            const rpcRes = await supabase.rpc("atomic_consume_face_approval_token", {
              p_staff_code: staffCode,
              p_token: candidateToken,
              p_device_id: deviceId || "active-device",
              p_sample_count: templateCount,
            });
            if (rpcRes?.error) {
              const errMsg = (rpcRes.error.message || "").toLowerCase();
              if (
                errMsg.includes("connection failure") ||
                errMsg.includes("timeout") ||
                errMsg.includes("unavailable") ||
                errMsg.includes("temporarily")
              ) {
                return sendJsonResponse(res, 503, {
                  success: false,
                  error: "Database or biometric service temporarily unavailable. Safe rollback enforced.",
                  code: "RPC_UNAVAILABLE",
                  isLocked: true,
                });
              }
            } else if (rpcRes?.data === true) {
              // Successfully consumed via atomic RPC
              await supabase.from("security_events").insert({
                time: nowIso,
                staff: staffCode,
                event: `FACE_CHANGE_CONSUMED: One-time approval consumed for device ${deviceId}`,
                device: `device_id:${deviceId}|count:${templateCount}|token:${candidateToken}|request_id:${approvedRow.id}`,
                location: "CampusAttend Biometric System",
                result: "Allowed",
                severity: "Low",
              });

              return sendJsonResponse(res, 200, {
                success: true,
                message: "Face registration updated and permanently locked. Single-use authorization consumed.",
                isLocked: true,
                count: templateCount,
                enrolledCount: templateCount,
                deviceId,
              });
            }
          } catch (rpcEx: any) {
            const msg = (rpcEx?.message || "").toLowerCase();
            if (msg.includes("connection") || msg.includes("timeout") || msg.includes("unavailable")) {
              return sendJsonResponse(res, 503, {
                success: false,
                error: "Database or biometric service temporarily unavailable. Safe rollback enforced.",
                code: "RPC_UNAVAILABLE",
                isLocked: true,
              });
            }
          }
        }

        // 2. Atomic row update: only updates if row still has status:approved and does NOT have status:consumed
        // In PostgreSQL, row-level locks on update serialize concurrent requests.
        let cleanDevice = approvedRow.device
          .replace(/status:approved/g, "status:consumed")
          .replace(/consumed_at:[^|]+/g, "");
        if (!cleanDevice.includes("status:consumed")) {
          cleanDevice += "|status:consumed";
        }
        cleanDevice += `|consumed_at:${nowIso}`;
        if (cleanDevice.length > 250) {
          cleanDevice = `token:${candidateToken}|status:consumed|device_id:${(deviceId || "device").slice(0, 32)}|consumed_at:${nowIso}|count:${templateCount}`;
        }

        const { data: updatedRows, error: updErr } = await supabase
          .from("security_events")
          .update({
            device: cleanDevice,
            time: nowIso,
          })
          .eq("id", approvedRow.id)
          .eq("result", "Allowed")
          .ilike("device", "%status:approved%")
          .not("device", "ilike", "%status:consumed%")
          .select();

        if (updErr) {
          return sendJsonResponse(res, 503, {
            success: false,
            error: "Database or biometric service temporarily unavailable. Safe rollback enforced.",
            code: "RPC_UNAVAILABLE",
            isLocked: true,
          });
        }

        if (!updatedRows || updatedRows.length === 0) {
          return sendJsonResponse(res, 403, {
            success: false,
            code: "INVALID_OR_CONSUMED_TOKEN",
            error: "Invalid, expired, or already consumed face change authorization. Request new administrator approval.",
            isLocked: true,
          });
        }

        // Immutable security audit log
        await supabase.from("security_events").insert({
          time: nowIso,
          staff: staffCode,
          event: `FACE_CHANGE_CONSUMED: One-time approval consumed for device ${deviceId}`,
          device: `device_id:${deviceId}|count:${templateCount}|token:${candidateToken}|request_id:${approvedRow.id}`,
          location: "CampusAttend Biometric System",
          result: "Allowed",
          severity: "Low",
        });

        // Invalidate linked or prior Stage 1 permission requests so they cannot leak as active
        const boundLinkedMatch = (approvedRow.location || "").match(/linked_req:([^|\s)]+)/) ||
                                (approvedRow.device || "").match(/linked_req:([^|\s)]+)/);
        const linkedReqId = boundLinkedMatch ? boundLinkedMatch[1] : null;

        if (linkedReqId) {
          try {
            await supabase
              .from("security_events")
              .update({
                device: `token:consumed|status:consumed|consumed_at:${nowIso}`,
              })
              .eq("id", linkedReqId)
              .ilike("device", "%status:prep_approved%");
          } catch {}
        }

        try {
          await supabase
            .from("security_events")
            .update({
              device: `token:consumed|status:consumed|consumed_at:${nowIso}`,
            })
            .eq("staff", staffCode)
            .ilike("device", "%status:prep_approved%")
            .lte("created_at", approvedRow.created_at || nowIso);
        } catch {}

        return sendJsonResponse(res, 200, {
          success: true,
          message: "Face registration updated and permanently locked. Single-use authorization consumed.",
          isLocked: true,
          count: templateCount,
          enrolledCount: templateCount,
          deviceId,
        });
      }

      // -----------------------------------------------------------------------
      // INITIAL ENROLLMENT: Only allowed if staff has NO prior enrollment
      // -----------------------------------------------------------------------
      if (isEnrolled) {
        return sendJsonResponse(res, 403, {
          success: false,
          code: "FACE_REGISTRATION_LOCKED",
          error: "Your face registration is locked. A fresh administrator approval is required for face replacement.",
          isLocked: true,
        });
      }

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

      let hasEnrollment = Boolean(priorEvents && priorEvents.length > 0);
      if (!hasEnrollment && staffRecord.device && staffRecord.device.includes("device_id:")) {
        hasEnrollment = true;
      }
      if (!hasEnrollment) {
        const { data: attCheck } = await supabase
          .from("attendance_records")
          .select("id")
          .eq("staff_code", staffCode)
          .limit(1);
        if (attCheck && attCheck.length > 0) {
          hasEnrollment = true;
        }
      }

      const isImageApproval =
        body?.action === "request-image-approval" ||
        body?.requestType === "image_approval" ||
        Boolean(body?.digest);

      const rawReason = (body?.reason || "").toString().trim();
      const defaultReason = isImageApproval
        ? "Replacement face images submitted for administrator approval"
        : hasEnrollment
        ? "Face biometric re-enrollment permission request"
        : "Initial face biometric registration";
      const reasonCandidate = rawReason || defaultReason;

      if (reasonCandidate.length < 5 || reasonCandidate.length > 250) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Reason must be between 5 and 250 characters.",
        });
      }

      const deviceId = (body?.deviceId || req.headers?.["x-device-id"] || "android-device").toString().trim();
      const sampleCount =
        typeof body?.sampleCount === "number"
          ? body.sampleCount
          : typeof body?.templateCount === "number"
          ? body.templateCount
          : 1;

      const digest = (body?.digest || req.headers?.["x-digest"] || "").toString().trim();
      const linkedRequestId = (body?.linkedRequestId || body?.permissionRequestId || "").toString().trim();

      if (isImageApproval && !digest) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Cryptographic digest of staged face templates is required for replacement image approval.",
        });
      }

      // Check if a pending request already exists for this staff member
      const { data: existingPending } = await supabase
        .from("security_events")
        .select("id, created_at, event, device")
        .eq("staff", staffCode)
        .eq("result", "Flagged")
        .or("event.ilike.FACE_PERMISSION_REQUEST%,event.ilike.FACE_IMAGE_APPROVAL_REQUEST%,event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%")
        .maybeSingle();

      if (existingPending) {
        return sendJsonResponse(res, 409, {
          success: false,
          error: "A face approval request is already pending administrator approval. Please wait for a decision.",
          requestId: existingPending.id,
        });
      }

      const nowIso = new Date().toISOString();
      let reqType: string;
      let eventPrefix: string;
      let devicePayload: string;

      if (isImageApproval) {
        reqType = "image_approval";
        eventPrefix = "FACE_IMAGE_APPROVAL_REQUEST";
        devicePayload = `status:pending|device_id:${deviceId}|count:${sampleCount}|type:image_approval|linked_req:${linkedRequestId}|digest:${digest}`;
      } else if (hasEnrollment) {
        reqType = "permission_request";
        eventPrefix = "FACE_PERMISSION_REQUEST";
        devicePayload = `status:pending|device_id:${deviceId}|count:1|type:permission_request`;
      } else {
        reqType = "initial";
        eventPrefix = "FACE_ENROLLMENT_REQUEST";
        devicePayload = `status:pending|device_id:${deviceId}|count:${sampleCount}|type:initial`;
      }

      const { data: createdReq, error: reqInsErr } = await supabase
        .from("security_events")
        .insert({
          time: nowIso,
          staff: staffCode,
          event: `${eventPrefix}: ${reasonCandidate.slice(0, 180)}`,
          device: devicePayload,
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
        message: isImageApproval
          ? "Replacement face images submitted successfully. Awaiting administrator approval."
          : hasEnrollment
          ? "Face re-enrollment permission request submitted successfully. Awaiting administrator approval."
          : "Face enrollment request submitted successfully. Awaiting administrator approval.",
        requestId: createdReq.id,
        request: {
          id: createdReq.id,
          status: "pending",
          reason: reasonCandidate,
          deviceId,
          sampleCount: isImageApproval ? sampleCount : 1,
          requestType: reqType,
          linkedRequestId: linkedRequestId || undefined,
          digest: digest || undefined,
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
        .or("event.ilike.FACE_PERMISSION_REQUEST%,event.ilike.FACE_IMAGE_APPROVAL_REQUEST%,event.ilike.FACE_CHANGE_REQUEST%,event.ilike.FACE_ENROLLMENT_REQUEST%");

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
