import {
  verifyCampusWifi,
  matchNetworkFingerprint,
  isIpInSubnet,
  parseIpv4,
} from "../src/lib/wifi-config.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND WI-FI NETWORK-DETAIL FINGERPRINT TEST SUITE        ");
console.log("   Fingerprint 1: SONA Campus Network                            ");
console.log("      - Gateway / DNS: 172.16.16.16                              ");
console.log("      - Subnet: 172.16.0.0/12 (Dynamic IP: e.g. 172.16.184.252) ");
console.log("   Fingerprint 2: M Institutional Network                        ");
console.log("      - DNS: 10.220.86.133                                       ");
console.log("      - Subnet: 10.220.86.0/24 (Dynamic IP: e.g. 10.220.86.182)  ");
console.log("   STRICT PROHIBITION: NO SSID, NO BSSID, NO MAC, NO PUBLIC IP    ");
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

// =================================================================
// 1. IP & CIDR SUBNET PARSING HELPERS
// =================================================================
console.log("--- 1. CIDR SUBNET CALCULATION TESTS ---");
assert(isIpInSubnet("172.16.184.252", "172.16.0.0/12") === true, "172.16.184.252 is in 172.16.0.0/12");
assert(isIpInSubnet("172.16.16.16", "172.16.0.0/12") === true, "172.16.16.16 is in 172.16.0.0/12");
assert(isIpInSubnet("10.220.86.182", "10.220.86.0/24") === true, "10.220.86.182 is in 10.220.86.0/24");
assert(isIpInSubnet("10.220.86.133", "10.220.86.0/24") === true, "10.220.86.133 is in 10.220.86.0/24");
assert(isIpInSubnet("192.168.43.50", "172.16.0.0/12") === false, "Oppo IP 192.168.43.50 is NOT in 172.16.0.0/12");
assert(isIpInSubnet("192.168.1.100", "10.220.86.0/24") === false, "Home IP 192.168.1.100 is NOT in 10.220.86.0/24");

// =================================================================
// 2. TEST 1: PHONE CONNECTED TO M
// =================================================================
console.log("\n--- TEST 1: PHONE CONNECTED TO M INSTITUTIONAL NETWORK ---");
// Dynamic IP: 10.220.86.182 (screenshot lease), DNS: 10.220.86.133
const mResult1 = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "10.220.86.182",
  ipv4Subnet: "10.220.86.0/24",
  prefixLength: 24,
  dnsServers: ["10.220.86.133", "2409:40f4:311d:b23a::52"],
});
assert(mResult1.authorized === true, "M network fingerprint → AUTHORIZED");
assert(mResult1.networkType === "M", 'networkType is "M"');
assert(mResult1.networkSummary === "M Institutional Network", 'networkSummary is "M Institutional Network"');

// Dynamic IP variation for M (e.g. DHCP assigned another address 10.220.86.45)
const mDynamicIpResult = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "10.220.86.45", // Different dynamic client IP
  ipv4Subnet: "10.220.86.0/24",
  dnsServers: ["10.220.86.133"],
});
assert(mDynamicIpResult.authorized === true, "M with different dynamic DHCP IP (10.220.86.45) → AUTHORIZED");

// =================================================================
// 3. TEST 2: PHONE CONNECTED TO SONA-WIFI
// =================================================================
console.log("\n--- TEST 2: PHONE CONNECTED TO SONA CAMPUS NETWORK ---");
// Screenshot reference: Gateway 172.16.16.16, DNS 172.16.16.16, Client IP 172.16.184.252
const sonaResult1 = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "172.16.184.252",
  ipv4Subnet: "172.16.0.0/12",
  prefixLength: 12,
  gateway: "172.16.16.16",
  dnsServers: ["172.16.16.16"],
});
assert(sonaResult1.authorized === true, "SONA network fingerprint → AUTHORIZED");
assert(sonaResult1.networkType === "SONA", 'networkType is "SONA"');
assert(sonaResult1.networkSummary === "SONA Campus Network", 'networkSummary is "SONA Campus Network"');

// Dynamic IP variation for SONA (e.g. DHCP assigned 172.16.92.10)
const sonaDynamicIpResult = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "172.16.92.10", // Different dynamic client IP
  ipv4Subnet: "172.16.0.0/12",
  gateway: "172.16.16.16",
  dnsServers: ["172.16.16.16"],
});
assert(sonaDynamicIpResult.authorized === true, "SONA with different dynamic DHCP IP (172.16.92.10) → AUTHORIZED");

// =================================================================
// 4. TEST 3: PHONE CONNECTED TO OPPO K13 HOTSPOT
// =================================================================
console.log("\n--- TEST 3: PHONE CONNECTED TO OPPO K13 HOTSPOT ---");
// Rogue hotspot characteristics: Subnet 192.168.43.0/24, Gateway 192.168.43.1, DNS 192.168.43.1 / 8.8.8.8
const oppoResult = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "192.168.43.78",
  ipv4Subnet: "192.168.43.0/24",
  prefixLength: 24,
  gateway: "192.168.43.1",
  dnsServers: ["192.168.43.1", "8.8.8.8"],
});
assert(oppoResult.authorized === false, "Oppo K13 hotspot → FAILED (authorized === false)");
assert(oppoResult.networkType === "UNAUTHORIZED", 'networkType is "UNAUTHORIZED"');
assert(oppoResult.networkSummary === "Unauthorized Network", 'networkSummary is "Unauthorized Network"');

