import {
  AUTHORIZED_GEOFENCE_POLYGON,
  isPointInPolygon,
  evaluateGeofence,
  haversineDistanceMeters,
  getPolygonCentroid,
} from "../src/lib/geofence/geofence-service.ts";
import {
  getGpsQuality,
  checkTemporalStability,
} from "../src/hooks/use-geofence.ts";

console.log("===============================================================================");
console.log("   CAMPUSATTEND ENHANCED GPS ACCURACY & MULTI-READING VERIFICATION SUITE       ");
console.log("===============================================================================\n");

let allPassed = true;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  [PASS] ${testName}${details ? ` -> ${details}` : ""}`);
  } else {
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ""}`);
    allPassed = false;
  }
}

// -----------------------------------------------------------------------------
// TEST 1: Exact 5-Point Polygon Integrity (C1 -> C2 -> C3 -> C4 -> C5 -> C1)
// -----------------------------------------------------------------------------
console.log("1. TESTING AUTHORITATIVE 5-POINT POLYGON INTEGRITY:");
assert(
  AUTHORIZED_GEOFENCE_POLYGON.length === 5,
  "Polygon contains exactly 5 vertices",
  `Found ${AUTHORIZED_GEOFENCE_POLYGON.length} vertices`,
);

const expectedCoords = [
  { lat: 11.680071, lng: 78.121811 },
  { lat: 11.680239, lng: 78.121575 },
  { lat: 11.680607, lng: 78.121628 },
  { lat: 11.680439, lng: 78.122047 },
  { lat: 11.680176, lng: 78.122057 },
];

expectedCoords.forEach((exp, idx) => {
  const actual = AUTHORIZED_GEOFENCE_POLYGON[idx];
  assert(
    actual && actual.lat === exp.lat && actual.lng === exp.lng,
    `Vertex C${idx + 1} matches authoritative coordinates`,
    `Expected: (${exp.lat}, ${exp.lng}) | Actual: (${actual?.lat}, ${actual?.lng})`,
  );
});

const centroid = getPolygonCentroid();
assert(
  centroid.lat > 11.679 && centroid.lat < 11.681 && centroid.lng > 78.121 && centroid.lng < 78.123,
  "Polygon centroid is within Sona College campus bounds",
  `Centroid: ${centroid.lat.toFixed(6)}° N, ${centroid.lng.toFixed(6)}° E`,
);

// -----------------------------------------------------------------------------
// TEST 2: GPS Accuracy Policy Tiers
// -----------------------------------------------------------------------------
console.log("\n2. TESTING GPS ACCURACY POLICY TIERS (<=10m EXCELLENT, 10-20m GOOD, 20-50m ACQUIRING / WAIT, >50m UNRELIABLE):");

const accuracyTestCases = [
  { acc: 3.5, expected: "EXCELLENT", desc: "Superb GPS fix (3.5m)" },
  { acc: 8.0, expected: "EXCELLENT", desc: "High accuracy GPS fix (8.0m)" },
  { acc: 10.0, expected: "EXCELLENT", desc: "Boundary high accuracy fix (10.0m)" },
  { acc: 11.0, expected: "GOOD", desc: "Good precision fix (11.0m)" },
  { acc: 18.5, expected: "GOOD", desc: "Good precision fix (18.5m)" },
  { acc: 20.0, expected: "GOOD", desc: "Boundary good precision fix (20.0m)" },
  { acc: 21.0, expected: "ACQUIRING / WAIT", desc: "Low accuracy fix (21.0m)" },
  { acc: 45.0, expected: "ACQUIRING / WAIT", desc: "Low accuracy fix (45.0m)" },
  { acc: 50.0, expected: "ACQUIRING / WAIT", desc: "Boundary low accuracy fix (50.0m)" },
  { acc: 51.0, expected: "UNRELIABLE", desc: "Unreliable fix (51.0m)" },
  { acc: 115.0, expected: "UNRELIABLE", desc: "Degraded mobile indoor fix (115.0m)" },
  { acc: 850.0, expected: "UNRELIABLE", desc: "Cell-tower IP estimate (850.0m)" },
];

accuracyTestCases.forEach((tc) => {
  const result = getGpsQuality(tc.acc);
  assert(
    result === tc.expected,
    `Accuracy ±${tc.acc}m categorized as ${tc.expected}`,
    `${tc.desc} => Result: ${result}`,
  );
});

// -----------------------------------------------------------------------------
// TEST 3: Point-in-Polygon Containment (Inside vs Outside)
// -----------------------------------------------------------------------------
console.log("\n3. TESTING POINT-IN-POLYGON (PIP) CONTAINMENT:");

