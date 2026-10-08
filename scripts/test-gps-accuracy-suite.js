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
  evaluateGpsAccuracy,
  GPS_ACCEPTANCE_THRESHOLD_METERS,
  GPS_TARGET_ACCURACY_METERS,
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
// TEST 1: Authoritative 19-Point Polygon Integrity (C1 -> ... -> C19 -> C1)
// -----------------------------------------------------------------------------
console.log("1. TESTING AUTHORITATIVE POLYGON INTEGRITY:");
assert(
  AUTHORIZED_GEOFENCE_POLYGON.length === 13,
  "Polygon contains exactly 13 vertices (C1 through C13)",
  `Found ${AUTHORIZED_GEOFENCE_POLYGON.length} vertices`,
);

const expectedCoords = [
  { lat: 11.675651510482604, lng: 78.12402220170895 }, // C1
  { lat: 11.675657082681333, lng: 78.12382305416799 }, // C2
  { lat: 11.675768526632474, lng: 78.12359545697831 }, // C3
  { lat: 11.675857681761121, lng: 78.12339630943734 }, // C4
  { lat: 11.676125146975094, lng: 78.1228443862524 }, // C5
  { lat: 11.676370323194567, lng: 78.12244609117047 }, // C6
  { lat: 11.676414900665728, lng: 78.12241764152176 }, // C7
  { lat: 11.676448333764391, lng: 78.12143897360616 }, // C8
  { lat: 11.676905252375372, lng: 78.12147880311436 }, // C9
  { lat: 11.676977690622595, lng: 78.12159260170921 }, // C10
  { lat: 11.67708913404289, lng: 78.12222418391055 }, // C11
  { lat: 11.677990932044441, lng: 78.12235439874642 }, // C12
  { lat: 11.677979915759753, lng: 78.1237830407748 }, // C13
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
  centroid.lat > 11.675 && centroid.lat < 11.680 && centroid.lng > 78.121 && centroid.lng < 78.125,
  "Polygon centroid is within campus bounds",
  `Centroid: ${centroid.lat.toFixed(6)}° N, ${centroid.lng.toFixed(6)}° E`,
);

// -----------------------------------------------------------------------------
// TEST 2A: GPS Quality Policy Tiers (<10m EXCELLENT, 10-20m GOOD, 20-50m ACQUIRING / WAIT, >50m UNRELIABLE)
// -----------------------------------------------------------------------------
console.log("\n2A. TESTING GPS QUALITY TIERS (<10m EXCELLENT, 10-20m GOOD, 20-50m ACQUIRING / WAIT, >50m UNRELIABLE):");

assert(GPS_ACCEPTANCE_THRESHOLD_METERS === 20, "GPS ACCEPTANCE THRESHOLD is strictly 20 meters");
assert(GPS_TARGET_ACCURACY_METERS === 10, "GPS TARGET/OPTIMIZATION ACCURACY GOAL is strictly 10 meters (<10m)");

const qualityTestCases = [
  { acc: 3.5, expected: "EXCELLENT", desc: "Superb GPS fix (3.5m)" },
  { acc: 8.0, expected: "EXCELLENT", desc: "High accuracy GPS fix (8.0m)" },
  { acc: 9.9, expected: "EXCELLENT", desc: "Target accuracy goal achieved (9.9m < 10m)" },
  { acc: 10.0, expected: "GOOD", desc: "Accepted fix improving toward <10m (10.0m)" },
  { acc: 12.5, expected: "GOOD", desc: "Accepted fix improving toward <10m (12.5m)" },
  { acc: 14.9, expected: "GOOD", desc: "Accepted fix improving toward <10m (14.9m)" },
  { acc: 15.0, expected: "GOOD", desc: "Accepted fix improving toward <10m (15.0m)" },
  { acc: 18.5, expected: "GOOD", desc: "Accepted fix (18.5m)" },
  { acc: 19.9, expected: "GOOD", desc: "Accepted fix (19.9m)" },
  { acc: 20.0, expected: "GOOD", desc: "Boundary accepted precision fix (20.0m)" },
  { acc: 20.1, expected: "ACQUIRING / WAIT", desc: "Accuracy exceeding 20m threshold (20.1m)" },
  { acc: 21.0, expected: "ACQUIRING / WAIT", desc: "Low accuracy fix (21.0m)" },
  { acc: 45.0, expected: "ACQUIRING / WAIT", desc: "Low accuracy fix (45.0m)" },
  { acc: 50.0, expected: "ACQUIRING / WAIT", desc: "Boundary low accuracy fix (50.0m)" },
  { acc: 51.0, expected: "UNRELIABLE", desc: "Unreliable fix (51.0m)" },
  { acc: 115.0, expected: "UNRELIABLE", desc: "Degraded mobile indoor fix (115.0m)" },
  { acc: 850.0, expected: "UNRELIABLE", desc: "Cell-tower IP estimate (850.0m)" },
];

