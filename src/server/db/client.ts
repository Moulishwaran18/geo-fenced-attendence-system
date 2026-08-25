/**
 * Database client for CampusAttend — Scalable Staff Face Database.
 *
 * Connects to PostgreSQL via `pg.Pool` (using `DATABASE_URL` or PG* env variables).
 * Seamlessly supports pgvector L2 similarity queries (<->) with fallback vector search.
 */

import pg from "pg";
import fs from "fs";
import path from "path";

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
  embedding: number[]; // 512-float descriptor
  reference_image_path: string;
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
}

// -----------------------------------------------------------------------------
// PostgreSQL Pool Initialization
// -----------------------------------------------------------------------------

const dbUrl = process.env["DATABASE_URL"] || "";
let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool | null {
  if (pool) return pool;
  if (dbUrl || (process.env["PGHOST"] && process.env["PGDATABASE"])) {
    try {
      pool = new Pool({
        connectionString: dbUrl || undefined,
        host: process.env["PGHOST"],
        port: process.env["PGPORT"] ? parseInt(process.env["PGPORT"], 10) : 5432,
        user: process.env["PGUSER"],
        password: process.env["PGPASSWORD"],
        database: process.env["PGDATABASE"],
        max: 20,
        idleTimeoutMillis: 30000,
      });
      return pool;
    } catch (err) {
      console.warn("Failed to initialize PostgreSQL pool:", err);
      return null;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Persistent Local Dev Store (Fallback when PostgreSQL connection is not active)
// -----------------------------------------------------------------------------

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

interface LocalStoreSchema {
  staff: StaffRecord[];
  face_embeddings: FaceEmbeddingRecord[];
}

function ensureDataDir() {
  const dir = path.dirname(LOCAL_STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
    console.error("Error reading local staff-db.json:", err);
  }
  return { staff: [], face_embeddings: [] };
}

function writeLocalStore(data: LocalStoreSchema) {
  ensureDataDir();
  try {
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving local staff-db.json:", err);
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
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
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
    } catch (e) {
      console.warn("Postgres query failed, reading from local store:", e);
    }
  }

  // Fallback
  const store = readLocalStore();
  return store.staff.map((s) => {
    const samples = store.face_embeddings
      .filter((f) => f.staff_id === s.id)
      .map((f) => ({
        id: f.id,
        staff_id: f.staff_id,
        embedding: [], // Never expose raw embedding to client
        reference_image_path: f.reference_image_path,
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
  const p = getPgPool();
  if (p) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
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
      const res = await p.query(query, [idOrCode]);
      if (res.rows.length > 0) return res.rows[0];
      return null;
    } catch (e) {
      console.warn("Postgres getStaffById failed, using local store:", e);
    }
  }

  const store = readLocalStore();
  const found = store.staff.find(
    (s) => s.id === idOrCode || s.staff_code.toUpperCase() === idOrCode.toUpperCase(),
  );
  if (!found) return null;

  const samples = store.face_embeddings
    .filter((f) => f.staff_id === found.id)
    .map((f) => ({
      id: f.id,
      staff_id: f.staff_id,
      embedding: [], // Redacted
      reference_image_path: f.reference_image_path,
      created_at: f.created_at,
    }));

  return {
    ...found,
    referenceSamples: samples,
    embeddingCount: samples.length,
  };
}

/**
 * Create a new staff record in the database.
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
    } catch (e) {
      console.warn("Postgres createStaff failed, using local store:", e);
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
  const p = getPgPool();
  if (p) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
      const whereClause = isUuid ? "id = $1" : "staff_code = $1";
      const query = `
        UPDATE staff
        SET active = $2, updated_at = NOW()
        WHERE ${whereClause}
        RETURNING *;
      `;
      const res = await p.query(query, [idOrCode, active]);
      if (res.rows.length > 0) return res.rows[0];
      return null;
    } catch (e) {
      console.warn("Postgres updateStaffStatus failed, using local store:", e);
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
 * Store a 512-dimensional face embedding linked to a staff record.
 */
export async function storeFaceEmbedding(
  staffId: string,
  embedding: number[],
  referenceImagePath: string,
): Promise<FaceEmbeddingRecord> {
  if (embedding.length !== 512) {
    throw new Error(`Invalid embedding length: ${embedding.length}. Expected 512-dimensional descriptor.`);
  }

  const p = getPgPool();
  if (p) {
    try {
      const vecString = `[${embedding.join(",")}]`;
      const query = `
        INSERT INTO face_embeddings (staff_id, embedding, reference_image_path)
        VALUES ($1, $2, $3)
        RETURNING id, staff_id, reference_image_path, created_at;
      `;
      const res = await p.query(query, [staffId, vecString, referenceImagePath]);
      const row = res.rows[0];
      return {
        id: row.id,
        staff_id: row.staff_id,
        embedding,
        reference_image_path: row.reference_image_path,
        created_at: row.created_at,
      };
    } catch (e) {
      console.warn("Postgres storeFaceEmbedding failed, using local store:", e);
    }
  }

  const store = readLocalStore();
  const newRec: FaceEmbeddingRecord = {
    id: `emb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    staff_id: staffId,
    embedding,
    reference_image_path: referenceImagePath,
    created_at: new Date().toISOString(),
  };

  store.face_embeddings.push(newRec);
  writeLocalStore(store);
  return newRec;
}

/**
 * Delete a specific face embedding.
 */
export async function deleteFaceEmbedding(embeddingId: string): Promise<boolean> {
  const p = getPgPool();
  if (p) {
    try {
      const res = await p.query("DELETE FROM face_embeddings WHERE id = $1", [embeddingId]);
      return (res.rowCount ?? 0) > 0;
    } catch (e) {
      console.warn("Postgres deleteFaceEmbedding failed, using local store:", e);
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
        distance: parseFloat(r.distance),
      }));
    } catch (e) {
      console.warn("Postgres vector search query failed, using local store fallback:", e);
    }
  }

  // Local Store Fallback with exact Cosine distance (<=>)
  const store = readLocalStore();
  const activeStaffMap = new Map<string, StaffRecord>();
  store.staff.filter((s) => s.active).forEach((s) => activeStaffMap.set(s.id, s));

  const results: VectorSearchResult[] = [];
  for (const emb of store.face_embeddings) {
    const staff = activeStaffMap.get(emb.staff_id);
    if (!staff) continue;

    const dist = calculateCosineDistance(liveDescriptor, emb.embedding);
    results.push({
      staff_id: staff.id,
      staff_code: staff.staff_code,
      name: staff.name,
      embedding_id: emb.id,
      reference_image_path: emb.reference_image_path,
      distance: dist,
    });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, limit);
}
