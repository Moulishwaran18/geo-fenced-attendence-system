/**
 * Database client for CampusAttend — Scalable Staff Face Database.
 *
 * Multi-Tier Database Architecture:
 * 1. Direct PostgreSQL Pool (via DATABASE_URL or PG* env variables with pgvector)
 * 2. Managed Supabase Cloud (via SUPABASE_URL and SUPABASE_ANON_KEY / SERVICE_ROLE_KEY)
 * 3. Local JSON Fallback Store (for offline local developer mode)
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const { Pool } = pg;

export interface StaffRecord {
  id: string;
  staff_code: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FaceEmbeddingRecord {
  id: string;
  staff_id: string;
  staff_code?: string;
  embedding: number[]; // 512-float descriptor
  reference_image_path: string;
  photo_data?: string | undefined; // Base64 JPEG data URL stored directly in database
  created_at: string;
}

export interface StaffWithEmbeddings extends StaffRecord {
  referenceSamples: FaceEmbeddingRecord[];
  embeddingCount: number;
}

export interface VectorSearchResult {
  staff_id: string;
  staff_code: string;
  name: string;
  distance: number;
  embedding_id: string;
  reference_image_path: string;
  photo_data?: string | undefined;
}

// -----------------------------------------------------------------------------
// Environment & Connection Pool Initialization
// -----------------------------------------------------------------------------

function ensureEnvLoaded() {
  if (!process.env["DATABASE_URL"] && !process.env["SUPABASE_URL"]) {
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, "utf-8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const [key, ...vals] = trimmed.split("=");
            if (key && vals.length > 0 && !process.env[key.trim()]) {
              process.env[key.trim()] = vals.join("=").trim();
            }
          }
        }
      }
    } catch {
      // Ignore env read failure
    }
  }
}

let pool: pg.Pool | null = null;
let pgPoolFailed = false;

function markPgError(err: any) {
  if (
    err &&
    (err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "ETIMEDOUT" ||
      err.message?.includes("connect") ||
      err.message?.includes("Connection refused") ||
      err.message?.includes("timeout"))
  ) {
    pgPoolFailed = true;
    if (pool) {
      pool.end().catch(() => {});
      pool = null;
    }
  }
}

export function getPgPool(): pg.Pool | null {
  if (pgPoolFailed) return null;
  if (pool) return pool;
  ensureEnvLoaded();
  const currentDbUrl = process.env["DATABASE_URL"] || "";
  if (currentDbUrl || (process.env["PGHOST"] && process.env["PGDATABASE"])) {
    try {
      pool = new Pool({
        connectionString: currentDbUrl || undefined,
        host: process.env["PGHOST"],
        port: process.env["PGPORT"] ? parseInt(process.env["PGPORT"], 10) : 5432,
        user: process.env["PGUSER"],
        password: process.env["PGPASSWORD"],
        database: process.env["PGDATABASE"],
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000,
      });
      return pool;
    } catch (err) {
      console.warn("Failed to initialize PostgreSQL pool:", err);
      return null;
    }
  }
  return null;
}

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  ensureEnvLoaded();
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"])) ||
    "";
  if (url && key) {
    try {
      supabaseClient = createClient(url, key, {
        auth: { persistSession: false },
      });
      return supabaseClient;
    } catch (err) {
      console.warn("Failed to initialize Supabase client:", err);
      return null;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Persistent Local Dev Store (Fallback when PostgreSQL and Supabase are not active)
// -----------------------------------------------------------------------------

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

interface LocalStoreSchema {
  staff: StaffRecord[];
  face_embeddings: FaceEmbeddingRecord[];
}

function ensureDataDir() {
  const dir = path.dirname(LOCAL_STORE_PATH);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore if filesystem is read-only (e.g. Vercel)
    }
  }
}

function readLocalStore(): LocalStoreSchema {
  ensureDataDir();
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    // Read-only or missing
  }
  return { staff: [], face_embeddings: [] };
}

function writeLocalStore(data: LocalStoreSchema) {
  ensureDataDir();
  try {
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    // Ignore in read-only environment
  }
}

// -----------------------------------------------------------------------------
// Cosine Distance Helper for ArcFace 512-D Vector Matching
// -----------------------------------------------------------------------------

export function calculateCosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1.0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const similarity = dot / denom;
  const clamped = Math.max(-1.0, Math.min(1.0, similarity));
  return 1.0 - clamped;
}

export function calculateEuclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 999;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// -----------------------------------------------------------------------------
// Data Access API
// -----------------------------------------------------------------------------

/**
 * Get all staff with their enrollment counts (embeddings not included in full for security).
 */
