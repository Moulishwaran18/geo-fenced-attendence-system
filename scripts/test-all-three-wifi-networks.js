import {
  verifyCampusWifi,
  isSsidAuthorized,
} from "../src/lib/wifi-config.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND SSID & NATIVE BRIDGE WI-FI TEST SUITE             ");
console.log("   Rule: normalizedSsid === 'm' || normalizedSsid.includes('sona') ");
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
// 1. CONDITION 1 — M NETWORK (EXACT MATCH "m" with trimming)
// =================================================================
console.log("--- 1. CONDITION 1 — M NETWORK TESTS ---");

const mUpper = verifyCampusWifi({ ssid: "M", state: "connected" });
assert(mUpper.authorized === true, '"M" → PASS (authorized === true)');
assert(mUpper.networkSummary === "Authorized campus Wi-Fi", '"M" networkSummary === "Authorized campus Wi-Fi"');

const mLower = verifyCampusWifi({ ssid: "m", state: "connected" });
assert(mLower.authorized === true, '"m" → PASS (authorized === true)');

const mLeadingSpace = verifyCampusWifi({ ssid: " M", state: "connected" });
assert(mLeadingSpace.authorized === true, '" M" (leading space) → PASS');

const mTrailingSpace = verifyCampusWifi({ ssid: "m ", state: "connected" });
assert(mTrailingSpace.authorized === true, '"m " (trailing space) → PASS');

const mWifi = verifyCampusWifi({ ssid: "M-WIFI", state: "connected" });
assert(mWifi.authorized === false, '"M-WIFI" → FAIL (authorized === false)');

const myWifi = verifyCampusWifi({ ssid: "MyWiFi", state: "connected" });
assert(myWifi.authorized === false, '"MyWiFi" → FAIL (authorized === false)');

const campusM = verifyCampusWifi({ ssid: "Campus-M", state: "connected" });
assert(campusM.authorized === false, '"Campus-M" → FAIL (authorized === false)');

const my = verifyCampusWifi({ ssid: "MY", state: "connected" });
assert(my.authorized === false, '"MY" → FAIL (authorized === false)');

// Helper function verification for M condition
assert(isSsidAuthorized("M") === true, 'isSsidAuthorized("M") === true');
assert(isSsidAuthorized("m") === true, 'isSsidAuthorized("m") === true');
assert(isSsidAuthorized(" M") === true, 'isSsidAuthorized(" M") === true');
assert(isSsidAuthorized("m ") === true, 'isSsidAuthorized("m ") === true');
assert(isSsidAuthorized("M-WIFI") === false, 'isSsidAuthorized("M-WIFI") === false');
assert(isSsidAuthorized("MyWiFi") === false, 'isSsidAuthorized("MyWiFi") === false');
assert(isSsidAuthorized("Campus-M") === false, 'isSsidAuthorized("Campus-M") === false');
assert(isSsidAuthorized("MY") === false, 'isSsidAuthorized("MY") === false');

// =================================================================
// 2. CONDITION 2 — SONA NETWORK (CONTAINS "sona")
// =================================================================
console.log("\n--- 2. CONDITION 2 — SONA NETWORK TESTS ---");

const sonaUpper = verifyCampusWifi({ ssid: "SONA", state: "connected" });
assert(sonaUpper.authorized === true, '"SONA" → PASS');
assert(sonaUpper.networkSummary === "Authorized campus Wi-Fi", '"SONA" networkSummary === "Authorized campus Wi-Fi"');

const sonaWifiUpper = verifyCampusWifi({ ssid: "SONA-WIFI", state: "connected" });
assert(sonaWifiUpper.authorized === true, '"SONA-WIFI" → PASS');

const sonaWifiMixed = verifyCampusWifi({ ssid: "Sona-Wifi", state: "connected" });
assert(sonaWifiMixed.authorized === true, '"Sona-Wifi" → PASS');

const sonaCampus = verifyCampusWifi({ ssid: "sona campus", state: "connected" });
assert(sonaCampus.authorized === true, '"sona campus" → PASS');

const mySonaNet = verifyCampusWifi({ ssid: "MY-SONA-NETWORK", state: "connected" });
assert(mySonaNet.authorized === true, '"MY-SONA-NETWORK" → PASS');

// Helper function verification for SONA condition
assert(isSsidAuthorized("SONA") === true, 'isSsidAuthorized("SONA") === true');
assert(isSsidAuthorized("SONA-WIFI") === true, 'isSsidAuthorized("SONA-WIFI") === true');
assert(isSsidAuthorized("Sona-Wifi") === true, 'isSsidAuthorized("Sona-Wifi") === true');
assert(isSsidAuthorized("sona campus") === true, 'isSsidAuthorized("sona campus") === true');
assert(isSsidAuthorized("MY-SONA-NETWORK") === true, 'isSsidAuthorized("MY-SONA-NETWORK") === true');

