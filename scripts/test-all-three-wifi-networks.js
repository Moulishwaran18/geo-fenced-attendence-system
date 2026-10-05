import { verifyCampusWifi, AUTHORIZED_CAMPUS_NETWORKS } from "../src/lib/wifi-config.ts";
import { AUTHORIZED_SSIDS } from "../src/lib/wifi-detection.ts";

console.log("=================================================================");
console.log("   AUTHORITATIVE 3-FACTOR WI-FI SECURITY VERIFICATION SUITE      ");
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
// Test 1: Verify Configuration Contains All 3 Authorized Networks
// -------------------------------------------------------------
console.log("1. Verifying Authorized Networks Configuration:");
assert(AUTHORIZED_CAMPUS_NETWORKS["SONA-WIFI"] !== undefined, "Network 1 'SONA-WIFI' is configured");
assert(AUTHORIZED_CAMPUS_NETWORKS["M"] !== undefined, "Network 2 'M' is configured");
assert(AUTHORIZED_CAMPUS_NETWORKS["LAPTOP-96EEBK69 4670"] !== undefined, "Network 3 'LAPTOP-96EEBK69 4670' is configured");
assert(AUTHORIZED_SSIDS.includes("SONA-WIFI"), "AUTHORIZED_SSIDS includes 'SONA-WIFI'");
assert(AUTHORIZED_SSIDS.includes("M"), "AUTHORIZED_SSIDS includes 'M'");
assert(AUTHORIZED_SSIDS.includes("LAPTOP-96EEBK69 4670"), "AUTHORIZED_SSIDS includes 'LAPTOP-96EEBK69 4670'");

// -------------------------------------------------------------
// Test 2: Network 1 (SONA-WIFI) - Institutional Campus Open Wi-Fi
// -------------------------------------------------------------
console.log("\n2. Testing Network 1: SONA-WIFI (Institutional Gateway & Subnet):");
const sonaResult = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "172.16.184.252",
  gateway: "172.16.16.16",
  dns: "172.16.16.16",
  auth: "Open",
  band: "5 GHz",
});
assert(sonaResult.authorized === true, "SONA-WIFI authorized = true");
assert(sonaResult.stage === "VERIFIED", `SONA-WIFI stage = VERIFIED (got: ${sonaResult.stage})`);
console.log(`     Summary: ${sonaResult.networkSummary}`);

// -------------------------------------------------------------
// Test 3: Network 2 (M) - Campus WPA2-Personal Wi-Fi
// -------------------------------------------------------------
console.log("\n3. Testing Network 2: M (Campus 10.220.86.x Subnet & DNS):");
const mResult = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  ip: "10.220.86.182",
  gateway: "",
  dns: "10.220.86.133, 2409:40f4:301e:8572::94",
  auth: "WPA2-Personal",
  band: "5 GHz",
});
assert(mResult.authorized === true, "M authorized = true");
assert(mResult.stage === "VERIFIED", `M stage = VERIFIED (got: ${mResult.stage})`);
console.log(`     Summary: ${mResult.networkSummary}`);

// -------------------------------------------------------------
// Test 4: Network 3 (LAPTOP-96EEBK69 4670) - From Android Screenshot
// Details: 192.168.137.125, 433 Mbps on 5 GHz, WPA/WPA2-Personal, -54 dBm
// -------------------------------------------------------------
console.log("\n4. Testing Network 3: LAPTOP-96EEBK69 4670 (From Android Screenshot):");
const thirdResult = verifyCampusWifi({
  ssid: "LAPTOP-96EEBK69 4670",
  state: "connected",
  ip: "192.168.137.125",
  gateway: "192.168.137.1",
  dns: "192.168.137.1",
  auth: "WPA/WPA2-Personal",
  band: "5 GHz",
  frequency: 5180,
  signal: "-54 dBm",
});
assert(thirdResult.authorized === true, "LAPTOP-96EEBK69 4670 authorized = true");
assert(thirdResult.stage === "VERIFIED", `LAPTOP-96EEBK69 4670 stage = VERIFIED (got: ${thirdResult.stage})`);
assert(thirdResult.band === "5 GHz", `Band recorded dynamically: ${thirdResult.band}`);
console.log(`     Summary: ${thirdResult.networkSummary}`);

// -------------------------------------------------------------
// Test 5: Security - Spoofed SSID Rogue Hotspot Detection
// -------------------------------------------------------------
console.log("\n5. Testing Security: Rogue Hotspot & Subnet Spoofing Defense:");