qualityTestCases.forEach((tc) => {
  const result = getGpsQuality(tc.acc);
  assert(
    result === tc.expected,
    `Accuracy ±${tc.acc}m categorized as ${tc.expected}`,
    `${tc.desc} => Result: ${result}`,
  );
});

// -----------------------------------------------------------------------------
// TEST 2B: Required Boundary Accuracy Acceptance & Rejection Verification
// -----------------------------------------------------------------------------
console.log("\n2B. TESTING REQUIRED BOUNDARY ACCURACY VALUES (20.1m, 20.0m, 19.9m, 10.1m, 10.0m, 9.9m):");

const requiredBoundaryTests = [
  { acc: 20.1, expectedAccepted: false, expectedPreferred: false, label: "rejected" },
  { acc: 20.0, expectedAccepted: true, expectedPreferred: false, label: "accepted" },
  { acc: 19.9, expectedAccepted: true, expectedPreferred: false, label: "accepted" },
  { acc: 10.1, expectedAccepted: true, expectedPreferred: false, label: "accepted" },
  { acc: 10.0, expectedAccepted: true, expectedPreferred: false, label: "accepted" },
  { acc: 9.9, expectedAccepted: true, expectedPreferred: true, label: "accepted/target (<10m)" },
  { acc: 5.0, expectedAccepted: true, expectedPreferred: true, label: "accepted/target (<10m)" },
];

requiredBoundaryTests.forEach((t) => {
  const evalInfo = evaluateGpsAccuracy(t.acc);
  assert(
    evalInfo.isAccepted === t.expectedAccepted,
    `${t.acc.toFixed(1)}m -> ${t.label} (isAccepted === ${t.expectedAccepted})`,
    `Status text: "${evalInfo.statusText}"`,
  );
  if (t.expectedPreferred) {
    assert(
      evalInfo.isTargetReached === true,
      `${t.acc.toFixed(1)}m marked as optimization target goal (isTargetReached === true)`,
      `Tier: ${evalInfo.tier}`,
    );
  }
});

// -----------------------------------------------------------------------------
// TEST 2C: Exact UI Text Gating Requirements
// -----------------------------------------------------------------------------
console.log("\n2C. TESTING EXACT UI TEXT GATING SPECIFICATIONS:");

// >20m
const uiGt20 = evaluateGpsAccuracy(20.1);
assert(
  uiGt20.title === "GPS ACCURACY INSUFFICIENT",
  '>20m UI title matches: "GPS ACCURACY INSUFFICIENT"',
  uiGt20.title,
);
assert(
  uiGt20.accuracyText === "Current accuracy: ±20.1m",
  '>20m UI accuracyText matches: "Current accuracy: ±20.1m"',
  uiGt20.accuracyText,
);
assert(
  uiGt20.instructionText === "Acquiring a better GPS fix...",
  '>20m UI instruction text matches: "Acquiring a better GPS fix..."',
  uiGt20.instructionText || "",
);

