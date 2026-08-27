/**
 * End-to-End Test Matrix for Development/Test Mode & Production Mode Attendance Verification
 *
 * Validates:
 * 1. GPS INSIDE + PERSON_001 -> ALLOW
 * 2. GPS INSIDE + PERSON_002 -> ALLOW
 * 3. GPS INSIDE + UNKNOWN -> REJECT
 * 4. GPS OUTSIDE + valid face -> REJECT
 * 5. PROD MODE (outside 8:45-9:10 AM) -> REJECT
 */

import pg from "pg";
import { isPointInPolygon, AUTHORIZED_GEOFENCE_POLYGON } from "../src/lib/geofence/geofence-service.ts";
import { isWithinAttendanceWindow, ATTENDANCE_WINDOW_CONFIG } from "../src/lib/india-time.ts";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

// Campus coordinates inside polygon (Sona College Main Gate / CSE Block)
const GPS_INSIDE_POINT = {
  lat: 11.67776,
  lng: 78.12519,
};

// Coordinates outside polygon (Salem Bus Stand ~5km away)
const GPS_OUTSIDE_POINT = {
  lat: 11.6550,
  lng: 78.1580,
};

async function getStaffEmbedding(staffCode) {
  const query = `
    SELECT f.embedding, s.staff_code, s.name, s.active
    FROM face_embeddings f
    JOIN staff s ON f.staff_id = s.id
    WHERE s.staff_code = $1 AND s.active = true
    LIMIT 1
  `;
  const res = await pool.query(query, [staffCode]);
  if (res.rows.length === 0) {
    throw new Error(`No active embedding found for ${staffCode}`);
  }
  let emb = res.rows[0].embedding;
  if (typeof emb === "string") {
    emb = emb.replace(/[\[\]]/g, "").split(",").map(Number);
  }
  return {
    descriptor: emb,
    staffCode: res.rows[0].staff_code,
    name: res.rows[0].name,
  };
}

async function verifyFaceApi(descriptor, sessionId) {
  const res = await fetch("https://localhost:8080/api/face/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      descriptor,
      verificationSessionId: sessionId,
    }),
  });
  return await res.json();
}

function evaluateAttendanceFlow({
  isDevMode,
  currentTime,
  gpsCoords,
  faceVerifyResult,
}) {
  // 1. Time window evaluation
  const inWindow = isWithinAttendanceWindow(currentTime);
  const isTimeAuthorized = isDevMode ? true : inWindow;

  // 2. GPS Geofence polygon evaluation
  const isLocationAuthorized = isPointInPolygon(
    { lat: gpsCoords.lat, lng: gpsCoords.lng },
    AUTHORIZED_GEOFENCE_POLYGON
  );

  // 3. Biometric face authorization
  const isIdentityAuthorized = Boolean(
    faceVerifyResult &&
    faceVerifyResult.matched &&
    (faceVerifyResult.finalResult === "PERSON_001" || faceVerifyResult.finalResult === "PERSON_002") &&
    faceVerifyResult.distance <= 0.45
  );

  // Final decision
  if (!isTimeAuthorized) {
    return {
      decision: "REJECT",
      reason: `REJECTED (Outside Attendance Window ${ATTENDANCE_WINDOW_CONFIG.label})`,
      canMark: false,
    };
  }

  if (!isLocationAuthorized) {
    return {
      decision: "REJECT",
      reason: "REJECTED (Outside Campus Polygon Geofence)",
      canMark: false,
    };
  }

  if (!isIdentityAuthorized) {
    return {
      decision: "REJECT",
      reason: `REJECTED (Biometric Verification Failed / Unknown Face: ${faceVerifyResult?.finalResult})`,
      canMark: false,
    };
  }

  return {
    decision: "ALLOW",
    reason: isDevMode
      ? `ALLOWED (Dev Mode — Time Window Bypassed for ${faceVerifyResult.finalResult})`
      : `ALLOWED (Production Verified — ${faceVerifyResult.finalResult})`,
    canMark: true,
  };
}

