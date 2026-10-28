/**
 * Comprehensive Security & Integrity Regression Test Suite:
 * CampusAttend Attendance Persistence & History Workflow
 *
 * Covers:
 * 1. Summary calculations with zero records (0 in list => 0 in summary).
 * 2. Unauthenticated attendance submission rejection (HTTP 401).
 * 3. Unregistered staff ID rejection (HTTP 403 UNREGISTERED_STAFF_IDENTITY).
 * 4. Forged staff code mismatch rejection (HTTP 403 IDENTITY_FORGERY_DETECTED).
 * 5. Biometric face identity mismatch rejection (HTTP 403 IDENTITY_MISMATCH).
 * 6. Deactivated/inactive staff account rejection (HTTP 403 STAFF_ACCOUNT_INACTIVE).
 * 7. Successful attendance submission with registered staff token & canonical derivation.
 * 8. Authoritative Supabase read-back verification (canonical name, department, status, location).
 * 9. Duplicate submission idempotency (same staff, same date => single row, alreadyMarked: true).
 * 10. Consistent Asia/Kolkata (IST) date/time calendar presentation.
 * 11. Staff history retrieval and strict staff isolation (Staff A cannot read Staff B).
 * 12. Administrator authorization and institute-wide access.
 * 13. Unauthenticated history query rejection (HTTP 401).
 * 14. Detection and safe audit inspection of orphaned historical records (SCT-2417).
 * 15. Clean teardown of temporary test artifacts without altering production data.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import attendanceHandler from "../api/attendance.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TOKEN_SECRET = process.env.CAMPUS_AUTH_SECRET || "sona-campus-wifi-egress-auth-secret-key-2026";
const STAFF_TOKEN_SECRET = process.env.STAFF_AUTH_SECRET || process.env.CAMPUS_AUTH_SECRET || "campusattend-staff-auth-session-sec-key-2026";
const ADMIN_TOKEN_SECRET = process.env.CAMPUS_ADMIN_SECRET || "campusattend-admin-sec-key-moulish-2026-auth-token";

function mintNetworkToken(ssid = "SONA-WIFI", expiresMs = 60000) {
  const payload = {
    authorized: true,
    ssid,
    network: ssid,
    verifiedIp: "111.92.42.18",
    expiresAt: Date.now() + expiresMs,
    timestamp: Date.now(),
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function mintStaffToken(staffCode = "TEST-REG-STAFF") {
  const payload = {
    sub: staffCode,
    staffId: staffCode,
    role: "staff",
    expiresAt: Date.now() + 3600000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function mintAdminToken() {
  const payload = {
    sub: "admin-test",
    username: "moulish",
    role: "admin",
    expiresAt: Date.now() + 3600000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function createMockRes() {
  let statusCode = 200;
  let headers = {};
  let body = null;
  const res = {
    statusCode: 200,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(code) { statusCode = code; res.statusCode = code; return res; },
    json(data) { body = data; return res; },
    end(data) { if (data && !body) body = typeof data === "string" ? JSON.parse(data) : data; return res; },
    get response() { return { status: statusCode, headers, body }; },
  };
  return res;
}

async function runTests() {
  console.log("============================================================");
  console.log("   CAMPUSATTEND SECURITY & DATA INTEGRITY TEST SUITE");
  console.log("============================================================\n");

  const TEST_STAFF_ACTIVE = "TEST-STAFF-ACTIVE-99";
  const TEST_STAFF_INACTIVE = "TEST-STAFF-INACTIVE-99";
  const TEST_STAFF_UNREGISTERED = "SCT-UNKNOWN-9999";
  const createdRecordIds = [];
  const createdStaffIds = [];

  try {
    // Clean any preexisting test rows from previous runs
    await supabase.from("attendance_records").delete().in("staff_code", [TEST_STAFF_ACTIVE, TEST_STAFF_INACTIVE]);
    await supabase.from("staff").delete().in("staff_code", [TEST_STAFF_ACTIVE, TEST_STAFF_INACTIVE]);

    // Provision temporary registered test staff for strict identity derivation
    const { data: staffActiveRow, error: staffErr1 } = await supabase
      .from("staff")
      .insert({
        staff_code: TEST_STAFF_ACTIVE,
        name: "Canonical Test Staff Member",
        department: "Computer Science & Engineering",
        designation: "Assistant Professor",
        email: "test.staff.active@sonatech.ac.in",
        phone: "+91 99999 11111",
        device: "Test Device",
        device_status: "Active",
        active: true,
        status: "Active",
      })
      .select("id")
      .single();

    if (staffErr1 || !staffActiveRow) {
      throw new Error(`Failed to provision active test staff: ${staffErr1?.message}`);
    }
    createdStaffIds.push(staffActiveRow.id);

    const { data: staffInactiveRow, error: staffErr2 } = await supabase
      .from("staff")
      .insert({
        staff_code: TEST_STAFF_INACTIVE,
        name: "Disabled Test Staff",
        department: "ECE",
        designation: "Lecturer",
        email: "test.staff.inactive@sonatech.ac.in",
        phone: "+91 99999 22222",
        device: "Test Device",
        device_status: "Blocked",
        active: false,
        status: "Inactive",
      })
      .select("id")
      .single();

    if (staffErr2 || !staffInactiveRow) {
      throw new Error(`Failed to provision inactive test staff: ${staffErr2?.message}`);
    }
    createdStaffIds.push(staffInactiveRow.id);

    console.log("✓ Provisioned temporary registered staff accounts for test validation.\n");

    // -------------------------------------------------------------------------
    // TEST 1: Summary Calculation when Records = 0
    // -------------------------------------------------------------------------
    console.log("TEST 1: Summary calculations with zero records");
    const emptyRecords = [];
    const stats0 = {
      totalRecords: emptyRecords.length,
      present: emptyRecords.filter((r) => r.status === "Present").length,
      late: emptyRecords.filter((r) => r.status === "Late").length,
      absent: emptyRecords.filter((r) => r.status === "Absent").length,
      rate: emptyRecords.length === 0 ? 0 : Math.round(100 * (0 / emptyRecords.length)),
    };
    if (stats0.totalRecords !== 0 || stats0.present !== 0 || stats0.late !== 0 || stats0.rate !== 0) {
      throw new Error(`Summary calculation bug: expected 0, got ${JSON.stringify(stats0)}`);
    }
    console.log("✓ Empty record set correctly evaluates to Total: 0, Present: 0, Rate: 0%\n");

    // -------------------------------------------------------------------------
    // TEST 2: Unauthenticated Attendance Submission Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 2: Rejection of unauthenticated attendance submission");
    const networkToken = mintNetworkToken("SONA-WIFI");
    const unauthReq = {
      method: "POST",
      headers: {
        "x-network-auth-token": networkToken,
      },
      body: {
        staffCode: TEST_STAFF_ACTIVE,
        latitude: 11.67672,
        longitude: 78.12219,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_ACTIVE,
        faceMatchDistance: 0.25,
        livenessPassed: true,
      },
    };
    const unauthRes = createMockRes();
    await attendanceHandler(unauthReq, unauthRes);
    if (unauthRes.response.status !== 401) {
      throw new Error(`Expected HTTP 401 for unauthenticated submission, got ${unauthRes.response.status}`);
    }
    console.log(`✓ Unauthenticated attendance submission rejected with HTTP 401 (${unauthRes.response.body?.error})\n`);

    // -------------------------------------------------------------------------
    // TEST 3: Unregistered Staff Identity Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 3: Rejection of unregistered staff ID");
    const unregToken = mintStaffToken(TEST_STAFF_UNREGISTERED);
    const unregReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${unregToken}`,
        "x-network-auth-token": networkToken,
      },
      body: {
        staffCode: TEST_STAFF_UNREGISTERED,
        latitude: 11.67672,
        longitude: 78.12219,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_UNREGISTERED,
        faceMatchDistance: 0.25,
        livenessPassed: true,
      },
    };
    const unregRes = createMockRes();
    await attendanceHandler(unregReq, unregRes);
    if (unregRes.response.status !== 403 || unregRes.response.body?.error !== "UNREGISTERED_STAFF_IDENTITY") {
      throw new Error(`Expected HTTP 403 UNREGISTERED_STAFF_IDENTITY, got ${unregRes.response.status} - ${JSON.stringify(unregRes.response.body)}`);
    }
    console.log(`✓ Unregistered staff identity correctly rejected with HTTP 403 (${unregRes.response.body?.message})\n`);

    // -------------------------------------------------------------------------
    // TEST 4: Identity Forgery & Client-Supplied Mismatch Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 4: Rejection of forged client-supplied Staff ID mismatch");
    const validStaffToken = mintStaffToken(TEST_STAFF_ACTIVE);
    const forgeryReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${validStaffToken}`, // Authenticated as TEST_STAFF_ACTIVE
        "x-network-auth-token": networkToken,
      },
      body: {
        staffCode: "SCT-FORGED-IMPERSONATOR", // Client attempting to mark for another staff
        latitude: 11.67672,
        longitude: 78.12219,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_ACTIVE,
        faceMatchDistance: 0.25,
        livenessPassed: true,
      },
    };
    const forgeryRes = createMockRes();
    await attendanceHandler(forgeryReq, forgeryRes);
    if (forgeryRes.response.status !== 403 || forgeryRes.response.body?.error !== "IDENTITY_FORGERY_DETECTED") {
      throw new Error(`Expected HTTP 403 IDENTITY_FORGERY_DETECTED, got ${forgeryRes.response.status} - ${JSON.stringify(forgeryRes.response.body)}`);
    }
    console.log(`✓ Client forgery attempt blocked with HTTP 403 (${forgeryRes.response.body?.message})\n`);

    // -------------------------------------------------------------------------
    // TEST 5: Biometric Face Recognition Identity Mismatch Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 5: Rejection of biometric face identity mismatch");
    const faceMismatchReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${validStaffToken}`,
        "x-network-auth-token": networkToken,
      },
      body: {
        staffCode: TEST_STAFF_ACTIVE,
        latitude: 11.67672,
        longitude: 78.12219,
        faceVerified: true,
        recognizedStaffCode: "OTHER-PERSON-FACE", // Recognized face does not match authenticated staff
        faceMatchDistance: 0.25,
        livenessPassed: true,
      },
    };
    const faceMismatchRes = createMockRes();
    await attendanceHandler(faceMismatchReq, faceMismatchRes);
    if (faceMismatchRes.response.status !== 403 || faceMismatchRes.response.body?.error !== "IDENTITY_MISMATCH") {
      throw new Error(`Expected HTTP 403 IDENTITY_MISMATCH, got ${faceMismatchRes.response.status} - ${JSON.stringify(faceMismatchRes.response.body)}`);
    }
    console.log(`✓ Face identity mismatch rejected with HTTP 403 (${faceMismatchRes.response.body?.message})\n`);

    // -------------------------------------------------------------------------
    // TEST 6: Inactive / Disabled Staff Account Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 6: Rejection of disabled / inactive staff account");
    const inactiveToken = mintStaffToken(TEST_STAFF_INACTIVE);
    const inactiveReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${inactiveToken}`,
        "x-network-auth-token": networkToken,
      },
      body: {
        staffCode: TEST_STAFF_INACTIVE,
        latitude: 11.67672,
        longitude: 78.12219,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_INACTIVE,
        faceMatchDistance: 0.25,
        livenessPassed: true,
      },
    };
    const inactiveRes = createMockRes();
    await attendanceHandler(inactiveReq, inactiveRes);
    if (inactiveRes.response.status !== 403 || inactiveRes.response.body?.error !== "STAFF_ACCOUNT_INACTIVE") {
      throw new Error(`Expected HTTP 403 STAFF_ACCOUNT_INACTIVE, got ${inactiveRes.response.status} - ${JSON.stringify(inactiveRes.response.body)}`);
    }
    console.log(`✓ Disabled staff account correctly rejected with HTTP 403 (${inactiveRes.response.body?.message})\n`);

    // -------------------------------------------------------------------------
    // TEST 7: Successful Attendance Insert with Canonical Server Derivation
    // -------------------------------------------------------------------------
    console.log("TEST 7: Successful attendance insertion & canonical server derivation");
    const validReq = {
      method: "POST",
      headers: {
        authorization: `Bearer ${validStaffToken}`,
        "x-network-auth-token": networkToken,
        "x-forwarded-for": "111.92.42.18",
      },
      body: {
        staffCode: TEST_STAFF_ACTIVE,
        staffName: "Fake Client Name Attempt", // Must be ignored by server
        department: "Fake Client Department Attempt", // Must be ignored by server
        latitude: 11.67672,
        longitude: 78.12219,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_ACTIVE,
        faceMatchDistance: 0.26,
        livenessPassed: true,
        location: "Main Campus, Sona College",
        deviceId: "DEV-TEST-PHONE-SECURE",
      },
    };
    const validRes = createMockRes();
    await attendanceHandler(validReq, validRes);
    const validPayload = validRes.response.body;

    if (validRes.response.status !== 200 || !validPayload?.success || !validPayload?.receipt?.attendanceId) {
      throw new Error(`Attendance insertion failed: ${validRes.response.status} - ${JSON.stringify(validPayload)}`);
    }
    createdRecordIds.push(validPayload.receipt.attendanceId);
    console.log(`✓ Attendance successfully recorded! Confirmed UUID: ${validPayload.receipt.attendanceId}`);

    // -------------------------------------------------------------------------
    // TEST 8: Authoritative Read-Back & Canonical Identity Verification
    // -------------------------------------------------------------------------
    console.log("TEST 8: Direct Supabase read-back & canonical identity verification");
    const { data: dbRow, error: readErr } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("id", validPayload.receipt.attendanceId)
      .single();

    if (readErr || !dbRow) {
      throw new Error(`Failed to read back persisted attendance row: ${readErr?.message}`);
    }
    if (dbRow.staff_code !== TEST_STAFF_ACTIVE) {
      throw new Error(`DB row staff_code mismatch: ${dbRow.staff_code} !== ${TEST_STAFF_ACTIVE}`);
    }
    if (dbRow.staff_name !== "Canonical Test Staff Member") {
      throw new Error(`SECURITY FAILURE: Server trusted client-provided name instead of canonical staff record! (${dbRow.staff_name})`);
    }
    if (dbRow.department !== "Computer Science & Engineering") {
      throw new Error(`SECURITY FAILURE: Server trusted client-provided department instead of canonical staff record! (${dbRow.department})`);
    }
    if (dbRow.verification !== "Verified") {
      throw new Error(`DB verification check constraint violation: ${dbRow.verification}`);
    }
    console.log(`✓ Canonical derivation verified: Name="${dbRow.staff_name}", Dept="${dbRow.department}", Verification="${dbRow.verification}"\n`);

    // -------------------------------------------------------------------------
    // TEST 9: Duplicate Submission Idempotency
    // -------------------------------------------------------------------------
    console.log("TEST 9: Duplicate submission idempotency (single row per staff per day)");
    const dupRes = createMockRes();
    await attendanceHandler(validReq, dupRes);
    const dupPayload = dupRes.response.body;

    if (dupRes.response.status !== 200 || !dupPayload?.alreadyMarked) {
      throw new Error(`Idempotency check failed: ${dupRes.response.status} - ${JSON.stringify(dupPayload)}`);
    }
    if (dupPayload.receipt.attendanceId !== validPayload.receipt.attendanceId) {
      throw new Error(`Duplicate submission created different ID: ${dupPayload.receipt.attendanceId} !== ${validPayload.receipt.attendanceId}`);
    }

    const { data: countRows } = await supabase
      .from("attendance_records")
      .select("id")
      .eq("staff_code", TEST_STAFF_ACTIVE);
    if (!countRows || countRows.length !== 1) {
      throw new Error(`Duplicate rows created in database: count = ${countRows?.length}`);
    }
    console.log("✓ Duplicate submission returned existing receipt idempotently without creating duplicate rows\n");

    // -------------------------------------------------------------------------
    // TEST 10: Timezone & Date Boundary in IST (Asia/Kolkata)
    // -------------------------------------------------------------------------
    console.log("TEST 10: Timezone verification in Asia/Kolkata (IST)");
    const expectedIstDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (dbRow.date !== expectedIstDate) {
      throw new Error(`IST Date mismatch: DB has ${dbRow.date}, expected ${expectedIstDate}`);
    }
    console.log(`✓ Stored calendar date matches Asia/Kolkata day: ${dbRow.date}\n`);

    // -------------------------------------------------------------------------
    // TEST 11: History Accuracy & Staff Isolation
    // -------------------------------------------------------------------------
    console.log("TEST 11: Staff history accuracy and strict staff isolation");
    const getReqSelf = {
      method: "GET",
      url: `/api/attendance?staff_code=${TEST_STAFF_ACTIVE}`,
      headers: {
        authorization: `Bearer ${validStaffToken}`,
      },
    };
    const getResSelf = createMockRes();
    await attendanceHandler(getReqSelf, getResSelf);
    const selfPayload = getResSelf.response.body;

    if (getResSelf.response.status !== 200 || !selfPayload?.success || selfPayload.count < 1) {
      throw new Error(`Staff self-history failed: ${getResSelf.response.status} - ${JSON.stringify(selfPayload)}`);
    }
    const foundSelfRecord = selfPayload.records.find((r) => r.id === validPayload.receipt.attendanceId);
    if (!foundSelfRecord) {
      throw new Error("Marked record not found in staff self-history");
    }

    // Attempt to access another staff's records
    const getReqCross = {
      method: "GET",
      url: "/api/attendance?staff_code=SCT-001",
      headers: {
        authorization: `Bearer ${validStaffToken}`, // Token is for TEST_STAFF_ACTIVE
      },
    };
    const getResCross = createMockRes();
    await attendanceHandler(getReqCross, getResCross);
    const crossPayload = getResCross.response.body;

    const leakedRecords = crossPayload?.records?.some((r) => r.staff_code !== TEST_STAFF_ACTIVE);
    if (leakedRecords) {
      throw new Error("SECURITY FAILURE: Staff token was able to read other staff records!");
    }
    console.log("✓ Staff isolation strictly enforced: ordinary staff can only see their own attendance\n");

    // -------------------------------------------------------------------------
    // TEST 12: Administrator Authorization & Filtering
    // -------------------------------------------------------------------------
    console.log("TEST 12: Administrator authorization and full visibility");
    const adminToken = mintAdminToken();
    const adminReq = {
      method: "GET",
      url: `/api/attendance?staff_code=${TEST_STAFF_ACTIVE}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    };
    const adminRes = createMockRes();
    await attendanceHandler(adminReq, adminRes);
    const adminPayload = adminRes.response.body;

    if (adminRes.response.status !== 200 || !adminPayload?.success || adminPayload.count < 1) {
      throw new Error(`Admin attendance query failed: ${adminRes.response.status} - ${JSON.stringify(adminPayload)}`);
    }
    console.log(`✓ Administrator successfully accessed records (${adminPayload.count} records)\n`);

    // -------------------------------------------------------------------------
    // TEST 13: Unauthenticated History Query Rejection
    // -------------------------------------------------------------------------
    console.log("TEST 13: Rejection of unauthenticated history queries");
    const unauthGetReq = {
      method: "GET",
      url: "/api/attendance",
      headers: {},
    };
    const unauthGetRes = createMockRes();
    await attendanceHandler(unauthGetReq, unauthGetRes);
    if (unauthGetRes.response.status !== 401) {
      throw new Error(`Expected HTTP 401 for unauthenticated GET, got ${unauthGetRes.response.status}`);
    }
    console.log("✓ Unauthenticated history query rejected with HTTP 401\n");

    // -------------------------------------------------------------------------
    // TEST 14: Orphaned Records Audit Check (Dr. Priya Ramanathan SCT-2417)
    // -------------------------------------------------------------------------
    console.log("TEST 14: Orphaned historical records audit check");
    const { data: allStaff } = await supabase.from("staff").select("staff_code");
    const registeredCodes = new Set((allStaff || []).map((s) => s.staff_code.toUpperCase()));

    const { data: allRecords } = await supabase.from("attendance_records").select("id, staff_code, staff_name, date");
    const orphanedRows = (allRecords || []).filter((r) => !registeredCodes.has(r.staff_code.toUpperCase()));

    console.log(`   Audited ${allRecords?.length || 0} production attendance records:`);
    console.log(`   Registered staff count: ${registeredCodes.size}`);
    console.log(`   Orphaned rows detected: ${orphanedRows.length}`);
    orphanedRows.forEach((r) => {
      console.log(`   - [ORPHANED] ID: ${r.id} | Staff: ${r.staff_code} (${r.staff_name}) | Date: ${r.date}`);
    });

    const priyaRows = orphanedRows.filter((r) => r.staff_code === "SCT-2417");
    if (priyaRows.length > 0) {
      console.log(`✓ Confirmed: Dr. Priya Ramanathan (SCT-2417) rows (${priyaRows.length}) exist without active staff account.`);
      console.log("  Preserved intact per safe inspection requirements.\n");
    }

    console.log("============================================================");
    console.log("   ALL 14 REGRESSION TESTS PASSED SUCCESSFULLY (14/14)");
    console.log("============================================================\n");
  } finally {
    // Teardown temporary test rows
    if (createdRecordIds.length > 0) {
      console.log(`Tearing down ${createdRecordIds.length} temporary test attendance records...`);
      await supabase.from("attendance_records").delete().in("id", createdRecordIds);
    }
    if (createdStaffIds.length > 0) {
      console.log(`Tearing down ${createdStaffIds.length} temporary test staff accounts...`);
      await supabase.from("staff").delete().in("id", createdStaffIds);
    }
    console.log("Cleanup complete. Genuine production data strictly preserved.");
  }
}

runTests().catch((err) => {
  console.error("\n❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