// =================================================================
// 3. UNAUTHORIZED NETWORKS
// =================================================================
console.log("\n--- 3. UNAUTHORIZED NETWORKS TESTS ---");

const oppo = verifyCampusWifi({ ssid: "Oppo K13", state: "connected" });
assert(oppo.authorized === false, '"Oppo K13" → FAIL');
assert(oppo.networkSummary === "Unauthorized Wi-Fi network", '"Oppo K13" networkSummary === "Unauthorized Wi-Fi network"');

const homeWifi = verifyCampusWifi({ ssid: "Home WiFi", state: "connected" });
assert(homeWifi.authorized === false, '"Home WiFi" → FAIL');

const jioFiber = verifyCampusWifi({ ssid: "JioFiber", state: "connected" });
assert(jioFiber.authorized === false, '"JioFiber" → FAIL');

const airtel = verifyCampusWifi({ ssid: "Airtel", state: "connected" });
assert(airtel.authorized === false, '"Airtel" → FAIL');

const campusGuest = verifyCampusWifi({ ssid: "CampusGuest", state: "connected" });
assert(campusGuest.authorized === false, '"CampusGuest" → FAIL');

assert(isSsidAuthorized("Oppo K13") === false, 'isSsidAuthorized("Oppo K13") === false');
assert(isSsidAuthorized("Home WiFi") === false, 'isSsidAuthorized("Home WiFi") === false');
assert(isSsidAuthorized("JioFiber") === false, 'isSsidAuthorized("JioFiber") === false');
assert(isSsidAuthorized("Airtel") === false, 'isSsidAuthorized("Airtel") === false');
assert(isSsidAuthorized("CampusGuest") === false, 'isSsidAuthorized("CampusGuest") === false');

// =================================================================
// 4. EMPTY / UNKNOWN / UNAVAILABLE SSID
// =================================================================
console.log("\n--- 4. EMPTY / UNKNOWN / UNAVAILABLE SSID TESTS ---");

const emptyStr = verifyCampusWifi({ ssid: "", state: "connected" });
assert(emptyStr.authorized === false, '"" → FAIL');
assert(emptyStr.networkSummary === "Unauthorized Wi-Fi network", '"" networkSummary === "Unauthorized Wi-Fi network"');

const nullSsid = verifyCampusWifi({ ssid: null, state: "connected" });
assert(nullSsid.authorized === false, 'null → FAIL');

const undefinedSsid = verifyCampusWifi({ ssid: undefined, state: "connected" });
assert(undefinedSsid.authorized === false, 'undefined → FAIL');

const unknownSsid = verifyCampusWifi({ ssid: "Unknown", state: "connected" });
assert(unknownSsid.authorized === false, '"Unknown" → FAIL');

const unavailableSsid = verifyCampusWifi({ ssid: "Unavailable", state: "connected" });
assert(unavailableSsid.authorized === false, '"Unavailable" → FAIL');

const hiddenSsid = verifyCampusWifi({ ssid: "Hidden", state: "connected" });
assert(hiddenSsid.authorized === false, '"Hidden" → FAIL');

const bracketUnknown = verifyCampusWifi({ ssid: "<unknown ssid>", state: "connected" });
assert(bracketUnknown.authorized === false, '"<unknown ssid>" → FAIL');

const ssidUnavailableFlag = verifyCampusWifi({ ssid: "SSID_UNAVAILABLE", state: "connected" });
assert(ssidUnavailableFlag.authorized === false, '"SSID_UNAVAILABLE" → FAIL');

assert(isSsidAuthorized("") === false, 'isSsidAuthorized("") === false');
assert(isSsidAuthorized(null) === false, 'isSsidAuthorized(null) === false');
assert(isSsidAuthorized(undefined) === false, 'isSsidAuthorized(undefined) === false');
assert(isSsidAuthorized("Unknown") === false, 'isSsidAuthorized("Unknown") === false');
assert(isSsidAuthorized("Unavailable") === false, 'isSsidAuthorized("Unavailable") === false');
assert(isSsidAuthorized("Hidden") === false, 'isSsidAuthorized("Hidden") === false');

// =================================================================
// 5. PUBLIC IP & SERVER-OBSERVABLE VERIFICATION TESTS
// =================================================================
console.log("\n--- 5. PUBLIC IP & SERVER-OBSERVABLE VERIFICATION TESTS ---");

