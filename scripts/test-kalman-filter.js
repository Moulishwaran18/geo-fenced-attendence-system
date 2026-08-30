import {
  GpsKalmanFilter,
  latLngToLocalMeters,
  localMetersToLatLng,
  DEFAULT_GEOFENCE_ORIGIN,
} from "../src/lib/geofence/kalman-filter.ts";
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
console.log("   CAMPUSATTEND 2D KALMAN FILTER DETERMINISTIC VERIFICATION SUITE              ");
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
// TEST 1: Local Tangent Plane Coordinate Conversion Round-Trip Precision
// -----------------------------------------------------------------------------
console.log("1. TESTING LOCAL TANGENT-PLANE COORDINATE CONVERSION PRECISION:");

const testPoints = [
  DEFAULT_GEOFENCE_ORIGIN,
  { lat: 11.680071, lng: 78.121811 }, // C1
  { lat: 11.680239, lng: 78.121575 }, // C2
  { lat: 11.680607, lng: 78.121628 }, // C3
  { lat: 11.680439, lng: 78.122047 }, // C4
  { lat: 11.680176, lng: 78.122057 }, // C5
  { lat: 11.685000, lng: 78.121800 }, // North Highway
];

testPoints.forEach((pt, i) => {
  const local = latLngToLocalMeters(pt, DEFAULT_GEOFENCE_ORIGIN);
  const recon = localMetersToLatLng(local, DEFAULT_GEOFENCE_ORIGIN);
  const errMeters = haversineDistanceMeters(pt, recon);

  assert(
    errMeters < 0.001, // Error < 1 millimeter
    `Point #${i + 1} (${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}) round-trip conversion`,
    `Local: (${local.x.toFixed(2)}m E, ${local.y.toFixed(2)}m N) | Roundtrip Err: ${(errMeters * 1000).toFixed(4)} mm`,
  );
});

// -----------------------------------------------------------------------------
// TEST 2: Stable GPS Measurements (Stationary Sensor)
// -----------------------------------------------------------------------------
console.log("\n2. TESTING STABLE GPS MEASUREMENTS (STATIONARY SENSOR):");

const filter2 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
const centroid = DEFAULT_GEOFENCE_ORIGIN;

const stationarySamples = [
  { lat: centroid.lat, lng: centroid.lng, accuracy: 6.0, timestamp: 1000 },
  { lat: centroid.lat, lng: centroid.lng, accuracy: 6.0, timestamp: 2000 },
  { lat: centroid.lat, lng: centroid.lng, accuracy: 6.0, timestamp: 3000 },
  { lat: centroid.lat, lng: centroid.lng, accuracy: 6.0, timestamp: 4000 },
];

let lastOutput = null;
stationarySamples.forEach((s) => {
  lastOutput = filter2.update(s);
});

const distFromTrue = haversineDistanceMeters(
  { lat: lastOutput.filteredLat, lng: lastOutput.filteredLng },
  centroid,
);

assert(
  distFromTrue < 0.01 && lastOutput.status === "SETTLED",
  "Stationary readings converge to true centroid position",
  `Filtered: (${lastOutput.filteredLat.toFixed(6)}, ${lastOutput.filteredLng.toFixed(6)}) | Offset: ${distFromTrue.toFixed(4)}m | Status: ${lastOutput.status}`,
);

// -----------------------------------------------------------------------------
// TEST 3: Small GPS Jitter Smoothing (Noise Reduction)
// -----------------------------------------------------------------------------
console.log("\n3. TESTING SMALL GPS JITTER SMOOTHING (NOISE REDUCTION):");

const filter3 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
// True position is centroid. Measurements oscillate with ±2m noise
const jitterSamples = [
  { lat: 11.680306, lng: 78.121824, accuracy: 8.0, timestamp: 1000 },
  { lat: 11.680324, lng: 78.121835, accuracy: 8.0, timestamp: 2000 }, // +2m North, +1m East
  { lat: 11.680288, lng: 78.121810, accuracy: 8.0, timestamp: 3000 }, // -2m South, -1m East
  { lat: 11.680315, lng: 78.121830, accuracy: 8.0, timestamp: 4000 },
  { lat: 11.680295, lng: 78.121818, accuracy: 8.0, timestamp: 5000 },
];

const rawOffsets = [];
const filteredOffsets = [];

jitterSamples.forEach((s) => {
  const out = filter3.update(s);
  const rawDist = haversineDistanceMeters({ lat: s.lat, lng: s.lng }, centroid);
  const filtDist = haversineDistanceMeters({ lat: out.filteredLat, lng: out.filteredLng }, centroid);
  rawOffsets.push(rawDist);
  filteredOffsets.push(filtDist);
});

const avgRawErr = rawOffsets.reduce((a, b) => a + b, 0) / rawOffsets.length;
const finalFiltErr = filteredOffsets[filteredOffsets.length - 1];

