import {
  verifyCampusWifi,
  AUTHORIZED_CAMPUS_NETWORKS,
  isAuthorizedMPublicIp,
  extractClientPublicIpFromHeaders,
} from "../src/lib/wifi-config.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND WI-FI AUTHENTICATION SPECIFICATION TEST SUITE     ");
console.log("   M: Server-Side Public IP Verification                         ");
console.log("   SONA-WIFI: Strict Institutional Gateway/DNS Identity Check    ");
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

const M_MOCK_PUBLIC_IP = "203.0.113.195";

// -------------------------------------------------------------
// TEST 1: Phone connected to M via Server-Side Public IP Verification
// (SSID unavailable in Chrome/Vercel, but public IP matches AUTHORIZED_M_PUBLIC_IP)
// -------------------------------------------------------------
console.log("TEST 1: M Authentication via Server-Side Public IP Match:");
const test1A = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: M_MOCK_PUBLIC_IP,
  authorizedMPublicIp: M_MOCK_PUBLIC_IP,
});
assert(test1A.authorized === true, "Wi-Fi AUTHORIZED when client public IP matches AUTHORIZED_M_PUBLIC_IP");
assert(test1A.stage === "VERIFIED", `Stage = VERIFIED (got: ${test1A.stage})`);
assert(test1A.ssid === "M", `Network identified as 'M' (got: ${test1A.ssid})`);
assert(test1A.authMethod === "Campus public network verified", `Auth Method = 'Campus public network verified' (got: ${test1A.authMethod})`);
assert(test1A.networkSummary === "Campus public network verified", `Network summary = 'Campus public network verified' (got: ${test1A.networkSummary})`);
assert(test1A.bssid === "Not available in browser", "BSSID is not faked, reported as 'Not available in browser'");

// Test 1B: Explicit SSID = "M" (from Native Android Bridge or Local OS)
const test1B = verifyCampusWifi({
  ssid: "M",
  state: "connected",
});
assert(test1B.authorized === true, "Wi-Fi AUTHORIZED when SSID is explicitly detected as 'M'");
assert(test1B.stage === "VERIFIED", `Stage = VERIFIED (got: ${test1B.stage})`);
assert(test1B.bssidStatusMessage === "BSSID not required for M", "BSSID is not required for M");

// -------------------------------------------------------------
// TEST 2: Connected to Oppo K13 or Other Wi-Fi / Hotspot
// -------------------------------------------------------------
console.log("\nTEST 2: Unauthorized Wi-Fi Networks (Oppo K13 / Other Hotspot):");
// 2A: Explicit SSID "Oppo K13"
const test2A = verifyCampusWifi({
  ssid: "Oppo K13",
  state: "connected",
  clientPublicIp: M_MOCK_PUBLIC_IP, // Even if IP were coincidentally matching, explicit unauthorized SSID fails
  authorizedMPublicIp: M_MOCK_PUBLIC_IP,
});
assert(test2A.authorized === false, "Wi-Fi FAILED for unauthorized SSID 'Oppo K13'");
assert(test2A.stage === "SSID_CHECK_FAILED", `Stage = SSID_CHECK_FAILED (got: ${test2A.stage})`);
assert(test2A.networkSummary === "Unauthorized Wi-Fi network", "Network summary = 'Unauthorized Wi-Fi network'");

// 2B: Phone on another Wi-Fi / cellular hotspot (public IP changes to 49.36.12.80)
const test2B = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: "49.36.12.80",
  authorizedMPublicIp: M_MOCK_PUBLIC_IP,
});
assert(test2B.authorized === false, "Wi-Fi FAILED when client public IP does not match AUTHORIZED_M_PUBLIC_IP");
assert(test2B.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test2B.stage})`);
assert(test2B.networkSummary === "Unauthorized campus network", "Network summary = 'Unauthorized campus network'");

// -------------------------------------------------------------
// TEST 3: Connected to SONA-WIFI (Unique Identity Matches)
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
// TEST 4: SSID = SONA-WIFI (Unique Identity Does NOT Match)
// -------------------------------------------------------------
console.log("\nTEST 4: SSID = SONA-WIFI (Unique Identity Does NOT Match):");
// 4A: Rogue hotspot / home router with SSID "SONA-WIFI"
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

// 4B: SONA-WIFI with no unique identity telemetry (cannot be verified on SSID alone)
const test4B = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
});
assert(test4B.authorized === false, "Wi-Fi FAILED when SONA-WIFI unique identity is unavailable");
assert(test4B.stage === "NETWORK_VALIDATION_FAILED", `Stage = NETWORK_VALIDATION_FAILED (got: ${test4B.stage})`);

// -------------------------------------------------------------
// TEST 5: SSID Unavailable in Chrome (Do NOT assume M)
// -------------------------------------------------------------
console.log("\nTEST 5: SSID Unavailable in Chrome (Do NOT assume M):");
// 5A: Empty SSID without authorized public IP
const test5A = verifyCampusWifi({
  ssid: "",
  state: "connected",
  clientPublicIp: "123.45.67.89",
  authorizedMPublicIp: M_MOCK_PUBLIC_IP,
});
assert(test5A.authorized === false, "Wi-Fi FAILED when public IP is unverified (did NOT assume M)");
assert(test5A.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test5A.stage})`);
assert(test5A.ssid !== "M", "Did NOT assume M when public IP did not match");

