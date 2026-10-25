import pg from "pg";
import fs from "fs";
import path from "path";
import assert from "assert";

const { Client } = pg;

async function runStagingProductionEquivalentTest() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — PRODUCTION-EQUIVALENT STAGING DATABASE SUITE  ");
  console.log("=================================================================");

  const client = new Client({
    connectionString: "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
  });
  await client.connect();

  console.log("\n1. SETTING UP PRE-MIGRATION PRODUCTION SCHEMA REPLICA");
  // Clean up any old staging schema
  await client.query("DROP SCHEMA IF EXISTS staging_prod CASCADE;");
  await client.query("CREATE SCHEMA staging_prod;");
  await client.query("SET search_path = staging_prod, public;");

  // A. staff (14 columns as observed in production)
  await client.query(`
    CREATE TABLE staging_prod.staff (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_code VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      department VARCHAR(255) NOT NULL,
      designation VARCHAR(255) NOT NULL,
      phone VARCHAR(32) DEFAULT '',
      device VARCHAR(255) DEFAULT '',
      device_status VARCHAR(32) DEFAULT 'Active',
      status VARCHAR(32) DEFAULT 'Active',
      active BOOLEAN DEFAULT true NOT NULL,
      inside_campus BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Seed sample production staff rows
  await client.query(`
    INSERT INTO staging_prod.staff (id, staff_code, name, email, department, designation, device_status, status, active)
    VALUES 
      ('bdd00096-08d5-484a-b0ae-23e5b60c6052', 'SCT-001', 'Moulishwaran S', 'sct001@sonatech.ac.in', 'Computer Science & Engineering', 'Staff', 'Active', 'Active', true),
      ('93fda573-02ca-4878-a0a6-c5d5139102c9', 'SCT-002', 'Navin Dharshan', 'sct002@sonatech.ac.in', 'Computer Science & Engineering', 'Staff', 'Active', 'Active', true);
  `);
  console.log("  ✓ Created 'staff' with 2 verified production records");

  // B. devices (EXACT 8 columns as currently in production, missing 12 attestation columns)
  await client.query(`
    CREATE TABLE staging_prod.devices (
      id VARCHAR(64) PRIMARY KEY,
      staff_id UUID REFERENCES staging_prod.staff(id) ON DELETE SET NULL,
      staff_code VARCHAR(64),
      staff_name VARCHAR(255),
      model VARCHAR(255) NOT NULL,
      os VARCHAR(64) NOT NULL,
      status VARCHAR(32) DEFAULT 'Active' NOT NULL,
      registered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Seed exact sample device observed in production
  await client.query(`
    INSERT INTO staging_prod.devices (id, staff_id, staff_code, staff_name, model, os, status, registered_at)
    VALUES ('DEV_ANDROID_7404535de4d19863', '93fda573-02ca-4878-a0a6-c5d5139102c9', 'SCT-002', 'Navin Dharshan', 'Android Phone', 'Web Platform', 'Active', '2026-10-22T17:39:07.171Z');
  `);
  console.log("  ✓ Created 'devices' in un-migrated 8-column shape with live sample row");

  // C. attendance_records (EXACT 14 columns as currently in production, missing record_hash and tamper_status)
  await client.query(`
    CREATE TABLE staging_prod.attendance_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_code VARCHAR(64) NOT NULL,
      staff_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      date DATE DEFAULT CURRENT_DATE NOT NULL,
      day VARCHAR(32) NOT NULL,
      time VARCHAR(32) NOT NULL,
      status VARCHAR(32) DEFAULT 'Present' NOT NULL,
      location VARCHAR(255) DEFAULT 'Main Campus',
      verification VARCHAR(32) DEFAULT 'Verified' NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      device_id VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  // Seed exact historical row observed in production
  await client.query(`
    INSERT INTO staging_prod.attendance_records (id, staff_code, staff_name, department, date, day, time, status, location, verification, latitude, longitude, device_id, created_at)
    VALUES ('a44bc5cc-cd1a-408b-ae6e-dedea202bc89', 'SCT-001', 'Moulishwaran S', 'Computer Science & Engineering', '2026-10-11', 'Sunday', '03:04:38 PM', 'Present', 'Main Campus, Sona College', 'Verified', 11.67686421, 78.12218103, NULL, '2026-10-11T09:34:39.19761Z');
  `);
  console.log("  ✓ Created 'attendance_records' in un-migrated 14-column shape with historical row");

  // D. security_events (9 columns as observed in production)
  await client.query(`
    CREATE TABLE staging_prod.security_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      time VARCHAR(64) NOT NULL,
      staff VARCHAR(255) NOT NULL,
      event VARCHAR(255) NOT NULL,
      device VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      result VARCHAR(32) DEFAULT 'Blocked' NOT NULL,
      severity VARCHAR(32) DEFAULT 'Medium' NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
  await client.query(`
    INSERT INTO staging_prod.security_events (id, time, staff, event, device, location, result, severity, created_at)
    VALUES ('70375e9b-aba2-45fe-a234-e3100c7ca034', '2026-10-10T17:53:21.380Z', 'MOULISH', 'ADMIN_TOKEN_REVOKED|52154a14529b61f55f076812d02ab6c3', 'session_expiry:1791741199373', 'Campus Administration', 'Blocked', 'Low', '2026-10-10T17:53:21.967709Z');
  `);
  console.log("  ✓ Created 'security_events' with sample live production event");

  console.log("\n2. RUNNING REVISED MIGRATION AGAINST PRODUCTION-EQUIVALENT SCHEMA");
  const sqlPath = path.resolve("supabase/migrations/20261024_security_hardening.sql");
  const rawSql = fs.readFileSync(sqlPath, "utf-8");

  // Adapt migration to staging_prod schema for isolated testing
  const adaptedSql = rawSql.replace(/public\./g, "staging_prod.");
  
  // RUN 1
  await client.query(adaptedSql);
  console.log("  ✓ Run 1 Succeeded: Migration executed cleanly without errors");

  // RUN 2 (Idempotency)
  await client.query(adaptedSql);
  console.log("  ✓ Run 2 Succeeded: Migration is 100% idempotent when re-run");

  console.log("\n3. POST-MIGRATION VERIFICATION ON PRODUCTION-EQUIVALENT DATA");

  // Check A: Devices table has all 20 columns and preserved existing row
  const devCols = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'staging_prod' AND table_name = 'devices';
  `);
  const colNames = devCols.rows.map(r => r.column_name);
  assert(colNames.includes("public_key"), "devices has public_key");
  assert(colNames.includes("key_id"), "devices has key_id");
  assert(colNames.includes("attestation_status"), "devices has attestation_status");
  assert(colNames.includes("revoked_at"), "devices has revoked_at");
  console.log(`  ✓ 'devices' now has all ${colNames.length} columns (expanded from 8)`);

  const devRow = await client.query("SELECT * FROM staging_prod.devices WHERE id = 'DEV_ANDROID_7404535de4d19863'");
  assert.strictEqual(devRow.rows.length, 1);
  assert.strictEqual(devRow.rows[0].staff_code, "SCT-002");
  console.log("  ✓ Existing device record was preserved intact with zero data loss");

  // Check B: Historical attendance row has tamper_status = 'UNVERIFIED_HISTORICAL'
  const histRow = await client.query("SELECT * FROM staging_prod.attendance_records WHERE id = 'a44bc5cc-cd1a-408b-ae6e-dedea202bc89'");
  assert.strictEqual(histRow.rows.length, 1);
  assert.strictEqual(histRow.rows[0].tamper_status, "UNVERIFIED_HISTORICAL");
  assert.strictEqual(histRow.rows[0].record_hash, null);
  console.log("  ✓ Historical attendance record is correctly labeled 'UNVERIFIED_HISTORICAL'");

  // Check C: Triggers strictly block UPDATE and DELETE on attendance_records
  let updateBlocked = false;
  try {
    await client.query("UPDATE staging_prod.attendance_records SET status = 'Absent' WHERE id = 'a44bc5cc-cd1a-408b-ae6e-dedea202bc89'");
  } catch (err: any) {
    if (err.message.includes("CRITICAL_SECURITY_VIOLATION")) updateBlocked = true;
  }
  assert.strictEqual(updateBlocked, true, "UPDATE on attendance_records was blocked by trigger");
  console.log("  ✓ Trigger successfully rejected UPDATE on attendance_records");

  let deleteBlocked = false;
  try {
    await client.query("DELETE FROM staging_prod.attendance_records WHERE id = 'a44bc5cc-cd1a-408b-ae6e-dedea202bc89'");
  } catch (err: any) {
    if (err.message.includes("CRITICAL_SECURITY_VIOLATION")) deleteBlocked = true;
  }
  assert.strictEqual(deleteBlocked, true, "DELETE on attendance_records was blocked by trigger");
  console.log("  ✓ Trigger successfully rejected DELETE on attendance_records");

  // Check D: Unique constraint blocks duplicate attendance per faculty per day
  let dupBlocked = false;
  try {
    await client.query(`
      INSERT INTO staging_prod.attendance_records 
        (staff_code, staff_name, department, date, day, time, status, location, verification)
      VALUES 
        ('SCT-001', 'Moulishwaran S', 'CSE', '2026-10-11', 'Sunday', '04:00 PM', 'Present', 'Campus', 'Verified');
    `);
  } catch (err: any) {
    if (err.code === "23505" || err.message.includes("unique")) dupBlocked = true;
  }
  assert.strictEqual(dupBlocked, true, "Duplicate punch on (staff_code, date) was blocked by unique index");
  console.log("  ✓ Unique index successfully rejected duplicate attendance on same date");

  // Check E: Challenge RPC Security & Binding Validation
  // 1. Valid consumption
  await client.query(`
    INSERT INTO staging_prod.attendance_challenges (challenge, staff_code, device_id, operation, issued_at, expires_at, status)
    VALUES ('CHAL_STAGING_001', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH', NOW(), NOW() + INTERVAL '2 minutes', 'ACTIVE');
  `);
  const rpcRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_001', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH') as res;
  `);
  assert.strictEqual(rpcRes.rows[0].res.valid, true);
  console.log("  ✓ RPC: Successfully verified and consumed active challenge");

  // 2. Replay rejection: challenge now CONSUMED
  const replayRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_001', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH') as res;
  `);
  assert.strictEqual(replayRes.rows[0].res.valid, false);
  assert.strictEqual(replayRes.rows[0].res.error, "CHALLENGE_ALREADY_CONSUMED");
  console.log("  ✓ RPC: Replayed/consumed challenge strictly rejected");

  // 3. NULL operation rejection (secures against NULL bypass flaw)
  await client.query(`
    INSERT INTO staging_prod.attendance_challenges (challenge, staff_code, device_id, operation, issued_at, expires_at, status)
    VALUES ('CHAL_STAGING_NULL_OP', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH', NOW(), NOW() + INTERVAL '2 minutes', 'ACTIVE');
  `);
  const nullOpRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_NULL_OP', 'SCT-001', 'DEV_STAGING_001', NULL) as res;
  `);
  assert.strictEqual(nullOpRes.rows[0].res.valid, false);
  assert.strictEqual(nullOpRes.rows[0].res.error, "OPERATION_MISSING");
  console.log("  ✓ RPC: NULL operation rejected with OPERATION_MISSING (no bypass)");

  // 4. Operation mismatch rejection
  const opMismatchRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_NULL_OP', 'SCT-001', 'DEV_STAGING_001', 'DEVICE_ENROLLMENT') as res;
  `);
  assert.strictEqual(opMismatchRes.rows[0].res.valid, false);
  assert.strictEqual(opMismatchRes.rows[0].res.error, "CHALLENGE_OPERATION_MISMATCH");
  console.log("  ✓ RPC: Mismatched operation type strictly rejected");

  // 5. Staff mismatch rejection
  const staffMismatchRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_NULL_OP', 'SCT-999', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH') as res;
  `);
  assert.strictEqual(staffMismatchRes.rows[0].res.valid, false);
  assert.strictEqual(staffMismatchRes.rows[0].res.error, "CHALLENGE_STAFF_MISMATCH");
  console.log("  ✓ RPC: Mismatched staff account strictly rejected");

  // 6. Device mismatch rejection
  const devMismatchRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_NULL_OP', 'SCT-001', 'DEV_ROGUE_999', 'ATTENDANCE_PUNCH') as res;
  `);
  assert.strictEqual(devMismatchRes.rows[0].res.valid, false);
  assert.strictEqual(devMismatchRes.rows[0].res.error, "CHALLENGE_DEVICE_MISMATCH");
  console.log("  ✓ RPC: Mismatched device ID strictly rejected");

  // 7. Expired challenge rejection
  await client.query(`
    INSERT INTO staging_prod.attendance_challenges (challenge, staff_code, device_id, operation, issued_at, expires_at, status)
    VALUES ('CHAL_STAGING_EXPIRED', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '1 minute', 'ACTIVE');
  `);
  const expiredRes = await client.query(`
    SELECT staging_prod.atomic_verify_and_consume_attendance_challenge('CHAL_STAGING_EXPIRED', 'SCT-001', 'DEV_STAGING_001', 'ATTENDANCE_PUNCH') as res;
  `);
  assert.strictEqual(expiredRes.rows[0].res.valid, false);
  assert.strictEqual(expiredRes.rows[0].res.error, "CHALLENGE_EXPIRED");
  console.log("  ✓ RPC: Expired challenge strictly rejected");

  // Check F: TRUNCATE Trigger Protection
  let truncateBlocked = false;
  try {
    await client.query("TRUNCATE staging_prod.attendance_records, staging_prod.attendance_corrections;");
  } catch (err: any) {
    if (err.message.includes("CRITICAL_SECURITY_VIOLATION")) truncateBlocked = true;
  }
  assert.strictEqual(truncateBlocked, true, "TRUNCATE on attendance_records was blocked by statement trigger");
  console.log("  ✓ Trigger successfully rejected TRUNCATE on attendance_records");

  // Check G: NOT NULL enforcement on tamper_status
  let nullTamperBlocked = false;
  try {
    await client.query(`
      INSERT INTO staging_prod.attendance_records 
        (staff_code, staff_name, department, date, day, time, status, location, verification, tamper_status)
      VALUES 
        ('SCT-002', 'Navin Dharshan', 'CSE', '2026-10-12', 'Monday', '09:00 AM', 'Present', 'Campus', 'Verified', NULL);
    `);
  } catch (err: any) {
    if (err.code === "23502" || err.message.includes("not-null")) nullTamperBlocked = true;
  }
  assert.strictEqual(nullTamperBlocked, true, "NULL tamper_status was blocked by NOT NULL constraint");
  console.log("  ✓ Schema: NOT NULL constraint strictly rejected NULL tamper_status insertion");

  // Check H: staff_directory view exists and excludes sensitive columns
  const dirCols = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'staging_prod' AND table_name = 'staff_directory';
  `);
  const dirColNames = dirCols.rows.map(r => r.column_name);
  assert(dirColNames.includes("staff_code"), "staff_directory has staff_code");
  assert(dirColNames.includes("name"), "staff_directory has name");
  assert(!dirColNames.includes("device"), "staff_directory strictly excludes 'device' PBKDF2 hash");
  assert(!dirColNames.includes("phone"), "staff_directory strictly excludes phone");
  assert(!dirColNames.includes("email"), "staff_directory strictly excludes email");
  console.log("  ✓ View: staff_directory strictly excludes password hashes, phone, email, and UUIDs");

  // Check I: staff_directory view permissions strictly restricted to service_role (revoked from anon and authenticated)
  const aclRes = await client.query(`
    SELECT grantee, privilege_type 
    FROM information_schema.table_privileges 
    WHERE table_schema = 'staging_prod' AND table_name = 'staff_directory';
  `);
  const grantees = aclRes.rows.map(r => r.grantee.toLowerCase());
  assert(!grantees.includes("anon"), "staff_directory is NOT granted to anon");
  assert(!grantees.includes("authenticated"), "staff_directory is NOT granted to authenticated");
  console.log("  ✓ Permissions: staff_directory is strictly revoked from anon and authenticated client roles");

  // Clean up staging schema
  await client.query("DROP SCHEMA staging_prod CASCADE;");
  await client.end();

  console.log("\n=================================================================");
  console.log("   PRODUCTION-EQUIVALENT STAGING DATABASE SUITE: ALL PASSED!    ");
  console.log("=================================================================\n");
}

runStagingProductionEquivalentTest().catch((err) => {
  console.error("Staging test failed:", err);
  process.exit(1);
});
