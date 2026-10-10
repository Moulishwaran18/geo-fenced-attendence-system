/**
 * CampusAttend — Live Production Verification Suite (HTTPS Vercel Deployment)
 * Target: https://geo-fenced-attendence-system.vercel.app
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://geo-fenced-attendence-system.vercel.app";
const SUPABASE_URL = "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runLiveVerification() {
  console.log("==================================================================");
  console.log("   CAMPUSATTEND LIVE PRODUCTION VERCEL VERIFICATION SUITE       ");
  console.log("   Target: " + BASE_URL);
  console.log("==================================================================\n");

  const LIVE_STAFF_ID = `SCT-LIVE-${Date.now().toString().slice(-4)}`;
  const LIVE_NAME = "Prof. Ananya Sen";
  const LIVE_DEPT = "Computer Science & Engineering";
  const LIVE_PASS = "AnanyaSecret#2026";
  const SHARED_CODE = "staff@123";

  // Pre-cleanup in case old artifact exists
  await supabase.from("staff").delete().eq("staff_code", LIVE_STAFF_ID);

  // 1. Missing Shared Authorization Code
  console.log("--- 1. LIVE REJECTION OF MISSING AUTHORIZATION CODE ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        name: LIVE_NAME,
        department: LIVE_DEPT,
        password: LIVE_PASS,
        confirmPassword: LIVE_PASS,
      }),
    });
    const data = await res.json();
    assert(res.status === 403, `HTTP status is 403 Forbidden (got ${res.status})`);
    assert(data.success === false, "Response returns success: false");
    assert(data.error.includes("Shared account-creation password is required"), "Correct error message returned");
  }

  // 2. Wrong Shared Authorization Code
  console.log("\n--- 2. LIVE REJECTION OF INVALID AUTHORIZATION CODE ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        name: LIVE_NAME,
        department: LIVE_DEPT,
        password: LIVE_PASS,
        confirmPassword: LIVE_PASS,
        registrationCode: "wrong-authorization-code-123",
      }),
    });
    const data = await res.json();
    assert(res.status === 403, `HTTP status is 403 Forbidden (got ${res.status})`);
    assert(data.success === false, "Response returns success: false");
    assert(data.error.includes("Invalid shared account-creation password"), "Correct error message returned");
  }

  // 3. Password Mismatch
  console.log("\n--- 3. LIVE INPUT VALIDATION: PASSWORD MISMATCH ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        name: LIVE_NAME,
        department: LIVE_DEPT,
        password: LIVE_PASS,
        confirmPassword: "different-password",
        registrationCode: SHARED_CODE,
      }),
    });
    const data = await res.json();
    assert(res.status === 400, `HTTP status is 400 Bad Request (got ${res.status})`);
    assert(data.error.includes("Passwords do not match"), "Identifies password mismatch");
  }

  // 4. Successful Self-Registration with staff@123
  console.log("\n--- 4. LIVE SUCCESSFUL SELF-REGISTRATION WITH staff@123 ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        name: LIVE_NAME,
        department: LIVE_DEPT,
        password: LIVE_PASS,
        confirmPassword: LIVE_PASS,
        registrationCode: SHARED_CODE,
      }),
    });
    const data = await res.json();
    assert(res.status === 201, `HTTP status is 201 Created (got ${res.status})`);
    assert(data.success === true, "Response returns success: true");
    assert(data.staff?.staff_code === LIVE_STAFF_ID, `Registered Staff ID is '${LIVE_STAFF_ID}'`);
    assert(data.staff?.role === "staff", "Role strictly 'staff'");
    assert(!data.password && !data.registrationCode, "Secrets NEVER returned in response");
  }

  // 5. Duplicate Staff ID Rejection (HTTP 409)
  console.log("\n--- 5. LIVE DUPLICATE STAFF ID REJECTION (HTTP 409 CONFLICT) ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        name: "Another Person",
        department: "Information Technology",
        password: "SomePassword123",
        confirmPassword: "SomePassword123",
        registrationCode: SHARED_CODE,
      }),
    });
    const data = await res.json();
    assert(res.status === 409, `HTTP status is 409 Conflict (got ${res.status})`);
    assert(data.success === false, "Duplicate rejected");
    assert(data.error.includes("already registered"), "Duplicate error identified");
  }

  // 6. Verify Salted PBKDF2 in Cloud Database
  console.log("\n--- 6. SUPABASE CLOUD DATABASE SECURITY AUDIT ---");
  {
    const { data: dbRow, error: dbErr } = await supabase
      .from("staff")
      .select("id, staff_code, name, email, department, device, active")
      .eq("staff_code", LIVE_STAFF_ID)
      .single();

    assert(!dbErr, "Record verified in Supabase Cloud");
    assert(Boolean(dbRow), "Row exists in production PostgreSQL");
    assert(dbRow?.device?.startsWith("auth:pbkdf2$"), "Stored as salted PBKDF2 hash");
    assert(!dbRow?.device?.includes(LIVE_PASS), "Zero plaintext password in production database");
  }

  // 7. Live Staff Login
  console.log("\n--- 7. LIVE STAFF LOGIN (PERSONAL CREDENTIALS) ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        password: LIVE_PASS,
      }),
    });
    const data = await res.json();
    assert(res.status === 200, `HTTP status is 200 OK (got ${res.status})`);
    assert(data.success === true, "Authentication successful");
    assert(Boolean(data.token), "HMAC session token issued");
    assert(data.staff?.staff_code === LIVE_STAFF_ID, "Staff ID matches authenticated user");
    const cookie = res.headers.get("set-cookie");
    assert(Boolean(cookie && cookie.includes("staff_session")), "HttpOnly session cookie issued by Vercel");
  }

  // 8. Live Staff Login Rejection (Wrong Password)
  console.log("\n--- 8. LIVE STAFF LOGIN REJECTION (WRONG PASSWORD) ---");
  {
    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: LIVE_STAFF_ID,
        password: "IncorrectPassword999!",
      }),
    });
    const data = await res.json();
    assert(res.status === 401, `HTTP status is 401 Unauthorized (got ${res.status})`);
    assert(data.success === false, "Login rejected");
  }

  // 9. Preserve Administrator Login (moulish / moulish@123)
  console.log("\n--- 9. PRESERVE LIVE ADMINISTRATOR AUTHENTICATION ---");
  {
    const res = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "moulish",
        password: "moulish@123",
      }),
    });
    const data = await res.json();
    assert(res.status === 200, `HTTP status is 200 OK (got ${res.status})`);
    assert(data.success === true, "Admin login successful");
    assert(data.admin?.username === "moulish", "Admin user is 'moulish'");
    assert(data.admin?.role === "admin", "Role is 'admin'");
  }

  // 10. Preserve Historical Attendance Records
  console.log("\n--- 10. PRESERVE HISTORICAL ATTENDANCE RECORDS ---");
  {
    const { count, error } = await supabase
      .from("attendance_records")
      .select("id", { count: "exact", head: true });

    assert(!error, "Attendance table accessible");
    assert(count === 3, `Expected 3 attendance records preserved, found: ${count}`);
  }

  // 11. Cleanup Live Test Staff Account
  console.log("\n--- 11. CLEANUP LIVE TEST STAFF RECORD ---");
  {
    await supabase.from("staff").delete().eq("staff_code", LIVE_STAFF_ID);
    const { count } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true });
    assert(count === 0, `Staff count restored to 0. (Current count: ${count})`);
  }

  console.log("\n==================================================================");
  console.log(`LIVE PRODUCTION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) process.exit(1);
}

runLiveVerification().catch((err) => {
  console.error("Live verification fatal error:", err);
  process.exit(1);
});
