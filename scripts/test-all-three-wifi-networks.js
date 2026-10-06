import {
  verifyCampusWifi,
  isSsidAuthorized,
} from "../src/lib/wifi-config.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND PURE SSID NAME-BASED WI-FI TEST SUITE             ");
console.log("   Rule 1: normalizedSsid === 'm'                                ");
console.log("   Rule 2: normalizedSsid.includes('sona')                       ");
console.log("   Source: Android Native Wi-Fi Bridge (AndroidWifiBridge.kt)    ");
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
// 1. RULE 1 — M NETWORK (EXACT MATCH "m", case-insensitive)
// =================================================================
console.log("--- 1. RULE 1 — M NETWORK TESTS ---");

const mUpper = verifyCampusWifi({ ssid: "M", state: "connected" });
assert(mUpper.authorized === true, '"M" → PASS (authorized === true)');
assert(mUpper.ssid === "M", '"M" ssid === "M"');
assert(mUpper.networkSummary === "M", '"M" networkSummary === "M"');

const mLower = verifyCampusWifi({ ssid: "m", state: "connected" });
assert(mLower.authorized === true, '"m" → PASS (authorized === true)');
assert(mLower.ssid === "m", '"m" ssid === "m"');

const mSpaces = verifyCampusWifi({ ssid: " M ", state: "connected" });
assert(mSpaces.authorized === true, '" M " → PASS (authorized === true)');
assert(mSpaces.ssid === "M", '" M " trimmed to "M"');

const mLeadingSpace = verifyCampusWifi({ ssid: " M", state: "connected" });
assert(mLeadingSpace.authorized === true, '" M" (leading space) → PASS');

const mTrailingSpace = verifyCampusWifi({ ssid: "m ", state: "connected" });
assert(mTrailingSpace.authorized === true, '"m " (trailing space) → PASS');

// Exact match rejections
const mWifi = verifyCampusWifi({ ssid: "M-WIFI", state: "connected" });
assert(mWifi.authorized === false, '"M-WIFI" → FAIL (authorized === false)');

const my = verifyCampusWifi({ ssid: "MY", state: "connected" });
assert(my.authorized === false, '"MY" → FAIL (authorized === false)');

const mm = verifyCampusWifi({ ssid: "MM", state: "connected" });
assert(mm.authorized === false, '"MM" → FAIL (authorized === false)');

const myM = verifyCampusWifi({ ssid: "MY-M", state: "connected" });
assert(myM.authorized === false, '"MY-M" → FAIL (authorized === false)');

const myWifi = verifyCampusWifi({ ssid: "MyWiFi", state: "connected" });
assert(myWifi.authorized === false, '"MyWiFi" → FAIL (authorized === false)');

const campusM = verifyCampusWifi({ ssid: "Campus-M", state: "connected" });
assert(campusM.authorized === false, '"Campus-M" → FAIL (authorized === false)');

// Helper function verification for Rule 1
assert(isSsidAuthorized("M") === true, 'isSsidAuthorized("M") === true');
assert(isSsidAuthorized("m") === true, 'isSsidAuthorized("m") === true');
assert(isSsidAuthorized(" M ") === true, 'isSsidAuthorized(" M ") === true');
assert(isSsidAuthorized(" M") === true, 'isSsidAuthorized(" M") === true');
assert(isSsidAuthorized("m ") === true, 'isSsidAuthorized("m ") === true');
assert(isSsidAuthorized("M-WIFI") === false, 'isSsidAuthorized("M-WIFI") === false');
assert(isSsidAuthorized("MY") === false, 'isSsidAuthorized("MY") === false');
assert(isSsidAuthorized("MM") === false, 'isSsidAuthorized("MM") === false');
assert(isSsidAuthorized("MY-M") === false, 'isSsidAuthorized("MY-M") === false');
assert(isSsidAuthorized("MyWiFi") === false, 'isSsidAuthorized("MyWiFi") === false');
assert(isSsidAuthorized("Campus-M") === false, 'isSsidAuthorized("Campus-M") === false');

// =================================================================
// 2. RULE 2 — SONA NETWORK (CONTAINS "sona", case-insensitive)
// =================================================================
console.log("\n--- 2. RULE 2 — SONA NETWORK TESTS ---");

