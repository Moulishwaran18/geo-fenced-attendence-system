/**
 * REST API Handlers for Admin Staff Management & Biometric Enrollment
 *
 * Endpoints:
 * - GET /api/admin/staff
 * - POST /api/admin/staff
 * - GET /api/admin/staff/:id
 * - PATCH /api/admin/staff/:id/status
 * - POST /api/admin/staff/:id/enroll (and /face-enrollment)
 * - DELETE /api/admin/staff/:id/embedding/:embeddingId (and /embeddings/:embeddingId)
 * - GET /api/admin/db-diagnostic
 */

import {
  getAllStaff,
  getStaffById,
  createStaff,
  updateStaffStatus,
  storeFaceEmbedding,
  deleteFaceEmbedding,
  getDatabaseDiagnostics,
} from "../db/client.ts";

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

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
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
  return jsonResponse(payload, status);
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
    } catch (err: any) {
      return errorResponse(`Database diagnostic error: ${err?.message || String(err)}`, 500);
    }
  }

  // 1. GET /api/admin/staff — List all staff with enrollment status
  if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "GET") {
    try {
      const staffList = await getAllStaff();
      return jsonResponse({
        success: true,
        count: staffList.length,
        data: staffList,
      });
    } catch (err: any) {
      console.error("GET /api/admin/staff error:", err?.message || err);
      return errorResponse("Failed to fetch staff directory", 500);
    }
  }

  // 2. POST /api/admin/staff — Create new staff member
  if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "POST") {
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
    } catch (err: any) {
      console.error("POST /api/admin/staff error:", err?.message || err);
      return errorResponse(`Failed to create staff member: ${err?.message || String(err)}`, 500);
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
    } catch (err: any) {
      return errorResponse(`Failed to fetch staff record: ${err?.message || String(err)}`, 500);
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
    } catch (err: any) {
      return errorResponse(`Failed to update staff status: ${err?.message || String(err)}`, 500);
    }
  }

  // 5. POST /api/admin/staff/:id/enroll OR /face-enrollment — Enroll reference embedding
  if ((subRoute === "/enroll" || subRoute === "/face-enrollment") && method === "POST") {
    try {
      const staff = await getStaffById(staffIdOrCode);
      if (!staff) {
        return errorResponse(`Staff '${staffIdOrCode}' not found. Cannot enroll face.`, 404);
      }

      const body = (await request.json()) as {
        embedding?: number[];
        descriptor?: number[];
        referenceImagePath?: string;
        photoData?: string;
      };

      const embeddingList = body.embedding || body.descriptor;
      if (!embeddingList || !Array.isArray(embeddingList) || embeddingList.length !== 512) {
        return errorResponse(
          `Invalid embedding descriptor. Must be 512-dimensional float array. Received length: ${embeddingList?.length ?? 0}`,
          400,
        );
      }

      for (let i = 0; i < embeddingList.length; i++) {
        const v = embeddingList[i];
        if (typeof v !== "number" || isNaN(v) || !isFinite(v)) {
          return errorResponse(`Invalid embedding value at index ${i}. Must be finite number.`, 400);
        }
      }

      const norm = Math.sqrt(embeddingList.reduce((s, v) => s + v * v, 0));
      if (norm < 0.7 || norm > 1.3) {
        return errorResponse(`Invalid embedding normalization. Expected L2 norm near 1.0, got ${norm.toFixed(4)}.`, 400);
      }

      const imagePath =
        body.referenceImagePath ||
        `/staff-photos/${staff.staff_code.toLowerCase()}/custom_${Date.now()}.jpg`;

      const saved = await storeFaceEmbedding(staff.id, embeddingList, imagePath, body.photoData);

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
    } catch (err: any) {
      console.error("Enrollment error:", err?.message || err);
      return errorResponse(`Face enrollment failed: ${err?.message || String(err)}`, 500);
    }
  }

  // 6. DELETE /api/admin/staff/:id/embedding/:embeddingId OR /embeddings/:embeddingId
  const deleteMatch = subRoute.match(/^\/embeddings?\/([^/]+)$/);
  if (deleteMatch && method === "DELETE") {
    const embeddingId = decodeURIComponent(deleteMatch[1]!);
    try {
      const removed = await deleteFaceEmbedding(embeddingId);
      return jsonResponse({ success: removed });
    } catch (err: any) {
      return errorResponse(`Failed to delete embedding: ${err?.message || String(err)}`, 500);
    }
  }

  return errorResponse("Method or endpoint not supported", 404);
}

/**
 * Universal Vercel / Node Serverless Function Handler
 */
export default async function handler(req: any, res?: any) {
  const method = req.method?.toUpperCase() || "GET";
  let pathname = "/api/admin/staff";

  if (req.url) {
    try {
      const url = new URL(req.url, "https://localhost");
      pathname = url.pathname;
    } catch {
      pathname = req.url.split("?")[0] || "/api/admin/staff";
    }
  }

  // Handle Vercel dynamic route slug if present in query
  if (req.query?.slug) {
    const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    pathname = "/api/admin/" + slugParts.join("/");
  }

  let body: any = undefined;
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

  const reqInit: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) {
    reqInit.body = JSON.stringify(body);
  }

  const reqObj = new Request(`https://localhost${pathname}`, reqInit);
  const webRes = await handleStaffApi(reqObj, pathname);
  const data = await webRes.json().catch(() => ({}));
  return sendJsonResponse(res, webRes.status, data);
}