const ip1 = verifyCampusWifi({ ssid: "M", state: "connected", clientPublicIp: "103.21.244.2" });
assert(ip1.authorized === true, '"M" is AUTHORIZED with Public IP 103.21.244.2 (native bridge)');

const ip2 = verifyCampusWifi({ ssid: "M", state: "connected", clientPublicIp: "49.36.12.80" });
assert(ip2.authorized === true, '"M" is AUTHORIZED with Public IP 49.36.12.80 (native bridge)');

const ipInvalid1 = verifyCampusWifi({ ssid: "Oppo K13", state: "connected", clientPublicIp: "203.0.113.195" });
assert(ipInvalid1.authorized === false, '"Oppo K13" remains UNAUTHORIZED regardless of Public IP 203.0.113.195');

// 5B. Server-Observable Campus Network Verification in Mobile Chrome
console.log("\n--- 5B. SERVER-OBSERVABLE VERIFICATION IN MOBILE CHROME ---");

// Case 5B-1: Chrome on M network (egress IP matches M)
const chromeM = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: "203.0.113.195",
  authorizedMPublicIp: "203.0.113.195",
});
assert(chromeM.authorized === true, "Mobile Chrome on M network -> AUTHORIZED via server egress IP");
assert(chromeM.ssid === "Unavailable in browser", 'SSID is "Unavailable in browser" (never faked)');
assert(chromeM.networkSummary === "Authorized campus network", 'networkSummary is "Authorized campus network"');

// Case 5B-2: Chrome on SONA-WIFI network (egress IP matches SONA CIDR)
const chromeSona = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: "115.240.192.50",
  authorizedSonaPublicIp: "115.240.192.0/22",
});
assert(chromeSona.authorized === true, "Mobile Chrome on SONA network -> AUTHORIZED via server egress CIDR");
assert(chromeSona.ssid === "Unavailable in browser", 'SSID is "Unavailable in browser" (never faked)');
assert(chromeSona.networkSummary === "Authorized campus network", 'networkSummary is "Authorized campus network"');

// Case 5B-3: Chrome on Oppo K13 / Home Wi-Fi / Mobile Data (unauthorized public IP)
const chromeUnauthorized = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: "49.36.12.80",
  authorizedMPublicIp: "203.0.113.195",
  authorizedSonaPublicIp: "115.240.192.0/22",
});
assert(chromeUnauthorized.authorized === false, "Mobile Chrome on unauthorized IP (Oppo K13 / Mobile Data) -> FAILED");
assert(chromeUnauthorized.ssid === "Unavailable in browser", 'SSID is "Unavailable in browser"');
assert(chromeUnauthorized.networkSummary === "Unauthorized Wi-Fi network", 'networkSummary is "Unauthorized Wi-Fi network"');

// Case 5B-4: Chrome on general campus egress pool
const chromeCampus = verifyCampusWifi({
  ssid: "Unavailable",
  state: "connected",
  clientPublicIp: "10.0.0.1",
  authorizedCampusIp: "10.0.0.0/8",
});
assert(chromeCampus.authorized === true, "Mobile Chrome on campus IP pool -> AUTHORIZED");
assert(chromeCampus.networkSummary === "Authorized campus network", 'networkSummary is "Authorized campus network"');

// =================================================================
// 6. ANDROID NATIVE BRIDGE BEHAVIOR TESTS (PHASE 13 SPECIFICATION)
// =================================================================
console.log("\n--- 6. ANDROID NATIVE BRIDGE BEHAVIOR TESTS ---");

// Helper to simulate native bridge evaluation in React hook
function processNativeBridgePayload(payload) {
  if (payload.transport === "cellular") {
    return { authorized: false, ssid: "Mobile Data", reason: "CELLULAR_DATA" };
  }
  if (payload.transport === "none" || !payload.connected) {
    return { authorized: false, ssid: "None", reason: "DISCONNECTED" };
  }
  if (payload.permissionGranted === false) {
    return { authorized: false, ssid: "Unavailable", reason: "PERMISSION_DENIED" };
  }
  if (payload.locationEnabled === false) {
    return { authorized: false, ssid: "Unavailable", reason: "LOCATION_SERVICES_DISABLED" };
  }
  if (!payload.ssid || payload.ssid === "SSID_UNAVAILABLE" || payload.ssid === "<unknown ssid>") {
    return { authorized: false, ssid: "Unavailable", reason: "SSID_UNAVAILABLE" };
  }
  const verification = verifyCampusWifi({ ssid: payload.ssid, state: "connected" });
  return {
    authorized: verification.authorized,
    ssid: verification.ssid,
    reason: verification.reason,
  };
}