const sonaUpper = verifyCampusWifi({ ssid: "SONA", state: "connected" });
assert(sonaUpper.authorized === true, '"SONA" → PASS');
assert(sonaUpper.networkSummary === "SONA", '"SONA" networkSummary === "SONA"');

const sonaLower = verifyCampusWifi({ ssid: "sona", state: "connected" });
assert(sonaLower.authorized === true, '"sona" → PASS');

const sonaWifiUpper = verifyCampusWifi({ ssid: "SONA-WIFI", state: "connected" });
assert(sonaWifiUpper.authorized === true, '"SONA-WIFI" → PASS');
assert(sonaWifiUpper.networkSummary === "SONA-WIFI", '"SONA-WIFI" networkSummary === "SONA-WIFI"');

const sonaWifiMixed = verifyCampusWifi({ ssid: "Sona-Wifi", state: "connected" });
assert(sonaWifiMixed.authorized === true, '"Sona-Wifi" → PASS');

const sonaWifiSpaced = verifyCampusWifi({ ssid: "sona wifi", state: "connected" });
assert(sonaWifiSpaced.authorized === true, '"sona wifi" → PASS');

const sonaCampus = verifyCampusWifi({ ssid: "sona campus", state: "connected" });
assert(sonaCampus.authorized === true, '"sona campus" → PASS');

const mySonaNet = verifyCampusWifi({ ssid: "MY-SONA-NETWORK", state: "connected" });
assert(mySonaNet.authorized === true, '"MY-SONA-NETWORK" → PASS');

// Helper function verification for Rule 2
assert(isSsidAuthorized("SONA") === true, 'isSsidAuthorized("SONA") === true');
assert(isSsidAuthorized("sona") === true, 'isSsidAuthorized("sona") === true');
assert(isSsidAuthorized("SONA-WIFI") === true, 'isSsidAuthorized("SONA-WIFI") === true');
assert(isSsidAuthorized("Sona-Wifi") === true, 'isSsidAuthorized("Sona-Wifi") === true');
assert(isSsidAuthorized("sona wifi") === true, 'isSsidAuthorized("sona wifi") === true');
assert(isSsidAuthorized("sona campus") === true, 'isSsidAuthorized("sona campus") === true');
assert(isSsidAuthorized("MY-SONA-NETWORK") === true, 'isSsidAuthorized("MY-SONA-NETWORK") === true');

// =================================================================
// 3. UNAUTHORIZED NETWORKS (ALL FAIL)
// =================================================================
console.log("\n--- 3. UNAUTHORIZED NETWORKS TESTS ---");

const oppo = verifyCampusWifi({ ssid: "Oppo K13", state: "connected" });
assert(oppo.authorized === false, '"Oppo K13" → FAIL');
assert(oppo.networkSummary === "Oppo K13", '"Oppo K13" networkSummary === "Oppo K13"');

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
// 4. EMPTY / UNKNOWN / UNAVAILABLE SSID (ALL FAIL, NEVER ASSUME M/SONA)
// =================================================================
console.log("\n--- 4. EMPTY / UNKNOWN / UNAVAILABLE SSID TESTS ---");

const emptyStr = verifyCampusWifi({ ssid: "", state: "connected" });
assert(emptyStr.authorized === false, '"" → FAIL');
assert(emptyStr.networkSummary === "Unable to determine Wi-Fi name", '"" networkSummary === "Unable to determine Wi-Fi name"');

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
assert(isSsidAuthorized("<unknown ssid>") === false, 'isSsidAuthorized("<unknown ssid>") === false');
assert(isSsidAuthorized("SSID_UNAVAILABLE") === false, 'isSsidAuthorized("SSID_UNAVAILABLE") === false');

// =================================================================
// 5. ANDROID NATIVE BRIDGE BEHAVIOR TESTS
// =================================================================
console.log("\n--- 5. ANDROID NATIVE BRIDGE BEHAVIOR TESTS ---");

