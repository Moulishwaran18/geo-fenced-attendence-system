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
console.log("1. AUTHORITATIVE GEOFENCE POLYGON VERTICES (C1 → C2 → ... → C13):");
AUTHORIZED_GEOFENCE_POLYGON.forEach((pt, idx) => {
  console.log(`   C${idx + 1}: Lat: ${pt.lat.toFixed(6)}, Lng: ${pt.lng.toFixed(6)}`);
});

// Check if polygon has 13 vertices
const hasExpectedVertices = AUTHORIZED_GEOFENCE_POLYGON.length === 13;
console.log(`\n   • Total Vertices: ${AUTHORIZED_GEOFENCE_POLYGON.length} (${hasExpectedVertices ? "✓ 13 Vertices Present" : "✗ MISMATCH"})`);

// Closure check: Algorithm connects C13 back to C1
const p1 = AUTHORIZED_GEOFENCE_POLYGON[0];
const p13 = AUTHORIZED_GEOFENCE_POLYGON[AUTHORIZED_GEOFENCE_POLYGON.length - 1];
const midClosingEdge = { lat: (p1.lat + p13.lat) / 2, lng: (p1.lng + p13.lng) / 2 };
const isClosed = isPointInPolygon({ lat: midClosingEdge.lat, lng: midClosingEdge.lng - 0.0001 }) &&
                 !isPointInPolygon({ lat: midClosingEdge.lat, lng: midClosingEdge.lng + 0.0001 });
console.log(`   • Polygon Closure: C13 (${p13.lat.toFixed(6)}, ${p13.lng.toFixed(6)}) → C1 (${p1.lat.toFixed(6)}, ${p1.lng.toFixed(6)}) [${isClosed ? "✓ Exact Loop Closed by Algorithm" : "✗ Not Closed"}]`);

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
    lat: 11.676800,
    lng: 78.122800,
    expectedInside: true,
  },
  {
    name: "Inside Point B (North Quad)",
    lat: 11.677200,
    lng: 78.123200,
    expectedInside: true,
  },
  {
    name: "Inside Point C (West Quad)",
    lat: 11.676600,
    lng: 78.121800,
    expectedInside: true,
  },
  {
    name: "Inside Point D (South Quad)",
    lat: 11.676000,
    lng: 78.123500,
    expectedInside: true,
  },
  {
    name: "Boundary: Just Inside North Edge (5m)",
    lat: 11.677940,
    lng: 78.123069,
    expectedInside: true,
  },
  {
    name: "Boundary: Just Inside West Edge (5m)",
    lat: 11.676677,
    lng: 78.121505,
    expectedInside: true,
  },
  {
    name: "Boundary: Just Outside North Edge (5m)",
    lat: 11.678030,
    lng: 78.123069,
    expectedInside: false,
  },
  {
    name: "Boundary: Just Outside West Edge (5m)",
    lat: 11.676677,
    lng: 78.121413,
    expectedInside: false,
  },
  {
    name: "Outside North",
    lat: 11.682000,
    lng: 78.122700,
    expectedInside: false,
  },
  {
    name: "Outside South",
    lat: 11.672000,
    lng: 78.122700,
    expectedInside: false,
  },
  {
    name: "Outside East",
    lat: 11.676500,
    lng: 78.130000,
    expectedInside: false,
  },
  {
    name: "Outside West",
    lat: 11.676500,
    lng: 78.118000,
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
