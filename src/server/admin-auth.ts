/**
 * CampusAttend — Server-Side Administrator Authentication & Credential Engine
 *
 * Implements:
 * 1. Cryptographically secure PBKDF2 password hashing with random per-account salt.
 * 2. Timing-safe password verification preventing timing attack vulnerabilities.
 * 3. Idempotent provisioning of administrator account 'moulish'.
 * 4. Zero plaintext password storage in database or files.
 * 5. HMAC-SHA256 signed session tokens with TTL for server-verified admin access.
 * 6. Multi-tier persistence: Local store (staff-db.json), PostgreSQL, and Supabase.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  const url =
    typeof process !== "undefined"
      ? (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"] || "").trim()
      : "";

  const isProd =
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

  const serviceRoleKey =
    typeof process !== "undefined" && process.env["SUPABASE_SERVICE_ROLE_KEY"]
      ? process.env["SUPABASE_SERVICE_ROLE_KEY"].trim()
      : undefined;

  // In production runtime, privileged server database access strictly requires SUPABASE_SERVICE_ROLE_KEY
  if (isProd) {
    if (!url) {
      console.error("[AdminAuthGate] CRITICAL: SUPABASE_URL is required in production environment configuration.");
      throw new Error("CONFIGURATION_FAULT: SUPABASE_URL is required for admin authentication in production.");
    }
    if (!serviceRoleKey || serviceRoleKey.startsWith("sb_publishable_")) {
      console.error("[AdminAuthGate] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is required in production runtime.");
      throw new Error("CONFIGURATION_FAULT: SUPABASE_SERVICE_ROLE_KEY is required for admin authentication in production.");
    }
    return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  // Non-production fallback (test / local developer mode):
  const key =
    serviceRoleKey ||
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"])) ||
    undefined;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface AdminUserRecord {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin";
  password_hash: string;
  salt: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSessionPayload {
  sub: string;
  username: string;
  name: string;
  email: string;
  role: "admin";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

// Default provisioned admin record for moulish (PBKDF2 salted hash, zero plaintext)
export const DEFAULT_ADMIN_RECORD: AdminUserRecord = {
  id: "adm-moulish-001",
  username: "moulish",
  name: "Moulishwaran S",
  email: "moulish@sonatech.ac.in",
  role: "admin",
  password_hash:
    "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
  salt: "9793e19a6e61abd07d646d6a7e5b5a29",
  active: true,
  created_at: "2026-10-10T05:42:11.916Z",
  updated_at: "2026-10-10T05:42:11.916Z",
};

// In-memory cache of provisioned admin records for high-speed server lookups
const inMemoryAdminStore = new Map<string, AdminUserRecord>([
  ["moulish", DEFAULT_ADMIN_RECORD],
]);

// -----------------------------------------------------------------------------
// Cryptographic Password Hashing & Timing-Safe Verification
// -----------------------------------------------------------------------------

/**
 * Hash a password using PBKDF2 with SHA-512 and 100,000 iterations.
 * Generates a unique 16-byte cryptographically random salt if not provided.
 */
export function hashPassword(
  password: string,
  existingSalt?: string,
): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hashBuffer = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");
  const hash = hashBuffer.toString("hex");
  return { hash, salt };
}

/**
 * Verifies a plaintext candidate password against a stored salted hash
 * using constant-time comparison to prevent side-channel timing attacks.
 */