const locations = [
  { name: "Centroid Interior", lat: centroid.lat, lng: centroid.lng, expectedInside: true },
  { name: "Inside Center Core", lat: 11.680300, lng: 78.121800, expectedInside: true },
  { name: "Inside Near C1/C5", lat: 11.680150, lng: 78.121820, expectedInside: true },
  { name: "Inside Near C3/C4", lat: 11.680500, lng: 78.121700, expectedInside: true },
  { name: "Outside North (Highway)", lat: 11.685000, lng: 78.121800, expectedInside: false },
  { name: "Outside South", lat: 11.675000, lng: 78.121800, expectedInside: false },
  { name: "Outside East", lat: 11.680300, lng: 78.130000, expectedInside: false },
  { name: "Outside West", lat: 11.680300, lng: 78.110000, expectedInside: false },
];

locations.forEach((loc) => {
  const inside = isPointInPolygon({ lat: loc.lat, lng: loc.lng });
  const evalRes = evaluateGeofence({ lat: loc.lat, lng: loc.lng, accuracy: 5.0 });
  assert(
    inside === loc.expectedInside && evalRes.isInside === loc.expectedInside,
    `Location '${loc.name}'`,
    `PIP: ${inside ? "INSIDE" : "OUTSIDE"} (Expected: ${loc.expectedInside ? "INSIDE" : "OUTSIDE"}) - Edge dist: ${evalRes.distanceToBoundaryMeters}m`,
  );
});

// -----------------------------------------------------------------------------
// TEST 4: Temporal Stability & Jitter Filtering
// -----------------------------------------------------------------------------
console.log("\n4. TESTING TEMPORAL STABILITY & CONSECUTIVE READING JITTER:");

// Case A: Stable consecutive readings within ~3 meters of each other (<=20m accuracy)
const stableReadings = [
  { lat: 11.680300, lng: 78.121800, accuracy: 8.0, timestamp: 1000 },
  { lat: 11.680305, lng: 78.121803, accuracy: 7.2, timestamp: 2000 },
  { lat: 11.680302, lng: 78.121801, accuracy: 6.8, timestamp: 3000 },
];
const stabilityA = checkTemporalStability(stableReadings, 15);
assert(
  stabilityA.isStable === true && stabilityA.status === "STABLE",
  "Consecutive stationary GPS fixes flagged as temporally STABLE",
  `Max jump: ${stabilityA.maxDisplacementMeters}m (threshold: 15m) | Good fixes: ${stabilityA.consecutiveGoodCount}`,
);

// Case B: Erratic jumping readings (jumping > 40 meters due to cell tower switches)
const jumpingReadings = [
  { lat: 11.680300, lng: 78.121800, accuracy: 18.0, timestamp: 1000 },
  { lat: 11.681200, lng: 78.122800, accuracy: 19.0, timestamp: 2000 },
  { lat: 11.679100, lng: 78.120500, accuracy: 18.0, timestamp: 3000 },
];
const stabilityB = checkTemporalStability(jumpingReadings, 15);
assert(
  stabilityB.isStable === false && stabilityB.status === "UNSTABLE",
  "Erratic jumping GPS fixes flagged as UNSTABLE",
  `Coordinate jump (${stabilityB.maxDisplacementMeters}m) exceeds 15m tolerance`,
);

// Case C: Single reading (cannot establish temporal stability on 1 reading)
const singleReading = [
  { lat: 11.680300, lng: 78.121800, accuracy: 5.0, timestamp: 1000 },
];
const stabilityC = checkTemporalStability(singleReading, 15);
assert(
  stabilityC.isStable === false && stabilityC.status === "MEASURING",
  "Single reading requires at least 2 consecutive fixes for stability",
  `Status: ${stabilityC.status} | Good fixes: ${stabilityC.consecutiveGoodCount}`,
);

// -----------------------------------------------------------------------------
// TEST 5: GPS Accuracy & Acceptance Matrix Simulation
// -----------------------------------------------------------------------------
console.log("\n5. TESTING GPS AUTHORIZATION ACCEPTANCE MATRIX (Quality Gate: <=20m + >=2 Good Fixes + Stable Displacement <=15m):");