// 5B: Unknown / hidden SSID when AUTHORIZED_M_PUBLIC_IP is not yet configured
const test5B = verifyCampusWifi({
  ssid: "<unknown ssid>",
  state: "connected",
  clientPublicIp: "103.21.244.2",
  authorizedMPublicIp: "", // Not configured yet
});
assert(test5B.authorized === false, "Wi-Fi FAILED when AUTHORIZED_M_PUBLIC_IP is unconfigured");
assert(test5B.stage === "UNABLE_TO_VERIFY", `Stage = UNABLE_TO_VERIFY (got: ${test5B.stage})`);

// 5C: Disconnected state
const test5C = verifyCampusWifi({
  state: "disconnected",
});
assert(test5C.authorized === false, "Wi-Fi FAILED when device is disconnected");
assert(test5C.stage === "DISCONNECTED", `Stage = DISCONNECTED (got: ${test5C.stage})`);

// -------------------------------------------------------------
// TEST 6: Public IP Matching Helper Verification
// -------------------------------------------------------------
console.log("\nTEST 6: Public IP Configuration Matching Engine:");
assert(isAuthorizedMPublicIp("203.0.113.195", "203.0.113.195") === true, "Exact single public IP match");
assert(isAuthorizedMPublicIp("203.0.113.196", "203.0.113.195, 203.0.113.196") === true, "Comma-separated IP pool match");
assert(isAuthorizedMPublicIp("203.0.113.50", "203.0.113.0/24") === true, "CIDR /24 subnet match");
assert(isAuthorizedMPublicIp("198.51.100.1", "203.0.113.195") === false, "Different IP rejected");
assert(isAuthorizedMPublicIp("10.220.86.182", "203.0.113.195") === false, "Private IP 10.220.86.182 rejected");

// -------------------------------------------------------------
// TEST 7: Request Header Client IP Extraction
// -------------------------------------------------------------
console.log("\nTEST 7: Multi-Proxy Client IP Extraction:");
const headersVercel = {
  get: (h) => (h === "x-forwarded-for" ? "203.0.113.195, 10.0.0.1" : null),
};
assert(extractClientPublicIpFromHeaders(headersVercel) === "203.0.113.195", "Extracts client IP from x-forwarded-for");

const headersRealIp = {
  get: (h) => (h === "x-real-ip" ? "203.0.113.195" : null),
};
assert(extractClientPublicIpFromHeaders(headersRealIp) === "203.0.113.195", "Extracts client IP from x-real-ip");

// -------------------------------------------------------------
// TEST 8: Security Defenses (Rogue Hotspots & VPN)
// -------------------------------------------------------------
console.log("\nTEST 8: Security Defenses (Rogue Hotspots & VPN):");
const rogueHotspotAndroid = verifyCampusWifi({
  ssid: "SONA-WIFI",
  state: "connected",
  ip: "192.168.43.88",
  gateway: "192.168.43.1",
});
assert(rogueHotspotAndroid.authorized === false, "Rogue Android hotspot (192.168.43.x) rejected");

const vpnAttempt = verifyCampusWifi({
  ssid: "M",
  state: "connected",
  capabilities: { notVpn: false, hasWifi: true },
});
assert(vpnAttempt.authorized === false, "Active VPN connection rejected");

// -------------------------------------------------------------
// TEST 9: Attendance Gating
// -------------------------------------------------------------
console.log("\nTEST 9: Attendance Verification Pipeline Enforcement:");
function evaluateAttendanceGate(wifi, gps, face) {
  if (!wifi.authorized) {
    return { allowed: false, blockedBy: "WIFI", stage: 1 };
  }
  if (!gps.insideGeofence) {
    return { allowed: false, blockedBy: "GPS", stage: 2 };
  }
  if (!face.authenticated) {
    return { allowed: false, blockedBy: "FACE", stage: 3 };
  }
  return { allowed: true, blockedBy: null, stage: 5 };
}

const unverifiedWifiResult = evaluateAttendanceGate(test2B, { insideGeofence: true }, { authenticated: true });
assert(unverifiedWifiResult.allowed === false, "Attendance blocked when Wi-Fi unverified");
assert(unverifiedWifiResult.blockedBy === "WIFI", "Gate blocked strictly at Stage 1 (Wi-Fi)");

const verifiedMResult = evaluateAttendanceGate(test1A, { insideGeofence: true }, { authenticated: true });
assert(verifiedMResult.allowed === true, "Attendance allowed when M verified via Public IP + GPS inside + Face authenticated");

const verifiedSonaWifiResult = evaluateAttendanceGate(test3, { insideGeofence: true }, { authenticated: true });
assert(verifiedSonaWifiResult.allowed === true, "Attendance allowed when SONA-WIFI verified + GPS inside + Face authenticated");

console.log("\n=================================================================");
console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
