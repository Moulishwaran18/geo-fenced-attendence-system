/**
 * REST API Handlers for Admin Staff Management & Biometric Enrollment
 *
 * Endpoints:
 * - GET /api/admin/staff
 * - POST /api/admin/staff
 * - GET /api/admin/staff/:id
 * - PATCH /api/admin/staff/:id/status
 * - POST /api/admin/staff/:id/face-enrollment
 * - DELETE /api/admin/staff/:id/embeddings/:embeddingId
 */

import {
  getAllStaff,
  getStaffById,
  createStaff,
  updateStaffStatus,
  storeFaceEmbedding,
  deleteFaceEmbedding,
  getDatabaseDiagnostics,
} from "../db/client";

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

export async function handleStaffApi(request: Request, pathname: string): Promise<Response> {
  const method = request.method.toUpperCase();

  // 0. GET /api/admin/db-diagnostic — Verify database connection and diagnostic state
  if (pathname === "/api/admin/db-diagnostic" && method === "GET") {
    try {
      const diag = await getDatabaseDiagnostics();
      return jsonResponse({
        success: true,
        data: diag,
      });
    } catch (err) {
      return errorResponse(`Database diagnostic error: ${String(err)}`, 500);
    }
  }

  // 1. GET /api/admin/staff — List all staff with enrollment status
  if (pathname === "/api/admin/staff" && method === "GET") {
    try {
      const staffList = await getAllStaff();
      return jsonResponse({
        success: true,
        count: staffList.length,
        data: staffList,
      });
    } catch (err) {
      console.error("GET /api/admin/staff error:", err);
      return errorResponse("Failed to fetch staff directory", 500);
    }
  }

  // 2. POST /api/admin/staff — Create new staff member (e.g. PERSON_004+)
  if (pathname === "/api/admin/staff" && method === "POST") {
    try {
      const body = (await request.json()) as {
        staff_code?: string;
        name?: string;
        email?: string;
        department?: string;
        designation?: string;
        active?: boolean;
      };

      if (!body.staff_code || !body.name || !body.email) {
        return errorResponse("Missing required fields: staff_code, name, email are required.", 400);
      }

      const created = await createStaff({
        staff_code: body.staff_code.trim().toUpperCase(),
        name: body.name.trim(),
        email: body.email.trim().toLowerCase(),
        department: body.department?.trim() || "General Administration",
        designation: body.designation?.trim() || "Staff",
        active: body.active !== undefined ? body.active : true,
      });

      return jsonResponse({ success: true, data: created }, 201);
    } catch (err) {
      console.error("POST /api/admin/staff error:", err);
      return errorResponse(`Failed to create staff member: ${String(err)}`, 500);
    }
  }

  // Dynamic route matcher: /api/admin/staff/:id/...
  const staffIdMatch = pathname.match(/^\/api\/admin\/staff\/([^/]+)(\/.*)?$/);
  if (!staffIdMatch) {
    return errorResponse("Endpoint not found", 404);
  }

  const staffIdOrCode = decodeURIComponent(staffIdMatch[1]!);
  const subRoute = staffIdMatch[2] || "";

  // 3. GET /api/admin/staff/:id — Single staff details
  if (subRoute === "" && method === "GET") {
    try {
      const staff = await getStaffById(staffIdOrCode);
      if (!staff) return errorResponse(`Staff '${staffIdOrCode}' not found`, 404);
      return jsonResponse({ success: true, data: staff });
    } catch (err) {
      return errorResponse(`Failed to fetch staff record: ${String(err)}`, 500);
    }
  }

  // 4. PATCH /api/admin/staff/:id/status — Activate / Deactivate staff
  if (subRoute === "/status" && (method === "PATCH" || method === "POST")) {
    try {
      const body = (await request.json()) as { active?: boolean };
      if (body.active === undefined) {
        return errorResponse("Missing 'active' boolean flag in request body", 400);
      }
      const updated = await updateStaffStatus(staffIdOrCode, body.active);
      if (!updated) return errorResponse(`Staff '${staffIdOrCode}' not found`, 404);
      return jsonResponse({ success: true, data: updated });
    } catch (err) {
      return errorResponse(`Failed to update staff status: ${String(err)}`, 500);
    }
  }

  // 5. POST /api/admin/staff/:id/face-enrollment — Enroll reference embedding
  if (subRoute === "/face-enrollment" && method === "POST") {
    try {
      const staff = await getStaffById(staffIdOrCode);
      if (!staff) {
        return errorResponse(`Staff '${staffIdOrCode}' not found. Cannot enroll face.`, 404);
      }

      const body = (await request.json()) as {
        descriptor?: number[];
        referenceImagePath?: string;
      };

      if (!body.descriptor || !Array.isArray(body.descriptor) || body.descriptor.length !== 512) {
        return errorResponse(
          `Invalid embedding descriptor. Must be 512-dimensional float array. Received length: ${body.descriptor?.length ?? 0}`,
          400,
        );
      }

      const imagePath =
        body.referenceImagePath ||
        `/staff-photos/${staff.staff_code.toLowerCase()}/custom_${Date.now()}.jpg`;

      const saved = await storeFaceEmbedding(staff.id, body.descriptor, imagePath);

      // Ensure staff is marked active upon valid enrollment
      await updateStaffStatus(staff.id, true);

      return jsonResponse({
        success: true,
        message: `Face embedding successfully enrolled for ${staff.staff_code} (${staff.name})`,
        data: {
          id: saved.id,
          staff_id: saved.staff_id,
          reference_image_path: saved.reference_image_path,
          created_at: saved.created_at,
        },
      });
    } catch (err) {
      console.error("Enrollment error:", err);
      return errorResponse(`Face enrollment failed: ${String(err)}`, 500);
    }
  }

  // 6. DELETE /api/admin/staff/:id/embeddings/:embeddingId — Remove embedding
  const deleteMatch = subRoute.match(/^\/embeddings\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const embeddingId = decodeURIComponent(deleteMatch[1]!);
    try {
      const removed = await deleteFaceEmbedding(embeddingId);
      return jsonResponse({ success: removed });
    } catch (err) {
      return errorResponse(`Failed to delete embedding: ${String(err)}`, 500);
    }
  }

  return errorResponse("Method or endpoint not supported", 404);
}
