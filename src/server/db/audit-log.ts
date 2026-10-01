/**
 * Face Detection / Authentication Audit Logging Service
 *
 * Implements server-side audit logs for successful face authentications:
 * - Records user_id (referencing staff_code), name, email, and exact server timestamps
 * - Utilizes PostgreSQL server clock (NOW(), CURRENT_DATE, CURRENT_TIME)
 * - Implements configurable server-side duplicate protection window (default 60s)
 * - Safe fallback to local dev store (data/staff-db.json) if PG is unconfigured
 * - Completely non-blocking for live face recognition
 */

import { getPgPool, getStaffById } from "./client.ts";
import fs from "fs";
import path from "path";

export interface FaceDetectionLogRecord {
  id: string;
  user_id: string;
  name: string;
  email: string;
  detected_at: string;
  server_date: string;
  server_time: string;
  created_at: string;
}

export interface RecordFaceDetectionLogInput {
  userId: string; // staff_code (e.g. PERSON_001) or staff UUID
  name?: string | undefined;
  email?: string | undefined;
  windowSeconds?: number | undefined;
}

export interface RecordFaceDetectionLogResult {
  logged: boolean;
  duplicateSuppressed: boolean;
  record: FaceDetectionLogRecord;
  windowSeconds: number;
}

export interface QueryFaceDetectionLogsParams {
  page?: number | undefined;
  limit?: number | undefined;
  search?: string | undefined;
  userId?: string | undefined;
  date?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}

export interface QueryFaceDetectionLogsResult {
  records: FaceDetectionLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// In-memory sliding window cache for instant rejection of rapid duplicate frames (< 1s)
const recentMemoryLogCache = new Map<string, number>();

/**
 * Default duplicate window in seconds.
 * Configurable via FACE_LOG_DUPLICATE_WINDOW_SECONDS environment variable.
 */
export function getDuplicateWindowSeconds(override?: number | undefined): number {
  if (typeof override === "number" && override >= 0) return override;
  const envVal = process.env["FACE_LOG_DUPLICATE_WINDOW_SECONDS"];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return 60; // 60 seconds default
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

function getLocalStoreLogs(): FaceDetectionLogRecord[] {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.face_detection_logs)) {
        return parsed.face_detection_logs;
      }
    }
  } catch {
    // Ignore read errors
  }
  return [];
}

function saveLocalStoreLog(log: FaceDetectionLogRecord) {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.face_detection_logs)) {
        parsed.face_detection_logs = [];
      }
      parsed.face_detection_logs.push(log);
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(parsed, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("[AuditLog] Error saving local store log:", err);
  }
}

/**
 * Authoritatively record a successful face detection / authentication event.
 * Resolves user identity from the server's staff table.
 * Applies configurable server-side duplicate suppression window.
 */
