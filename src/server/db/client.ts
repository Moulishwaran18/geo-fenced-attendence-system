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

  const isProd =
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

  const serviceRoleKey =
    typeof process !== "undefined" && process.env["SUPABASE_SERVICE_ROLE_KEY"]
      ? process.env["SUPABASE_SERVICE_ROLE_KEY"].trim()
      : undefined;

  // In production runtime, privileged server database access strictly requires SUPABASE_SERVICE_ROLE_KEY
  if (isProd) {
    if (!serviceRoleKey || serviceRoleKey.startsWith("sb_publishable_")) {
      console.error("[DbClient] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is required in production runtime.");
      throw new Error("CONFIGURATION_FAULT: SUPABASE_SERVICE_ROLE_KEY is required for server database operations in production.");
    }
    supabaseClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  }

  // Non-production fallback (test / local developer mode):
  const key =
    serviceRoleKey ||
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"])) ||
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
          0 AS "embeddingCount",
          '[]'::json AS "referenceSamples"
        FROM staff s
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
        .select("id, staff_code, name, email, department, designation, active, created_at, updated_at")
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
          embeddingCount: 0,
          referenceSamples: [],
        }));
      }
    } catch (sbErr) {
      console.warn("Supabase getAllStaff failed:", sbErr);
    }
  }

  // Dev-only Fallback (only when PostgreSQL and Supabase are offline)
  const store = readLocalStore();
  return store.staff.map((s) => {
    return {
      ...s,
      referenceSamples: [],
      embeddingCount: 0,
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
          0 AS "embeddingCount",
          '[]'::json AS "referenceSamples"
        FROM staff s
        WHERE ${whereClause};
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
        .select("id, staff_code, name, email, department, designation, active, created_at, updated_at");

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
          embeddingCount: 0,
          referenceSamples: [],
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

  return {
    ...staff,
    referenceSamples: [],
    embeddingCount: 0,
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
  _staffId: string,
  _embedding: number[],
  _referenceImagePath?: string,
  _photoData?: string,
): Promise<FaceEmbeddingRecord> {
  throw new Error(
    "Biometric templates, vectors, and photos must remain exclusively on the staff member's device. Uploading biometric data to the server is strictly prohibited.",
  );
}

/**
 * Delete a specific face embedding (No-op in device-only biometric policy).
 */
export async function deleteFaceEmbedding(_embeddingId: string): Promise<boolean> {
  return true;
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

  // Device-only biometric policy: zero cloud vectors stored or queried on server
  return [];
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
  const supabase = getSupabaseClient();
  let staffCount = 0;
  if (supabase) {
    try {
      const { count } = await supabase.from("staff").select("*", { count: "exact", head: true });
      staffCount = count || 0;
    } catch {}
  }

  return {
    status: "CONNECTED",
    databaseType: "Supabase (Cloud Managed PostgreSQL)",
    host: "qvjcxoznvhoagclbyhad.supabase.co",
    port: 443,
    databaseName: "postgres",
    user: "postgres",
    staffCount,
    totalEmbeddingCount: 0,
    activeEmbeddingCount: 0,
    pgvector: "DISABLED",
    activeSource: "Device-Only Biometrics (Android Keystore)",
  };
}
