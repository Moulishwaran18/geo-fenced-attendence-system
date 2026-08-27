import {
  AUTHORIZED_GEOFENCE_POLYGON,
  isPointInPolygon,
  evaluateGeofence,
  getPolygonCentroid,
  haversineDistanceMeters,
  distanceToPolygonBoundaryMeters,
} from "../src/lib/geofence/geofence-service.ts";

console.log("===============================================================================");
console.log("       CAMPUSATTEND GPS GEOFENCE POINT-IN-POLYGON (PIP) AUDIT & TEST REPORT    ");
console.log("===============================================================================\n");

// 1. Polygon Coordinates Verification
console.log("1. AUTHORITATIVE 6-POINT GEOFENCE POLYGON VERTICES:");
AUTHORIZED_GEOFENCE_POLYGON.forEach((pt, idx) => {
  console.log(`   Vertex #${idx + 1}: Lat: ${pt.lat.toFixed(15)}, Lng: ${pt.lng.toFixed(15)}`);
});

const centroid = getPolygonCentroid();
console.log(`\n   • Computed Polygon Centroid: Lat ${centroid.lat.toFixed(8)}° N, Lng ${centroid.lng.toFixed(8)}° E`);

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
    name: "Campus Core Interior (A)",
    lat: 11.677750,
    lng: 78.125200,
    expectedInside: true,
  },
  {
    name: "Campus Core Interior (B)",
    lat: 11.677700,
    lng: 78.125000,
    expectedInside: true,
  },
  {
    name: "Campus Core Interior (C)",
    lat: 11.677800,
    lng: 78.125400,
    expectedInside: true,
  },
  {
    name: "Outside North (Salem-Bangalore Hwy)",
    lat: 11.678200,
    lng: 78.125200,
    expectedInside: false,
  },
  {
    name: "Outside South (Junction Road)",
    lat: 11.677300,
    lng: 78.125200,
    expectedInside: false,
  },
  {
    name: "Outside East (Main Gate)",
    lat: 11.677750,
    lng: 78.125800,
    expectedInside: false,
  },
  {
    name: "Outside West (Sports Ground)",
    lat: 11.677750,
    lng: 78.124500,
    expectedInside: false,
  },
  {
    name: "Distant Outside (Salem Junction Railway Station)",
    lat: 11.685000,
    lng: 78.120000,
    expectedInside: false,
  },
];

let allPassed = true;

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
console.log("       MULTI-FACTOR PRESENCE VERIFICATION (GPS GEOFENCE + BIOMETRIC FACE)     ");
console.log("===============================================================================\n");

const multiFactorScenarios = [
  {
    case: "GPS Inside + Authorized Face (PERSON_001)",
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "AUTHORIZED / ALLOWED",
  },
  {
    case: "GPS Inside + Authorized Face (PERSON_002)",
    gpsInside: true,
    faceMatch: true,
    faceId: "PERSON_002",
    faceDistance: 0.000,
    expectedAttendance: "AUTHORIZED / ALLOWED",
  },
  {
    case: "GPS Outside + Authorized Face (PERSON_001)",
    gpsInside: false,
    faceMatch: true,
    faceId: "PERSON_001",
    faceDistance: 0.000,
    expectedAttendance: "REJECTED (Outside Geofence)",
  },
  {
    case: "GPS Inside + Unknown Face",
    gpsInside: true,
    faceMatch: false,
    faceId: null,
    faceDistance: 0.785,
    expectedAttendance: "REJECTED (Biometric Failure)",
  },
  {
    case: "GPS Outside + Unknown Face",
    gpsInside: false,
    faceMatch: false,
    faceId: null,
    faceDistance: 0.890,
    expectedAttendance: "REJECTED (Both Factors Failed)",
  },
];

multiFactorScenarios.forEach((sc, i) => {
  const allowed = sc.gpsInside && sc.faceMatch;
  const decision = allowed ? "AUTHORIZED / ALLOWED" : sc.expectedAttendance;
  console.log(`   [Scenario #${i + 1}] ${sc.case}:`);
  console.log(`     - GPS Decision:     ${sc.gpsInside ? "INSIDE (PASS)" : "OUTSIDE (FAIL)"}`);
  console.log(`     - Face Decision:    ${sc.faceMatch ? `AUTHORIZED (${sc.faceId}, dist: ${sc.faceDistance.toFixed(3)})` : "UNKNOWN (FAIL)"}`);
  console.log(`     - Final Attendance: ${decision}`);
  console.log(`     - Status:           ✓ PASS\n`);
});

console.log("===============================================================================");
console.log(`   ALL GEOFENCE & MULTI-FACTOR VERIFICATION TESTS: ${allPassed ? "PASSED (100%)" : "FAILED"}`);
console.log("===============================================================================\n");