export async function getAllStaff(): Promise<StaffWithEmbeddings[]> {
  const p = getPgPool();
  if (p) {
    try {
      const query = `
        SELECT 
          s.id, s.staff_code, s.name, s.email, s.department, s.designation, s.active, s.created_at, s.updated_at,
          COUNT(f.id)::int AS "embeddingCount",
          COALESCE(
            json_agg(
              json_build_object(
                'id', f.id,
                'staff_id', f.staff_id,
                'reference_image_path', f.reference_image_path,
                'photo_data', f.photo_data,
                'created_at', f.created_at
              )
            ) FILTER (WHERE f.id IS NOT NULL),
            '[]'
          ) AS "referenceSamples"
        FROM staff s
        LEFT JOIN face_embeddings f ON s.id = f.staff_id
        GROUP BY s.id
        ORDER BY s.staff_code ASC;
      `;
      const res = await p.query(query);
      return res.rows;
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL getAllStaff failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("staff")
        .select(
          "id, staff_code, name, email, department, designation, active, created_at, updated_at, face_embeddings(id, staff_id, reference_image_path, photo_data, created_at)",
        )
        .order("staff_code", { ascending: true });

      if (!error && Array.isArray(data)) {
        return data.map((s: any) => ({
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
            embedding: [],
            reference_image_path: f.reference_image_path,
            photo_data: f.photo_data,
            created_at: f.created_at,
          })),
        }));
      }
    } catch (sbErr) {
      console.warn("Supabase getAllStaff failed:", sbErr);
    }
  }

  // Dev-only Fallback (only when PostgreSQL and Supabase are offline)
  const store = readLocalStore();
  return store.staff.map((s) => {
    const samples = store.face_embeddings
      .filter((f) => f.staff_id === s.id)
      .map((f) => ({
        id: f.id,
        staff_id: f.staff_id,
        embedding: [],
        reference_image_path: f.reference_image_path,
        photo_data: f.photo_data,
        created_at: f.created_at,
      }));

    return {
      ...s,
      referenceSamples: samples,
      embeddingCount: samples.length,
    };
  });
}

/**
 * Get a single staff member by ID or Staff Code with their reference samples.
 */
export async function getStaffById(idOrCode: string): Promise<StaffWithEmbeddings | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
  const p = getPgPool();
  if (p) {
    try {
      const whereClause = isUuid ? "s.id = $1" : "s.staff_code = $1";
      const query = `
        SELECT 
          s.id, s.staff_code, s.name, s.email, s.department, s.designation, s.active, s.created_at, s.updated_at,
          COUNT(f.id)::int AS "embeddingCount",
          COALESCE(
            json_agg(
              json_build_object(
                'id', f.id,
                'staff_id', f.staff_id,
                'reference_image_path', f.reference_image_path,
                'photo_data', f.photo_data,
                'created_at', f.created_at
              )
            ) FILTER (WHERE f.id IS NOT NULL),
            '[]'
          ) AS "referenceSamples"
        FROM staff s
        LEFT JOIN face_embeddings f ON s.id = f.staff_id
        WHERE ${whereClause}
        GROUP BY s.id;
      `;
      const res = await p.query(query, [isUuid ? idOrCode : idOrCode.toUpperCase()]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL getStaffById failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
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
      const { data, error } = await query.single();
      if (!error && data) {
        return {
          id: data.id,
          staff_code: data.staff_code,
          name: data.name,
          email: data.email,
          department: data.department,
          designation: data.designation,
          active: data.active,
          created_at: data.created_at,
          updated_at: data.updated_at,
          embeddingCount: data.face_embeddings?.length || 0,
          referenceSamples: (data.face_embeddings || []).map((f: any) => ({
            id: f.id,
            staff_id: f.staff_id,
            embedding: [],
            reference_image_path: f.reference_image_path,
            photo_data: f.photo_data,
            created_at: f.created_at,
          })),
        };
      }
    } catch (sbErr) {
      console.warn("Supabase getStaffById failed:", sbErr);
    }
  }

  // Dev-only Fallback
  const store = readLocalStore();
  const staff = store.staff.find(
    (s) => s.id === idOrCode || s.staff_code.toUpperCase() === idOrCode.toUpperCase(),
  );
  if (!staff) return null;

  const samples = store.face_embeddings
    .filter((f) => f.staff_id === staff.id)
    .map((f) => ({
      id: f.id,
      staff_id: f.staff_id,
      embedding: [],
      reference_image_path: f.reference_image_path,
      photo_data: f.photo_data,
      created_at: f.created_at,
    }));

  return {
    ...staff,
    referenceSamples: samples,
    embeddingCount: samples.length,
  };
}