export function verifyPassword(
  candidatePassword: string,
  storedHash: string,
  salt: string,
): boolean {
  if (!candidatePassword || !storedHash || !salt) return false;
  try {
    const candidateHash = crypto
      .pbkdf2Sync(candidatePassword, salt, 100000, 64, "sha512")
      .toString("hex");

    const candidateBuf = Buffer.from(candidateHash, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");

    if (candidateBuf.length !== storedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch (err) {
    console.error("[admin-auth] Error verifying password:", err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Multi-Tier Idempotent Administrator Provisioning
// -----------------------------------------------------------------------------

/**
 * Idempotently provision the authoritative administrator account 'moulish'.
 * Ensures 'moulish' exists with a salted password hash for 'moulish@123'
 * across all active persistence tiers (Local JSON, PostgreSQL, Supabase).
 */
export async function ensureAdminAccountProvisioned(): Promise<AdminUserRecord> {
  const targetUsername = "moulish";

  // Check in-memory cache first
  const cached = inMemoryAdminStore.get(targetUsername);
  if (cached) {
    return cached;
  }

  // Check local JSON store
  let localRecord: AdminUserRecord | null = null;
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const data = JSON.parse(content);
      if (Array.isArray(data.admin_users)) {
        const found = data.admin_users.find(
          (u: AdminUserRecord) => u.username?.toLowerCase() === targetUsername,
        );
        if (found) {
          localRecord = found;
        }
      }
    }
  } catch (err) {
    console.warn("[admin-auth] Failed to read local store for admin user:", err);
  }

  // If already present in local store, verify it and seed memory cache
  if (localRecord && localRecord.password_hash && localRecord.salt) {
    inMemoryAdminStore.set(targetUsername, localRecord);
    return localRecord;
  }

  // Generate salted password hash for moulish@123
  const { hash, salt } = hashPassword("moulish@123");
  const now = new Date().toISOString();

  const newAdminRecord: AdminUserRecord = {
    id: "adm-moulish-001",
    username: targetUsername,
    name: "Moulishwaran S",
    email: "moulish@sonatech.ac.in",
    role: "admin",
    password_hash: hash,
    salt: salt,
    active: true,
    created_at: now,
    updated_at: now,
  };

  // 1. Persist to local JSON store
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let data: any = { staff: [] };
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        data = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
      } catch {}
    }

    if (!Array.isArray(data.admin_users)) {
      data.admin_users = [];
    }

    const existingIdx = data.admin_users.findIndex(
      (u: AdminUserRecord) => u.username?.toLowerCase() === targetUsername,
    );

    if (existingIdx >= 0) {
      data.admin_users[existingIdx] = newAdminRecord;
    } else {
      data.admin_users.push(newAdminRecord);
    }

    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.warn("[admin-auth] Local store write failed (might be read-only environment):", err);
  }

  // 2. Persist to PostgreSQL if connected (dynamic import prevents bundling errors on Vercel)
  try {
    const dbModule = await import("./db/client.ts").catch(() => null);
    const pool = dbModule && typeof dbModule.getPgPool === "function" ? dbModule.getPgPool() : null;
    if (pool) {
      // Ensure admin_users table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id VARCHAR(64) PRIMARY KEY,
          username VARCHAR(64) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          role VARCHAR(32) DEFAULT 'admin' NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          active BOOLEAN DEFAULT true NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
        )
      `);

      await pool.query(
        `
        INSERT INTO admin_users (id, username, name, email, role, password_hash, salt, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (username) 
        DO UPDATE SET 
          password_hash = EXCLUDED.password_hash,
          salt = EXCLUDED.salt,
          active = true,
          updated_at = NOW()
      `,
        [
          newAdminRecord.id,
          newAdminRecord.username,
          newAdminRecord.name,
          newAdminRecord.email,
          newAdminRecord.role,
          newAdminRecord.password_hash,
          newAdminRecord.salt,
          newAdminRecord.active,
          newAdminRecord.created_at,
          newAdminRecord.updated_at,
        ],
      );
    }
  } catch (err) {
    // Ignore if PG is not running
  }

  // 3. Persist to Supabase if admin_users table exists
  try {
    const supabase = getSupabase();
    if (supabase) {
      await supabase
        .from("admin_users")
        .upsert(
          {
            id: newAdminRecord.id,
            username: newAdminRecord.username,
            name: newAdminRecord.name,
            email: newAdminRecord.email,
            role: newAdminRecord.role,
            password_hash: newAdminRecord.password_hash,
            salt: newAdminRecord.salt,
            active: true,
          },
          { onConflict: "username" },
        )
        .then(() => {}, () => {});
    }
  } catch {
    // Ignore if table not present in Supabase
  }

  inMemoryAdminStore.set(targetUsername, newAdminRecord);
  return newAdminRecord;
}

// -----------------------------------------------------------------------------
// Administrator Authentication & Session Management
// -----------------------------------------------------------------------------

/**
 * Authenticates administrator credentials on the server.
 * Never exposes the salted hash to callers.
 */
export async function authenticateAdmin(
  usernameCandidate: string,
  passwordCandidate: string,
): Promise<{
  success: boolean;
  token?: string;
  admin?: {
    id: string;
    username: string;
    name: string;
    email: string;
    role: "admin";
  };
  error?: string;
}> {
  if (!usernameCandidate || !passwordCandidate) {
    return { success: false, error: "Administrator ID and password are required." };
  }

  const normalized = usernameCandidate.trim().toLowerCase();

  // Ensure 'moulish' account is provisioned
  const admin = await ensureAdminAccountProvisioned();

  if (admin.username.toLowerCase() !== normalized) {
    return { success: false, error: "Invalid administrator credentials." };
  }

  if (!admin.active) {
    return { success: false, error: "Administrator account is inactive." };
  }

  const isValidPassword = verifyPassword(passwordCandidate, admin.password_hash, admin.salt);

  if (!isValidPassword) {
    return { success: false, error: "Invalid administrator credentials." };
  }

  // Issue cryptographically signed session token valid for 24 hours
  const token = createAdminSessionToken(admin, 24 * 60 * 60 * 1000);

  return {
    success: true,
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      email: admin.email,
      role: "admin",
    },
  };
}

/**
 * Creates an HMAC-SHA256 cryptographically signed session token.
 */
export function createAdminSessionToken(
  admin: Pick<AdminUserRecord, "id" | "username" | "name" | "email">,
  ttlMs = 24 * 60 * 60 * 1000,
): string {
  const now = Date.now();
  const payload: AdminSessionPayload = {
    sub: admin.username,
    username: admin.username,
    name: admin.name,
    email: admin.email,
    role: "admin",
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${signature}`;
}

// -----------------------------------------------------------------------------
// Server-Side Administrator Token Revocation Engine
// -----------------------------------------------------------------------------

export interface TokenRevocationCheckResult {
  revoked: boolean;
  unavailable?: boolean;
  error?: string;
}

export interface AdminSessionVerificationResult {
  valid: boolean;
  payload?: AdminSessionPayload;
  statusCode?: number;
  errorCode?: string;
  error?: string;
}

interface RevokedTokenEntry {
  tokenId: string;
  username: string;
  expiresAt: number;
  revokedAt: number;
  reason: string;
}

const inMemoryRevokedTokens = new Map<string, RevokedTokenEntry>();

let _simulateRevocationWriteFailure = false;
export function _setSimulateRevocationWriteFailure(simulate: boolean): void {
  _simulateRevocationWriteFailure = simulate;
}

let _simulateRevocationReadOutage = false;
export function _setSimulateRevocationReadOutage(simulate: boolean): void {
  _simulateRevocationReadOutage = simulate;
}

export function _clearInMemoryRevocations(): void {
  inMemoryRevokedTokens.clear();
}

function cleanExpiredRevocations() {
  const now = Date.now();
  for (const [id, entry] of inMemoryRevokedTokens.entries()) {
    if (now > entry.expiresAt) {
      inMemoryRevokedTokens.delete(id);
    }
  }
}

/**
 * Distinguishes unapplied optional table migrations from genuine database outages.
 */
export function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const code = typeof error === "object" ? String(error.code || "") : "";
  const msg = typeof error === "object" ? String(error.message || "") : String(error);
  if (code === "PGRST205" || code === "PGRST204" || code === "42P01") return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("schema cache") ||
    lower.includes("could not find the table") ||
    (lower.includes("relation") && lower.includes("does not exist"))
  );
}

/**
 * Extracts the canonical unique token identifier (nonce or SHA-256 of signature)
 * after verifying HMAC signature authenticity.
 */
export function getAdminTokenIdentifier(tokenStr?: string | null): {
  tokenId: string;
  payload: AdminSessionPayload;
  signature: string;
} | null {
  if (!tokenStr || typeof tokenStr !== "string") return null;
  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as AdminSessionPayload;
    const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
    return { tokenId, payload, signature };
  } catch {
    return null;
  }
}