export async function recordFaceDetectionLog(
  input: RecordFaceDetectionLogInput,
): Promise<RecordFaceDetectionLogResult> {
  const windowSec = getDuplicateWindowSeconds(input.windowSeconds);

  // 1. Authoritatively resolve user from PostgreSQL / local database
  const staff = await getStaffById(input.userId);
  if (!staff) {
    throw new Error(`Staff with ID/code '${input.userId}' not found in database.`);
  }

  const authoritativeUserId = staff.staff_code;
  const authoritativeName = staff.name;
  const authoritativeEmail = staff.email;

  const pool = getPgPool();

  if (pool) {
    // Check in-memory fast debounce (e.g. 500ms multi-frame burst)
    const nowMs = Date.now();
    const lastMem = recentMemoryLogCache.get(authoritativeUserId);
    if (lastMem && (nowMs - lastMem) < (windowSec * 1000)) {
      // In-memory duplicate detected; fetch the latest record to return
      const latestQuery = `
        SELECT 
          id, user_id, name, email,
          detected_at::text, server_date::text, server_time::text, created_at::text
        FROM face_detection_logs
        WHERE user_id = $1
        ORDER BY detected_at DESC
        LIMIT 1;
      `;
      const latestRes = await pool.query(latestQuery, [authoritativeUserId]);
      if (latestRes.rows.length > 0) {
        return {
          logged: false,
          duplicateSuppressed: true,
          record: latestRes.rows[0],
          windowSeconds: windowSec,
        };
      }
    }

    // Check database duplicate window:
    // If a log for this user exists within windowSec, suppress duplicate.
    const dupCheckQuery = `
      SELECT 
        id, user_id, name, email,
        detected_at::text, server_date::text, server_time::text, created_at::text
      FROM face_detection_logs
      WHERE user_id = $1 
        AND detected_at >= (NOW() - ($2 || ' seconds')::interval)
      ORDER BY detected_at DESC
      LIMIT 1;
    `;
    const dupRes = await pool.query(dupCheckQuery, [authoritativeUserId, windowSec]);

    if (dupRes.rows.length > 0) {
      recentMemoryLogCache.set(authoritativeUserId, nowMs);
      return {
        logged: false,
        duplicateSuppressed: true,
        record: dupRes.rows[0],
        windowSeconds: windowSec,
      };
    }

    // Insert new authoritative log with SERVER timestamp
    const insertQuery = `
      INSERT INTO face_detection_logs (
        user_id,
        name,
        email,
        detected_at,
        server_date,
        server_time,
        created_at
      ) VALUES (
        $1,
        $2,
        $3,
        NOW(),
        CURRENT_DATE,
        CURRENT_TIME,
        NOW()
      )
      RETURNING 
        id, user_id, name, email,
        detected_at::text, server_date::text, server_time::text, created_at::text;
    `;
    const insertRes = await pool.query(insertQuery, [
      authoritativeUserId,
      authoritativeName,
      authoritativeEmail,
    ]);

    const newRecord: FaceDetectionLogRecord = insertRes.rows[0];
    recentMemoryLogCache.set(authoritativeUserId, nowMs);

    console.info(
      `[AuditLog] Logged face detection: user_id=${newRecord.user_id}, name="${newRecord.name}", detected_at=${newRecord.detected_at}`,
    );

    return {
      logged: true,
      duplicateSuppressed: false,
      record: newRecord,
      windowSeconds: windowSec,
    };
  }

  // Dev-only fallback store when PostgreSQL is unconfigured
  const existingLogs = getLocalStoreLogs();
  const now = new Date();
  const nowMs = now.getTime();

  // Check duplicate in local store
  const recentLocal = existingLogs
    .filter((l) => l.user_id === authoritativeUserId)
    .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())[0];

  if (recentLocal) {
    const diffSeconds = (nowMs - new Date(recentLocal.detected_at).getTime()) / 1000;
    if (diffSeconds < windowSec) {
      return {
        logged: false,
        duplicateSuppressed: true,
        record: recentLocal,
        windowSeconds: windowSec,
      };
    }
  }

  // Format server time in India Time (IST, UTC+5:30)
  const indiaDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const indiaTimeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const fallbackRecord: FaceDetectionLogRecord = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: authoritativeUserId,
    name: authoritativeName,
    email: authoritativeEmail,
    detected_at: now.toISOString(),
    server_date: indiaDateStr,
    server_time: indiaTimeStr,
    created_at: now.toISOString(),
  };

  saveLocalStoreLog(fallbackRecord);

  return {
    logged: true,
    duplicateSuppressed: false,
    record: fallbackRecord,
    windowSeconds: windowSec,
  };
}

/**
 * Retrieve face detection audit logs with sorting (newest first), pagination, and filtering.
 * Does NOT expose face embeddings or biometric images.
 */
export async function getFaceDetectionLogs(
  params: QueryFaceDetectionLogsParams = {},
): Promise<QueryFaceDetectionLogsResult> {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 10));
  const offset = (page - 1) * limit;

  const pool = getPgPool();

  if (pool) {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(params.userId.trim());
    }

    if (params.search) {
      conditions.push(`(user_id ILIKE $${paramIndex} OR name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
      values.push(`%${params.search.trim()}%`);
      paramIndex++;
    }

    if (params.date) {
      conditions.push(`server_date = $${paramIndex++}`);
      values.push(params.date.trim());
    }

    if (params.startDate) {
      conditions.push(`detected_at >= $${paramIndex++}::timestamptz`);
      values.push(params.startDate.trim());
    }

    if (params.endDate) {
      conditions.push(`detected_at <= $${paramIndex++}::timestamptz`);
      values.push(params.endDate.trim());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count query
    const countSql = `SELECT COUNT(*)::int AS count FROM face_detection_logs ${whereClause};`;
    const countRes = await pool.query(countSql, values);
    const total = countRes.rows[0]?.count || 0;

    // Data query (newest first)
    const dataSql = `
      SELECT 
        id,
        user_id,
        name,
        email,
        detected_at::text,
        server_date::text,
        server_time::text,
        created_at::text
      FROM face_detection_logs
      ${whereClause}
      ORDER BY detected_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
    const dataRes = await pool.query(dataSql, [...values, limit, offset]);

    return {
      records: dataRes.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // Dev-only fallback
  let allLogs = getLocalStoreLogs();

  if (params.userId) {
    allLogs = allLogs.filter((l) => l.user_id.toLowerCase() === params.userId!.trim().toLowerCase());
  }

  if (params.search) {
    const q = params.search.toLowerCase();
    allLogs = allLogs.filter(
      (l) => l.user_id.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q),
    );
  }

  if (params.date) {
    allLogs = allLogs.filter((l) => l.server_date === params.date);
  }

  // Sort newest first
  allLogs.sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());

  const total = allLogs.length;
  const records = allLogs.slice(offset, offset + limit);

  return {
    records,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