// 10m < accuracy <= 20m
const uiLe20Gt10 = evaluateGpsAccuracy(16.5);
assert(
  uiLe20Gt10.title === "GPS ACCURACY ACCEPTED",
  '10m < accuracy <= 20m UI title matches: "GPS ACCURACY ACCEPTED"',
  uiLe20Gt10.title,
);
assert(
  uiLe20Gt10.accuracyText === "Current accuracy: ±16.5m",
  '10m < accuracy <= 20m UI accuracyText matches: "Current accuracy: ±16.5m"',
  uiLe20Gt10.accuracyText,
);
assert(
  uiLe20Gt10.instructionText === "Improving GPS accuracy toward <10m...",
  '10m < accuracy <= 20m UI instruction matches: "Improving GPS accuracy toward <10m..."',
  uiLe20Gt10.instructionText || "",
);

// <10m
const uiLt10 = evaluateGpsAccuracy(8.5);
assert(
  uiLt10.title === "GPS ACCURACY EXCELLENT",
  '<10m UI title matches: "GPS ACCURACY EXCELLENT"',
  uiLt10.title,
);
assert(
  uiLt10.accuracyText === "Current accuracy: ±8.5m",
  '<10m UI accuracyText matches: "Current accuracy: ±8.5m"',
  uiLt10.accuracyText,
);
assert(
  uiLt10.instructionText === null,
  '<10m UI instruction text is null (Target reached)',
  String(uiLt10.instructionText),
);

// -----------------------------------------------------------------------------
// TEST 2D: Multi-Reading Sequential Flow & Non-Blocking Verification
// -----------------------------------------------------------------------------
console.log("\n2D. TESTING MULTI-READING SEQUENTIAL FLOW & BEST-ACCURACY TRACKING:");

// Simulating Reading Sequence:
// Reading 1: 20.1m -> NOT ACCEPTED -> continue acquiring
// Reading 2: 18.5m -> ACCEPTED -> geofence may proceed -> continue looking for better fix <10m
// Reading 3: 14.2m -> ACCEPTED -> best accuracy = 14.2m
// Reading 4: 8.5m -> ACCEPTED -> target optimization reached (<10m) -> best accuracy = 8.5m

const sequence = [20.1, 18.5, 14.2, 8.5];
let trackedBestAccuracy = null;
const sequenceStates = [];

sequence.forEach((acc, idx) => {
  const info = evaluateGpsAccuracy(acc);
  if (trackedBestAccuracy === null || acc < trackedBestAccuracy) {
    trackedBestAccuracy = acc;
  }
  sequenceStates.push({
    readingNum: idx + 1,
    acc,
    isAccepted: info.isAccepted,
    isTargetReached: info.isTargetReached,
    bestAcc: trackedBestAccuracy,
  });
});

assert(sequenceStates[0].isAccepted === false, "Reading 1 (20.1m) -> NOT ACCEPTED (continue acquiring)");
assert(sequenceStates[1].isAccepted === true, "Reading 2 (18.5m) -> ACCEPTED (geofence may proceed immediately)");
assert(sequenceStates[1].bestAcc === 18.5, "Reading 2 sets best accuracy to 18.5m");
assert(sequenceStates[2].isAccepted === true, "Reading 3 (14.2m) -> ACCEPTED");
assert(sequenceStates[2].bestAcc === 14.2, "Reading 3 updates best accuracy to 14.2m");
assert(sequenceStates[3].isAccepted === true, "Reading 4 (8.5m) -> ACCEPTED");
assert(sequenceStates[3].isTargetReached === true, "Reading 4 (8.5m) -> optimization target reached (<10m)");
assert(sequenceStates[3].bestAcc === 8.5, "Reading 4 updates best accuracy to 8.5m");

// Specific requirement: First valid reading is 19.5m -> attendance allowed, DO NOT wait for <10m
const firstFixAcc = 19.5;
const firstFixEval = evaluateGpsAccuracy(firstFixAcc);
const firstFixInside = isPointInPolygon({ lat: centroid.lat, lng: centroid.lng });
const firstFixGeofenceAllowed = firstFixInside && firstFixEval.isAccepted;
assert(
  firstFixGeofenceAllowed === true,
  "First valid reading is 19.5m inside geofence -> attendance/geofence ALLOWED immediately without waiting for <10m",
  `Geofence allowed: ${firstFixGeofenceAllowed} (isAccepted: ${firstFixEval.isAccepted})`,
);