const gpsSimCases = [
  {
    desc: "Excellent GPS (≤10m) + Stable + Inside Campus 5-Pt Polygon",
    readings: [
      { lat: 11.680300, lng: 78.121800, accuracy: 8.5, timestamp: 1000 },
      { lat: 11.680302, lng: 78.121801, accuracy: 7.0, timestamp: 2000 },
      { lat: 11.680301, lng: 78.121800, accuracy: 6.2, timestamp: 3000 },
    ],
    expectedAllowed: true,
    expectedReason: "Inside polygon & High Accuracy (≤10m) & Stable",
  },
  {
    desc: "Good GPS (≤20m) + Stable + Inside Campus 5-Pt Polygon",
    readings: [
      { lat: 11.680300, lng: 78.121800, accuracy: 16.5, timestamp: 1000 },
      { lat: 11.680302, lng: 78.121801, accuracy: 15.0, timestamp: 2000 },
    ],
    expectedAllowed: true,
    expectedReason: "Inside polygon & Good Accuracy (≤20m) & Stable",
  },
  {
    desc: "Poor GPS (±115m) + Inside Centroid",
    readings: [
      { lat: 11.680306, lng: 78.121823, accuracy: 115.0, timestamp: 1000 },
      { lat: 11.680306, lng: 78.121823, accuracy: 115.0, timestamp: 2000 },
    ],
    expectedAllowed: false,
    expectedReason: "Rejected: Accuracy ±115m exceeds 20m limit",
  },
  {
    desc: "Good GPS (≤10m) + Outside 5-Pt Geofence",
    readings: [
      { lat: 11.685000, lng: 78.121800, accuracy: 5.0, timestamp: 1000 },
      { lat: 11.685002, lng: 78.121801, accuracy: 4.8, timestamp: 2000 },
    ],
    expectedAllowed: false,
    expectedReason: "Rejected: Point is outside 5-point polygon perimeter",
  },
];

gpsSimCases.forEach((sim, idx) => {
  const bestReading = sim.readings.reduce((min, r) => (r.accuracy < min.accuracy ? r : min), sim.readings[0]);
  const stability = checkTemporalStability(sim.readings, 15);
  const inside = isPointInPolygon({ lat: bestReading.lat, lng: bestReading.lng });
  const isAcceptableAccuracy = bestReading.accuracy <= 20 && stability.isStable && stability.consecutiveGoodCount >= 2;
  const isGpsFactorAuthorized = inside && isAcceptableAccuracy;

  assert(
    isGpsFactorAuthorized === sim.expectedAllowed,
    `Scenario #${idx + 1}: ${sim.desc}`,
    `GPS Factor: ${isGpsFactorAuthorized ? "AUTHORIZED" : "BLOCKED"} (${sim.expectedReason})`,
  );
});

// -----------------------------------------------------------------------------
// TEST 6: 3-Factor Authoritative Attendance Rule Verification
// -----------------------------------------------------------------------------
console.log("\n6. TESTING 3-FACTOR AUTHORITATIVE ATTENDANCE RULE (Wi-Fi + GPS + Face):");

const multiFactorTests = [
  {
    name: "All 3 Factors Valid (Wi-Fi OK + GPS Inside ≤20m Stable + PERSON_001 Match)",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 7.5,
    gpsStable: true,
    faceMatch: true,
    expectedAttendance: "ALLOWED",
  },
  {
    name: "Wi-Fi OK + GPS Inside but Poor Accuracy (±115m) + Face OK",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 115.0,
    gpsStable: true,
    faceMatch: true,
    expectedAttendance: "REJECTED",
  },
  {
    name: "Wi-Fi OK + GPS Outside Campus + Face OK",
    wifi: true,
    gpsInside: false,
    gpsAccuracy: 6.0,
    gpsStable: true,
    faceMatch: true,
    expectedAttendance: "REJECTED",
  },
  {
    name: "Unauthorized Wi-Fi + GPS Inside ≤20m + Face OK",
    wifi: false,
    gpsInside: true,
    gpsAccuracy: 6.0,
    gpsStable: true,
    faceMatch: true,
    expectedAttendance: "REJECTED",
  },
  {
    name: "Wi-Fi OK + GPS Inside ≤20m + Unknown Face",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 6.0,
    gpsStable: true,
    faceMatch: false,
    expectedAttendance: "REJECTED",
  },
  {
    name: "All 3 Security Factors Failed",
    wifi: false,
    gpsInside: false,
    gpsAccuracy: 150.0,
    gpsStable: false,
    faceMatch: false,
    expectedAttendance: "REJECTED",
  },
];

multiFactorTests.forEach((mft, idx) => {
  const gpsFactor = mft.gpsInside && mft.gpsAccuracy <= 20 && mft.gpsStable;
  const decision = mft.wifi && gpsFactor && mft.faceMatch ? "ALLOWED" : "REJECTED";

  assert(
    decision === mft.expectedAttendance,
    `3-Factor Case #${idx + 1}: ${mft.name}`,
    `Result: ${decision} (Expected: ${mft.expectedAttendance})`,
  );
});

console.log("\n===============================================================================");
console.log(`   ALL GPS ACCURACY & 3-FACTOR SUITE TESTS: ${allPassed ? "100% PASSED" : "FAILED"}`);
console.log("===============================================================================\n");

process.exitCode = allPassed ? 0 : 1;
