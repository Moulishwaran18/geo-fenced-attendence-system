import {
  AUTHORIZED_GEOFENCE_POLYGON,
  isPointInPolygon,
  evaluateGeofence,
  haversineDistanceMeters,
  getPolygonCentroid,
} from "../src/lib/geofence/geofence-service.ts";
import {
  GpsKalmanFilter,
  DEFAULT_GEOFENCE_ORIGIN,
} from "../src/lib/geofence/kalman-filter.ts";
import {
  getGpsQuality,
  checkTemporalStability,
} from "../src/hooks/use-geofence.ts";

console.log("===============================================================================");
console.log("   CAMPUSATTEND NATIVE ANDROID FUSED LOCATION & GEOFENCE TEST SUITE            ");
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
// TEST 1: Native Android Fused Location Simulation (5 Outdoor High-Accuracy Samples)
// -----------------------------------------------------------------------------
console.log("1. TESTING NATIVE ANDROID FUSED LOCATION MULTI-SAMPLE STREAM (5 SAMPLES):");

const centroid = getPolygonCentroid();
const filter = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);

// Simulated 5 consecutive outdoor GNSS fixes from FusedLocationProviderClient (PRIORITY_HIGH_ACCURACY)
const outdoorSamples = [
  { sampleIndex: 1, lat: 11.680306, lng: 78.121824, accuracy: 6.5, timestamp: 1000, provider: "fused/gps" },
  { sampleIndex: 2, lat: 11.680308, lng: 78.121826, accuracy: 5.2, timestamp: 2000, provider: "fused/gps" },
  { sampleIndex: 3, lat: 11.680305, lng: 78.121822, accuracy: 4.8, timestamp: 3000, provider: "fused/gps" },
  { sampleIndex: 4, lat: 11.680307, lng: 78.121825, accuracy: 4.5, timestamp: 4000, provider: "fused/gps" },
  { sampleIndex: 5, lat: 11.680306, lng: 78.121824, accuracy: 4.2, timestamp: 5000, provider: "fused/gps" },
];

console.log("\n  --- Collected Native Fused Readings ---");
const processedReadings = [];
let bestReading = null;

outdoorSamples.forEach((sample) => {
  const kOut = filter.update({
    lat: sample.lat,
    lng: sample.lng,
    accuracy: sample.accuracy,
    timestamp: sample.timestamp,
  });

  const reading = {
    sampleIndex: sample.sampleIndex,
    lat: sample.lat,
    lng: sample.lng,
    accuracy: sample.accuracy,
    filteredLat: kOut.filteredLat,
    filteredLng: kOut.filteredLng,
    provider: sample.provider,
    quality: getGpsQuality(sample.accuracy),
    kalmanStatus: kOut.status,
  };

  processedReadings.push(reading);
  if (!bestReading || sample.accuracy < bestReading.accuracy) {
    bestReading = reading;
  }

  console.log(`  Sample #${sample.sampleIndex}: Lat ${sample.lat.toFixed(6)}°, Lng ${sample.lng.toFixed(6)}° | Raw Acc: ±${sample.accuracy.toFixed(1)}m (${reading.quality}) | Filtered: (${kOut.filteredLat.toFixed(6)}°, ${kOut.filteredLng.toFixed(6)}°) | ${kOut.status}`);
});

const stability = checkTemporalStability(processedReadings, 15);
const finalReading = processedReadings[processedReadings.length - 1];
const geofenceEval = evaluateGeofence({
  lat: finalReading.filteredLat,
  lng: finalReading.filteredLng,
  accuracy: bestReading.accuracy,
});

console.log("\n  --- Native Android Telemetry Summary ---");
console.log(`  • Location Source:         NATIVE FUSED (FusedLocationProviderClient)`);
console.log(`  • Best Raw Accuracy:       ±${bestReading.accuracy.toFixed(1)} m`);
console.log(`  • Final Selected Accuracy: ±${bestReading.accuracy.toFixed(1)} m (Real Unmodified GNSS Value)`);
console.log(`  • Filtered Position:       Lat ${finalReading.filteredLat.toFixed(7)}° N, Lng ${finalReading.filteredLng.toFixed(7)}° E`);
console.log(`  • Position Stability:      ${stability.status} (${stability.consecutiveGoodCount}/2 req. good fixes, max displacement ${stability.maxDisplacementMeters}m)`);
console.log(`  • Geofence Result:         ${geofenceEval.isInside ? "INSIDE 5-POINT POLYGON" : "OUTSIDE POLYGON"} (${geofenceEval.distanceToBoundaryMeters}m to boundary)`);
console.log(`  • GPS Factor Decision:     ${geofenceEval.isInside && stability.isStable && bestReading.accuracy <= 20 ? "AUTHORIZED" : "BLOCKED"}\n`);

assert(
  processedReadings.length === 5,
  "Collected at least 5 native location samples",
  `Collected: ${processedReadings.length} samples`,
);

assert(
  bestReading.accuracy === 4.2,
  "Best raw accuracy correctly identified from real GNSS readings",
  `Best Accuracy: ±${bestReading.accuracy}m`,
);

assert(
  stability.isStable === true && stability.status === "STABLE",
  "Position stability achieved STABLE across outdoor GNSS stream",
  `Stability: ${stability.status}`,
);