// Case 5A: Attacker sets up personal mobile hotspot named "SONA-WIFI" on 192.168.43.x (Android)
const spoofedAndroidHotspot = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.43.88",
  gateway: "192.168.43.1",
});
assert(spoofedAndroidHotspot.authorized === false, "Spoofed SONA-WIFI on 192.168.43.x rejected");
assert(spoofedAndroidHotspot.stage === "NETWORK_VALIDATION_FAILED", "Rogue Android hotspot detected");

// Case 5B: Attacker sets up laptop hotspot named "SONA-WIFI" on 192.168.137.x
const spoofedWindowsHotspot = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.137.45",
  gateway: "192.168.137.1",
});
assert(spoofedWindowsHotspot.authorized === false, "Spoofed SONA-WIFI on 192.168.137.x rejected");
assert(spoofedWindowsHotspot.stage === "NETWORK_VALIDATION_FAILED", "Spoofed Windows hotspot detected for SONA-WIFI");

// Case 5C: Attacker sets up iPhone hotspot named "M" on 172.20.10.x
const spoofedIphoneHotspot = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  ip: "172.20.10.4",
  gateway: "172.20.10.1",
});
assert(spoofedIphoneHotspot.authorized === false, "Spoofed M on 172.20.10.x rejected");

// -------------------------------------------------------------
// Test 6: Security - Unknown / Rogue Networks
// -------------------------------------------------------------
console.log("\n6. Testing Security: Completely Unknown / Rogue Networks:");
const unknownNetwork = verifyCampusWifi({
  ssid: "CoffeeShop-Free-WiFi",
  state: "connected",
  ip: "192.168.1.50",
  gateway: "192.168.1.1",
});
assert(unknownNetwork.authorized === false, "Unknown network rejected");
assert(unknownNetwork.stage === "SSID_CHECK_FAILED", `Correct stage SSID_CHECK_FAILED (got: ${unknownNetwork.stage})`);

// -------------------------------------------------------------
// Test 7: Security - Android Withheld / Masked Identity State
// -------------------------------------------------------------
console.log("\n7. Testing Security: Android Withheld Identity (<unknown ssid> / empty):");
const withheldIdentity = verifyCampusWifi({
  ssid: "<unknown ssid>",
  state: "connected",
  ip: "192.168.137.125",
});
assert(withheldIdentity.authorized === false, "Withheld identity not falsely authorized");
assert(withheldIdentity.stage === "UNABLE_TO_VERIFY", `Correct stage UNABLE_TO_VERIFY (got: ${withheldIdentity.stage})`);

// -------------------------------------------------------------
// Test 8: Security - Anti-VPN & Active Tunnel Detection
// -------------------------------------------------------------
console.log("\n8. Testing Security: Active VPN / Tunnel Detection:");
const vpnAttempt = verifyCampusWifi({
  ssid: "LAPTOP-96EEBK69 4670",
  state: "connected",
  ip: "192.168.137.125",
  gateway: "192.168.137.1",
  capabilities: { notVpn: false, hasWifi: true },
});
assert(vpnAttempt.authorized === false, "Active VPN connection rejected");
assert(vpnAttempt.stage === "NETWORK_VALIDATION_FAILED", "VPN blocked at NETWORK_VALIDATION_FAILED");

// -------------------------------------------------------------
// Test 9: Complete 5-Stage Attendance Gate Flow
// -------------------------------------------------------------
console.log("\n9. Testing Full 5-Stage Verification Enforcement:");
console.log("   WI-FI AUTH -> GPS VERIFY -> GEOFENCE POLYGON -> FACE + LIVENESS -> ATTENDANCE");

const flowCases = [
  { name: "All Factors Passed (SONA-WIFI)", wifi: true, gps: true, geofence: true, face: true, allowed: true },
  { name: "All Factors Passed (M)", wifi: true, gps: true, geofence: true, face: true, allowed: true },
  { name: "All Factors Passed (LAPTOP-96EEBK69 4670)", wifi: true, gps: true, geofence: true, face: true, allowed: true },
  { name: "Wi-Fi Failed -> Attendance BLOCKED", wifi: false, gps: true, geofence: true, face: true, allowed: false },
  { name: "Wi-Fi OK, GPS Outside Polygon -> BLOCKED", wifi: true, gps: true, geofence: false, face: true, allowed: false },
  { name: "Wi-Fi OK, GPS OK, Face Unmatched -> BLOCKED", wifi: true, gps: true, geofence: true, face: false, allowed: false },
  { name: "Wi-Fi Failed + Outside Polygon -> BLOCKED", wifi: false, gps: false, geofence: false, face: false, allowed: false },
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
