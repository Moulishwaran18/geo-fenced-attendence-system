/**
 * Comprehensive End-to-End Test Suite:
 * Attendance Success Screen, Security Factor Gates & Supabase Database Storage
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import attendanceHandler from "../api/attendance.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TOKEN_SECRET = process.env.CAMPUS_AUTH_SECRET || "sona-campus-wifi-egress-auth-secret-key-2026";
const STAFF_TOKEN_SECRET = process.env.CAMPUS_AUTH_SECRET || process.env.STAFF_AUTH_SECRET || "campusattend-staff-auth-session-sec-key-2026";
const ADMIN_TOKEN_SECRET = process.env.CAMPUS_ADMIN_SECRET || "campusattend-admin-sec-key-moulish-2026-auth-token";

function createMockReqRes({ method = "POST", body = {}, headers = {}, url = "/api/attendance" }) {
  const req = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    url,
    json: async () => body,
  };

  let statusCode = 200;
  let responseData = null;
  const headersSent = {};

  const res = {
    setHeader(name, val) {
      headersSent[name.toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end(str) {
      if (str && !responseData) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(code) {
      statusCode = code;
    },
  };

  return {
    req,
    res,
    getResult: () => ({ statusCode, data: responseData, headers: headersSent }),
  };
}

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

function mintStaffToken(staffCode = "SCT-001", staffName = "Moulishwaran S") {
  const payload = {
    sub: staffCode.toUpperCase(),
    staffId: staffCode.toUpperCase(),
    staffName,
    role: "staff",
    expiresAt: Date.now() + 3600000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function mintBiometricAttestation(staffId, deviceId, nonce = "att_nonce_" + Date.now()) {
  const payload = {
    staffId: staffId.toUpperCase(),
    deviceId,
    distance: 0.22,
    livenessPassed: true,
    antiSpoofScore: 0.94,
    timestamp: Date.now(),
    nonce,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

async function runTestSuite() {
  console.log("===============================================================================");
  console.log("   CAMPUSATTEND ATTENDANCE SUCCESS SCREEN & DATABASE STORAGE TEST SUITE        ");
  console.log("===============================================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  function assertTest(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`✓ TEST ${totalTests} PASSED: ${message}`);
      passedTests++;
    } else {
      console.error(`✗ TEST ${totalTests} FAILED: ${message}`);
      process.exitCode = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: UI COMPONENT & SUCCESS PANEL MARKUP VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("--- SECTION 1: Frontend Success Screen Markup & Flow Verification ---");
  const markAttendancePath = path.join(rootDir, "src", "routes", "mark-attendance.tsx");
  const markAttendanceCode = fs.readFileSync(markAttendancePath, "utf-8");

  assertTest(
    markAttendanceCode.includes("Attendance Recorded") &&
    markAttendanceCode.includes("<CheckCircle2 className=\"size-11\" aria-hidden />"),
    "SuccessPanel renders Heading 'Attendance Recorded' and green CheckCircle2 icon"
  );

  assertTest(
    markAttendanceCode.includes("Welcome, {displayFacultyId}") ||
    (markAttendanceCode.includes("displayFacultyId") && markAttendanceCode.includes("Welcome")),
    "SuccessPanel displays authenticated faculty ID in welcome message (e.g. Welcome, SCT-001)"
  );

  assertTest(
    markAttendanceCode.includes("GPS Geofence polygon verified (Inside Campus)") &&
    markAttendanceCode.includes("Identity verified — ${displayFacultyId}") &&
    markAttendanceCode.includes("Device verified") &&
    markAttendanceCode.includes("Attendance successfully recorded"),
    "SuccessPanel includes all 4 green verification check indicators with faculty ID"
  );

  assertTest(
    markAttendanceCode.includes("Attendance ID: {receipt.attendanceId}"),
    "SuccessPanel displays unique Attendance ID matching server receipt"
  );

  assertTest(
    markAttendanceCode.includes("Back to dashboard") &&
    markAttendanceCode.includes("View verification panel"),
    "SuccessPanel includes 'Back to dashboard' and 'View verification panel' actions"
  );

  assertTest(
    markAttendanceCode.includes("id=\"mark-attendance-btn\"") &&
    markAttendanceCode.includes("Mark Attendance"),
    "Mark Attendance button is present and triggers attendance recording workflow"
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: SERVER-SIDE ATTENDANCE HARD GATES & SECURITY CHECKS
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 2: Server-Side Attendance Hard Gates & Security Checks ---");

  // TEST 7: Campus Wi-Fi Gatekeeper
  const noWifiMock = createMockReqRes({
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
    },
  });
  await attendanceHandler(noWifiMock.req, noWifiMock.res);
  const noWifiRes = noWifiMock.getResult();
  assertTest(
    noWifiRes.statusCode === 403 && noWifiRes.data?.error === "CAMPUS_NETWORK_UNAUTHORIZED",
    `Attendance without authorized Wi-Fi network token rejected with HTTP 403 (${noWifiRes.data?.error})`
  );

  // TEST 8: Campus GPS Polygon Geofence Gatekeeper
  const validNetToken = mintNetworkToken("SONA-WIFI");
  const outsideGpsMock = createMockReqRes({
    headers: { "x-network-auth-token": validNetToken },
    body: {
      staffCode: "SCT-001",
      latitude: 11.6500, // Outside campus
      longitude: 78.1000,
    },
  });
  await attendanceHandler(outsideGpsMock.req, outsideGpsMock.res);
  const outsideGpsRes = outsideGpsMock.getResult();
  assertTest(
    outsideGpsRes.statusCode === 403 && outsideGpsRes.data?.error === "GPS_OUTSIDE_CAMPUS",
    `Attendance outside campus GPS polygon rejected with HTTP 403 (${outsideGpsRes.data?.error})`
  );

  // TEST 9: GPS Accuracy Enforcement (<= 20m)
  const lowAccuracyMock = createMockReqRes({
    headers: { "x-network-auth-token": validNetToken },
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 35, // exceeds 20m threshold
    },
  });
  await attendanceHandler(lowAccuracyMock.req, lowAccuracyMock.res);
  const lowAccuracyRes = lowAccuracyMock.getResult();
  assertTest(
    lowAccuracyRes.statusCode === 403 && lowAccuracyRes.data?.error === "GPS_ACCURACY_INSUFFICIENT",
    `Attendance with poor GPS accuracy (>20m) rejected with HTTP 403 (${lowAccuracyRes.data?.error})`
  );

  // TEST 10: Authentication Gatekeeper (Reject Unauthenticated)
  const unauthMock = createMockReqRes({
    headers: { "x-network-auth-token": validNetToken },
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 8,
    },
  });
  await attendanceHandler(unauthMock.req, unauthMock.res);
  const unauthRes = unauthMock.getResult();
  assertTest(
    unauthRes.statusCode === 401 && unauthRes.data?.error === "UNAUTHORIZED",
    `Attendance without authenticated session rejected with HTTP 401 (${unauthRes.data?.error})`
  );

  // TEST 11: Identity Forgery Protection
  const sct001Token = mintStaffToken("SCT-001");
  const forgeryMock = createMockReqRes({
    headers: {
      authorization: `Bearer ${sct001Token}`,
      "x-network-auth-token": validNetToken,
    },
    body: {
      staffCode: "SCT-002", // Forged client attempt
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 8,
    },
  });
  await attendanceHandler(forgeryMock.req, forgeryMock.res);
  const forgeryRes = forgeryMock.getResult();
  assertTest(
    forgeryRes.statusCode === 403 && forgeryRes.data?.error === "IDENTITY_FORGERY_DETECTED",
    `Client-forged staff ID mismatch blocked with HTTP 403 (${forgeryRes.data?.error})`
  );

  // TEST 12: Registered Device Gatekeeper
  const noDeviceMock = createMockReqRes({
    headers: {
      authorization: `Bearer ${sct001Token}`,
      "x-network-auth-token": validNetToken,
    },
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 8,
      faceVerified: true,
      recognizedStaffCode: "SCT-001",
      livenessPassed: true,
      antiSpoofScore: 0.9,
    },
  });
  await attendanceHandler(noDeviceMock.req, noDeviceMock.res);
  const noDeviceRes = noDeviceMock.getResult();
  assertTest(
    noDeviceRes.statusCode === 403 && noDeviceRes.data?.error === "MISSING_DEVICE_SIGNATURE",
    `Attendance without cryptographic device signature rejected with HTTP 403 (${noDeviceRes.data?.error})`
  );

  // TEST 13: Biometric Face & Liveness Gatekeeper
  const failedLivenessToken = mintBiometricAttestation("SCT-001", "DEV_ANDROID_15da1ec2b55216de", "bad_nonce_" + Date.now());
  // Replace livenessPassed with false
  const [b64Part] = failedLivenessToken.split(".");
  const parsedAtt = JSON.parse(Buffer.from(b64Part, "base64url").toString("utf-8"));
  parsedAtt.livenessPassed = false;
  const badB64 = Buffer.from(JSON.stringify(parsedAtt)).toString("base64url");
  const badSig = crypto.createHmac("sha256", TOKEN_SECRET).update(badB64).digest("base64url");
  const badLivenessToken = `${badB64}.${badSig}`;

  const failedFaceMock = createMockReqRes({
    headers: {
      authorization: `Bearer ${sct001Token}`,
      "x-network-auth-token": validNetToken,
    },
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 8,
      biometricAttestation: badLivenessToken,
      faceVerified: true,
      recognizedStaffCode: "SCT-001",
    },
  });
  await attendanceHandler(failedFaceMock.req, failedFaceMock.res);
  const failedFaceRes = failedFaceMock.getResult();
  assertTest(
    failedFaceRes.statusCode === 403 && (
      failedFaceRes.data?.error === "INVALID_BIOMETRIC_ATTESTATION" ||
      failedFaceRes.data?.error === "LIVENESS_FAILED" ||
      failedFaceRes.data?.error === "FACE_BIOMETRIC_UNAUTHORIZED"
    ),
    `Attendance with failed biometric liveness rejected with HTTP 403 (${failedFaceRes.data?.error}: ${failedFaceRes.data?.message})`
  );

  // ---------------------------------------------------------------------------
  // SECTION 3: END-TO-END VERIFIED ATTENDANCE RECORDING & SUPABASE STORAGE
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 3: Verified Attendance Recording & Supabase Storage for SCT-001 ---");

  // Fetch registered active device for SCT-001
  const { data: deviceRow } = await supabase
    .from("devices")
    .select("*")
    .ilike("staff_code", "SCT-001")
    .eq("status", "Active")
    .limit(1)
    .single();

  assertTest(Boolean(deviceRow?.id), `Found active registered device for SCT-001 (${deviceRow?.id})`);

  // Mint biometric hardware attestation bound to SCT-001's active device
  const testNonce = "nonce_success_test_" + Date.now();
  const attestationToken = mintBiometricAttestation("SCT-001", deviceRow.id, testNonce);

  const attendanceSubmissionMock = createMockReqRes({
    headers: {
      authorization: `Bearer ${sct001Token}`,
      "x-network-auth-token": validNetToken,
      "x-forwarded-for": "111.92.42.18",
    },
    body: {
      staffCode: "SCT-001",
      staffName: "Fake Client Claim", // Authoritative server should pull genuine name
      department: "Fake Dept Claim", // Authoritative server should pull genuine dept
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 6.5,
      location: "Main Campus, Sona College",
      biometricAttestation: attestationToken,
      faceVerified: true,
      recognizedStaffCode: "SCT-001",
      deviceId: deviceRow.id,
      attemptNonce: testNonce,
    },
  });

  await attendanceHandler(attendanceSubmissionMock.req, attendanceSubmissionMock.res);
  const attResult = attendanceSubmissionMock.getResult();

  assertTest(
    attResult.statusCode === 200 && attResult.data?.success === true,
    `Attendance successfully recorded! Status HTTP 200, receipt issued.`
  );

  const receipt = attResult.data?.receipt;
  assertTest(
    Boolean(receipt?.attendanceId) && Boolean(receipt?.time) && Boolean(receipt?.date),
    `Receipt contains attendanceId (${receipt?.attendanceId}), time (${receipt?.time}), and date (${receipt?.date})`
  );

  assertTest(
    receipt?.staffCode === "SCT-001" &&
    receipt?.staffName === "Moulishwaran S" &&
    receipt?.department === "Computer Science & Engineering",
    `Receipt populated with authoritative staff data: SCT-001 · Moulishwaran S · Computer Science & Engineering`
  );

  // ---------------------------------------------------------------------------
  // SECTION 4: DIRECT DATABASE READ-BACK VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 4: Direct Supabase Database Read-Back from public.attendance_records ---");

  const { data: dbRecord, error: dbErr } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("id", receipt.attendanceId)
    .single();

  assertTest(!dbErr && Boolean(dbRecord), `Successfully queried public.attendance_records row for UUID ${receipt.attendanceId}`);
  assertTest(dbRecord?.staff_code === "SCT-001", `Stored staff_code matches authoritative faculty ID: ${dbRecord?.staff_code}`);
  assertTest(dbRecord?.staff_name === "Moulishwaran S", `Stored staff_name matches authoritative name: ${dbRecord?.staff_name}`);
  assertTest(dbRecord?.department === "Computer Science & Engineering", `Stored department matches authoritative department: ${dbRecord?.department}`);
  assertTest(dbRecord?.status === "Present" && dbRecord?.verification === "Verified", `Stored status is Present and verification is Verified`);
  assertTest(Boolean(dbRecord?.time) && Boolean(dbRecord?.date), `Stored record contains valid time (${dbRecord?.time}) and date (${dbRecord?.date})`);

  // ---------------------------------------------------------------------------
  // SECTION 5: ACCIDENTAL DUPLICATE PREVENTION (IDEMPOTENCY)
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 5: Accidental Duplicate Submission Prevention (Idempotency) ---");

  const duplicateNonce = "nonce_dup_test_" + Date.now();
  const duplicateAttestation = mintBiometricAttestation("SCT-001", deviceRow.id, duplicateNonce);

  const duplicateMock = createMockReqRes({
    headers: {
      authorization: `Bearer ${sct001Token}`,
      "x-network-auth-token": validNetToken,
      "x-forwarded-for": "111.92.42.18",
    },
    body: {
      staffCode: "SCT-001",
      latitude: 11.67776,
      longitude: 78.12519,
      accuracy: 7.0,
      biometricAttestation: duplicateAttestation,
      faceVerified: true,
      recognizedStaffCode: "SCT-001",
      deviceId: deviceRow.id,
      attemptNonce: duplicateNonce,
    },
  });

  await attendanceHandler(duplicateMock.req, duplicateMock.res);
  const dupResult = duplicateMock.getResult();

  assertTest(
    dupResult.statusCode === 200 && dupResult.data?.alreadyMarked === true,
    `Duplicate request recognized: HTTP 200 returned with alreadyMarked: true`
  );

  assertTest(
    dupResult.data?.receipt?.attendanceId === receipt.attendanceId,
    `Duplicate request returns original Attendance ID (${dupResult.data?.receipt?.attendanceId}), preventing new entry`
  );

  // Verify record count for SCT-001 today in Supabase
  const todayDateStr = dbRecord.date;
  const { count: todayCount } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .ilike("staff_code", "SCT-001")
    .eq("date", todayDateStr);

  assertTest(
    todayCount === 1,
    `Supabase exact row count for SCT-001 on date ${todayDateStr} is strictly 1 (No duplicate row created)`
  );

  // ---------------------------------------------------------------------------
  // SECTION 6: HISTORICAL RECORDS PRESERVATION
  // ---------------------------------------------------------------------------
  console.log("\n--- SECTION 6: Historical Attendance Records Preservation ---");

  const { data: allFacultyRecords } = await supabase
    .from("attendance_records")
    .select("id, staff_code, date, time")
    .ilike("staff_code", "SCT-001")
    .order("date", { ascending: true });

  assertTest(
    Array.isArray(allFacultyRecords) && allFacultyRecords.length >= 2,
    `Faculty SCT-001 historical attendance ledger preserved with ${allFacultyRecords?.length} total records`
  );

  // Verify historical dates are untouched
  const hasOct21 = allFacultyRecords.some((r) => r.date === "2026-10-21");
  const hasOct15 = allFacultyRecords.some((r) => r.date === "2026-10-15");
  assertTest(hasOct21 && hasOct15, `Historical records for 2026-10-21 and 2026-10-15 strictly intact and unmodified`);

  console.log("\n===============================================================================");
  console.log(`     RESULTS: ${passedTests} / ${totalTests} ATTENDANCE WORKFLOW TESTS PASSED  `);
  console.log("===============================================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