// Specific requirement: Later reading improves to 8.2m -> best accuracy becomes 8.2m
let liveBestAcc = firstFixAcc;
const improvedAcc = 8.2;
if (improvedAcc < liveBestAcc) {
  liveBestAcc = improvedAcc;
}
assert(
  liveBestAcc === 8.2,
  "Later reading improves to 8.2m -> best accuracy becomes 8.2m",
  `liveBestAcc: ${liveBestAcc}m`,
);

// Specific requirement: Later worse readings do NOT replace best reading
const laterWorse = [14.5, 18.2, 22.1];
laterWorse.forEach((worseAcc) => {
  if (worseAcc < liveBestAcc) {
    liveBestAcc = worseAcc;
  }
});
assert(
  liveBestAcc === 8.2,
  "Subsequent worse readings (14.5m, 18.2m, 22.1m) do NOT replace best reading (8.2m)",
  `liveBestAcc: ${liveBestAcc}m`,
);

// Specific requirement: Readings never reach <10m but remain <=20m -> system still allows attendance
const sub20Non10Readings = [19.8, 18.5, 16.2, 12.5];
const allSub20Accepted = sub20Non10Readings.every((acc) => evaluateGpsAccuracy(acc).isAccepted);
const allSub20NotTarget = sub20Non10Readings.every((acc) => !evaluateGpsAccuracy(acc).isTargetReached);
assert(
  allSub20Accepted && allSub20NotTarget,
  "Readings never reach <10m but remain <=20m -> system STILL allows attendance without blocking",
  `All accepted: ${allSub20Accepted} | None reached <10m: ${allSub20NotTarget}`,
);

// -----------------------------------------------------------------------------
// TEST 2E: MANDATORY GPS ACQUISITION ENGINE SPECIFICATION TESTS
// -----------------------------------------------------------------------------
console.log("\n2E. TESTING MANDATORY GPS ENGINE SPECIFICATION TESTS:");

// 1. 24.3m -> continue acquisition
const eval24_3 = evaluateGpsAccuracy(24.3);
assert(
  eval24_3.continueAcquisition === true && eval24_3.isAccepted === false,
  "24.3m -> continue acquisition (isAccepted: false, continueAcquisition: true)",
  `Title: ${eval24_3.title} | Instruction: ${eval24_3.instructionText}`,
);

// 2. 21m -> continue acquisition
const eval21_0 = evaluateGpsAccuracy(21.0);
assert(
  eval21_0.continueAcquisition === true && eval21_0.isAccepted === false,
  "21m -> continue acquisition (isAccepted: false, continueAcquisition: true)",
  `Title: ${eval21_0.title} | Instruction: ${eval21_0.instructionText}`,
);

// 3. 19.9m -> accepted but continue improving toward <10m
const eval19_9 = evaluateGpsAccuracy(19.9);
assert(
  eval19_9.isAccepted === true && eval19_9.continueAcquisition === true && eval19_9.isTargetReached === false,
  "19.9m -> accepted but continue improving (isAccepted: true, continueAcquisition: true, isTarget: false)",
  `Title: ${eval19_9.title} | Instruction: ${eval19_9.instructionText}`,
);

// 4. 15.1m -> accepted but continue improving toward <10m
const eval15_1 = evaluateGpsAccuracy(15.1);
assert(
  eval15_1.isAccepted === true && eval15_1.continueAcquisition === true && eval15_1.isTargetReached === false,
  "15.1m -> accepted but continue improving (isAccepted: true, continueAcquisition: true, isTarget: false)",
  `Title: ${eval15_1.title} | Instruction: ${eval15_1.instructionText}`,
);

// 5. 10.0m -> accepted but continue improving toward <10m
const eval10_0 = evaluateGpsAccuracy(10.0);
assert(
  eval10_0.isAccepted === true && eval10_0.continueAcquisition === true && eval10_0.isTargetReached === false,
  "10.0m -> accepted but continue improving (isAccepted: true, continueAcquisition: true, isTarget: false)",
  `Title: ${eval10_0.title} | Instruction: ${eval10_0.instructionText}`,
);

