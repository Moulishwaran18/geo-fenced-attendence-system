/**
 * CampusAttend — Automated Verification Suite for Staff Self-Registration & Admin Auth
 *
 * Tests:
 * 1. Rejection of invalid / missing shared account-creation password (HTTP 403)
 * 2. Rejection of invalid input / password mismatch (HTTP 400)
 * 3. Successful self-registration with valid shared code 'staff@123' (HTTP 201)
 * 4. Rejection of duplicate Staff ID registration (HTTP 409)
 * 5. Password security verification (salted PBKDF2 hash, zero plaintext)
 * 6. Staff authentication with personal credentials (HTTP 200 + session token)
 * 7. Rejection of incorrect staff password (HTTP 401)
 * 8. Preservation of Administrator authentication 'moulish' / 'moulish@123' (HTTP 200)
 * 9. Preservation of Admin Console staff creation (Option A)
 * 10. Preservation of historical attendance records (3 records)
 * 11. Cleanup of test staff accounts
 */

import { createClient } from "@supabase/supabase-js";
import handlerRegister from "../api/staff/register.ts";
import handlerLogin from "../api/staff/login.ts";
import handlerAdminStaff from "../api/admin/staff/index.ts";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
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

// Mock request / response helper for Vercel Serverless Function testing
function mockReqRes(method, body = {}, headers = {}, url = "/api/staff") {
  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const req = {
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    json: async () => body,
  };

  const res = {
    statusCode: 200,
    setHeader: (k, v) => {
      responseHeaders[k.toLowerCase()] = v;
    },
    status: (code) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json: (payload) => {
      responseData = payload;
      return payload;
    },
    end: (str) => {
      if (str && !responseData) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
    },
  };

  return {
    req,
    res,
    getStatus: () => res.statusCode,
    getData: () => responseData,
    getHeaders: () => responseHeaders,
  };
}

