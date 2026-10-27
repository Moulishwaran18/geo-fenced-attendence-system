/**
 * CampusAttend — Hardened Staging-Only PostgreSQL Concurrency & Constraint Suite
 *
 * SAFETY MANDATES:
 * 1. NEVER connects to production. Hard-coded abort if URL matches production Supabase.
 * 2. Does NOT print secrets, tokens, passwords, or raw connection strings.
 * 3. Does NOT apply migrations automatically; verifies prerequisites in read-only mode first.
 * 4. Strictly requires affirmative staging confirmation environment variables:
 *      CAMPUSATTEND_STAGING_CONFIRMATION="I_CONFIRM_THIS_IS_STAGING_NOT_PRODUCTION"
 *      CAMPUSATTEND_ALLOW_DB_TESTS="true"
 * 5. Validates index definitions and predicates, not merely index names.
 * 6. Tests two-way device uniqueness by staff_code (Rule 1), public_key (Rule 2A), and key_id (Rule 2B).
 * 7. Uses isolated run-scoped identifiers (`stag_test_<timestamp>_<rand>`) for all test rows.
 * 8. Guarantees safe cleanup in finally blocks strictly scoped to test identifiers.
 * 9. Enforces strict TLS certificate verification (rejectUnauthorized: true) for remote connections.
 */

import pg from "pg";
const { Pool } = pg;
import type { PoolClient } from "pg";
import crypto from "crypto";
import fs from "fs";

// Production indicators to prevent accidental execution against production
const PRODUCTION_INDICATORS = [
  "qvjcxoznvhoagclbyhad", // Production Supabase project reference
  "campusattend-prod",
  "prod.supabase.co",
  "production",
  "-prod.",
  "prod-",
  "/prod",
  "campusattend_prod",
];

export interface StagingTestConfig {
  databaseUrl: string;
  caCertPath?: string;
}

export function validateStagingEnvironment(databaseUrl?: string): { valid: boolean; reason?: string; url?: URL } {
  if (!databaseUrl || typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    return {
      valid: false,
      reason: "Missing database connection URL. Please set STAGING_DATABASE_URL or DATABASE_URL.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    return { valid: false, reason: "Malformed database connection URL." };
  }

  // 1. Guard against known production hostnames/paths
  const fullUrlLower = databaseUrl.toLowerCase();
  for (const indicator of PRODUCTION_INDICATORS) {
    if (fullUrlLower.includes(indicator.toLowerCase())) {
      return {
        valid: false,
        reason: `FATAL: Target database URL contains production indicator ('${indicator}'). Execution aborted immediately.`,
      };
    }
  }

  // 2. Guard against production environment flags
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.ENV === "production"
  ) {
    return {
      valid: false,
      reason: "FATAL: Production environment detected via NODE_ENV / VERCEL_ENV / ENV. Staging tests cannot run in production mode.",
    };
  }

  // 3. Ambiguous remote target guard
  const host = parsed.hostname.toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  if (!isLocalHost) {
    const isExplicitlyStaging =
      host.includes("staging") ||
      host.includes("stage") ||
      host.includes("test") ||
      host.includes("dev") ||
      parsed.pathname.toLowerCase().includes("staging") ||
      parsed.pathname.toLowerCase().includes("test");

    const explicitlyAuthorizedHost = process.env.CAMPUSATTEND_EXPLICIT_REMOTE_STAGING_HOST;
    if (!isExplicitlyStaging && explicitlyAuthorizedHost !== host) {
      return {
        valid: false,
        reason: `FATAL: Ambiguous remote database host '${host}'. Target is neither localhost nor explicitly identified as staging/test/dev. Set CAMPUSATTEND_EXPLICIT_REMOTE_STAGING_HOST='${host}' to authorize.`,
      };
    }
  }

  // 4. Guard requiring explicit user confirmation
  if (process.env.CAMPUSATTEND_STAGING_CONFIRMATION !== "I_CONFIRM_THIS_IS_STAGING_NOT_PRODUCTION") {
    return {
      valid: false,
      reason:
        "Safety Lock Engaged: You must set CAMPUSATTEND_STAGING_CONFIRMATION='I_CONFIRM_THIS_IS_STAGING_NOT_PRODUCTION' to authorize database writes against a dedicated staging environment.",
    };
  }

  if (process.env.CAMPUSATTEND_ALLOW_DB_TESTS !== "true") {
    return {
      valid: false,
      reason:
        "Safety Lock Engaged: Set CAMPUSATTEND_ALLOW_DB_TESTS='true' to confirm that the configured database is a dedicated disposable staging instance.",
    };
  }

  return { valid: true, url: parsed };
}