/**
 * Create or upsert a staff member.
 */
export async function createStaff(data: {
  staff_code: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  active?: boolean;
}): Promise<StaffRecord> {
  const p = getPgPool();
  if (p) {
    try {
      const query = `
        INSERT INTO staff (staff_code, name, email, department, designation, active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (staff_code) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email, department = EXCLUDED.department, designation = EXCLUDED.designation, updated_at = NOW()
        RETURNING *;
      `;
      const res = await p.query(query, [
        data.staff_code,
        data.name,
        data.email,
        data.department,
        data.designation,
        data.active !== undefined ? data.active : true,
      ]);
      return res.rows[0];
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL createStaff failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data: resData, error } = await supabase
        .from("staff")
        .upsert(
          {
            staff_code: data.staff_code,
            name: data.name,
            email: data.email,
            department: data.department,
            designation: data.designation,
            active: data.active !== undefined ? data.active : true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "staff_code" },
        )
        .select()
        .single();

      if (!error && resData) {
        return resData;
      }
    } catch (sbErr) {
      console.warn("Supabase createStaff failed:", sbErr);
    }
  }

  const store = readLocalStore();
  const existingIdx = store.staff.findIndex(
    (s) => s.staff_code.toUpperCase() === data.staff_code.toUpperCase(),
  );

  const now = new Date().toISOString();
  if (existingIdx >= 0 && store.staff[existingIdx]) {
    const updated = {
      ...store.staff[existingIdx]!,
      name: data.name,
      email: data.email,
      department: data.department,
      designation: data.designation,
      active: data.active !== undefined ? data.active : store.staff[existingIdx]!.active,
      updated_at: now,
    };
    store.staff[existingIdx] = updated;
    writeLocalStore(store);
    return updated;
  }

  const newStaff: StaffRecord = {
    id: `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    staff_code: data.staff_code,
    name: data.name,
    email: data.email,
    department: data.department,
    designation: data.designation,
    active: data.active !== undefined ? data.active : true,
    created_at: now,
    updated_at: now,
  };
  store.staff.push(newStaff);
  writeLocalStore(store);
  return newStaff;
}

/**
 * Update staff active/inactive status.
 */
export async function updateStaffStatus(idOrCode: string, active: boolean): Promise<StaffRecord | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
  const p = getPgPool();
  if (p) {
    try {
      const whereClause = isUuid ? "id = $1" : "staff_code = $1";
      const query = `
        UPDATE staff
        SET active = $2, updated_at = NOW()
        WHERE ${whereClause}
        RETURNING *;
      `;
      const res = await p.query(query, [isUuid ? idOrCode : idOrCode.toUpperCase(), active]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL updateStaffStatus failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      let query = supabase.from("staff").update({ active, updated_at: new Date().toISOString() });
      if (isUuid) {
        query = query.eq("id", idOrCode);
      } else {
        query = query.eq("staff_code", idOrCode.toUpperCase());
      }
      const { data, error } = await query.select().single();
      if (!error && data) return data;
    } catch (sbErr) {
      console.warn("Supabase updateStaffStatus failed:", sbErr);
    }
  }

  const store = readLocalStore();
  const staff = store.staff.find(
    (s) => s.id === idOrCode || s.staff_code.toUpperCase() === idOrCode.toUpperCase(),
  );
  if (!staff) return null;
  staff.active = active;
  staff.updated_at = new Date().toISOString();
  writeLocalStore(store);
  return staff;
}

/**
 * Insert a new 512-dimensional ArcFace embedding for an authorized staff member.
 */
export async function storeFaceEmbedding(
  staffId: string,
  embedding: number[],
  referenceImagePath: string,
  photoData?: string,
): Promise<FaceEmbeddingRecord> {
  if (!embedding || embedding.length !== 512) {
    throw new Error(`Embedding must be a 512-dimensional array. Got length ${embedding?.length ?? 0}`);
  }
  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i];
    if (typeof v !== "number" || isNaN(v) || !isFinite(v)) {
      throw new Error(`Embedding contains non-finite number at index ${i}`);
    }
  }

  // Ensure staff exists and resolve their immutable database UUID
  const staff = await getStaffById(staffId);
  if (!staff) {
    throw new Error(`Staff member '${staffId}' not found. Cannot associate biometric embedding.`);
  }
  const resolvedStaffId = staff.id;

  const p = getPgPool();
  if (p) {
    try {
      const vecString = `[${embedding.join(",")}]`;
      const query = `
        INSERT INTO face_embeddings (staff_id, embedding, reference_image_path, photo_data)
        VALUES ($1, $2::vector, $3, $4)
        RETURNING id, staff_id, reference_image_path, photo_data, created_at;
      `;
      const res = await p.query(query, [resolvedStaffId, vecString, referenceImagePath, photoData || null]);
      const row = res.rows[0];
      return {
        id: row.id,
        staff_id: row.staff_id,
        embedding: [],
        reference_image_path: row.reference_image_path,
        photo_data: row.photo_data,
        created_at: row.created_at,
      };
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL storeFaceEmbedding failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("face_embeddings")
        .insert({
          staff_id: resolvedStaffId,
          embedding,
          reference_image_path: referenceImagePath,
          photo_data: photoData || null,
        })
        .select("id, staff_id, reference_image_path, photo_data, created_at")
        .single();

      if (error) throw error;
      if (data) {
        // Mark staff active on successful enrollment
        await supabase
          .from("staff")
          .update({ active: true, updated_at: new Date().toISOString() })
          .eq("id", resolvedStaffId);

        return {
          id: data.id,
          staff_id: data.staff_id,
          embedding: [],
          reference_image_path: data.reference_image_path,
          photo_data: data.photo_data,
          created_at: data.created_at,
        };
      }
    } catch (sbErr) {
      console.warn("Supabase storeFaceEmbedding failed:", sbErr);
      throw sbErr;
    }
  }

  // Fallback to local store for offline dev
  const store = readLocalStore();
  const newRec: FaceEmbeddingRecord = {
    id: `emb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    staff_id: resolvedStaffId,
    embedding,
    reference_image_path: referenceImagePath,
    photo_data: photoData,
    created_at: new Date().toISOString(),
  };

  store.face_embeddings.push(newRec);
  writeLocalStore(store);
  return {
    ...newRec,
    embedding: [],
  };
}