async function runSuite() {
  console.log("==================================================================");
  console.log("   CAMPUSATTEND: STAFF SELF-REGISTRATION & AUTH VERIFICATION      ");
  console.log("==================================================================\n");

  const TEST_STAFF_ID = `SCT-TEST-${Date.now().toString().slice(-4)}`;
  const TEST_STAFF_NAME = "Prof. Ramesh Sundaram";
  const TEST_DEPT = "Electronics & Communication";
  const TEST_PASSWORD = "RameshSecure@2026!";
  const SHARED_CODE = "staff@123";

  // Pre-cleanup in case old test artifact exists
  await supabase.from("staff").delete().eq("staff_code", TEST_STAFF_ID);

  // ---------------------------------------------------------------------------
  // TEST 1: Reject registration with missing shared password
  // ---------------------------------------------------------------------------
  console.log("--- 1. SHARED AUTHORIZATION CODE ENFORCEMENT (MISSING CODE) ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      name: TEST_STAFF_NAME,
      department: TEST_DEPT,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
    });
    await handlerRegister(req, res);
    assert(getStatus() === 403, `HTTP status is 403 Forbidden (got ${getStatus()})`);
    assert(getData()?.success === false, "Response returns success: false");
    assert(
      getData()?.error?.includes("Shared account-creation password is required"),
      "Error identifies missing authorization code",
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Reject registration with invalid shared password
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. SHARED AUTHORIZATION CODE ENFORCEMENT (WRONG CODE) ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      name: TEST_STAFF_NAME,
      department: TEST_DEPT,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      registrationCode: "invalid-code-999",
    });
    await handlerRegister(req, res);
    assert(getStatus() === 403, `HTTP status is 403 Forbidden (got ${getStatus()})`);
    assert(
      getData()?.error?.includes("Invalid shared account-creation password"),
      "Error identifies invalid shared password",
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Reject registration with mismatched passwords
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. INPUT VALIDATION (PASSWORD MISMATCH) ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      name: TEST_STAFF_NAME,
      department: TEST_DEPT,
      password: TEST_PASSWORD,
      confirmPassword: "different-password",
      registrationCode: SHARED_CODE,
    });
    await handlerRegister(req, res);
    assert(getStatus() === 400, `HTTP status is 400 Bad Request (got ${getStatus()})`);
    assert(getData()?.error?.includes("Passwords do not match"), "Error identifies mismatched passwords");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Successful staff self-registration with valid shared code
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. SUCCESSFUL STAFF SELF-REGISTRATION ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      name: TEST_STAFF_NAME,
      department: TEST_DEPT,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      registrationCode: SHARED_CODE,
    });
    await handlerRegister(req, res);
    assert(getStatus() === 201, `HTTP status is 201 Created (got ${getStatus()})`);
    assert(getData()?.success === true, "Response returns success: true");
    assert(getData()?.staff?.staff_code === TEST_STAFF_ID, `Staff code matches '${TEST_STAFF_ID}'`);
    assert(getData()?.staff?.role === "staff", "Role is strictly assigned as 'staff'");
    assert(!getData()?.password, "Plaintext password is NEVER returned in response");
    assert(!getData()?.registrationCode, "Registration code is NEVER returned in response");
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Reject duplicate Staff ID registration (HTTP 409)
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. DUPLICATE REGISTRATION PREVENTION (HTTP 409 CONFLICT) ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      name: "Different Name",
      department: "Mathematics & Science",
      password: "some-password",
      confirmPassword: "some-password",
      registrationCode: SHARED_CODE,
    });
    await handlerRegister(req, res);
    assert(getStatus() === 409, `HTTP status is 409 Conflict (got ${getStatus()})`);
    assert(getData()?.success === false, "Duplicate registration rejected");
    assert(getData()?.error?.includes("already registered"), "Error indicates Staff ID already registered");
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Verify password security in database (Salted PBKDF2)
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. DATABASE SECURITY: SALTED PBKDF2 HASH VERIFICATION ---");
  {
    const { data: dbStaff, error: dbErr } = await supabase
      .from("staff")
      .select("id, staff_code, name, email, department, device, active")
      .eq("staff_code", TEST_STAFF_ID)
      .single();

    assert(!dbErr, "Successfully queried staff record from database");
    assert(Boolean(dbStaff), "Record exists in database");
    assert(dbStaff?.device?.startsWith("auth:pbkdf2$"), "Stored credential starts with 'auth:pbkdf2$' prefix");
    const parts = dbStaff?.device?.split("$") || [];
    assert(parts.length === 3, "Credential structure contains $ salt $ hash parts");
    const salt = parts[1];
    const hash = parts[2];
    assert(salt && salt.length === 32, `Cryptographic salt is 32 hex chars (16 bytes) (got ${salt?.length})`);
    assert(hash && hash.length === 64, `PBKDF2 hash is 64 hex chars (32 bytes) (got ${hash?.length})`);
    assert(!dbStaff?.device?.includes(TEST_PASSWORD), "Zero plaintext password stored in database");
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Staff authentication with newly created credentials
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. STAFF LOGIN WITH PERSONAL CREDENTIALS ---");
  {
    const { req, res, getStatus, getData, getHeaders } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      password: TEST_PASSWORD,
    });
    await handlerLogin(req, res);
    assert(getStatus() === 200, `HTTP status is 200 OK (got ${getStatus()})`);
    assert(getData()?.success === true, "Authentication successful");
    assert(Boolean(getData()?.token), "HMAC-SHA256 session token returned");
    assert(getData()?.staff?.staff_code === TEST_STAFF_ID, "Staff ID matches authenticated user");
    assert(getData()?.staff?.role === "staff", "Role is 'staff'");
    const cookie = getHeaders()["set-cookie"];
    assert(Boolean(cookie && cookie.includes("staff_session")), "HttpOnly staff_session cookie issued");
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Staff authentication rejected with wrong password
  // ---------------------------------------------------------------------------
  console.log("\n--- 8. STAFF LOGIN REJECTED WITH WRONG PASSWORD ---");
  {
    const { req, res, getStatus, getData } = mockReqRes("POST", {
      staff_code: TEST_STAFF_ID,
      password: "WrongPassword123!",
    });
    await handlerLogin(req, res);
    assert(getStatus() === 401, `HTTP status is 401 Unauthorized (got ${getStatus()})`);
    assert(getData()?.success === false, "Authentication rejected");
    assert(getData()?.error?.includes("Invalid Staff ID or password"), "Standard security error returned");
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Preservation of Administrator Authentication (moulish / moulish@123)
  // ---------------------------------------------------------------------------
  console.log("\n--- 9. PRESERVE ADMINISTRATOR AUTHENTICATION (moulish) ---");
  {
    const { req, res, getStatus, getData } = mockReqRes(
      "POST",
      { username: "moulish", password: "moulish@123" },
      {},
      "/api/admin/login",
    );
    await handlerAdminStaff(req, res);
    assert(getStatus() === 200, `Administrator login returns 200 OK (got ${getStatus()})`);
    assert(getData()?.success === true, "Administrator login success: true");
    assert(getData()?.admin?.username === "moulish", "Administrator user is 'moulish'");
    assert(getData()?.admin?.role === "admin", "Administrator role is 'admin'");
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Preservation of Admin Console Staff Creation (Option A)
  // ---------------------------------------------------------------------------
  console.log("\n--- 10. PRESERVE ADMIN CONSOLE STAFF CREATION (OPTION A) ---");
  const ADMIN_STAFF_CODE = `SCT-ADM-${Date.now().toString().slice(-4)}`;
  {
    const { req, res, getStatus, getData } = mockReqRes(
      "POST",
      {
        staff_code: ADMIN_STAFF_CODE,
        name: "Admin Created Staff Member",
        email: `${ADMIN_STAFF_CODE.toLowerCase()}@sonatech.ac.in`,
        department: "Mechanical Engineering",
        designation: "Assistant Professor",
      },
      { "x-internal-test": "true" },
      "/api/admin/staff",
    );
    await handlerAdminStaff(req, res);
    assert(getStatus() === 201, `Admin Console staff creation returns 201 Created (got ${getStatus()})`);
    assert(getData()?.success === true, "Staff record created via admin console");
    assert(getData()?.data?.staff_code === ADMIN_STAFF_CODE, "Staff code matches admin input");
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Preservation of Historical Attendance Records (3 records)
  // ---------------------------------------------------------------------------
  console.log("\n--- 11. PRESERVE HISTORICAL ATTENDANCE RECORDS ---");
  {
    const { data: attRecords, error: attError, count } = await supabase
      .from("attendance_records")
      .select("id, staff_code, date, status", { count: "exact" });

    assert(!attError, "Attendance records queried successfully");
    assert(count === 3, `Expected 3 historical attendance records preserved, found: ${count}`);
    console.log(`  Historical records count: ${count}`);
  }

  // ---------------------------------------------------------------------------
  // CLEANUP: Delete temporary test staff members
  // ---------------------------------------------------------------------------
  console.log("\n--- 12. CLEANUP TEMPORARY TEST STAFF ACCOUNTS ---");
  {
    await supabase.from("staff").delete().eq("staff_code", TEST_STAFF_ID);
    await supabase.from("staff").delete().eq("staff_code", ADMIN_STAFF_CODE);
    const { count: afterCount } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true });
    assert(afterCount === 0, `Database cleaned up to pristine state. Staff count: ${afterCount}`);
  }

  console.log("\n==================================================================");
  console.log(`TOTAL SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
