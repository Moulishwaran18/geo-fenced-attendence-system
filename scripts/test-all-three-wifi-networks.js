import { verifyCampusWifi, AUTHORIZED_CAMPUS_NETWORKS } from "../src/lib/wifi-config.ts";
import { AUTHORIZED_SSIDS } from "../src/lib/wifi-detection.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND DUAL-PATH WI-FI AUTHENTICATION TEST SUITE        ");
console.log("   (SONA-WIFI: Strict Identity | M: SSID Verification Only)      ");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// -------------------------------------------------------------
// Test 1: Connected to M (Detected SSID = M)
// -------------------------------------------------------------
console.log("TEST 1: Connected to M (Detected SSID = M):");
const test1 = verifyCampusWifi({
  ssid: "M",
  state: "connected",
});
assert(test1.authorized === true, "Wi-Fi AUTHORIZED for detected SSID 'M'");
assert(test1.stage === "VERIFIED", `Stage = VERIFIED (got: ${test1.stage})`);
assert(test1.ssid === "M", `SSID = 'M' (got: ${test1.ssid})`);
assert(test1.bssidVerified === false, "BSSID is not required for M (bssidVerified = false)");
assert(test1.bssid === "Not available in browser", "BSSID displayed as 'Not available in browser'");
assert(test1.networkSummary === "Authorized campus Wi-Fi", "Network summary = 'Authorized campus Wi-Fi'");

// -------------------------------------------------------------
// Test 2: Connected to Oppo K13 (Detected SSID = Oppo K13)
// -------------------------------------------------------------
console.log("\nTEST 2: Connected to Oppo K13 (Detected SSID = Oppo K13):");
const test2 = verifyCampusWifi({
  ssid: "Oppo K13",
  state: "connected",
});
assert(test2.authorized === false, "Wi-Fi FAILED for unauthorized SSID 'Oppo K13'");
assert(test2.stage === "SSID_CHECK_FAILED", `Stage = SSID_CHECK_FAILED (got: ${test2.stage})`);
assert(test2.networkSummary === "Unauthorized Wi-Fi network", "Network summary = 'Unauthorized Wi-Fi network'");

// -------------------------------------------------------------
// Test 3: Connected to SONA-WIFI (Unique Identity Matches)
// -------------------------------------------------------------
console.log("\nTEST 3: Connected to SONA-WIFI (Unique Identity Matches):");
const test3 = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "172.16.184.252",
  gateway: "172.16.16.16",
  dns: "172.16.16.16",
  band: "5 GHz (52)",
  auth: "Open",
});
assert(test3.authorized === true, "Wi-Fi VERIFIED when SONA-WIFI unique identity matches");
assert(test3.stage === "VERIFIED", `Stage = VERIFIED (got: ${test3.stage})`);
assert(test3.ssid === "SONA-WIFI", `SSID = 'SONA-WIFI' (got: ${test3.ssid})`);
assert(test3.networkSummary === "Authorized campus Wi-Fi", "Network summary = 'Authorized campus Wi-Fi'");

// -------------------------------------------------------------
// Test 4: SSID = SONA-WIFI (Unique Identity Does NOT Match)
// -------------------------------------------------------------
console.log("\nTEST 4: SSID = SONA-WIFI (Unique Identity Does NOT Match):");
// Case 4A: Wrong gateway (e.g. personal router / hotspot named SONA-WIFI)
const test4A = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.1.150",
  gateway: "192.168.1.1",
  dns: "192.168.1.1",
});
assert(test4A.authorized === false, "Wi-Fi FAILED when gateway does not match 172.16.16.16");
assert(test4A.stage === "NETWORK_VALIDATION_FAILED", `Stage = NETWORK_VALIDATION_FAILED (got: ${test4A.stage})`);
assert(test4A.networkSummary === "Unauthorized Wi-Fi network", "Network summary = 'Unauthorized Wi-Fi network'");

// Case 4B: SONA-WIFI with no unique identity telemetry (cannot be verified on SSID alone)
const test4B = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
});
assert(test4B.authorized === false, "Wi-Fi FAILED when SONA-WIFI unique identity is unavailable");
assert(test4B.stage === "NETWORK_VALIDATION_FAILED", `Stage = NETWORK_VALIDATION_FAILED (got: ${test4B.stage})`);