assert(
  finalFiltErr < avgRawErr,
  "Kalman filter dampens positional jitter variance",
  `Avg Raw Offset: ${avgRawErr.toFixed(2)}m -> Final Filtered Offset: ${finalFiltErr.toFixed(2)}m`,
);

// -----------------------------------------------------------------------------
// TEST 4: Large Noisy Measurement Dampening (Measurement Covariance R)
// -----------------------------------------------------------------------------
console.log("\n4. TESTING LARGE NOISY MEASUREMENT DAMPENING VIA COVARIANCE R:");

const filter4 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
// Initialize with high accuracy fix
filter4.update({ lat: centroid.lat, lng: centroid.lng, accuracy: 5.0, timestamp: 1000 });
filter4.update({ lat: centroid.lat, lng: centroid.lng, accuracy: 5.0, timestamp: 2000 });

// Sudden jump spike measurement with reported poor accuracy (100m)
const spikeSample = {
  lat: centroid.lat + 0.001, // ~111m away
  lng: centroid.lng + 0.001,
  accuracy: 100.0, // High measurement uncertainty
  timestamp: 3000,
};

const spikeOutput = filter4.update(spikeSample);
const rawSpikeDist = haversineDistanceMeters({ lat: spikeSample.lat, lng: spikeSample.lng }, centroid);
const filtSpikeDist = haversineDistanceMeters({ lat: spikeOutput.filteredLat, lng: spikeOutput.filteredLng }, centroid);

assert(
  filtSpikeDist < rawSpikeDist * 0.4, // Filter rejects over 60% of the spike due to high R
  "Large noisy spike measurement with poor accuracy is heavily dampened",
  `Raw Spike Dist: ${rawSpikeDist.toFixed(1)}m -> Filtered Pos Dist: ${filtSpikeDist.toFixed(1)}m (Dampening: ${(((rawSpikeDist - filtSpikeDist) / rawSpikeDist) * 100).toFixed(1)}%)`,
);

// -----------------------------------------------------------------------------
// TEST 5: Constant Velocity Trajectory Tracking (Moving Person)
// -----------------------------------------------------------------------------
console.log("\n5. TESTING CONSTANT VELOCITY TRAJECTORY TRACKING:");

const filter5 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
// Person walking East at 1.2 m/s (0.000011 deg/s approx)
const walkingSamples = [
  { lat: 11.680306, lng: 78.121800, accuracy: 5.0, timestamp: 1000 },
  { lat: 11.680306, lng: 78.121811, accuracy: 5.0, timestamp: 2000 }, // +1.2m East
  { lat: 11.680306, lng: 78.121822, accuracy: 5.0, timestamp: 3000 }, // +1.2m East
  { lat: 11.680306, lng: 78.121833, accuracy: 5.0, timestamp: 4000 }, // +1.2m East
  { lat: 11.680306, lng: 78.121844, accuracy: 5.0, timestamp: 5000 }, // +1.2m East
];

let walkOut = null;
walkingSamples.forEach((s) => {
  walkOut = filter5.update(s);
});

assert(
  walkOut.estimatedVelocityMps > 0.8 && walkOut.estimatedVelocityMps < 1.8,
  "Estimated velocity correctly reflects walking speed (~1.2 m/s)",
  `Estimated Speed: ${walkOut.estimatedVelocityMps} m/s`,
);

// -----------------------------------------------------------------------------
// TEST 6: Outside Geofence Points Remain Outside
// -----------------------------------------------------------------------------
console.log("\n6. TESTING OUTSIDE GEOFENCE POINTS (NO ARTIFICIAL MIGRATION INSIDE):");

const filter6 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
const outsideHighway = { lat: 11.685000, lng: 78.121800 }; // North Highway (~520m outside)

const outsideSamples = [
  { lat: outsideHighway.lat, lng: outsideHighway.lng, accuracy: 8.0, timestamp: 1000 },
  { lat: outsideHighway.lat + 0.00002, lng: outsideHighway.lng, accuracy: 7.5, timestamp: 2000 },
  { lat: outsideHighway.lat - 0.00001, lng: outsideHighway.lng, accuracy: 7.8, timestamp: 3000 },
];

let outResult = null;
outsideSamples.forEach((s) => {
  outResult = filter6.update(s);
});

const evalOutside = evaluateGeofence({
  lat: outResult.filteredLat,
  lng: outResult.filteredLng,
  accuracy: outResult.rawAccuracy,
});

assert(
  evalOutside.isInside === false && evalOutside.distanceToBoundaryMeters > 450,
  "Outside measurements strictly remain OUTSIDE the 5-point polygon after filtering",
  `PIP: ${evalOutside.isInside ? "INSIDE" : "OUTSIDE"} | Dist to perimeter: ${evalOutside.distanceToBoundaryMeters}m`,
);