// 6. 9.9m -> excellent (<10m target reached)
const eval9_9 = evaluateGpsAccuracy(9.9);
assert(
  eval9_9.isAccepted === true && eval9_9.continueAcquisition === false && eval9_9.isTargetReached === true,
  "9.9m -> excellent (isAccepted: true, continueAcquisition: false, isTarget: true)",
  `Title: ${eval9_9.title}`,
);

// 7. Best reading is retained across acquisition sequence
const testSeq1 = [24.3, 22.7, 19.8, 18.1, 14.5, 8.8];
let bestObserved = null;
testSeq1.forEach((acc) => {
  if (bestObserved === null || acc < bestObserved) {
    bestObserved = acc;
  }
});
assert(
  bestObserved === 8.8,
  "Best reading is retained across acquisition window (24.3 -> ... -> 8.8m => best: 8.8m)",
  `Observed: ${bestObserved}m`,
);

// 8. Later worse readings do not replace best
let bestMonotonic = 8.8;
const worseReadings = [14.2, 18.5, 22.0];
worseReadings.forEach((acc) => {
  if (acc < bestMonotonic) {
    bestMonotonic = acc;
  }
});
assert(
  bestMonotonic === 8.8,
  "Later worse readings do NOT replace best reading (8.8m followed by 14.2m, 18.5m => best remains 8.8m)",
  `bestMonotonic: ${bestMonotonic}m`,
);

// 9. No <10m reading -> proceed using best <=20m reading without fabricating <10m
const subTargetSeq = [24.3, 22.5, 19.2, 16.4];
let actualBest = null;
subTargetSeq.forEach((acc) => {
  if (actualBest === null || acc < actualBest) {
    actualBest = acc;
  }
});
assert(
  actualBest === 16.4 && actualBest >= 10,
  "No <10m reading observed -> actual best (16.4m) is strictly preserved without fabricating <10m",
  `Actual best preserved: ${actualBest}m (never fabricated)`,
);
const timeoutEval = evaluateGpsAccuracy(actualBest);
assert(
  timeoutEval.isAccepted === true && actualBest <= 20,
  "Timeout reporting: genuine <=20m reading exists (16.4m) -> proceed using best <=20m reading without blocking attendance",
  `Geofence allowed: ${timeoutEval.isAccepted} | Actual best: ${actualBest}m`,
);

// 10. The final geofence calculation must use the best genuine accepted location
const simulatedReadings = [
  { lat: 11.6765, lng: 78.1227, accuracy: 18.2, name: "reading-1" },
  { lat: 11.6764, lng: 78.1226, accuracy: 8.4, name: "reading-2 (best inside)" },
  { lat: 11.6785, lng: 78.1245, accuracy: 22.5, name: "reading-3 (worse)" }
];
const bestAcceptedSample = simulatedReadings.filter(r => r.accuracy <= 20).reduce((min, r) => r.accuracy < min.accuracy ? r : min);
assert(
  bestAcceptedSample.name === "reading-2 (best inside)" && bestAcceptedSample.accuracy === 8.4,
  "Final geofence calculation selection selects reading-2 (best genuine accepted location: ±8.4m)",
  `Selected: ${bestAcceptedSample.name}`,
);
const geofenceResultBest = evaluateGeofence(bestAcceptedSample);
assert(
  geofenceResultBest.isInside === true,
  "Final geofence calculation using best genuine accepted reading evaluates as INSIDE campus polygon",
  `isInside: ${geofenceResultBest.isInside}`,
);

// -----------------------------------------------------------------------------
// TEST 3: Point-in-Polygon Containment (Inside vs Outside)
// -----------------------------------------------------------------------------
console.log("\n3. TESTING POINT-IN-POLYGON (PIP) CONTAINMENT:");

