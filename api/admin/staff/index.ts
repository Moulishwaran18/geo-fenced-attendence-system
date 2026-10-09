/**
 * Vercel Serverless Function: /api/admin/staff
 *
 * Handles staff management, enrollment, and status for CampusAttend via Supabase Cloud.
 */

import { createClient } from "@supabase/supabase-js";

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

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      success: false,
      error: "Database configuration unavailable on server",
    });
  }

  let pathname = req.url || "/api/admin/staff";
  try {
    pathname = new URL(pathname, "https://localhost").pathname;
  } catch {}

  if (req.query?.slug) {
    const slugParts = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    if (slugParts.length > 0 && !pathname.includes(slugParts[0]!)) {
      pathname = "/api/admin/staff/" + slugParts.join("/");
    }
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

  try {
    // 1. GET /api/admin/staff — List all staff with enrollment metadata
    if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "GET") {
      const { data, error } = await supabase
        .from("staff")
        .select(
          "id, staff_code, name, email, department, designation, active, created_at, updated_at, face_embeddings(id, staff_id, reference_image_path, photo_data, created_at)",
        )
        .order("staff_code", { ascending: true });

      if (error) {
        return sendJsonResponse(res, 500, { success: false, error: error.message });
      }

      const staffList = (data || []).map((s: any) => ({
        id: s.id,
        staff_code: s.staff_code,
        name: s.name,
        email: s.email,
        department: s.department,
        designation: s.designation,
        active: s.active,
        created_at: s.created_at,
        updated_at: s.updated_at,
        embeddingCount: s.face_embeddings?.length || 0,
        referenceSamples: (s.face_embeddings || []).map((f: any) => ({
          id: f.id,
          staff_id: f.staff_id,
          embedding: [], // Omit raw vector for privacy
          reference_image_path: f.reference_image_path,
          photo_data: f.photo_data,
          created_at: f.created_at,
        })),
      }));

      return sendJsonResponse(res, 200, {
        success: true,
        count: staffList.length,
        data: staffList,
      });
    }

    // 2. POST /api/admin/staff — Create new staff member
    if ((pathname === "/api/admin/staff" || pathname === "/api/admin/staff/") && method === "POST") {
      if (!body?.staff_code || !body?.name || !body?.email) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Missing required fields: staff_code, name, email are required.",
        });
      }

      const { data, error } = await supabase
        .from("staff")
        .upsert(
          {
            staff_code: body.staff_code.trim().toUpperCase(),
            name: body.name.trim(),
            email: body.email.trim(),
            department: body.department?.trim() || "General",
            designation: body.designation?.trim() || "Staff",
            active: body.active !== undefined ? body.active : true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "staff_code" },
        )
        .select()
        .single();

      if (error) {
        return sendJsonResponse(res, 500, { success: false, error: error.message });
      }

      return sendJsonResponse(res, 201, { success: true, data });
    }

    // 3. Database diagnostics: /api/admin/db-diagnostic
    if (pathname.includes("/db-diagnostic") && method === "GET") {
      const { count: staffCount } = await supabase.from("staff").select("*", { count: "exact", head: true });
      const { count: embCount } = await supabase.from("face_embeddings").select("*", { count: "exact", head: true });

      return sendJsonResponse(res, 200, {
        success: true,
        data: {
          status: "CONNECTED",
          databaseType: "Supabase (Cloud Managed PostgreSQL + pgvector)",
          host: "qvjcxoznvhoagclbyhad.supabase.co",
          port: 443,
          databaseName: "postgres",
          staffCount: staffCount ?? 0,
          totalEmbeddingCount: embCount ?? 0,
          activeEmbeddingCount: embCount ?? 0,
          pgvector: "ENABLED",
          activeSource: "Supabase Cloud Database (Live Production)",
        },
      });
    }

    // 4. Enroll face: /api/admin/staff/:id/enroll OR /face-enrollment
    const enrollMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/(?:enroll|face-enrollment)\/?$/);
    if (enrollMatch && method === "POST") {
      const idOrCode = decodeURIComponent(enrollMatch[1]!);
      const embedding = body?.embedding || body?.descriptor;

      if (!Array.isArray(embedding) || embedding.length !== 512) {
        return sendJsonResponse(res, 400, {
          success: false,
          error: "Invalid face embedding. Expected 512-dimensional array.",
        });
      }

      // Resolve staff id
      let staffId = idOrCode;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
      if (!isUuid) {
        const { data: s } = await supabase.from("staff").select("id").eq("staff_code", idOrCode.toUpperCase()).single();
        if (s?.id) staffId = s.id;
        else {
          return sendJsonResponse(res, 404, { success: false, error: `Staff member not found for code: ${idOrCode}` });
        }
      }

      const { data: newEmb, error: embError } = await supabase
        .from("face_embeddings")
        .insert({
          staff_id: staffId,
          embedding,
          reference_image_path: body.referenceImagePath || "enrollment/live_capture.jpg",
          photo_data: body.photoData || null,
        })
        .select()
        .single();

      if (embError) {
        return sendJsonResponse(res, 500, { success: false, error: embError.message });
      }

      return sendJsonResponse(res, 200, {
        success: true,
        message: "Face embedding enrolled successfully",
        data: {
          id: newEmb.id,
          staff_id: newEmb.staff_id,
          reference_image_path: newEmb.reference_image_path,
          created_at: newEmb.created_at,
        },
      });
    }

    // 5. Delete embedding: /api/admin/staff/:id/embedding/:embeddingId OR /embeddings/:id
    const deleteMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/(?:embedding|embeddings)\/([^/]+)\/?$/);
    if (deleteMatch && method === "DELETE") {
      const embeddingId = decodeURIComponent(deleteMatch[2]!);
      const { error: delError } = await supabase.from("face_embeddings").delete().eq("id", embeddingId);
      if (delError) {
        return sendJsonResponse(res, 500, { success: false, error: delError.message });
      }
      return sendJsonResponse(res, 200, { success: true, message: "Embedding deleted successfully" });
    }

    // 6. Toggle status: /api/admin/staff/:id/status
    const statusMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/status\/?$/);
    if (statusMatch && (method === "PATCH" || method === "POST")) {
      const idOrCode = decodeURIComponent(statusMatch[1]!);
      const active = typeof body?.active === "boolean" ? body.active : true;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

      let query = supabase.from("staff").update({ active, updated_at: new Date().toISOString() });
      if (isUuid) {
        query = query.eq("id", idOrCode);
      } else {
        query = query.eq("staff_code", idOrCode.toUpperCase());
      }
      const { data: updated, error: statErr } = await query.select().single();
      if (statErr) {
        return sendJsonResponse(res, 500, { success: false, error: statErr.message });
      }
      return sendJsonResponse(res, 200, { success: true, data: updated });
    }

    // 7. Get single staff: /api/admin/staff/:id
    const singleMatch = pathname.match(/\/api\/admin\/staff\/([^/]+)\/?$/);
    if (singleMatch && method === "GET") {
      const idOrCode = decodeURIComponent(singleMatch[1]!);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

      let query = supabase
        .from("staff")
        .select(
          "id, staff_code, name, email, department, designation, active, created_at, updated_at, face_embeddings(id, staff_id, reference_image_path, photo_data, created_at)",
        );
      if (isUuid) {
        query = query.eq("id", idOrCode);
      } else {
        query = query.eq("staff_code", idOrCode.toUpperCase());
      }
      const { data: staffMember, error: findErr } = await query.single();
      if (findErr || !staffMember) {
        return sendJsonResponse(res, 404, { success: false, error: "Staff member not found" });
      }

      return sendJsonResponse(res, 200, {
        success: true,
        data: {
          ...staffMember,
          embeddingCount: staffMember.face_embeddings?.length || 0,
          referenceSamples: (staffMember.face_embeddings || []).map((f: any) => ({
            id: f.id,
            staff_id: f.staff_id,
            embedding: [],
            reference_image_path: f.reference_image_path,
            photo_data: f.photo_data,
            created_at: f.created_at,
          })),
        },
      });
    }

    return sendJsonResponse(res, 404, { success: false, error: `Route not found: ${pathname}` });
  } catch (err: any) {
    console.error("Staff API error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: err?.message || "Internal server error",
    });
  }
}
