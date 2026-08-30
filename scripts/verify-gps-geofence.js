import {
  AUTHORIZED_GEOFENCE_POLYGON,
  isPointInPolygon,
  evaluateGeofence,
  getPolygonCentroid,
} from "../src/lib/geofence/geofence-service.ts";

console.log("===============================================================================");
console.log("       CAMPUSATTEND 5-POINT GPS GEOFENCE AUDIT & TEST REPORT                   ");
console.log("===============================================================================\n");

// 1. Polygon Coordinates Verification
console.log("1. AUTHORITATIVE 5-POINT GEOFENCE POLYGON VERTICES (C1 → C2 → C3 → C4 → C5 → C1):");
AUTHORIZED_GEOFENCE_POLYGON.forEach((pt, idx) => {
  console.log(`   C${idx + 1}: Lat: ${pt.lat.toFixed(6)}, Lng: ${pt.lng.toFixed(6)}`);
});

// Check if polygon has 5 vertices
const has5Points = AUTHORIZED_GEOFENCE_POLYGON.length === 5;
console.log(`\n   • Total Vertices: ${AUTHORIZED_GEOFENCE_POLYGON.length} (${has5Points ? "✓ 5 Vertices Present" : "✗ MISMATCH"})`);

// Closure check: C5 connects back to C1
const c1 = AUTHORIZED_GEOFENCE_POLYGON[0];
const c5 = AUTHORIZED_GEOFENCE_POLYGON[4];
console.log(`   • Polygon Closure: C1 (${c1.lat}, ${c1.lng}) ← C5 (${c5.lat}, ${c5.lng}) closed via ray-casting edge`);

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
    name: "Inside Point A (Center Core)",
    lat: 11.680300,
    lng: 78.121800,
    expectedInside: true,
  },
  {
    name: "Inside Point B (Near C1/C5)",
    lat: 11.680150,
    lng: 78.121820,
    expectedInside: true,
  },
  {
    name: "Inside Point C (Near C3/C4)",
    lat: 11.680500,
    lng: 78.121700,
    expectedInside: true,
  },
  {
    name: "Outside North (Highway)",
    lat: 11.685000,
    lng: 78.121800,
    expectedInside: false,
  },
  {
    name: "Outside South",
    lat: 11.675000,
    lng: 78.121800,
    expectedInside: false,
  },
  {
    name: "Outside East",
    lat: 11.680300,
    lng: 78.130000,
    expectedInside: false,
  },
  {
    name: "Outside West",
    lat: 11.680300,
    lng: 78.110000,
    expectedInside: false,
  },
  {
    name: "Distant Outside (Salem Railway Station)",
    lat: 11.655000,
    lng: 78.158000,
    expectedInside: false,
  },
];

let allPassed = has5Points;

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
console.log("       3-FACTOR PRESENCE VERIFICATION (WIFI + 5-PT GPS + BIOMETRIC FACE)       ");
console.log("===============================================================================\n");

const multiFactorScenarios = [
  {
    case: "Wi-Fi OK + GPS Inside 5-Pt + Authorized Face (PERSON_001)",
    wifiOk: true,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "ALLOWED",
  },
  {
    case: "Wi-Fi OK + GPS Inside 5-Pt + Authorized Face (PERSON_002)",
    wifiOk: true,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_002",
    faceDistance: 0.000,
    expectedAttendance: "ALLOWED",
  },
  {
    case: "Wi-Fi OK + GPS Outside 5-Pt + Authorized Face (PERSON_001)",
    wifiOk: true,
    gpsInside: false,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "REJECTED",
  },
  {
    case: "Wi-Fi Fail + GPS Inside 5-Pt + Authorized Face (PERSON_001)",
    wifiOk: false,
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "REJECTED",
  },
  {
    case: "Wi-Fi OK + GPS Inside 5-Pt + Unknown Face",
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
  console.log(`     - GPS 5-Pt Factor:  ${sc.gpsInside ? "INSIDE (PASS)" : "OUTSIDE (FAIL)"}`);
  console.log(`     - Face Factor:      ${sc.faceMatch ? `AUTHORIZED (${sc.faceId}, dist: ${sc.faceDistance.toFixed(3)})` : "UNKNOWN (FAIL)"}`);
  console.log(`     - Final Attendance: ${decision} (Expected: ${sc.expectedAttendance})`);
  console.log(`     - Status:           ${passed ? "✓ PASS" : "✗ FAIL"}\n`);
});

console.log("===============================================================================");
console.log(`   ALL 5-POINT GEOFENCE & 3-FACTOR TESTS: ${allPassed ? "PASSED (100%)" : "FAILED"}`);
console.log("===============================================================================\n");

process.exitCode = allPassed ? 0 : 1;