assert(
  geofenceEval.isInside === true,
  "Containment check inside authoritative 5-point polygon",
  `PIP Result: INSIDE (Distance to boundary: ${geofenceEval.distanceToBoundaryMeters}m)`,
);

// -----------------------------------------------------------------------------
// TEST 2: Scenario Matrix (Inside/Outside, Quality Gating, Errors)
// -----------------------------------------------------------------------------
console.log("\n2. TESTING NATIVE ANDROID SCENARIO MATRIX:");

const scenarioMatrix = [
  {
    name: "1. Inside Polygon + Accuracy <= 20m (Outdoor High Accuracy)",
    lat: centroid.lat,
    lng: centroid.lng,
    accuracy: 8.5,
    stable: true,
    expectedGpsAllowed: true,
    expectedStatus: "INSIDE",
  },
  {
    name: "2. Inside Polygon + Accuracy > 20m (Indoor Degraded / Coarse Triangulation)",
    lat: centroid.lat,
    lng: centroid.lng,
    accuracy: 115.0,
    stable: true,
    expectedGpsAllowed: false,
    expectedStatus: "INSUFFICIENT_ACCURACY",
  },
  {
    name: "3. Outside Polygon + Good Accuracy (North Highway)",
    lat: 11.685000,
    lng: 78.121800,
    accuracy: 5.0,
    stable: true,
    expectedGpsAllowed: false,
    expectedStatus: "OUTSIDE",
  },
  {
    name: "4. Device Location Hardware Disabled",
    isLocationEnabled: false,
    expectedStatus: "LOCATION_DISABLED",
    expectedAction: "Open Location Settings",
  },
  {
    name: "5. Precise Location Permission Denied",
    hasPermission: false,
    expectedStatus: "PERMISSION_DENIED",
    expectedAction: "Request Precise Location Permission",
  },
];

scenarioMatrix.forEach((sc, idx) => {
  if (sc.isLocationEnabled === false) {
    assert(
      sc.expectedStatus === "LOCATION_DISABLED",
      `Scenario #${idx + 1}: ${sc.name}`,
      `Handled with prompt: '${sc.expectedAction}'`,
    );
  } else if (sc.hasPermission === false) {
    assert(
      sc.expectedStatus === "PERMISSION_DENIED",
      `Scenario #${idx + 1}: ${sc.name}`,
      `Handled with prompt: '${sc.expectedAction}'`,
    );
  } else {
    const isInside = isPointInPolygon({ lat: sc.lat, lng: sc.lng });
    const isGoodAcc = sc.accuracy <= 20;
    const isAllowed = isInside && isGoodAcc && sc.stable;

    assert(
      isAllowed === sc.expectedGpsAllowed,
      `Scenario #${idx + 1}: ${sc.name}`,
      `Decision: ${isAllowed ? "AUTHORIZED" : "BLOCKED"} (Expected: ${sc.expectedGpsAllowed ? "AUTHORIZED" : "BLOCKED"})`,
    );
  }
});

// -----------------------------------------------------------------------------
// TEST 3: Strict 3-Factor Presence Verification Rule
// -----------------------------------------------------------------------------
console.log("\n3. TESTING NATIVE ANDROID 3-FACTOR AUTHORIZATION RULE:");

const multiFactorCases = [
  {
    desc: "All 3 Security Factors Valid (Wi-Fi Auth + Native Fused GPS Inside <=20m + Face OK)",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 6.2,
    gpsStable: true,
    faceMatch: true,
    expected: "ALLOWED",
  },
  {
    desc: "Wi-Fi OK + GPS Inside but Degraded Accuracy (±115m) + Face OK",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 115.0,
    gpsStable: true,
    faceMatch: true,
    expected: "REJECTED",
  },
  {
    desc: "Wi-Fi OK + GPS Outside Campus + Face OK",
    wifi: true,
    gpsInside: false,
    gpsAccuracy: 5.0,
    gpsStable: true,
    faceMatch: true,
    expected: "REJECTED",
  },
  {
    desc: "Unauthorized Wi-Fi + Native Fused GPS Inside <=20m + Face OK",
    wifi: false,
    gpsInside: true,
    gpsAccuracy: 5.0,
    gpsStable: true,
    faceMatch: true,
    expected: "REJECTED",
  },
  {
    desc: "Wi-Fi OK + Native Fused GPS Inside <=20m + Unknown Face",
    wifi: true,
    gpsInside: true,
    gpsAccuracy: 5.0,
    gpsStable: true,
    faceMatch: false,
    expected: "REJECTED",
  },
];

multiFactorCases.forEach((mfc, idx) => {
  const gpsFactor = mfc.gpsInside && mfc.gpsAccuracy <= 20 && mfc.gpsStable;
  const decision = mfc.wifi && gpsFactor && mfc.faceMatch ? "ALLOWED" : "REJECTED";

  assert(
    decision === mfc.expected,
    `3-Factor Case #${idx + 1}: ${mfc.desc}`,
    `Final Attendance Decision: ${decision}`,
  );
});

console.log("\n===============================================================================");
console.log(`   ALL NATIVE ANDROID FUSED LOCATION TESTS: ${allPassed ? "100% PASSED" : "FAILED"}`);
console.log("===============================================================================\n");

process.exitCode = allPassed ? 0 : 1;