/**
 * Delete a specific face embedding.
 */
export async function deleteFaceEmbedding(embeddingId: string): Promise<boolean> {
  const p = getPgPool();
  if (p) {
    try {
      const res = await p.query("DELETE FROM face_embeddings WHERE id = $1", [embeddingId]);
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (pgErr) {
      markPgError(pgErr);
      console.warn("Direct PostgreSQL deleteFaceEmbedding failed, attempting Supabase fallback:", pgErr);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from("face_embeddings").delete().eq("id", embeddingId);
      if (!error) return true;
    } catch (sbErr) {
      console.warn("Supabase deleteFaceEmbedding failed:", sbErr);
    }
  }

  const store = readLocalStore();
  const initialLen = store.face_embeddings.length;
  store.face_embeddings = store.face_embeddings.filter((f) => f.id !== embeddingId);
  writeLocalStore(store);
  return store.face_embeddings.length < initialLen;
}

/**
 * Scalable Backend Vector Search:
 * Compares live 512-float embedding descriptor against ALL active authorized staff embeddings.
 * Returns sorted list of match candidates with Cosine distances.
 */
export async function searchFaceEmbeddings(
  liveDescriptor: number[],
  limit: number = 5,
): Promise<VectorSearchResult[]> {
  if (liveDescriptor.length !== 512) {
    throw new Error(`Live descriptor dimension must be 512. Received ${liveDescriptor.length}`);
  }
  for (let i = 0; i < liveDescriptor.length; i++) {
    const v = liveDescriptor[i];
    if (typeof v !== "number" || isNaN(v) || !isFinite(v)) {
      throw new Error(`Live descriptor contains non-finite number at index ${i}`);
    }
  }

  const p = getPgPool();
  if (p) {
    try {
      const vecString = `[${liveDescriptor.join(",")}]`;
      const query = `
        SELECT 
          s.id AS staff_id,
          s.staff_code,
          s.name,
          f.id AS embedding_id,
          f.reference_image_path,
          f.photo_data,
          (f.embedding <=> $1::vector) AS distance
        FROM face_embeddings f
        JOIN staff s ON f.staff_id = s.id
        WHERE s.active = true
        ORDER BY distance ASC
        LIMIT $2;
      `;
      const res = await p.query(query, [vecString, limit]);
      return res.rows.map((r) => ({
        staff_id: r.staff_id,
        staff_code: r.staff_code,
        name: r.name,
        embedding_id: r.embedding_id,
        reference_image_path: r.reference_image_path,
        photo_data: r.photo_data,
        distance: parseFloat(r.distance),
      }));
    } catch (err: any) {
      markPgError(err);
      console.warn("Direct PostgreSQL search failed, falling back to Supabase/stored gallery:", err?.message || err);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      // 1. Try Supabase pgvector RPC
      const { data: rpcRows, error: rpcErr } = await supabase.rpc("match_face_embeddings", {
        query_embedding: liveDescriptor,
        match_threshold: 0.65,
        match_count: limit,
      });

      if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
        return rpcRows.map((r: any) => ({
          staff_id: r.staff_id,
          staff_code: r.staff_code,
          name: r.name,
          embedding_id: r.id,
          reference_image_path: r.reference_image_path,
          photo_data: r.photo_data,
          distance: parseFloat(r.distance),
        }));
      }

      // 2. Direct vector select fallback (calculates cosine distance in-memory for resilience)
      const { data: embs, error: embErr } = await supabase
        .from("face_embeddings")
        .select(
          "id, staff_id, embedding, reference_image_path, photo_data, staff:staff_id(id, staff_code, name, active)",
        );

      if (!embErr && Array.isArray(embs) && embs.length > 0) {
        const results: VectorSearchResult[] = [];
        for (const f of embs) {
          const staffObj = Array.isArray(f.staff) ? f.staff[0] : f.staff;
          if (!staffObj || !staffObj.active) continue;
          let embVec: number[] = [];
          if (Array.isArray(f.embedding)) {
            embVec = f.embedding;
          } else if (typeof f.embedding === "string") {
            const str = f.embedding.trim();
            if (str.startsWith("[") && str.endsWith("]")) {
              try {
                embVec = JSON.parse(str);
              } catch {}
            } else if (str.startsWith("{") && str.endsWith("}")) {
              try {
                embVec = str.slice(1, -1).split(",").map(Number);
              } catch {}
            } else {
              try {
                embVec = str.split(",").map(Number);
              } catch {}
            }
          }
          if (embVec.length !== 512) continue;
          const dist = calculateCosineDistance(liveDescriptor, embVec);
          results.push({
            staff_id: staffObj.id,
            staff_code: staffObj.staff_code,
            name: staffObj.name,
            embedding_id: f.id,
            reference_image_path: f.reference_image_path,
            photo_data: f.photo_data,
            distance: dist,
          });
        }
        return results.sort((a, b) => a.distance - b.distance).slice(0, limit);
      }
    } catch (sbErr) {
      console.warn("Supabase searchFaceEmbeddings notice:", sbErr);
    }
  }

  // Dev-only Local Store fallback (cosine distance)
  const store = readLocalStore();
  const activeStaffMap = new Map<string, StaffRecord>();
  store.staff
    .filter((s) => s.active)
    .forEach((s) => {
      activeStaffMap.set(s.id, s);
      activeStaffMap.set(s.staff_code, s);
    });

  const results: VectorSearchResult[] = [];
  for (const emb of store.face_embeddings) {
    if (!emb.embedding || emb.embedding.length !== 512) continue;
    const staff = activeStaffMap.get(emb.staff_id) || (emb.staff_code ? activeStaffMap.get(emb.staff_code) : undefined);
    if (!staff) continue;

    const dist = calculateCosineDistance(liveDescriptor, emb.embedding);
    results.push({
      staff_id: staff.id,
      staff_code: staff.staff_code,
      name: staff.name,
      embedding_id: emb.id,
      reference_image_path: emb.reference_image_path,
      photo_data: emb.photo_data,
      distance: dist,
    });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

export interface DatabaseDiagnostics {
  status: "CONNECTED" | "DISCONNECTED";
  databaseType: string;
  host: string;
  port: number | string;
  databaseName: string;
  user: string;
  staffCount: number;
  totalEmbeddingCount: number;
  activeEmbeddingCount: number;
  pgvector: "ENABLED" | "DISABLED";
  activeSource: string;
  provenanceProof?: Array<{ staff_code: string; name: string; embedding_count: number }>;
  details?: string;
}

/**
 * Developer diagnostic function: verifies live database connection and state
 * without exposing credentials or modifying any tables.
 */
export async function getDatabaseDiagnostics(): Promise<DatabaseDiagnostics> {
  const p = getPgPool();
  if (p) {
    try {
      const client = await p.connect();
      try {
        const staffRes = await client.query("SELECT COUNT(*)::int as count FROM staff");
        const embRes = await client.query("SELECT COUNT(*)::int as count FROM face_embeddings");
        const activeEmbRes = await client.query(`
          SELECT COUNT(f.id)::int as count 
          FROM face_embeddings f 
          JOIN staff s ON f.staff_id = s.id 
          WHERE s.active = true
        `);
        const extRes = await client.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
        const dbInfo = await client.query(
          "SELECT current_database(), current_user, inet_server_addr(), inet_server_port()",
        );
        const proofRes = await client.query(`
          SELECT s.staff_code, s.name, COUNT(f.id)::int as embedding_count
          FROM staff s
          LEFT JOIN face_embeddings f ON f.staff_id = s.id
          GROUP BY s.id
          ORDER BY s.staff_code
        `);

        return {
          status: "CONNECTED",
          databaseType: "PostgreSQL (Direct Pool)",
          host: String(dbInfo.rows[0]?.inet_server_addr || process.env["PGHOST"] || "PostgreSQL Server"),
          port:
            dbInfo.rows[0]?.inet_server_port ||
            (process.env["PGPORT"] ? parseInt(process.env["PGPORT"], 10) : 5432),
          databaseName: String(dbInfo.rows[0]?.current_database || process.env["PGDATABASE"] || ""),
          user: String(dbInfo.rows[0]?.current_user || process.env["PGUSER"] || ""),
          staffCount: staffRes.rows[0]?.count ?? 0,
          totalEmbeddingCount: embRes.rows[0]?.count ?? 0,
          activeEmbeddingCount: activeEmbRes.rows[0]?.count ?? 0,
          pgvector: extRes.rows.length > 0 ? "ENABLED" : "DISABLED",
          activeSource: "PostgreSQL Live Database",
          provenanceProof: proofRes.rows,
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      markPgError(err);
      console.warn("Direct PostgreSQL connection test failed, checking Supabase fallback:", err?.message || err);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { count: staffCount, error: sErr } = await supabase
        .from("staff")
        .select("*", { count: "exact", head: true });
      const { count: embCount, error: eErr } = await supabase
        .from("face_embeddings")
        .select("*", { count: "exact", head: true });

      if (!sErr && !eErr) {
        return {
          status: "CONNECTED",
          databaseType: "Supabase (Cloud Managed PostgreSQL + pgvector)",
          host: "qvjcxoznvhoagclbyhad.supabase.co",
          port: 443,
          databaseName: "postgres",
          user: "supabase_client",
          staffCount: staffCount ?? 0,
          totalEmbeddingCount: embCount ?? 0,
          activeEmbeddingCount: embCount ?? 0,
          pgvector: "ENABLED",
          activeSource: "Supabase Cloud Database (Live Production)",
        };
      }
    } catch (sbErr: any) {
      console.warn("Supabase connection check failed:", sbErr?.message || sbErr);
    }
  }

  // Standalone Dev-only Local JSON Store Fallback
  const store = readLocalStore();
  const activeStaffIds = new Set(store.staff.filter((s) => s.active).map((s) => s.id));
  const activeEmbeddings = store.face_embeddings.filter((e) => activeStaffIds.has(e.staff_id));

  return {
    status: "DISCONNECTED",
    databaseType: "local JSON",
    host: process.env["PGHOST"] || "localhost (not configured)",
    port: process.env["PGPORT"] || 5432,
    databaseName: process.env["PGDATABASE"] || "campus_biometrics (not connected)",
    user: process.env["PGUSER"] || "postgres",
    staffCount: store.staff.length,
    totalEmbeddingCount: store.face_embeddings.length,
    activeEmbeddingCount: activeEmbeddings.length,
    pgvector: "DISABLED",
    activeSource: "data/staff-db.json",
    details:
      "Direct PostgreSQL and Supabase are not reachable. All operations served from data/staff-db.json (dev-only mode).",
  };
}
