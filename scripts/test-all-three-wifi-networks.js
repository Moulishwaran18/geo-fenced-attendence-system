import {
  verifyCampusWifi,
  isSsidAuthorized,
} from "../src/lib/wifi-config.ts";

console.log("=================================================================");
console.log("   CAMPUSATTEND SSID-ONLY WI-FI AUTHENTICATION TEST SUITE         ");
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
// 1. CONDITION 1 — M NETWORK (EXACT MATCH "m")
// =================================================================
console.log("--- 1. CONDITION 1 — M NETWORK TESTS ---");

const mUpper = verifyCampusWifi({ ssid: "M", state: "connected" });
assert(mUpper.authorized === true, '"M" → PASS (authorized === true)');
assert(mUpper.networkSummary === "Authorized campus Wi-Fi", '"M" networkSummary === "Authorized campus Wi-Fi"');

const mLower = verifyCampusWifi({ ssid: "m", state: "connected" });
assert(mLower.authorized === true, '"m" → PASS (authorized === true)');

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
// 5. VERIFY PUBLIC IP CHANGES DO NOT AFFECT THE RESULT
// =================================================================
console.log("\n--- 5. PUBLIC IP INDEPENDENCE TESTS ---");

// Valid SSID with various different public IPs
const ip1 = verifyCampusWifi({ ssid: "M", state: "connected", clientPublicIp: "103.21.244.2" });
assert(ip1.authorized === true, '"M" is AUTHORIZED with Public IP 103.21.244.2');

const ip2 = verifyCampusWifi({ ssid: "M", state: "connected", clientPublicIp: "49.36.12.80" });
assert(ip2.authorized === true, '"M" is AUTHORIZED with Public IP 49.36.12.80 (changed IP has no effect)');

const ip3 = verifyCampusWifi({ ssid: "M", state: "connected", clientPublicIp: "203.0.113.195" });
assert(ip3.authorized === true, '"M" is AUTHORIZED with Public IP 203.0.113.195');

// Invalid SSID with various public IPs (even previously whitelisted IP)
const ipInvalid1 = verifyCampusWifi({ ssid: "Oppo K13", state: "connected", clientPublicIp: "203.0.113.195" });
assert(ipInvalid1.authorized === false, '"Oppo K13" remains UNAUTHORIZED regardless of Public IP 203.0.113.195');

const ipInvalid2 = verifyCampusWifi({ ssid: "Unavailable", state: "connected", clientPublicIp: "203.0.113.195" });
assert(ipInvalid2.authorized === false, '"Unavailable" SSID remains UNAUTHORIZED regardless of Public IP 203.0.113.195');

// =================================================================
// 6. ATTENDANCE VERIFICATION GATING ORDER
// 1. Wi-Fi SSID authorization
// 2. GPS polygon geofence
// 3. Face recognition / liveness
// 4. Attendance registration
// If Wi-Fi fails: GPS and face diagnostics visible, but attendance registration BLOCKED
// =================================================================
console.log("\n--- 6. ATTENDANCE REGISTRATION GATING TESTS ---");

function evaluateAttendanceRegistration(wifiResult, gpsInsideGeofence, faceAuthenticated) {
  // Pure 3-factor gate:
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

// Case A: Wi-Fi fails ("Oppo K13"), GPS is inside, Face is verified
const gateOppo = evaluateAttendanceRegistration(oppo, true, true);
assert(gateOppo.canMarkAttendance === false, "Attendance blocked when Wi-Fi fails (Oppo K13)");
assert(gateOppo.blockedReason === "BLOCKED_WIFI", "Blocked reason is BLOCKED_WIFI");

// Case B: Wi-Fi fails (Unavailable), GPS is inside, Face is verified
const gateUnavailable = evaluateAttendanceRegistration(unavailableSsid, true, true);
assert(gateUnavailable.canMarkAttendance === false, "Attendance blocked when SSID is Unavailable");
assert(gateUnavailable.blockedReason === "BLOCKED_WIFI", "Blocked reason is BLOCKED_WIFI");

// Case C: Wi-Fi passes ("M"), GPS inside, Face verified -> ALLOWED
const gateM = evaluateAttendanceRegistration(mUpper, true, true);
assert(gateM.canMarkAttendance === true, "Attendance registration allowed when M + GPS + Face pass");

// Case D: Wi-Fi passes ("SONA-WIFI"), GPS inside, Face verified -> ALLOWED
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