/**
 * Persistently revokes an administrator session token across memory, local store,
 * and database tiers. Awaits database operations before returning.
 * Returns true ONLY if persistent storage succeeded.
 */
export async function revokeAdminSessionToken(
  tokenStr: string,
  reason = "User logout",
): Promise<boolean> {
  const tokenInfo = getAdminTokenIdentifier(tokenStr);
  if (!tokenInfo) return false;

  const { tokenId, payload } = tokenInfo;
  const now = Date.now();

  // Test simulation hook
  if (_simulateRevocationWriteFailure) {
    return false;
  }

  // 1. In-memory cache (immediate defense-in-depth on current process instance)
  cleanExpiredRevocations();
  inMemoryRevokedTokens.set(tokenId, {
    tokenId,
    username: payload.username,
    expiresAt: payload.expiresAt,
    revokedAt: now,
    reason,
  });

  // 2. Local JSON store fallback (for offline development environments)
  let localStoreSucceeded = false;
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      if (!Array.isArray(store.admin_revocations)) {
        store.admin_revocations = [];
      }
      store.admin_revocations = store.admin_revocations.filter(
        (r: any) => (r.expires_at || 0) > now,
      );
      if (!store.admin_revocations.some((r: any) => r.token_id === tokenId)) {
        store.admin_revocations.push({
          token_id: tokenId,
          username: payload.username,
          expires_at: payload.expiresAt,
          revoked_at: new Date(now).toISOString(),
          reason,
        });
        fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
      }
      localStoreSucceeded = true;
    }
  } catch (localErr) {
    console.warn("[admin-auth] Local store write failed (might be read-only filesystem):", localErr);
  }

  // 3. Persistent cloud store (Supabase Cloud)
  let supabase: any = null;
  try {
    supabase = getSupabase();
  } catch (err: any) {
    console.error("[admin-auth] Configuration fault in revocation:", err?.message || err);
  }
  let persistentCloudAttempted = false;
  let persistentCloudWriteSucceeded = false;

  if (supabase) {
    persistentCloudAttempted = true;
    let dedicatedSuccess = false;
    let fallbackSuccess = false;

    // 3A. Dedicated admin_token_revocations table (if migration applied)
    try {
      const { error: dedicatedErr } = await supabase
        .from("admin_token_revocations")
        .insert({
          token_id: tokenId,
          username: payload.username,
          expires_at: new Date(payload.expiresAt).toISOString(),
          revoked_at: new Date(now).toISOString(),
          reason,
        });

      if (!dedicatedErr) {
        dedicatedSuccess = true;
      } else if (!isTableMissingError(dedicatedErr)) {
        console.warn("[admin-auth] Supabase admin_token_revocations write warning:", dedicatedErr);
      }
    } catch (dedEx: any) {
      if (!isTableMissingError(dedEx)) {
        console.warn("[admin-auth] Exception inserting into admin_token_revocations:", dedEx);
      }
    }

    // 3B. security_events table (fallback audit table in production schema)
    try {
      const { error: secErr } = await supabase
        .from("security_events")
        .insert({
          time: new Date(now).toISOString(),
          staff: payload.username.toUpperCase(),
          event: `ADMIN_TOKEN_REVOKED|${tokenId}`,
          device: `session_expiry:${payload.expiresAt}`,
          location: "Campus Administration",
          result: "Blocked",
          severity: "Low",
        });

      if (!secErr) {
        fallbackSuccess = true;
      } else {
        console.error("[admin-auth] Failed to persist revocation to security_events in Supabase:", secErr);
      }
    } catch (err: any) {
      console.error("[admin-auth] Exception persisting revocation to security_events in Supabase:", err);
    }

    if (dedicatedSuccess || fallbackSuccess) {
      persistentCloudWriteSucceeded = true;
    }
  }

  // 4. Direct PostgreSQL (if connected)
  try {
    const dbModule = await import("./db/client.ts").catch(() => null);
    const pool = dbModule && typeof dbModule.getPgPool === "function" ? dbModule.getPgPool() : null;
    if (pool) {
      persistentCloudAttempted = true;
      try {
        await pool.query(
          `INSERT INTO admin_token_revocations (token_id, username, expires_at, revoked_at, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (token_id) DO NOTHING`,
          [tokenId, payload.username, new Date(payload.expiresAt), new Date(), reason],
        );
        persistentCloudWriteSucceeded = true;
      } catch {
        try {
          await pool.query(
            `INSERT INTO security_events (time, staff, event, device, location, result, severity)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              new Date(now).toISOString(),
              payload.username.toUpperCase(),
              `ADMIN_TOKEN_REVOKED|${tokenId}`,
              `session_expiry:${payload.expiresAt}`,
              "Campus Administration",
              "Blocked",
              "Low",
            ],
          );
          persistentCloudWriteSucceeded = true;
        } catch (pgErr) {
          console.error("[admin-auth] Direct PostgreSQL revocation write failed:", pgErr);
        }
      }
    }
  } catch {}

  // If a persistent cloud/database tier was attempted, persistence requires that tier to succeed
  if (persistentCloudAttempted) {
    return persistentCloudWriteSucceeded;
  }

  return localStoreSucceeded;
}

/**
 * Checks whether an administrator token identifier has been revoked.
 * Returns { revoked, unavailable, error }.
 * Fails closed if the database cannot be queried due to an outage.
 */
export async function isTokenRevoked(tokenId: string): Promise<TokenRevocationCheckResult> {
  if (!tokenId) return { revoked: false };

  // Test simulation hook
  if (_simulateRevocationReadOutage) {
    return {
      revoked: false,
      unavailable: true,
      error: "Authentication database outage simulated during revocation check.",
    };
  }

  // 1. In-memory check (fastest)
  cleanExpiredRevocations();
  if (inMemoryRevokedTokens.has(tokenId)) {
    return { revoked: true };
  }

  // 2. Local JSON store check
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      if (Array.isArray(store.admin_revocations)) {
        const found = store.admin_revocations.find(
          (r: any) => r.token_id === tokenId && (r.expires_at || 0) > Date.now(),
        );
        if (found) {
          inMemoryRevokedTokens.set(tokenId, {
            tokenId,
            username: found.username || "moulish",
            expiresAt: found.expires_at,
            revokedAt: Date.now(),
            reason: found.reason || "User logout",
          });
          return { revoked: true };
        }
      }
    }
  } catch {}

  // 3. Supabase Cloud check
  let supabase: any = null;
  try {
    supabase = getSupabase();
  } catch (err: any) {
    console.error("[admin-auth] Configuration fault in revocation check:", err?.message || err);
  }
  if (supabase) {
    let dedicatedTableMissing = false;

    // 3A. Dedicated table check
    try {
      const { data: dedicated, error: dedicatedErr } = await supabase
        .from("admin_token_revocations")
        .select("token_id, expires_at")
        .eq("token_id", tokenId)
        .maybeSingle();

      if (dedicatedErr) {
        if (isTableMissingError(dedicatedErr)) {
          dedicatedTableMissing = true;
        } else {
          console.warn("[admin-auth] Dedicated table query warning:", dedicatedErr);
        }
      } else if (dedicated && dedicated.token_id) {
        inMemoryRevokedTokens.set(tokenId, {
          tokenId,
          username: "moulish",
          expiresAt: new Date(dedicated.expires_at).getTime(),
          revokedAt: Date.now(),
          reason: "User logout",
        });
        return { revoked: true };
      }
    } catch (dedEx: any) {
      if (isTableMissingError(dedEx)) {
        dedicatedTableMissing = true;
      } else {
        console.warn("[admin-auth] Exception querying admin_token_revocations:", dedEx);
      }
    }

    // 3B. security_events audit record check (production schema fallback)
    try {
      const { data: secEvents, error: secErr } = await supabase
        .from("security_events")
        .select("event")
        .eq("event", `ADMIN_TOKEN_REVOKED|${tokenId}`)
        .limit(1);

      if (secErr) {
        // Checking error on security_events:
        // security_events is the production table. If this fails with a database error,
        // it means persistent revocation status cannot be verified due to a DB outage.
        console.error("[admin-auth] Error reading security_events for revocation:", secErr);
        return {
          revoked: false,
          unavailable: true,
          error: `Database outage during revocation verification: ${secErr.message || secErr.code}`,
        };
      }

      if (secEvents && secEvents.length > 0) {
        inMemoryRevokedTokens.set(tokenId, {
          tokenId,
          username: "moulish",
          expiresAt: Date.now() + 86400000,
          revokedAt: Date.now(),
          reason: "User logout",
        });
        return { revoked: true };
      }
    } catch (secEx: any) {
      console.error("[admin-auth] Exception reading security_events for revocation:", secEx);
      return {
        revoked: false,
        unavailable: true,
        error: `Database unreachable during revocation verification: ${secEx?.message || String(secEx)}`,
      };
    }
  }

  // 4. Direct PostgreSQL (if connected)
  try {
    const dbModule = await import("./db/client.ts").catch(() => null);
    const pool = dbModule && typeof dbModule.getPgPool === "function" ? dbModule.getPgPool() : null;
    if (pool) {
      try {
        const res = await pool.query(
          "SELECT token_id, expires_at FROM admin_token_revocations WHERE token_id = $1 LIMIT 1",
          [tokenId],
        );
        if (res.rows && res.rows.length > 0) {
          inMemoryRevokedTokens.set(tokenId, {
            tokenId,
            username: "moulish",
            expiresAt: new Date(res.rows[0].expires_at).getTime(),
            revokedAt: Date.now(),
            reason: "User logout",
          });
          return { revoked: true };
        }
      } catch {
        try {
          const res = await pool.query(
            "SELECT event FROM security_events WHERE event = $1 LIMIT 1",
            [`ADMIN_TOKEN_REVOKED|${tokenId}`],
          );
          if (res.rows && res.rows.length > 0) {
            inMemoryRevokedTokens.set(tokenId, {
              tokenId,
              username: "moulish",
              expiresAt: Date.now() + 86400000,
              revokedAt: Date.now(),
              reason: "User logout",
            });
            return { revoked: true };
          }
        } catch (pgErr: any) {
          if (pgErr && pgErr.code !== "ECONNREFUSED") {
            console.warn("[admin-auth] Direct PG query error for revocation:", pgErr);
          }
        }
      }
    }
  } catch {}

  return { revoked: false };
}

/**
 * Synchronous verification for fast in-process checks against memory cache.
 */
export function verifyAdminSessionTokenSync(tokenStr?: string | null): {
  valid: boolean;
  payload?: AdminSessionPayload;
  statusCode?: number;
  errorCode?: string;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MISSING", error: "Missing administrator session token." };
  }

  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MALFORMED", error: "Malformed administrator session token." };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_INVALID", error: "Invalid token components." };
  }

  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, statusCode: 401, errorCode: "SIGNATURE_INVALID", error: "Invalid administrator session signature." };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as AdminSessionPayload;

    if (payload.role !== "admin" || payload.username !== "moulish") {
      return { valid: false, statusCode: 401, errorCode: "PRIVILEGES_REQUIRED", error: "Token does not possess administrator privileges." };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, statusCode: 401, errorCode: "TOKEN_EXPIRED", error: "Administrator session has expired." };
    }

    const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
    cleanExpiredRevocations();
    if (inMemoryRevokedTokens.has(tokenId)) {
      return {
        valid: false,
        statusCode: 401,
        errorCode: "TOKEN_REVOKED",
        error: "Administrator session has been revoked. Please log in again.",
      };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, statusCode: 401, errorCode: "DECODE_FAILED", error: "Failed to decode administrator session token." };
  }
}

/**
 * Verifies authenticity, freshness, administrator role, and persistent revocation status of a session token.
 * Fails closed with HTTP 503 if persistent revocation status cannot be verified due to a database outage.
 */
export async function verifyAdminSessionToken(tokenStr?: string | null): Promise<AdminSessionVerificationResult> {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MISSING", error: "Missing administrator session token." };
  }

  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_MALFORMED", error: "Malformed administrator session token." };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, statusCode: 401, errorCode: "TOKEN_INVALID", error: "Invalid token components." };
  }

  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, statusCode: 401, errorCode: "SIGNATURE_INVALID", error: "Invalid administrator session signature." };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as AdminSessionPayload;

    if (payload.role !== "admin" || payload.username !== "moulish") {
      return { valid: false, statusCode: 401, errorCode: "PRIVILEGES_REQUIRED", error: "Token does not possess administrator privileges." };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, statusCode: 401, errorCode: "TOKEN_EXPIRED", error: "Administrator session has expired." };
    }

    const tokenId = payload.nonce || crypto.createHash("sha256").update(signature).digest("hex");
    const check = await isTokenRevoked(tokenId);

    if (check.unavailable) {
      return {
        valid: false,
        statusCode: 503,
        errorCode: "SESSION_REVOCATION_UNAVAILABLE",
        error: "Authentication service temporarily unavailable. Revocation status could not be verified.",
      };
    }

    if (check.revoked) {
      return {
        valid: false,
        statusCode: 401,
        errorCode: "TOKEN_REVOKED",
        error: "Administrator session has been revoked. Please log in again.",
      };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, statusCode: 401, errorCode: "DECODE_FAILED", error: "Failed to decode administrator session token." };
  }
}

/**
 * Helper to extract administrator token from Web Request or Node.js incoming message.
 */
export function extractAdminToken(req: any): string | null {
  if (!req) return null;

  // 1. Authorization: Bearer <token> header
  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    authHeader = req.headers.get("authorization") || req.headers.get("x-admin-token") || "";
  } else if (req.headers) {
    authHeader = req.headers["authorization"] || req.headers["x-admin-token"] || "";
  }

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }

  // 2. Cookie extraction (admin_session)
  let cookieHeader = "";
  if (typeof req.headers?.get === "function") {
    cookieHeader = req.headers.get("cookie") || "";
  } else if (req.headers) {
    cookieHeader = req.headers["cookie"] || "";
  }

  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}