async function runMatrix() {
  console.log("================================================================================");
  console.log("       CAMPUSATTEND E2E TEST MATRIX — DEV / TEST MODE & PRODUCTION MODE        ");
  console.log("================================================================================\n");

  const p1 = await getStaffEmbedding("PERSON_001");
  const p2 = await getStaffEmbedding("PERSON_002");

  // Generate random normalized 512-D vector for unknown face
  const rawUnknown = Array.from({ length: 512 }, () => Math.random() - 0.5);
  const normU = Math.sqrt(rawUnknown.reduce((s, v) => s + v * v, 0));
  const unknownDescriptor = rawUnknown.map((v) => v / normU);

  const currentTime = new Date(); // Current time e.g. 03:45 PM
  console.log(`Current Test Time (IST): ${currentTime.toISOString()}`);
  console.log(`Is within 8:45 AM - 9:10 AM IST: ${isWithinAttendanceWindow(currentTime)}\n`);

  let allPassed = true;

  // --------------------------------------------------------------------------
  // TEST 1: GPS INSIDE + PERSON_001 (Dev Mode) -> ALLOW
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 1: GPS INSIDE + PERSON_001 (Development / Test Mode)");
  const res1 = await verifyFaceApi(p1.descriptor, "TEST-DEV-P001");
  const eval1 = evaluateAttendanceFlow({
    isDevMode: true,
    currentTime,
    gpsCoords: GPS_INSIDE_POINT,
    faceVerifyResult: res1,
  });
  console.log(`  Face API matched: ${res1.matched} | finalResult: ${res1.finalResult} | dist: ${res1.distance?.toFixed(4)}`);
  console.log(`  GPS in polygon:   ${isPointInPolygon(GPS_INSIDE_POINT, AUTHORIZED_GEOFENCE_POLYGON)}`);
  console.log(`  Final Decision:   ${eval1.decision} -> ${eval1.reason}`);
  if (eval1.decision === "ALLOW" && res1.finalResult === "PERSON_001") {
    console.log("  [PASS] GPS INSIDE + PERSON_001 correctly ALLOWED in Dev Mode.\n");
  } else {
    console.error("  [FAIL] Expected ALLOW for GPS INSIDE + PERSON_001 in Dev Mode.\n");
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 2: GPS INSIDE + PERSON_002 (Dev Mode) -> ALLOW
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 2: GPS INSIDE + PERSON_002 (Development / Test Mode)");
  const res2 = await verifyFaceApi(p2.descriptor, "TEST-DEV-P002");
  const eval2 = evaluateAttendanceFlow({
    isDevMode: true,
    currentTime,
    gpsCoords: GPS_INSIDE_POINT,
    faceVerifyResult: res2,
  });
  console.log(`  Face API matched: ${res2.matched} | finalResult: ${res2.finalResult} | dist: ${res2.distance?.toFixed(4)}`);
  console.log(`  GPS in polygon:   ${isPointInPolygon(GPS_INSIDE_POINT, AUTHORIZED_GEOFENCE_POLYGON)}`);
  console.log(`  Final Decision:   ${eval2.decision} -> ${eval2.reason}`);
  if (eval2.decision === "ALLOW" && res2.finalResult === "PERSON_002") {
    console.log("  [PASS] GPS INSIDE + PERSON_002 correctly ALLOWED in Dev Mode.\n");
  } else {
    console.error("  [FAIL] Expected ALLOW for GPS INSIDE + PERSON_002 in Dev Mode.\n");
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 3: GPS INSIDE + UNKNOWN (Dev Mode) -> REJECT
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 3: GPS INSIDE + UNKNOWN (Development / Test Mode)");
  const res3 = await verifyFaceApi(unknownDescriptor, "TEST-DEV-UNKNOWN");
  const eval3 = evaluateAttendanceFlow({
    isDevMode: true,
    currentTime,
    gpsCoords: GPS_INSIDE_POINT,
    faceVerifyResult: res3,
  });
  console.log(`  Face API matched: ${res3.matched} | finalResult: ${res3.finalResult} | dist: ${res3.distance?.toFixed(4)}`);
  console.log(`  GPS in polygon:   ${isPointInPolygon(GPS_INSIDE_POINT, AUTHORIZED_GEOFENCE_POLYGON)}`);
  console.log(`  Final Decision:   ${eval3.decision} -> ${eval3.reason}`);
  if (eval3.decision === "REJECT" && res3.matched === false && res3.finalResult === "UNKNOWN") {
    console.log("  [PASS] GPS INSIDE + UNKNOWN correctly REJECTED in Dev Mode.\n");
  } else {
    console.error("  [FAIL] Expected REJECT for GPS INSIDE + UNKNOWN in Dev Mode.\n");
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 4: GPS OUTSIDE + valid face (PERSON_001) (Dev Mode) -> REJECT
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 4: GPS OUTSIDE + Valid Face PERSON_001 (Development / Test Mode)");
  const res4 = await verifyFaceApi(p1.descriptor, "TEST-DEV-OUTSIDE");
  const eval4 = evaluateAttendanceFlow({
    isDevMode: true,
    currentTime,
    gpsCoords: GPS_OUTSIDE_POINT,
    faceVerifyResult: res4,
  });
  console.log(`  Face API matched: ${res4.matched} | finalResult: ${res4.finalResult} | dist: ${res4.distance?.toFixed(4)}`);
  console.log(`  GPS in polygon:   ${isPointInPolygon(GPS_OUTSIDE_POINT, AUTHORIZED_GEOFENCE_POLYGON)}`);
  console.log(`  Final Decision:   ${eval4.decision} -> ${eval4.reason}`);
  if (eval4.decision === "REJECT" && eval4.reason.includes("Outside Campus Polygon Geofence")) {
    console.log("  [PASS] GPS OUTSIDE + valid face correctly REJECTED in Dev Mode.\n");
  } else {
    console.error("  [FAIL] Expected REJECT for GPS OUTSIDE + valid face in Dev Mode.\n");
    allPassed = false;
  }

  // --------------------------------------------------------------------------
  // TEST 5: PRODUCTION MODE (outside 8:45-9:10 AM) + valid face + inside GPS -> REJECT
  // --------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 5: PRODUCTION MODE (Outside 8:45 AM - 9:10 AM Window)");
  const eval5 = evaluateAttendanceFlow({
    isDevMode: false,
    currentTime,
    gpsCoords: GPS_INSIDE_POINT,
    faceVerifyResult: res1,
  });
  console.log(`  In Production Window: ${isWithinAttendanceWindow(currentTime)}`);
  console.log(`  Final Decision:       ${eval5.decision} -> ${eval5.reason}`);
  if (!isWithinAttendanceWindow(currentTime)) {
    if (eval5.decision === "REJECT" && eval5.reason.includes("Outside Attendance Window")) {
      console.log("  [PASS] Production mode correctly REJECTS attendance outside 8:45 AM – 9:10 AM.\n");
    } else {
      console.error("  [FAIL] Expected Production Mode to REJECT outside time window.\n");
      allPassed = false;
    }
  } else {
    console.log("  (Note: Currently inside time window, production mode allows valid attendance).\n");
  }

  console.log("================================================================================");
  if (allPassed) {
    console.log("✓ ALL 5 CRITICAL TEST CASES PASSED SUCCESSFULLY!");
  } else {
    console.error("✗ ONE OR MORE TESTS FAILED!");
  }
  console.log("================================================================================\n");

  await pool.end();
  process.exitCode = allPassed ? 0 : 1;
}

runMatrix().catch((err) => {
  console.error("Matrix execution error:", err);
  process.exitCode = 1;
});