// 6A. Android connected to M => real SSID returned as M => AUTHORIZED
const bridgeM = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "M",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeM.authorized === true, "Android connected to M => real SSID returned as M => AUTHORIZED");
assert(bridgeM.ssid === "M", 'bridgeM SSID is "M"');

// 6B. Android connected to SONA-WIFI => real SSID returned as SONA-WIFI => AUTHORIZED
const bridgeSona = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "SONA-WIFI",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeSona.authorized === true, "Android connected to SONA-WIFI => real SSID returned as SONA-WIFI => AUTHORIZED");
assert(bridgeSona.ssid === "SONA-WIFI", 'bridgeSona SSID is "SONA-WIFI"');

// 6C. Android connected to another Wi-Fi ("Oppo K13") => real SSID returned => UNAUTHORIZED
const bridgeOppo = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "Oppo K13",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeOppo.authorized === false, "Android connected to another Wi-Fi (Oppo K13) => real SSID returned => UNAUTHORIZED");
assert(bridgeOppo.ssid === "Oppo K13", 'bridgeOppo SSID is "Oppo K13"');

// 6D. Android on mobile data => UNAUTHORIZED
const bridgeCellular = processNativeBridgePayload({
  connected: false,
  transport: "cellular",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeCellular.authorized === false, "Android on mobile data => UNAUTHORIZED");
assert(bridgeCellular.reason === "CELLULAR_DATA", 'bridgeCellular reason is "CELLULAR_DATA"');

// 6E. Android with Wi-Fi permission denied => UNAUTHORIZED
const bridgePermDenied = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: null,
  permissionGranted: false,
  locationEnabled: true,
});
assert(bridgePermDenied.authorized === false, "Android with Wi-Fi permission denied => UNAUTHORIZED");
assert(bridgePermDenied.reason === "PERMISSION_DENIED", 'bridgePermDenied reason is "PERMISSION_DENIED"');

// 6F. Android with no Wi-Fi => UNAUTHORIZED
const bridgeNoWifi = processNativeBridgePayload({
  connected: false,
  transport: "none",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeNoWifi.authorized === false, "Android with no Wi-Fi => UNAUTHORIZED");
assert(bridgeNoWifi.reason === "DISCONNECTED", 'bridgeNoWifi reason is "DISCONNECTED"');

// 6G. Android SSID unavailable => UNAUTHORIZED
const bridgeUnavailable = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeUnavailable.authorized === false, "Android SSID unavailable => UNAUTHORIZED");
assert(bridgeUnavailable.reason === "SSID_UNAVAILABLE", 'bridgeUnavailable reason is "SSID_UNAVAILABLE"');

// =================================================================
// 7. ATTENDANCE REGISTRATION GATING TESTS
// =================================================================
console.log("\n--- 7. ATTENDANCE REGISTRATION GATING TESTS ---");

function evaluateAttendanceRegistration(wifiResult, gpsInsideGeofence, faceAuthenticated) {
  const canMarkAttendance = wifiResult.authorized && gpsInsideGeofence && faceAuthenticated;
  return {
    canMarkAttendance,
    blockedReason: !wifiResult.authorized
      ? "BLOCKED_WIFI"
      : !gpsInsideGeofence
        ? "BLOCKED_GPS"
        : !faceAuthenticated
          ? "BLOCKED_FACE"
          : null,
  };
}

const gateOppo = evaluateAttendanceRegistration(oppo, true, true);
assert(gateOppo.canMarkAttendance === false, "Attendance blocked when Wi-Fi fails (Oppo K13)");
assert(gateOppo.blockedReason === "BLOCKED_WIFI", "Blocked reason is BLOCKED_WIFI");

const gateUnavailable = evaluateAttendanceRegistration(unavailableSsid, true, true);
assert(gateUnavailable.canMarkAttendance === false, "Attendance blocked when SSID is Unavailable");
assert(gateUnavailable.blockedReason === "BLOCKED_WIFI", "Blocked reason is BLOCKED_WIFI");

const gateM = evaluateAttendanceRegistration(mUpper, true, true);
assert(gateM.canMarkAttendance === true, "Attendance registration allowed when M + GPS + Face pass");

const gateSona = evaluateAttendanceRegistration(sonaWifiUpper, true, true);
assert(gateSona.canMarkAttendance === true, "Attendance registration allowed when SONA-WIFI + GPS + Face pass");

// =================================================================
// TEST SUMMARY
// =================================================================
console.log("\n=================================================================");
console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