// Even if user renamed SSID to "SONA-WIFI" or "M" on Oppo K13, fingerprint check MUST FAIL!
const spoofedHotspot = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ssid: "SONA-WIFI", // Maliciously spoofed hotspot SSID name
  ipv4: "192.168.43.78",
  ipv4Subnet: "192.168.43.0/24",
  gateway: "192.168.43.1",
  dnsServers: ["192.168.43.1"],
});
assert(spoofedHotspot.authorized === false, "Spoofed SSID 'SONA-WIFI' on rogue hotspot → FAILED (SSID ignored)");

// =================================================================
// 5. TEST 4: PHONE CONNECTED TO ANOTHER WI-FI (Home Wi-Fi, JioFiber, Airtel)
// =================================================================
console.log("\n--- TEST 4: PHONE CONNECTED TO ANOTHER WI-FI ---");
const homeWifiResult = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "192.168.1.105",
  ipv4Subnet: "192.168.1.0/24",
  gateway: "192.168.1.1",
  dnsServers: ["192.168.1.1", "1.1.1.1"],
});
assert(homeWifiResult.authorized === false, "Home Wi-Fi (192.168.1.1) → FAILED");

const jioFiberResult = verifyCampusWifi({
  transport: "wifi",
  isWifi: true,
  ipv4: "192.168.29.55",
  ipv4Subnet: "192.168.29.0/24",
  gateway: "192.168.29.1",
  dnsServers: ["192.168.29.1"],
});
assert(jioFiberResult.authorized === false, "JioFiber Wi-Fi → FAILED");

// =================================================================
// 6. TEST 5: MOBILE DATA ONLY (CELLULAR)
// =================================================================
console.log("\n--- TEST 5: MOBILE DATA ONLY ---");
const cellularResult = verifyCampusWifi({
  transport: "cellular",
  isWifi: false,
  ipv4: "100.75.12.34",
  ipv4Subnet: "100.64.0.0/10",
  gateway: "100.75.12.1",
  dnsServers: ["1.1.1.1"],
});
assert(cellularResult.authorized === false, "Cellular / Mobile data → FAILED");
assert(cellularResult.networkSummary === "Mobile Data", 'networkSummary is "Mobile Data"');

// =================================================================
// 7. TEST 6: NO NETWORK INFORMATION / DISCONNECTED
// =================================================================
console.log("\n--- TEST 6: NO NETWORK INFORMATION / DISCONNECTED ---");
const disconnectedResult = verifyCampusWifi({
  transport: "none",
  isWifi: false,
  state: "disconnected",
});
assert(disconnectedResult.authorized === false, "Disconnected state → FAILED");

const emptyResult = verifyCampusWifi({});
assert(emptyResult.authorized === false, "No network info payload → FAILED");
assert(emptyResult.networkSummary === "Unable to verify network fingerprint", 'networkSummary indicates unable to verify');

// =================================================================
// 8. ATTENDANCE HARD GATE VERIFICATION
// =================================================================
console.log("\n--- ATTENDANCE REGISTRATION HARD GATE VERIFICATION ---");
function evaluateAttendanceGate(wifiVerification, gpsInside, faceVerified) {
  const allowed = wifiVerification.authorized && gpsInside && faceVerified;
  return {
    allowed,
    gateFailure: !wifiVerification.authorized ? "WIFI_GATE_FAILED" : null,
  };
}

const gatePassSona = evaluateAttendanceGate(sonaResult1, true, true);
assert(gatePassSona.allowed === true, "Attendance permitted when SONA fingerprint verified");

const gatePassM = evaluateAttendanceGate(mResult1, true, true);
assert(gatePassM.allowed === true, "Attendance permitted when M fingerprint verified");

const gateBlockedOppo = evaluateAttendanceGate(oppoResult, true, true);
assert(gateBlockedOppo.allowed === false, "Attendance blocked when connected to Oppo K13");
assert(gateBlockedOppo.gateFailure === "WIFI_GATE_FAILED", "Blocked specifically by WIFI_GATE_FAILED");

const gateBlockedHome = evaluateAttendanceGate(homeWifiResult, true, true);
assert(gateBlockedHome.allowed === false, "Attendance blocked when connected to Home Wi-Fi");

const gateBlockedCellular = evaluateAttendanceGate(cellularResult, true, true);
assert(gateBlockedCellular.allowed === false, "Attendance blocked when on Cellular data");

const gateBlockedEmpty = evaluateAttendanceGate(emptyResult, true, true);
assert(gateBlockedEmpty.allowed === false, "Attendance blocked when no network info present");

// =================================================================
// SUMMARY
// =================================================================
console.log("\n=================================================================");
console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
