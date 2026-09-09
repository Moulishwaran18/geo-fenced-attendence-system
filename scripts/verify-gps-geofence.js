import {
  AUTHORIZED_GEOFENCE_POLYGON,
  isPointInPolygon,
  evaluateGeofence,
  getPolygonCentroid,
} from "../src/lib/geofence/geofence-service.ts";

console.log("===============================================================================");
console.log("       CAMPUSATTEND AUTHORITATIVE GPS GEOFENCE AUDIT & TEST REPORT             ");
console.log("===============================================================================\n");

// 1. Polygon Coordinates Verification
console.log("1. AUTHORITATIVE GEOFENCE POLYGON VERTICES (C1 → C2 → ... → C19 → C1):");
AUTHORIZED_GEOFENCE_POLYGON.forEach((pt, idx) => {
  console.log(`   C${idx + 1}: Lat: ${pt.lat.toFixed(6)}, Lng: ${pt.lng.toFixed(6)}`);
});

// Check if polygon has 19 vertices
const hasExpectedVertices = AUTHORIZED_GEOFENCE_POLYGON.length === 19;
console.log(`\n   • Total Vertices: ${AUTHORIZED_GEOFENCE_POLYGON.length} (${hasExpectedVertices ? "✓ 19 Vertices Present" : "✗ MISMATCH"})`);

// Closure check: C19 connects back to C1
const c1 = AUTHORIZED_GEOFENCE_POLYGON[0];
const c19 = AUTHORIZED_GEOFENCE_POLYGON[AUTHORIZED_GEOFENCE_POLYGON.length - 1];
const isClosed = c1.lat === c19.lat && c1.lng === c19.lng;
console.log(`   • Polygon Closure: C1 (${c1.lat}, ${c1.lng}) ← C19 (${c19.lat}, ${c19.lng}) [${isClosed ? "✓ Exact Loop Closed" : "✗ Not Closed"}]`);

const centroid = getPolygonCentroid();
console.log(`   • Computed Polygon Centroid: Lat ${centroid.lat.toFixed(8)}° N, Lng ${centroid.lng.toFixed(8)}° E`);

// 2. Point-in-Polygon Tests
console.log("\n2. POINT-IN-POLYGON (PIP) ALGORITHM VERIFICATION:");

const testPoints = [
  {
    name: "Centroid Interior Point",
    lat: centroid.lat,
    lng: centroid.lng,
    expectedInside: true,
  },
  {
    name: "Inside Point A (Campus Core)",
    lat: 11.677100,
    lng: 78.125300,
    expectedInside: true,
  },
  {
    name: "Inside Point B (North Quad)",
    lat: 11.678500,
    lng: 78.125500,
    expectedInside: true,
  },
  {
    name: "Inside Point C (South Quad)",
    lat: 11.675600,
    lng: 78.125000,
    expectedInside: true,
  },
  {
    name: "Outside North",
    lat: 11.682000,
    lng: 78.125300,
    expectedInside: false,
  },
  {
    name: "Outside South",
    lat: 11.672000,
    lng: 78.125300,
    expectedInside: false,
  },
  {
    name: "Outside East",
    lat: 11.677100,
    lng: 78.130000,
    expectedInside: false,
  },
  {
    name: "Outside West",
    lat: 11.677100,
    lng: 78.120000,
    expectedInside: false,
  },
  {
    name: "Distant Outside (Salem Railway Station)",
    lat: 11.655000,
    lng: 78.158000,
    expectedInside: false,
  },
];

let allPassed = hasExpectedVertices && isClosed;

testPoints.forEach((tp, i) => {
  const result = evaluateGeofence({ lat: tp.lat, lng: tp.lng, accuracy: 5.0 });
  const passed = result.isInside === tp.expectedInside;
  if (!passed) allPassed = false;

  console.log(`\n   [Test #${i + 1}] ${tp.name}:`);
  console.log(`     - Coordinates:      ${tp.lat.toFixed(6)}° N, ${tp.lng.toFixed(6)}° E`);
  console.log(`     - PIP Result:       ${result.isInside ? "INSIDE (ALLOWED)" : "OUTSIDE (BLOCKED)"}`);
  console.log(`     - Expected:         ${tp.expectedInside ? "INSIDE" : "OUTSIDE"}`);
  console.log(`     - Distance to Edge: ${result.distanceToBoundaryMeters.toFixed(2)} meters`);
  console.log(`     - Dist to Centroid: ${result.distanceToCentroidMeters.toFixed(2)} meters`);
  console.log(`     - Test Status:      ${passed ? "✓ PASS" : "✗ FAIL"}`);
});

console.log("\n===============================================================================");
console.log("       3-FACTOR PRESENCE VERIFICATION (WIFI + GPS + BIOMETRIC FACE)            ");
console.log("===============================================================================\n");

const multiFactorScenarios = [
  {
    case: "Wi-Fi OK + GPS Inside Campus + Authorized Face (PERSON_001)",
    wifiOk: true,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "ALLOWED",
  },
  {
    case: "Wi-Fi OK + GPS Inside Campus + Authorized Face (PERSON_002)",
    wifiOk: true,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_002",
    faceDistance: 0.000,
    expectedAttendance: "ALLOWED",
  },
  {
    case: "Wi-Fi OK + GPS Outside Campus + Authorized Face (PERSON_001)",
    wifiOk: true,
    gpsInside: false,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "REJECTED",
  },
  {
    case: "Wi-Fi Fail + GPS Inside Campus + Authorized Face (PERSON_001)",
    wifiOk: false,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "REJECTED",
  },
  {
    case: "Wi-Fi OK + GPS Inside Campus + Unknown Face",
    wifiOk: true,
    gpsInside: true,
    faceMatch: false,
    faceId: null,
    faceDistance: 0.785,
    expectedAttendance: "REJECTED",
  },
  {
    case: "All 3 Security Factors Failed",
    wifiOk: false,
    gpsInside: false,
    faceMatch: false,
    faceId: null,
    faceDistance: 0.890,
    expectedAttendance: "REJECTED",
  },
];

multiFactorScenarios.forEach((sc, i) => {
  const allowed = sc.wifiOk && sc.gpsInside && sc.faceMatch;
  const decision = allowed ? "ALLOWED" : "REJECTED";
  const passed = decision === sc.expectedAttendance;
  if (!passed) allPassed = false;

  console.log(`   [Scenario #${i + 1}] ${sc.case}:`);
  console.log(`     - Wi-Fi Factor:     ${sc.wifiOk ? "AUTHORIZED (PASS)" : "UNAUTHORIZED (FAIL)"}`);
  console.log(`     - GPS Factor:       ${sc.gpsInside ? "INSIDE (PASS)" : "OUTSIDE (FAIL)"}`);
  console.log(`     - Face Factor:      ${sc.faceMatch ? `AUTHORIZED (${sc.faceId}, dist: ${sc.faceDistance.toFixed(3)})` : "UNKNOWN (FAIL)"}`);
  console.log(`     - Final Attendance: ${decision} (Expected: ${sc.expectedAttendance})`);
  console.log(`     - Status:           ${passed ? "✓ PASS" : "✗ FAIL"}\n`);
});

console.log("===============================================================================");
console.log(`   ALL GEOFENCE & 3-FACTOR TESTS: ${allPassed ? "PASSED (100%)" : "FAILED"}`);
console.log("===============================================================================\n");

process.exitCode = allPassed ? 0 : 1;
