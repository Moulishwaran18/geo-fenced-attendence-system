import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/campus_biometrics",
});

async function run() {
  console.log("--- Testing Database Immutability & Triggers ---");
  const client = await pool.connect();
  try {
    // 1. Clean test row if exists
    // Temporarily disable trigger for test setup cleanup if necessary, or use unique staff code
    const testStaff = "TEST_SECURITY_STAFF_" + Date.now();
    const today = "2026-10-24";

    // 2. Insert verified attendance record
    const ins = await client.query(
      `INSERT INTO public.attendance_records 
       (staff_code, staff_name, department, date, day, time, status, verification) 
       VALUES ($1, 'Security Test Staff', 'CyberSecurity', $2, 'Saturday', '09:00 AM', 'Present', 'Verified') 
       RETURNING id`,
      [testStaff, today]
    );
    const recId = ins.rows[0].id;
    console.log("✓ Step 1: Initial verified record inserted. ID:", recId);

    // 3. Test UPDATE rejection
    let updateBlocked = false;
    try {
      await client.query("UPDATE public.attendance_records SET status = 'Absent' WHERE id = $1", [recId]);
    } catch (err) {
      updateBlocked = true;
      console.log("✓ Step 2: UPDATE blocked by trigger:", err.message);
    }
    if (!updateBlocked) {
      throw new Error("FAIL: UPDATE was not blocked by immutable trigger!");
    }

    // 4. Test DELETE rejection
    let deleteBlocked = false;
    try {
      await client.query("DELETE FROM public.attendance_records WHERE id = $1", [recId]);
    } catch (err) {
      deleteBlocked = true;
      console.log("✓ Step 3: DELETE blocked by trigger:", err.message);
    }
    if (!deleteBlocked) {
      throw new Error("FAIL: DELETE was not blocked by immutable trigger!");
    }

    // 5. Test Duplicate punch prevention (unique index)
    let duplicateBlocked = false;
    try {
      await client.query(
        `INSERT INTO public.attendance_records 
         (staff_code, staff_name, department, date, day, time, status, verification) 
         VALUES ($1, 'Security Test Staff', 'CyberSecurity', $2, 'Saturday', '09:05 AM', 'Present', 'Verified')`,
        [testStaff, today]
      );
    } catch (err) {
      duplicateBlocked = true;
      console.log("✓ Step 4: Duplicate punch blocked by unique constraint:", err.message);
    }
    if (!duplicateBlocked) {
      throw new Error("FAIL: Duplicate punch on same day was not blocked!");
    }

    // 6. Test Controlled Attendance Correction table
    const corr = await client.query(
      `INSERT INTO public.attendance_corrections
       (attendance_id, original_status, corrected_status, reason, authorized_by, audit_hash)
       VALUES ($1, 'Present', 'Late', 'Late arrival authorized by Dean - train delay', 'admin_moulish', 'hash_test_123')
       RETURNING id, created_at`,
      [recId]
    );
    console.log("✓ Step 5: Controlled correction record inserted. Correction ID:", corr.rows[0].id);

    // 7. Verify original record was NOT modified
    const original = await client.query("SELECT status FROM public.attendance_records WHERE id = $1", [recId]);
    if (original.rows[0].status !== "Present") {
      throw new Error("FAIL: Original record was modified!");
    }
    console.log("✓ Step 6: Original attendance record preserved unchanged with status:", original.rows[0].status);

    // 8. Test Atomic Challenge RPC
    const testChallenge = "chal_" + Date.now();
    await client.query(
      `INSERT INTO public.attendance_challenges (challenge, staff_code, device_id, expires_at)
       VALUES ($1, $2, 'DEV-SEC-01', NOW() + INTERVAL '120 seconds')`,
      [testChallenge, testStaff]
    );
    console.log("✓ Step 7: Created attendance challenge:", testChallenge);

    // First consumption succeeds
    const consume1 = await client.query(
      "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, 'DEV-SEC-01') AS res",
      [testChallenge, testStaff]
    );
    console.log("✓ Step 8: First challenge consumption:", consume1.rows[0].res);
    if (!consume1.rows[0].res.valid) {
      throw new Error("FAIL: Valid challenge consumption failed!");
    }

    // Second consumption MUST fail (single-use replay prevention)
    const consume2 = await client.query(
      "SELECT public.atomic_verify_and_consume_attendance_challenge($1, $2, 'DEV-SEC-01') AS res",
      [testChallenge, testStaff]
    );
    console.log("✓ Step 9: Replayed challenge consumption (must fail):", consume2.rows[0].res);
    if (consume2.rows[0].res.valid) {
      throw new Error("FAIL: Replayed challenge was accepted!");
    }

    console.log("\nALL 9 DATABASE SECURITY TESTS PASSED PERFECTLY!");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
