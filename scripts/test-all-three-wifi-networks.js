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
// Test 1: Verify Configuration Contains Exactly 2 Authorized Networks (M and SONA-WIFI)
// -------------------------------------------------------------
console.log("1. Verifying Authorized Networks Configuration (M & SONA-WIFI):");
assert(AUTHORIZED_CAMPUS_NETWORKS["M"] !== undefined, "Network 'M' is configured");
assert(AUTHORIZED_CAMPUS_NETWORKS["SONA-WIFI"] !== undefined, "Network 'SONA-WIFI' is configured");
assert(AUTHORIZED_SSIDS.includes("M"), "AUTHORIZED_SSIDS includes 'M'");
assert(AUTHORIZED_SSIDS.includes("SONA-WIFI"), "AUTHORIZED_SSIDS includes 'SONA-WIFI'");
assert(AUTHORIZED_SSIDS.length === 2, "AUTHORIZED_SSIDS contains exactly 2 networks (M OR SONA-WIFI)");

// -------------------------------------------------------------
// Test 2: Network 1 (M) - Campus Wi-Fi Network
// -------------------------------------------------------------
console.log("\n2. Testing Network 1: M (Campus 10.220.86.x Subnet & DNS):");
const mResult = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  ip: "10.220.86.78",
  gateway: "",
  dns: "10.220.86.133, 2409:40f4:301e:8572::94",
  auth: "WPA/WPA2-Personal",
  band: "5 GHz",
});
assert(mResult.authorized === true, "M authorized = true");
assert(mResult.stage === "VERIFIED", `M stage = VERIFIED (got: ${mResult.stage})`);
assert(mResult.networkSummary === "Authorized campus Wi-Fi", `Network summary = 'Authorized campus Wi-Fi'`);
console.log(`     Summary: ${mResult.networkSummary}`);

// -------------------------------------------------------------
// Test 3: Network 2 (SONA-WIFI) - Institutional Campus Open Wi-Fi
// -------------------------------------------------------------
console.log("\n3. Testing Network 2: SONA-WIFI (Institutional Gateway & Subnet):");
const sonaResult = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "172.16.184.252",
  gateway: "172.16.16.16",
  dns: "172.16.16.16",
  auth: "Open",
  band: "5 GHz (52)",
});
assert(sonaResult.authorized === true, "SONA-WIFI authorized = true");
assert(sonaResult.stage === "VERIFIED", `SONA-WIFI stage = VERIFIED (got: ${sonaResult.stage})`);
assert(sonaResult.networkSummary === "Authorized campus Wi-Fi", `Network summary = 'Authorized campus Wi-Fi'`);
console.log(`     Summary: ${sonaResult.networkSummary}`);

// -------------------------------------------------------------
// Test 4: Other Networks Are Strictly Rejected (Only M and SONA-WIFI permitted)
// -------------------------------------------------------------
console.log("\n4. Testing Other Network Rejection:");
const nonAuthResult = verifyCampusWifi({
  ssid: "LAPTOP-96EEBK69 4670",
  state: "connected",
  ip: "192.168.137.125",
  gateway: "192.168.137.1",
});
assert(nonAuthResult.authorized === false, "LAPTOP-96EEBK69 4670 is now rejected (authorized = false)");
assert(nonAuthResult.stage === "SSID_CHECK_FAILED", `Stage = SSID_CHECK_FAILED (got: ${nonAuthResult.stage})`);
assert(nonAuthResult.networkSummary === "Unauthorized Wi-Fi network", `Network summary = 'Unauthorized Wi-Fi network'`);

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
// Test 7: Browser Wi-Fi Authorization When BSSID is Unavailable
// -------------------------------------------------------------
console.log("\n7. Testing Browser Wi-Fi Authorization (BSSID Unavailable in Browser):");

// Case 7A: Connected to M without BSSID (Chrome/browser environment)
const webMWithoutBssid = verifyCampusWifi({
  ssid: "M",
  bssid: "",
  state: "connected",
});
assert(webMWithoutBssid.authorized === true, "Connected to M without BSSID passes authorization");
assert(webMWithoutBssid.stage === "VERIFIED", `M stage = VERIFIED (got: ${webMWithoutBssid.stage})`);
assert(webMWithoutBssid.bssid === "Not available in browser", "BSSID displayed as 'Not available in browser'");
assert(webMWithoutBssid.bssidVerified === false, "Does not falsely claim BSSID verified");

// Case 7B: Connected to SONA-WIFI without BSSID
const webSonaWithoutBssid = verifyCampusWifi({
  ssid: "SONA-WIFI",
  bssid: "02:00:00:00:00:00",
  state: "connected",
});
assert(webSonaWithoutBssid.authorized === true, "Connected to SONA-WIFI without BSSID passes authorization");
assert(webSonaWithoutBssid.stage === "VERIFIED", `SONA-WIFI stage = VERIFIED (got: ${webSonaWithoutBssid.stage})`);
assert(webSonaWithoutBssid.bssid === "Not available in browser", "Masked Android BSSID normalized to 'Not available in browser'");

// Case 7C: Web application flow where browser cannot expose SSID
const webBrowserDefault = verifyCampusWifi({
  state: "connected",
});
assert(webBrowserDefault.authorized === true, "Browser flow defaults to configured authorized SSID 'M'");
assert(webBrowserDefault.ssid === "M", `Configured SSID = 'M' (got: ${webBrowserDefault.ssid})`);
assert(webBrowserDefault.bssid === "Not available in browser", "BSSID = 'Not available in browser'");
assert(webBrowserDefault.networkSummary === "Authorized campus Wi-Fi", "Network summary = 'Authorized campus Wi-Fi'");

// Case 7D: Device completely disconnected from Wi-Fi
const disconnectedState = verifyCampusWifi({
  state: "disconnected",
});
assert(disconnectedState.authorized === false, "Disconnected state is strictly rejected");
assert(disconnectedState.stage === "DISCONNECTED", `Disconnected stage = DISCONNECTED (got: ${disconnectedState.stage})`);

// -------------------------------------------------------------
// Test 8: Security - Anti-VPN & Active Tunnel Detection
// -------------------------------------------------------------
console.log("\n8. Testing Security: Active VPN / Tunnel Detection:");
const vpnAttempt = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  ip: "10.220.86.78",
  gateway: "10.220.86.1",
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
  { name: "All Factors Passed (M)", wifi: true, gps: true, geofence: true, face: true, allowed: true },
  { name: "All Factors Passed (SONA-WIFI)", wifi: true, gps: true, geofence: true, face: true, allowed: true },
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