function processNativeBridgePayload(payload) {
  if (payload.transport === "cellular") {
    return { authorized: false, ssid: "Mobile Data", networkSummary: "Mobile Data", reason: "CELLULAR_DATA" };
  }
  if (payload.transport === "none" || !payload.connected) {
    return { authorized: false, ssid: "None", networkSummary: "Unable to determine Wi-Fi name", reason: "DISCONNECTED" };
  }
  if (payload.permissionGranted === false) {
    return { authorized: false, ssid: "Unavailable", networkSummary: "Unable to determine Wi-Fi name", reason: "PERMISSION_DENIED" };
  }
  if (payload.locationEnabled === false) {
    return { authorized: false, ssid: "Unavailable", networkSummary: "Unable to determine Wi-Fi name", reason: "LOCATION_SERVICES_DISABLED" };
  }
  if (!payload.ssid || payload.ssid === "SSID_UNAVAILABLE" || payload.ssid === "<unknown ssid>") {
    return { authorized: false, ssid: "Unavailable", networkSummary: "Unable to determine Wi-Fi name", reason: "SSID_UNAVAILABLE" };
  }
  const verification = verifyCampusWifi({ ssid: payload.ssid, state: "connected" });
  return {
    authorized: verification.authorized,
    ssid: verification.ssid,
    networkSummary: verification.networkSummary,
    reason: verification.reason,
  };
}

// 5A. Android connected to M => real SSID returned as M => AUTHORIZED
const bridgeM = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "M",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeM.authorized === true, "Android native bridge → M → AUTHORIZED");
assert(bridgeM.ssid === "M", 'bridgeM SSID is "M"');
assert(bridgeM.networkSummary === "M", 'bridgeM networkSummary is "M"');

// 5B. Android connected to SONA-WIFI => real SSID returned as SONA-WIFI => AUTHORIZED
const bridgeSona = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "SONA-WIFI",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeSona.authorized === true, "Android native bridge → SONA-WIFI → AUTHORIZED");
assert(bridgeSona.ssid === "SONA-WIFI", 'bridgeSona SSID is "SONA-WIFI"');
assert(bridgeSona.networkSummary === "SONA-WIFI", 'bridgeSona networkSummary is "SONA-WIFI"');

// 5C. Android connected to another Wi-Fi ("Oppo K13") => real SSID returned => FAILED
const bridgeOppo = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: "Oppo K13",
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeOppo.authorized === false, "Android native bridge → Oppo K13 → FAILED");
assert(bridgeOppo.ssid === "Oppo K13", 'bridgeOppo SSID is "Oppo K13"');
assert(bridgeOppo.networkSummary === "Oppo K13", 'bridgeOppo networkSummary is "Oppo K13"');

// 5D. Android native bridge -> unavailable SSID => FAILED
const bridgeUnavailable = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeUnavailable.authorized === false, "Android native bridge → unavailable → FAILED");
assert(bridgeUnavailable.reason === "SSID_UNAVAILABLE", 'bridgeUnavailable reason is "SSID_UNAVAILABLE"');
assert(bridgeUnavailable.networkSummary === "Unable to determine Wi-Fi name", 'bridgeUnavailable networkSummary is "Unable to determine Wi-Fi name"');

// 5E. Android on mobile data => FAILED
const bridgeCellular = processNativeBridgePayload({
  connected: false,
  transport: "cellular",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeCellular.authorized === false, "Android native bridge on mobile data → FAILED");
assert(bridgeCellular.reason === "CELLULAR_DATA", 'bridgeCellular reason is "CELLULAR_DATA"');

// 5F. Android with Wi-Fi permission denied => FAILED
const bridgePermDenied = processNativeBridgePayload({
  connected: true,
  transport: "wifi",
  ssid: null,
  permissionGranted: false,
  locationEnabled: true,
});
assert(bridgePermDenied.authorized === false, "Android native bridge with Wi-Fi permission denied → FAILED");
assert(bridgePermDenied.reason === "PERMISSION_DENIED", 'bridgePermDenied reason is "PERMISSION_DENIED"');

// 5G. Android with no Wi-Fi => FAILED
const bridgeNoWifi = processNativeBridgePayload({
  connected: false,
  transport: "none",
  ssid: null,
  permissionGranted: true,
  locationEnabled: true,
});
assert(bridgeNoWifi.authorized === false, "Android native bridge with no Wi-Fi → FAILED");
assert(bridgeNoWifi.reason === "DISCONNECTED", 'bridgeNoWifi reason is "DISCONNECTED"');

// =================================================================
// 6. ATTENDANCE REGISTRATION GATING TESTS
// =================================================================
console.log("\n--- 6. ATTENDANCE REGISTRATION GATING TESTS ---");

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