export async function verifySchemaPrerequisites(client: PoolClient): Promise<{
  allPresent: boolean;
  missingObjects: string[];
  details: Record<string, boolean>;
}> {
  const missingObjects: string[] = [];
  const details: Record<string, boolean> = {};

  // 1. Verify required tables
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('attendance_challenges', 'devices', 'attendance_records', 'security_events')
  `);
  const foundTables = new Set(tablesRes.rows.map((r) => r.table_name));

  for (const t of ["attendance_challenges", "devices", "attendance_records", "security_events"]) {
    const present = foundTables.has(t);
    details[`table:${t}`] = present;
    if (!present) missingObjects.push(`Table: public.${t}`);
  }

  // 2. Verify required columns and widths
  const colsRes = await client.query(`
    SELECT table_name, column_name, character_maximum_length, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND (
        (table_name = 'attendance_challenges' AND column_name IN ('challenge', 'staff_code', 'device_id', 'status', 'expires_at', 'operation')) OR
        (table_name = 'devices' AND column_name IN ('id', 'staff_code', 'status', 'public_key', 'key_id')) OR
        (table_name = 'attendance_records' AND column_name IN ('id', 'staff_code', 'date', 'record_hash', 'tamper_status'))
      )
  `);
  const colsMap = new Map(colsRes.rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));

  const requiredCols = [
    "attendance_challenges.challenge",
    "attendance_challenges.staff_code",
    "attendance_challenges.device_id",
    "attendance_challenges.status",
    "attendance_challenges.expires_at",
    "attendance_challenges.operation",
    "devices.id",
    "devices.staff_code",
    "devices.status",
    "devices.public_key",
    "devices.key_id",
    "attendance_records.id",
    "attendance_records.staff_code",
    "attendance_records.date",
    "attendance_records.record_hash",
    "attendance_records.tamper_status",
  ];

  for (const col of requiredCols) {
    const r = colsMap.get(col);
    const present = !!r;
    details[`column:${col}`] = present;
    if (!present) {
      missingObjects.push(`Column: public.${col}`);
    } else if (col === "attendance_challenges.device_id") {
      // Check if device_id was widened to VARCHAR(128)
      const maxLen = r.character_maximum_length;
      if (typeof maxLen === "number" && maxLen < 128) {
        missingObjects.push(
          `Column: public.attendance_challenges.device_id width is VARCHAR(${maxLen}), expected VARCHAR(128) per migration 20261028`
        );
      }
    }
  }

  // 3. Verify unique indexes including predicates
  const idxRes = await client.query(`
    SELECT indexname, tablename, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND indexname IN (
        'idx_unique_staff_attendance_per_day',
        'idx_one_active_device_per_faculty',
        'idx_one_active_staff_per_device',
        'idx_one_active_staff_per_key_id'
      )
  `);
  const indexMap = new Map(idxRes.rows.map((r) => [r.indexname, r]));

  const requiredIndexes = [
    {
      name: "idx_unique_staff_attendance_per_day",
      table: "attendance_records",
      predicateTerms: [] as string[],
    },
    {
      name: "idx_one_active_device_per_faculty",
      table: "devices",
      predicateTerms: ["status", "Active"],
    },
    {
      name: "idx_one_active_staff_per_device",
      table: "devices",
      predicateTerms: ["status", "Active", "public_key", "IS NOT NULL"],
    },
    {
      name: "idx_one_active_staff_per_key_id",
      table: "devices",
      predicateTerms: ["status", "Active", "key_id", "IS NOT NULL"],
    },
  ];

  for (const reqIdx of requiredIndexes) {
    const found = indexMap.get(reqIdx.name);
    if (!found) {
      missingObjects.push(`Index: public.${reqIdx.name} (Missing index)`);
      details[`index:${reqIdx.name}`] = false;
      continue;
    }

    const defLower = found.indexdef.toLowerCase();
    if (!defLower.includes("unique index")) {
      missingObjects.push(`Index: public.${reqIdx.name} (Must be a UNIQUE index)`);
      details[`index:${reqIdx.name}`] = false;
      continue;
    }

    if (found.tablename !== reqIdx.table) {
      missingObjects.push(
        `Index: public.${reqIdx.name} (Expected on table '${reqIdx.table}', found on '${found.tablename}')`
      );
      details[`index:${reqIdx.name}`] = false;
      continue;
    }

    // Verify required predicate terms
    if (reqIdx.predicateTerms.length > 0) {
      const missingTerms = reqIdx.predicateTerms.filter((term) => !defLower.includes(term.toLowerCase()));
      if (missingTerms.length > 0) {
        missingObjects.push(
          `Index: public.${reqIdx.name} (Invalid predicate: missing terms [${missingTerms.join(", ")}] in '${found.indexdef}')`
        );
        details[`index:${reqIdx.name}`] = false;
        continue;
      }
    }

    details[`index:${reqIdx.name}`] = true;
  }

  // 4. Verify RPC function signature, return type, and security attributes
  const rpcRes = await client.query(`
    SELECT p.proname, 
           pg_get_function_identity_arguments(p.oid) as args,
           format_type(p.prorettype, null) as return_type,
           p.prosecdef as is_security_definer
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace = n.oid 
    WHERE n.nspname = 'public' 
      AND p.proname = 'atomic_verify_and_consume_attendance_challenge'
  `);

  if (rpcRes.rows.length === 0) {
    missingObjects.push("RPC: public.atomic_verify_and_consume_attendance_challenge (Function missing)");
    details["rpc:atomic_verify_and_consume_attendance_challenge"] = false;
  } else {
    const rpc = rpcRes.rows[0];
    const argsLower = (rpc.args || "").toLowerCase();
    const hasOperation = argsLower.includes("p_operation") || argsLower.includes("operation");
    const isJsonb = rpc.return_type?.toLowerCase() === "jsonb";
    const isSecDef = !!rpc.is_security_definer;

    if (!hasOperation) {
      missingObjects.push(
        "RPC: public.atomic_verify_and_consume_attendance_challenge (Missing 4th parameter p_operation; run migration 20261024 or 20261028)"
      );
      details["rpc:atomic_verify_and_consume_attendance_challenge"] = false;
    } else if (!isJsonb) {
      missingObjects.push(`RPC: atomic_verify_and_consume_attendance_challenge must return JSONB, got ${rpc.return_type}`);
      details["rpc:atomic_verify_and_consume_attendance_challenge"] = false;
    } else if (!isSecDef) {
      missingObjects.push("RPC: atomic_verify_and_consume_attendance_challenge must be marked SECURITY DEFINER");
      details["rpc:atomic_verify_and_consume_attendance_challenge"] = false;
    } else {
      details["rpc:atomic_verify_and_consume_attendance_challenge"] = true;
    }
  }

  return {
    allPresent: missingObjects.length === 0,
    missingObjects,
    details,
  };
}

export async function runStagingConcurrencySuite(rawDatabaseUrl?: string): Promise<{
  success: boolean;
  testResults: { name: string; passed: boolean; message?: string }[];
}> {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — STAGING POSTGRESQL CONCURRENCY TEST SUITE      ");
  console.log("=================================================================");

  const targetUrl = rawDatabaseUrl || process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
  const envCheck = validateStagingEnvironment(targetUrl);
  if (!envCheck.valid) {
    console.error(`\n[ABORTED] Environment validation failed: ${envCheck.reason}\n`);
    return {
      success: false,
      testResults: [{ name: "Environment Safety Check", passed: false, message: envCheck.reason }],
    };
  }

  const host = envCheck.url!.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const caCertPath = process.env.DATABASE_CA_CERT || process.env.PGSSLROOTCERT;

  let sslConfig: any = false;
  if (!isLocalHost) {
    if (caCertPath && fs.existsSync(caCertPath)) {
      sslConfig = {
        rejectUnauthorized: true,
        ca: fs.readFileSync(caCertPath, "utf-8"),
      };
    } else {
      sslConfig = {
        rejectUnauthorized: true,
      };
    }
  }

  // Print sanitized target information without exposing passwords or tokens
  const maskedUser = envCheck.url!.username ? envCheck.url!.username.slice(0, 3) + "***" : "none";
  console.log(`Target Host: ${host} (Port: ${envCheck.url!.port || 5432})`);
  console.log(`Database Name: ${envCheck.url!.pathname.replace(/^\//, "")}`);
  console.log(`Database User: ${maskedUser}`);
  console.log(`TLS Mode: ${sslConfig ? "STRICT (rejectUnauthorized: true)" : "Local / Non-TLS"}`);

  const pool = new Pool({
    connectionString: targetUrl,
    ssl: sslConfig,
    connectionTimeoutMillis: 10_000,
    max: 15,
  });

  const testResults: { name: string; passed: boolean; message?: string }[] = [];
  const RUN_ID = `stag_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  console.log(`Run-Scoped Test Prefix: ${RUN_ID}`);

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();

    // -------------------------------------------------------------------------
    // PRE-FLIGHT CHECK: Verify schema prerequisites in read-only mode
    // -------------------------------------------------------------------------
    console.log("\n[PRE-FLIGHT] Verifying required database objects before first write...");
    const prereqs = await verifySchemaPrerequisites(client);
    if (!prereqs.allPresent) {
      const msg = `Missing required database objects:\n  - ${prereqs.missingObjects.join("\n  - ")}\nApply pending migrations manually before executing this suite.`;
      console.error(`\n❌ PRE-FLIGHT FAILED: ${msg}\n`);
      return {
        success: false,
        testResults: [{ name: "Schema Prerequisites", passed: false, message: msg }],
      };
    }
    console.log("✓ Pre-flight passed: All required tables, columns, unique indexes, predicates, and RPCs are verified.");

    // -------------------------------------------------------------------------
    // TEST 1: Concurrent Challenge Consumption via RPC (FOR UPDATE Lock)
    // -------------------------------------------------------------------------
    const test1Name = "1. Concurrent Challenge Consumption (10 parallel workers on same nonce)";
    try {
      const testChallenge = `${RUN_ID}_CHAL_PUNCH`;
      const testStaff = `${RUN_ID}_FAC1`;
      const testDevice = `${RUN_ID}_DEV1`;

      await client.query(
        `INSERT INTO public.attendance_challenges (challenge, staff_code, device_id, operation, expires_at, status)
         VALUES ($1, $2, $3, 'ATTENDANCE_PUNCH', NOW() + INTERVAL '5 minutes', 'ACTIVE')`,
        [testChallenge, testStaff, testDevice]
      );

      const workers = Array.from({ length: 10 }, async (_, idx) => {
        const res = await pool.query(
          "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, $3, 'ATTENDANCE_PUNCH') AS result",
          [testChallenge, testStaff, testDevice]
        );
        return { worker: idx, result: res.rows[0]?.result };
      });

      const results = await Promise.all(workers);
      const successes = results.filter((r) => r.result?.valid === true);
      const alreadyConsumed = results.filter((r) => r.result?.error === "CHALLENGE_ALREADY_CONSUMED");

      if (successes.length !== 1 || alreadyConsumed.length !== 9) {
        throw new Error(
          `Atomic lock failure: Expected exactly 1 success and 9 CHALLENGE_ALREADY_CONSUMED. Got: ${successes.length} successes, ${alreadyConsumed.length} rejected.`
        );
      }

      console.log(`  ✓ PASS: ${test1Name} (1 granted, 9 serialized & rejected)`);
      testResults.push({ name: test1Name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${test1Name}:`, err.message);
      testResults.push({ name: test1Name, passed: false, message: err.message });
    }

    // -------------------------------------------------------------------------
    // TEST 2: Expired Challenge Rejection in Database
    // -------------------------------------------------------------------------
    const test2Name = "2. Expired Challenge Rejection & Status Transition";
    try {
      const expiredChallenge = `${RUN_ID}_CHAL_EXP`;
      const testStaff = `${RUN_ID}_FAC1`;
      const testDevice = `${RUN_ID}_DEV1`;

      await client.query(
        `INSERT INTO public.attendance_challenges (challenge, staff_code, device_id, operation, expires_at, status)
         VALUES ($1, $2, $3, 'ATTENDANCE_PUNCH', NOW() - INTERVAL '10 seconds', 'ACTIVE')`,
        [expiredChallenge, testStaff, testDevice]
      );

      const expRes = await client.query(
        "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, $3, 'ATTENDANCE_PUNCH') AS result",
        [expiredChallenge, testStaff, testDevice]
      );

      const res = expRes.rows[0]?.result;
      if (res?.valid !== false || res?.error !== "CHALLENGE_EXPIRED") {
        throw new Error(`Expected CHALLENGE_EXPIRED, got: ${JSON.stringify(res)}`);
      }

      const checkRes = await client.query(
        "SELECT status FROM public.attendance_challenges WHERE challenge = $1",
        [expiredChallenge]
      );
      if (checkRes.rows[0]?.status !== "EXPIRED") {
        throw new Error(`Expected row status 'EXPIRED', got '${checkRes.rows[0]?.status}'`);
      }

      console.log(`  ✓ PASS: ${test2Name}`);
      testResults.push({ name: test2Name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${test2Name}:`, err.message);
      testResults.push({ name: test2Name, passed: false, message: err.message });
    }

    // -------------------------------------------------------------------------
    // TEST 3: Challenge Parameter Mismatch Rejection (Staff, Device, Operation)
    // -------------------------------------------------------------------------
    const test3Name = "3. Challenge Tampering & Parameter Mismatch Rejection";
    try {
      const chalMismatch = `${RUN_ID}_CHAL_MIS`;
      const testStaff = `${RUN_ID}_FAC1`;
      const testDevice = `${RUN_ID}_DEV1`;

      await client.query(
        `INSERT INTO public.attendance_challenges (challenge, staff_code, device_id, operation, expires_at, status)
         VALUES ($1, $2, $3, 'ATTENDANCE_PUNCH', NOW() + INTERVAL '5 minutes', 'ACTIVE')`,
        [chalMismatch, testStaff, testDevice]
      );

      // Wrong operation
      const opRes = await client.query(
        "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, $3, 'DEVICE_REGISTRATION') AS result",
        [chalMismatch, testStaff, testDevice]
      );
      if (opRes.rows[0]?.result?.error !== "CHALLENGE_OPERATION_MISMATCH") {
        throw new Error(`Expected CHALLENGE_OPERATION_MISMATCH, got: ${JSON.stringify(opRes.rows[0]?.result)}`);
      }

      // Wrong staff
      const staffRes = await client.query(
        "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, $3, 'ATTENDANCE_PUNCH') AS result",
        [chalMismatch, `${RUN_ID}_FAC2`, testDevice]
      );
      if (staffRes.rows[0]?.result?.error !== "CHALLENGE_STAFF_MISMATCH") {
        throw new Error(`Expected CHALLENGE_STAFF_MISMATCH, got: ${JSON.stringify(staffRes.rows[0]?.result)}`);
      }

      // Wrong device
      const devRes = await client.query(
        "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, $3, 'ATTENDANCE_PUNCH') AS result",
        [chalMismatch, testStaff, `${RUN_ID}_DEV2`]
      );
      if (devRes.rows[0]?.result?.error !== "CHALLENGE_DEVICE_MISMATCH") {
        throw new Error(`Expected CHALLENGE_DEVICE_MISMATCH, got: ${JSON.stringify(devRes.rows[0]?.result)}`);
      }

      console.log(`  ✓ PASS: ${test3Name}`);
      testResults.push({ name: test3Name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${test3Name}:`, err.message);
      testResults.push({ name: test3Name, passed: false, message: err.message });
    }

    // -------------------------------------------------------------------------
    // TEST 4: Duplicate Daily Attendance Punch Concurrency (ON CONFLICT)
    // -------------------------------------------------------------------------
    const test4Name = "4. Duplicate Daily Attendance Concurrency (ON CONFLICT DO NOTHING)";
    try {
      const testStaff = `${RUN_ID}_FAC1`;
      const testDate = new Date().toISOString().slice(0, 10);
      const testDevice = `${RUN_ID}_DEV1`;
      const testHash = crypto.createHmac("sha256", "test_secret").update(`${testStaff}:${testDate}`).digest("hex");

      const punches = Array.from({ length: 5 }, async () => {
        return pool.query(
          `INSERT INTO public.attendance_records 
           (staff_code, staff_name, department, date, day, time, status, location, verification, latitude, longitude, device_id, record_hash, tamper_status)
           VALUES ($1, 'Dr. Staging Test', 'Computer Science', $2, 'Tuesday', '09:00:00', 'Present', 'Main Campus Gate', 'Verified', 11.6765, 78.1227, $3, $4, 'VERIFIED')
           ON CONFLICT (staff_code, date) DO NOTHING
           RETURNING id`,
          [testStaff, testDate, testDevice, testHash]
        );
      });

      const punchResults = await Promise.all(punches);
      const insertedRows = punchResults.filter((r) => r.rows.length > 0);

      if (insertedRows.length !== 1) {
        throw new Error(`Expected exactly 1 insert to succeed, got ${insertedRows.length}`);
      }

      const countRes = await client.query(
        "SELECT count(*)::int as count FROM public.attendance_records WHERE staff_code = $1 AND date = $2",
        [testStaff, testDate]
      );
      if (countRes.rows[0]?.count !== 1) {
        throw new Error(`Expected exactly 1 row in table, found ${countRes.rows[0]?.count}`);
      }

      console.log(`  ✓ PASS: ${test4Name} (1 inserted, 4 conflict ignored)`);
      testResults.push({ name: test4Name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${test4Name}:`, err.message);
      testResults.push({ name: test4Name, passed: false, message: err.message });
    }

    // -------------------------------------------------------------------------
    // TEST 5: Two-Way Device Uniqueness Constraints (Rules 1, 2A, and 2B)
    // -------------------------------------------------------------------------
    const test5Name = "5. Two-Way Device Uniqueness (staff_code, public_key, and key_id)";
    try {
      const pubKeyA = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(`${RUN_ID}_KEY_A`).toString("base64")}\n-----END PUBLIC KEY-----`;
      const pubKeyB = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(`${RUN_ID}_KEY_B`).toString("base64")}\n-----END PUBLIC KEY-----`;
      const pubKeyC = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(`${RUN_ID}_KEY_C`).toString("base64")}\n-----END PUBLIC KEY-----`;
      const staff1 = `${RUN_ID}_FAC1`;
      const staff2 = `${RUN_ID}_FAC2`;
      const staff3 = `${RUN_ID}_FAC3`;
      const devId1 = `${RUN_ID}_DEV_A`;
      const devId2 = `${RUN_ID}_DEV_B`;
      const devId3 = `${RUN_ID}_DEV_C`;
      const devId4 = `${RUN_ID}_DEV_D`;

      // 1. Initial valid binding: Staff 1 <-> Device A (key_id: devId1, public_key: pubKeyA)
      await client.query(
        `INSERT INTO public.devices (id, staff_code, staff_name, model, os, status, public_key, key_id)
         VALUES ($1, $2, 'Faculty One', 'Pixel 8', 'Android 14', 'Active', $3, $1)`,
        [devId1, staff1, pubKeyA]
      );

      // 2. Rule 1 Test: Attempt to bind Staff 1 to a SECOND active device (Device B)
      let rule1Blocked = false;
      try {
        await client.query(
          `INSERT INTO public.devices (id, staff_code, staff_name, model, os, status, public_key, key_id)
           VALUES ($1, $2, 'Faculty One', 'Pixel 8 (Second)', 'Android 14', 'Active', $3, $1)`,
          [devId2, staff1, pubKeyB]
        );
      } catch (err: any) {
        if (err.code === "23505") rule1Blocked = true;
      }
      if (!rule1Blocked) {
        throw new Error("RULE 1 VIOLATION: Database allowed multiple active devices for one faculty account (idx_one_active_device_per_faculty)!");
      }

      // 3. Rule 2A Test: Attempt to bind Staff 2 to Device A's public key (pubKeyA)
      let rule2aBlocked = false;
      try {
        await client.query(
          `INSERT INTO public.devices (id, staff_code, staff_name, model, os, status, public_key, key_id)
           VALUES ($1, $2, 'Faculty Two', 'Pixel 8', 'Android 14', 'Active', $3, $1)`,
          [devId3, staff2, pubKeyA]
        );
      } catch (err: any) {
        if (err.code === "23505") rule2aBlocked = true;
      }
      if (!rule2aBlocked) {
        throw new Error("RULE 2A VIOLATION: Database allowed one physical device public_key to be bound to multiple accounts (idx_one_active_staff_per_device)!");
      }

      // 4. Rule 2B Test: Attempt to bind Staff 3 to Device A's key_id (devId1) with a distinct public key (pubKeyC)
      let rule2bBlocked = false;
      try {
        await client.query(
          `INSERT INTO public.devices (id, staff_code, staff_name, model, os, status, public_key, key_id)
           VALUES ($1, $2, 'Faculty Three', 'Pixel 8', 'Android 14', 'Active', $3, $4)`,
          [devId4, staff3, pubKeyC, devId1]
        );
      } catch (err: any) {
        if (err.code === "23505") rule2bBlocked = true;
      }
      if (!rule2bBlocked) {
        throw new Error("RULE 2B VIOLATION: Database allowed one registered key_id to be bound to multiple accounts (idx_one_active_staff_per_key_id)!");
      }

      console.log(`  ✓ PASS: ${test5Name} (All 3 partial unique indexes enforced: staff_code, public_key, key_id)`);
      testResults.push({ name: test5Name, passed: true });
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${test5Name}:`, err.message);
      testResults.push({ name: test5Name, passed: false, message: err.message });
    }

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP: Strictly remove only rows created with this run's RUN_ID
    // -------------------------------------------------------------------------
    console.log("\n[CLEANUP] Purging run-scoped staging test data...");

    // Enforce safety assertions on RUN_ID before executing any deletes
    if (!RUN_ID || RUN_ID.length < 20 || !RUN_ID.startsWith("stag_")) {
      console.error("  ❌ CRITICAL SAFETY HALT: Test RUN_ID is corrupt or too short. Aborting delete.");
    } else {
      const cleanupPrefix = `${RUN_ID}%`;

      // Use active client or spawn a fresh client if primary client died
      let cleanClient: PoolClient | null = client;
      let freshSpawned = false;
      try {
        if (!cleanClient) {
          cleanClient = await pool.connect();
          freshSpawned = true;
        }

        const cleanupTasks = [
          {
            table: "attendance_challenges",
            query: "DELETE FROM public.attendance_challenges WHERE challenge LIKE $1",
          },
          {
            table: "attendance_records",
            query: "DELETE FROM public.attendance_records WHERE staff_code LIKE $1",
          },
          {
            table: "devices",
            query: "DELETE FROM public.devices WHERE id LIKE $1 OR staff_code LIKE $1",
          },
          {
            table: "security_events",
            query: "DELETE FROM public.security_events WHERE staff LIKE $1",
          },
        ];

        for (const task of cleanupTasks) {
          try {
            const res = await cleanClient.query(task.query, [cleanupPrefix]);
            console.log(`  ✓ Cleaned public.${task.table}: ${res.rowCount || 0} rows removed`);
          } catch (delErr: any) {
            console.error(`  ⚠️ Cleanup error on public.${task.table}:`, delErr.message);
          }
        }
      } catch (poolErr: any) {
        console.error("  ⚠️ Fatal error acquiring cleanup connection:", poolErr.message);
      } finally {
        if (cleanClient) {
          cleanClient.release();
        }
      }
    }

    await pool.end();
  }

  const allPassed = testResults.length > 0 && testResults.every((r) => r.passed);
  console.log("\n=================================================================");
  console.log(`   SUITE SUMMARY: ${allPassed ? "ALL TESTS PASSED" : "ONE OR MORE TESTS FAILED"}`);
  console.log("=================================================================");
  return { success: allPassed, testResults };
}

// Direct CLI entry point
if (process.argv[1] && process.argv[1].endsWith("staging-postgres-concurrency-test.ts")) {
  runStagingConcurrencySuite()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("UNHANDLED SUITE ERROR:", err);
      process.exit(1);
    });
}