// -----------------------------------------------------------------------------
// TEST 7: Inside Geofence Points Settle Cleanly Inside
// -----------------------------------------------------------------------------
console.log("\n7. TESTING INSIDE GEOFENCE POINTS:");

const filter7 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
const insideSamples = [
  { lat: 11.680300, lng: 78.121800, accuracy: 6.0, timestamp: 1000 },
  { lat: 11.680305, lng: 78.121805, accuracy: 6.2, timestamp: 2000 },
  { lat: 11.680302, lng: 78.121802, accuracy: 5.8, timestamp: 3000 },
];

let inResult = null;
insideSamples.forEach((s) => {
  inResult = filter7.update(s);
});

const evalInside = evaluateGeofence({
  lat: inResult.filteredLat,
  lng: inResult.filteredLng,
  accuracy: inResult.rawAccuracy,
});

assert(
  evalInside.isInside === true && evalInside.distanceToBoundaryMeters > 15,
  "Inside measurements strictly settle INSIDE the 5-point polygon",
  `PIP: ${evalInside.isInside ? "INSIDE" : "OUTSIDE"} | Dist to perimeter: ${evalInside.distanceToBoundaryMeters}m`,
);

// -----------------------------------------------------------------------------
// TEST 8: Raw Accuracy > 50m Gated as UNRELIABLE and BLOCKED
// -----------------------------------------------------------------------------
console.log("\n8. TESTING RAW ACCURACY >50m POLICY GATING:");

const poorAccuracySamples = [
  { lat: centroid.lat, lng: centroid.lng, accuracy: 212.0, timestamp: 1000 },
  { lat: centroid.lat, lng: centroid.lng, accuracy: 185.0, timestamp: 2000 },
];

const qualityTier8 = getGpsQuality(212.0);
assert(
  qualityTier8 === "UNRELIABLE",
  "Raw accuracy of 212m categorized as UNRELIABLE",
  `Result: ${qualityTier8}`,
);

// Filtering a 212m reading must NEVER change raw accuracy
const filter8 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
const out8_1 = filter8.update(poorAccuracySamples[0]);
const out8_2 = filter8.update(poorAccuracySamples[1]);

assert(
  out8_2.rawAccuracy === 185.0,
  "Kalman filter strictly preserves raw reported accuracy value (never fabricated)",
  `Reported Raw Accuracy: ±${out8_2.rawAccuracy}m`,
);

// -----------------------------------------------------------------------------
// TEST 9: Raw Accuracy 10-20m Gated as GOOD
// -----------------------------------------------------------------------------
console.log("\n9. TESTING RAW ACCURACY 10-20m POLICY GATING:");

const goodAccuracyTier = getGpsQuality(15.5);
assert(
  goodAccuracyTier === "GOOD",
  "Raw accuracy of 15.5m categorized as GOOD",
  `Result: ${goodAccuracyTier}`,
);

// -----------------------------------------------------------------------------
// TEST 10: Consecutive Stable Readings Pass Quality & Stability Gate
// -----------------------------------------------------------------------------
console.log("\n10. TESTING CONSECUTIVE STABLE READINGS PASSING GATE:");

const filter10 = new GpsKalmanFilter(DEFAULT_GEOFENCE_ORIGIN);
const history10 = [];

const stableSeries = [
  { lat: 11.680300, lng: 78.121800, accuracy: 8.0, timestamp: 1000 },
  { lat: 11.680302, lng: 78.121801, accuracy: 7.5, timestamp: 2000 },
  { lat: 11.680301, lng: 78.121800, accuracy: 7.0, timestamp: 3000 },
];

stableSeries.forEach((s, idx) => {
  const kOut = filter10.update(s);
  history10.push({
    lat: s.lat,
    lng: s.lng,
    accuracy: s.accuracy,
    filteredLat: kOut.filteredLat,
    filteredLng: kOut.filteredLng,
    filteredEastMeters: kOut.filteredEastMeters,
    filteredNorthMeters: kOut.filteredNorthMeters,
    quality: getGpsQuality(s.accuracy),
    sampleIndex: idx + 1,
    kalmanStatus: kOut.status,
  });
});

const stability10 = checkTemporalStability(history10, 15);
assert(
  stability10.isStable === true && stability10.status === "STABLE" && stability10.consecutiveGoodCount === 3,
  "Consecutive stable readings achieve STABLE position stability status",
  `Status: ${stability10.status} | Consecutive Good Fixes: ${stability10.consecutiveGoodCount} | Max Disp: ${stability10.maxDisplacementMeters}m`,
);

console.log("\n===============================================================================");
console.log(`   ALL 2D KALMAN FILTER TESTS: ${allPassed ? "100% PASSED" : "FAILED"}`);
console.log("===============================================================================\n");

process.exitCode = allPassed ? 0 : 1;