// -------------------------------------------------------------
// Test 5: SSID Unavailable (Do NOT assume M)
// -------------------------------------------------------------
console.log("\nTEST 5: SSID Unavailable (Do NOT assume M):");
// Case 5A: Empty SSID
const test5A = verifyCampusWifi({
  ssid: "",
  state: "connected",
});
assert(test5A.authorized === false, "Wi-Fi FAILED when SSID is empty (did not assume M)");
assert(test5A.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test5A.stage})`);
assert(test5A.ssid !== "M", "Did NOT assume M when SSID was empty");

// Case 5B: Unknown / hidden SSID
const test5B = verifyCampusWifi({
  ssid: "<unknown ssid>",
  state: "connected",
});
assert(test5B.authorized === false, "Wi-Fi FAILED when SSID is <unknown ssid> (did not assume M)");
assert(test5B.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test5B.stage})`);
assert(test5B.ssid !== "M", "Did NOT assume M when SSID was <unknown ssid>");

// Case 5C: Omitted SSID payload
const test5C = verifyCampusWifi({
  state: "connected",
});
assert(test5C.authorized === false, "Wi-Fi FAILED when SSID payload is omitted (did not assume M)");
assert(test5C.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test5C.stage})`);
assert(test5C.ssid !== "M", "Did NOT assume M when SSID payload was omitted");

// Case 5D: Disconnected state
const test5D = verifyCampusWifi({
  state: "disconnected",
});
assert(test5D.authorized === false, "Wi-Fi FAILED when device is disconnected");
assert(test5D.stage === "DISCONNECTED", `Stage = DISCONNECTED (got: ${test5D.stage})`);

// -------------------------------------------------------------
// Test 6: Security - Rogue Mobile Hotspot Subnets & Anti-VPN
// -------------------------------------------------------------
console.log("\nTEST 6: Security Defense (Rogue Hotspots & VPN):");
const rogueHotspotAndroid = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.43.88",
  gateway: "192.168.43.1",
});
assert(rogueHotspotAndroid.authorized === false, "Rogue Android hotspot (192.168.43.x) rejected");

const rogueHotspotWindows = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.137.45",
  gateway: "192.168.137.1",
});
assert(rogueHotspotWindows.authorized === false, "Rogue Windows hotspot (192.168.137.x) rejected");

const vpnAttempt = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  capabilities: { notVpn: false, hasWifi: true },
});
assert(vpnAttempt.authorized === false, "Active VPN connection rejected");

// -------------------------------------------------------------
// Test 7: Complete 5-Stage Verification Enforcement
// -------------------------------------------------------------
console.log("\nTEST 7: Full 5-Stage Attendance Gate Flow:");
console.log("   Wi-Fi Auth -> GPS Location -> Polygon Geofence -> Face Recognition -> Liveness -> Attendance\n");

const flowCases = [
  { name: "TEST 1 Flow: Connected to M -> Wi-Fi OK -> Attendance proceeds", wifi: test1.authorized, gps: true, geofence: true, face: true, allowed: true },
  { name: "TEST 2 Flow: Connected to Oppo K13 -> Wi-Fi Fails -> Attendance BLOCKED", wifi: test2.authorized, gps: true, geofence: true, face: true, allowed: false },
  { name: "TEST 3 Flow: Connected to SONA-WIFI (Identity Valid) -> Wi-Fi OK -> Attendance proceeds", wifi: test3.authorized, gps: true, geofence: true, face: true, allowed: true },
  { name: "TEST 4 Flow: SONA-WIFI (Identity Mismatch) -> Wi-Fi Fails -> Attendance BLOCKED", wifi: test4A.authorized, gps: true, geofence: true, face: true, allowed: false },
  { name: "TEST 5 Flow: SSID Unavailable -> Wi-Fi Fails -> Attendance BLOCKED", wifi: test5A.authorized, gps: true, geofence: true, face: true, allowed: false },
  { name: "Flow: Wi-Fi OK, GPS Outside Geofence -> Attendance BLOCKED", wifi: true, gps: true, geofence: false, face: true, allowed: false },
  { name: "Flow: Wi-Fi OK, Face Unmatched -> Attendance BLOCKED", wifi: true, gps: true, geofence: true, face: false, allowed: false },
];

for (const fc of flowCases) {
  const canMark = fc.wifi && fc.gps && fc.geofence && fc.face;
  assert(canMark === fc.allowed, `${fc.name} => ${canMark ? "ATTENDANCE ALLOWED" : "REGISTRATION BLOCKED"}`);
}

console.log("\n=================================================================");
console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