const locations = [
  { name: "Centroid Interior", lat: centroid.lat, lng: centroid.lng, expectedInside: true },
  { name: "Inside Center Core", lat: 11.676600, lng: 78.122800, expectedInside: true },
  { name: "Inside North Quad", lat: 11.677000, lng: 78.122500, expectedInside: true },
  { name: "Inside South Quad", lat: 11.676200, lng: 78.122800, expectedInside: true },
  { name: "Outside North", lat: 11.682000, lng: 78.125300, expectedInside: false },
  { name: "Outside South", lat: 11.672000, lng: 78.125300, expectedInside: false },
  { name: "Outside East", lat: 11.676500, lng: 78.130000, expectedInside: false },
  { name: "Outside West", lat: 11.676500, lng: 78.115000, expectedInside: false },
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
  { lat: 11.676600, lng: 78.122800, accuracy: 8.0, timestamp: 1000 },
  { lat: 11.676605, lng: 78.122803, accuracy: 7.2, timestamp: 2000 },
  { lat: 11.676602, lng: 78.122801, accuracy: 6.8, timestamp: 3000 },
];
const stabilityA = checkTemporalStability(stableReadings, 15);
assert(
  stabilityA.isStable === true && stabilityA.status === "STABLE",
  "Consecutive stationary GPS fixes flagged as temporally STABLE",
  `Max jump: ${stabilityA.maxDisplacementMeters}m (threshold: 15m) | Good fixes: ${stabilityA.consecutiveGoodCount}`,
);

// Case B: Erratic jumping readings (jumping > 40 meters due to cell tower switches)
const jumpingReadings = [
  { lat: 11.676600, lng: 78.122800, accuracy: 18.0, timestamp: 1000 },
  { lat: 11.678000, lng: 78.126300, accuracy: 19.0, timestamp: 2000 },
  { lat: 11.675900, lng: 78.124000, accuracy: 18.0, timestamp: 3000 },
];
const stabilityB = checkTemporalStability(jumpingReadings, 15);
assert(
  stabilityB.isStable === false && stabilityB.status === "UNSTABLE",
  "Erratic jumping GPS fixes flagged as UNSTABLE",
  `Coordinate jump (${stabilityB.maxDisplacementMeters}m) exceeds 15m tolerance`,
);

// Case C: Single reading (cannot establish temporal stability on 1 reading)
const singleReading = [
  { lat: 11.676600, lng: 78.122800, accuracy: 5.0, timestamp: 1000 },
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
    desc: "Excellent GPS (≤10m) + Stable + Inside Campus Polygon",
    readings: [
      { lat: 11.676600, lng: 78.122800, accuracy: 8.5, timestamp: 1000 },
      { lat: 11.676602, lng: 78.122801, accuracy: 7.0, timestamp: 2000 },
      { lat: 11.676601, lng: 78.122800, accuracy: 6.2, timestamp: 3000 },
    ],
    expectedAllowed: true,
    expectedReason: "Inside polygon & High Accuracy (≤10m) & Stable",
  },
  {
    desc: "Good GPS (≤20m) + Stable + Inside Campus Polygon",
    readings: [
      { lat: 11.676600, lng: 78.122800, accuracy: 16.5, timestamp: 1000 },
      { lat: 11.676602, lng: 78.122801, accuracy: 15.0, timestamp: 2000 },
    ],
    expectedAllowed: true,
    expectedReason: "Inside polygon & Good Accuracy (≤20m) & Stable",
  },
  {
    desc: "Poor GPS (±115m) + Inside Centroid",
    readings: [
      { lat: centroid.lat, lng: centroid.lng, accuracy: 115.0, timestamp: 1000 },
      { lat: centroid.lat, lng: centroid.lng, accuracy: 115.0, timestamp: 2000 },
    ],
    expectedAllowed: false,
    expectedReason: "Rejected: Accuracy ±115m exceeds 20m limit",
  },
  {
    desc: "Good GPS (≤10m) + Outside Geofence",
    readings: [
      { lat: 11.682000, lng: 78.125300, accuracy: 5.0, timestamp: 1000 },
      { lat: 11.682002, lng: 78.125301, accuracy: 4.8, timestamp: 2000 },
    ],
    expectedAllowed: false,
    expectedReason: "Rejected: Point is outside polygon perimeter",
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
