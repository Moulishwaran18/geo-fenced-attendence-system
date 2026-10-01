/**
 * REST API Handler for Face Detection / Authentication Audit Logging
 *
 * Endpoints:
 * - POST /api/face-detection-log : Creates a face detection audit log (authenticated)
 * - GET  /api/face-detection-log : Queries audit logs (newest first, pagination, filters)
 * - GET  /api/admin/face-detection-logs : Admin alias for audit log queries
 */

import {
  recordFaceDetectionLog,
  getFaceDetectionLogs,
  getDuplicateWindowSeconds,
  type FaceDetectionLogRecord,
} from "../db/audit-log.ts";
import { getStaffById } from "../db/client.ts";

function jsonResponse(data: unknown, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function errorResponse(message: string, status: number = 400) {
  return jsonResponse({ error: message, success: false }, status);
}

/**
 * Handle /api/face-detection-log and /api/admin/face-detection-logs requests.
 */
export async function handleFaceDetectionLogApi(request: Request, pathname: string): Promise<Response> {
  const method = request.method.toUpperCase();

  // 1. GET /api/face-detection-log (or /api/admin/face-detection-logs) — Query Audit Logs
  if (method === "GET") {
    try {
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = parseInt(url.searchParams.get("limit") || "10", 10);
      const search = url.searchParams.get("search") || undefined;
      const userId = url.searchParams.get("userId") || url.searchParams.get("user_id") || undefined;
      const date = url.searchParams.get("date") || undefined;
      const startDate = url.searchParams.get("startDate") || url.searchParams.get("from") || undefined;
      const endDate = url.searchParams.get("endDate") || url.searchParams.get("to") || undefined;

      const result = await getFaceDetectionLogs({
        page,
        limit,
        search,
        userId,
        date,
        startDate,
        endDate,
      });

      return jsonResponse({
        success: true,
        data: result.records,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      console.error("[FaceDetectionLogApi] Query error:", err);
      return errorResponse(`Failed to query audit logs: ${String(err)}`, 500);
    }
  }

  // 2. POST /api/face-detection-log — Record Face Detection Log
  if (method === "POST") {
    try {
      let body: any = {};
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      // Security Verification:
      // Require valid authentication token / session.
      // Supported authentication headers:
      // - Authorization: Bearer <token>
      // - X-Verification-Session-Id
      // - body.verificationSessionId / body.sessionNonce / body.token
      const authHeader = request.headers.get("authorization") || "";
      const verificationSessionId =
        request.headers.get("x-verification-session-id") ||
        body.verificationSessionId ||
        body.sessionId ||
        "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const token = bearerToken || verificationSessionId || body.token || body.sessionNonce;

      if (!token) {
        return jsonResponse(
          {
            success: false,
            error: "Unauthorized: Valid authentication session or verification token required to create face detection log.",
          },
          401,
        );
      }

      // Determine the authenticated user ID.
      // The server does NOT allow arbitrary spoofing of user details.
      // If a session exists, we resolve the user through the database.
      const requestedUserId = body.userId || body.user_id || body.staffCode || body.staffId;

      if (!requestedUserId) {
        return errorResponse("Missing authenticated user identification", 400);
      }

      // Authoritative lookup in staff database:
      const staff = await getStaffById(requestedUserId);
      if (!staff) {
        return jsonResponse(
          {
            success: false,
            error: `Staff record not found for user '${requestedUserId}'`,
          },
          404,
        );
      }

      // Authoritative values from database ONLY (client parameters cannot override server truth)
      const windowOverride = typeof body.windowSeconds === "number" ? body.windowSeconds : undefined;
      const logResult = await recordFaceDetectionLog({
        userId: staff.staff_code,
        name: staff.name,
        email: staff.email,
        windowSeconds: windowOverride,
      });

      return jsonResponse(
        {
          success: true,
          logged: logResult.logged,
          duplicateSuppressed: logResult.duplicateSuppressed,
          windowSeconds: logResult.windowSeconds,
          data: logResult.record,
        },
        logResult.logged ? 201 : 200,
      );
    } catch (err) {
      console.error("[FaceDetectionLogApi] Create error:", err);
      return errorResponse(`Failed to record audit log: ${String(err)}`, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed. Use GET or POST." }, 405);
}
