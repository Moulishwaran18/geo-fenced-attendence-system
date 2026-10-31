/**
 * Comprehensive Automated Test Suite: Campus Wi-Fi BSSID Verification
 *
 * Verifies all 6 required test cases specified in the prompt:
 * 1. Exact BSSID match: B0:1F:8C:29:6B:30 -> PASS
 * 2. Different BSSID -> FAIL (with exact message: "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.")
 * 3. BSSID unavailable -> FAIL (clear failure message, never assumes success)
 * 4. Permission denied -> FAIL
 * 5. Wi-Fi disconnected -> FAIL
 * 6. BSSID with lowercase letters -> normalize to uppercase and compare correctly -> PASS
 *
 * Additional Zero-Trust checks:
 * 7. Redacted MAC address (02:00:00:00:00:00 / 00:00:00:00:00:00) -> FAIL
 * 8. Server-side /api/wifi-status endpoint verification
 * 9. Server-side /api/attendance Factor 1 gating (rejects forged wifiVerified: true)
 */

import crypto from "node:crypto";
import {
  REGISTERED_CAMPUS_BSSID,
  CAMPUS_WIFI_FAILURE_MESSAGE,
  normalizeBssid,
  isAuthorizedCampusBssid,
  verifyCampusWifi,
} from "../src/lib/wifi-config";
import wifiStatusHandler, { createNetworkAuthToken, verifyNetworkAuthToken } from "../api/wifi-status";
import attendanceHandler from "../api/attendance";

class MockResponse {
  public statusCode: number = 200;
  public headers: Record<string, string> = {};
  public body: any = null;

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(data: any) {
    this.body = data;
    return this;
  }

  end(str?: string) {
    if (str && !this.body) {
      try {
        this.body = JSON.parse(str);
      } catch {
        this.body = str;
      }
    }
    return this;
  }
}

function createTestStaffToken(staffCode = "SCT-001") {
  const secret =
    process.env["CAMPUS_AUTH_SECRET"] ||
    process.env["STAFF_AUTH_SECRET"] ||
    process.env["CAMPUS_ADMIN_SECRET"] ||
    "campusattend-staff-auth-session-sec-key-2026";
  const payload = {
    staffId: staffCode,
    sub: staffCode,
    role: "staff",
    expiresAt: Date.now() + 3600000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

async function runTests() {
  console.log("================================================================================");
  console.log("       CAMPUS WI-FI BSSID VERIFICATION AUTOMATED TEST SUITE                     ");
  console.log(`       Target Access Point BSSID: ${REGISTERED_CAMPUS_BSSID}                     `);
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(testName: string, condition: boolean, extraInfo?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${extraInfo || "Assertion failed"}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Suite 1: Pure Functions & Normalization Tests
  // ---------------------------------------------------------------------------
  console.log("--- Suite 1: Pure Functions & BSSID Normalization ---");

  // Test 1: Normalization of lowercase
  const norm1 = normalizeBssid("b0:1f:8c:29:6b:30");
  assert("Case Normalization: converts lowercase to uppercase", norm1 === "B0:1F:8C:29:6B:30", `Got ${norm1}`);

  // Test 2: Normalization with hyphens
  const norm2 = normalizeBssid("B0-1F-8C-29-6B-30");
  assert("Delimiter Normalization: replaces hyphens with colons", norm2 === "B0:1F:8C:29:6B:30", `Got ${norm2}`);

  // Test 3: Normalization with outer quotes
  const norm3 = normalizeBssid('"b0:1f:8c:29:6b:30"');
  assert("Quote Stripping: strips outer quotation marks", norm3 === "B0:1F:8C:29:6B:30", `Got ${norm3}`);

  // Test 4: Exact BSSID Match
  assert("isAuthorizedCampusBssid: Exact match B0:1F:8C:29:6B:30 -> true", isAuthorizedCampusBssid("B0:1F:8C:29:6B:30"));

  // Test 5: Lowercase Match
  assert("isAuthorizedCampusBssid: Lowercase match b0:1f:8c:29:6b:30 -> true", isAuthorizedCampusBssid("b0:1f:8c:29:6b:30"));

  // Test 6: Different BSSID -> false
  assert("isAuthorizedCampusBssid: Different BSSID 00:11:22:33:44:55 -> false", !isAuthorizedCampusBssid("00:11:22:33:44:55"));

  // Test 7: Redacted MAC 02:00:00:00:00:00 -> false
  assert("isAuthorizedCampusBssid: Android 12+ Redacted MAC 02:00:00:00:00:00 -> false", !isAuthorizedCampusBssid("02:00:00:00:00:00"));

  // Test 8: Dummy Zero MAC 00:00:00:00:00:00 -> false
  assert("isAuthorizedCampusBssid: Dummy Zero MAC 00:00:00:00:00:00 -> false", !isAuthorizedCampusBssid("00:00:00:00:00:00"));

  // Test 9: Unavailable strings -> false
  assert("isAuthorizedCampusBssid: BSSID_UNAVAILABLE -> false", !isAuthorizedCampusBssid("BSSID_UNAVAILABLE"));
  assert("isAuthorizedCampusBssid: null/undefined/empty -> false", !isAuthorizedCampusBssid(null) && !isAuthorizedCampusBssid(undefined) && !isAuthorizedCampusBssid(""));

  // ---------------------------------------------------------------------------
  // Suite 2: Client-side Engine verifyCampusWifi() Tests
  // ---------------------------------------------------------------------------
  console.log("\n--- Suite 2: verifyCampusWifi() Rule Engine ---");

  // Case 1: Exact BSSID match -> PASS
  const case1 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    ssid: "SONA-WIFI",
    bssid: "B0:1F:8C:29:6B:30",
  });
  assert("Case 1: Exact BSSID match (B0:1F:8C:29:6B:30) -> PASS", case1.authorized === true && case1.networkType === "SONA");

  // Case 2: Different BSSID -> FAIL with exact message
  const case2 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    ssid: "HomeNetwork",
    bssid: "AA:BB:CC:DD:EE:FF",
  });
  assert(
    "Case 2: Different BSSID (AA:BB:CC:DD:EE:FF) -> FAIL with exact campus failure message",
    case2.authorized === false && case2.reason === CAMPUS_WIFI_FAILURE_MESSAGE && case2.errorCode === "UNAUTHORIZED_BSSID",
    `Got reason: "${case2.reason}"`
  );

  // Case 3: BSSID unavailable -> FAIL
  const case3 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    ssid: "SONA-WIFI",
    bssid: null,
  });
  assert(
    "Case 3: BSSID unavailable (null) -> FAIL with BSSID_UNAVAILABLE",
    case3.authorized === false && case3.errorCode === "BSSID_UNAVAILABLE"
  );

  // Case 4: Redacted MAC 02:00:00:00:00:00 -> FAIL
  const case4 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    ssid: "SONA-WIFI",
    bssid: "02:00:00:00:00:00",
  });
  assert(
    "Case 4: Redacted MAC (02:00:00:00:00:00) -> FAIL with BSSID_UNAVAILABLE",
    case4.authorized === false && case4.errorCode === "BSSID_UNAVAILABLE"
  );

  // Case 5: Permission denied -> FAIL
  const case5 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    permissionGranted: false,
    permissionDenied: true,
    bssid: "B0:1F:8C:29:6B:30",
  });
  assert(
    "Case 5: Permission denied -> FAIL with PERMISSION_DENIED",
    case5.authorized === false && case5.errorCode === "PERMISSION_DENIED"
  );

  // Case 6: Wi-Fi disconnected -> FAIL
  const case6 = verifyCampusWifi({
    transport: "none",
    connected: false,
    state: "disconnected",
    bssid: "B0:1F:8C:29:6B:30",
  });
  assert(
    "Case 6: Wi-Fi disconnected -> FAIL with DISCONNECTED",
    case6.authorized === false && case6.errorCode === "DISCONNECTED"
  );

  // Case 7: Lowercase letters BSSID -> PASS
  const case7 = verifyCampusWifi({
    transport: "wifi",
    connected: true,
    ssid: "SONA-WIFI",
    bssid: "b0:1f:8c:29:6b:30",
  });
  assert(
    "Case 7: BSSID with lowercase letters (b0:1f:8c:29:6b:30) -> PASS",
    case7.authorized === true && case7.bssid === "B0:1F:8C:29:6B:30"
  );

  // ---------------------------------------------------------------------------
  // Suite 3: Serverless /api/wifi-status Native Bridge Integration
  // ---------------------------------------------------------------------------
  console.log("\n--- Suite 3: Serverless /api/wifi-status API ---");

  // API 1: Exact Match on Native Bridge
  const reqApi1 = {
    method: "POST",
    body: {
      isNativeBridge: true,
      transport: "wifi",
      connected: true,
      ssid: "SONA-WIFI",
      bssid: "b0:1f:8c:29:6b:30", // lowercase to test normalization
    },
  };
  const resApi1 = new MockResponse();
  await wifiStatusHandler(reqApi1, resApi1);
  assert(
    "/api/wifi-status: Exact match mints valid networkAuthToken and authorizes",
    resApi1.body.authorized === true &&
      resApi1.body.bssid === "B0:1F:8C:29:6B:30" &&
      typeof resApi1.body.networkAuthToken === "string" &&
      resApi1.body.networkAuthToken.length > 20
  );

  // Token Cryptographic Binding Check
  const tokenVerify = verifyNetworkAuthToken(resApi1.body.networkAuthToken);
  assert(
    "HMAC-SHA256 Token contains validated campus BSSID payload",
    tokenVerify.valid === true && tokenVerify.payload?.bssid === "B0:1F:8C:29:6B:30"
  );

  // API 2: Different BSSID on Native Bridge
  const reqApi2 = {
    method: "POST",
    body: {
      isNativeBridge: true,
      transport: "wifi",
      connected: true,
      ssid: "SONA-WIFI",
      bssid: "11:22:33:44:55:66",
    },
  };
  const resApi2 = new MockResponse();
  await wifiStatusHandler(reqApi2, resApi2);
  assert(
    "/api/wifi-status: Different BSSID returns authorized: false and CAMPUS_WIFI_FAILURE_MESSAGE",
    resApi2.body.authorized === false &&
      resApi2.body.errorCode === "UNAUTHORIZED_BSSID" &&
      resApi2.body.reason === CAMPUS_WIFI_FAILURE_MESSAGE
  );

  // API 3: Redacted MAC on Native Bridge
  const reqApi3 = {
    method: "POST",
    body: {
      isNativeBridge: true,
      transport: "wifi",
      connected: true,
      ssid: "SONA-WIFI",
      bssid: "02:00:00:00:00:00",
    },
  };
  const resApi3 = new MockResponse();
  await wifiStatusHandler(reqApi3, resApi3);
  assert(
    "/api/wifi-status: Redacted MAC 02:00:00:00:00:00 returns BSSID_UNAVAILABLE",
    resApi3.body.authorized === false && resApi3.body.errorCode === "BSSID_UNAVAILABLE"
  );

  // ---------------------------------------------------------------------------
  // Suite 4: Serverless /api/attendance Factor 1 Gating & Zero Client Trust
  // ---------------------------------------------------------------------------
  console.log("\n--- Suite 4: Authoritative /api/attendance Factor 1 Gatekeeper ---");

  const validStaffToken = createTestStaffToken("SCT-001");

  // Attendance 1: Attacker sends wifiVerified: true with NO valid BSSID or Token
  const reqAtt1 = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${validStaffToken}`,
    },
    body: {
      staffCode: "SCT-001",
      token: validStaffToken,
      wifiVerified: true, // Spoofed client claim!
      latitude: 11.6802,
      longitude: 78.1216,
      accuracy: 10,
    },
  };
  const resAtt1 = new MockResponse();
  await attendanceHandler(reqAtt1, resAtt1);
  assert(
    "/api/attendance: Rejects spoofed wifiVerified: true without valid BSSID / token (403)",
    resAtt1.statusCode === 403 &&
      resAtt1.body?.success === false &&
      resAtt1.body?.message === CAMPUS_WIFI_FAILURE_MESSAGE,
    `Status: ${resAtt1.statusCode}, msg: ${resAtt1.body?.message}`
  );

  // Attendance 2: Attacker sends unauthorized BSSID
  const reqAtt2 = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${validStaffToken}`,
    },
    body: {
      staffCode: "SCT-001",
      token: validStaffToken,
      bssid: "99:88:77:66:55:44",
      latitude: 11.6802,
      longitude: 78.1216,
      accuracy: 10,
    },
  };
  const resAtt2 = new MockResponse();
  await attendanceHandler(reqAtt2, resAtt2);
  assert(
    "/api/attendance: Rejects unauthorized BSSID with 403 and CAMPUS_WIFI_FAILURE_MESSAGE",
    resAtt2.statusCode === 403 &&
      resAtt2.body?.error === "WIFI_BSSID_MISMATCH" &&
      resAtt2.body?.message === CAMPUS_WIFI_FAILURE_MESSAGE
  );

  // Attendance 3: Attacker sends unavailable/redacted BSSID
  const reqAtt3 = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${validStaffToken}`,
    },
    body: {
      staffCode: "SCT-001",
      token: validStaffToken,
      bssid: "02:00:00:00:00:00",
      latitude: 11.6802,
      longitude: 78.1216,
      accuracy: 10,
    },
  };
  const resAtt3 = new MockResponse();
  await attendanceHandler(reqAtt3, resAtt3);
  assert(
    "/api/attendance: Rejects redacted BSSID 02:00:00:00:00:00 with 403 WIFI_BSSID_UNAVAILABLE",
    resAtt3.statusCode === 403 && resAtt3.body?.error === "WIFI_BSSID_UNAVAILABLE"
  );

  // Attendance 4: Legitimate request with signed networkAuthToken (matching BSSID)
  // Factor 1 should PASS (it proceeds to Factor 2 GPS check)
  const validToken = createNetworkAuthToken("SONA-WIFI", "B0:1F:8C:29:6B:30");
  const reqAtt4 = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${validStaffToken}`,
      "x-network-auth-token": validToken,
      "x-wifi-bssid": "b0:1f:8c:29:6b:30",
    },
    body: {
      staffCode: "SCT-001",
      token: validStaffToken,
      networkAuthToken: validToken,
      bssid: "B0:1F:8C:29:6B:30",
      // Provide coordinates outside geofence so it rejects at Factor 2 (proving Factor 1 passed!)
      latitude: 0.0,
      longitude: 0.0,
      accuracy: 10,
    },
  };
  const resAtt4 = new MockResponse();
  await attendanceHandler(reqAtt4, resAtt4);
  assert(
    "/api/attendance: With valid campus BSSID & token, Factor 1 passes (proceeds to Factor 2 GPS polygon)",
    resAtt4.statusCode === 403 && (resAtt4.body?.error === "GPS_OUTSIDE_CAMPUS" || resAtt4.body?.error === "GEOFENCE_OUTSIDE"),
    `Expected GEOFENCE_OUTSIDE (proving Factor 1 passed), got: ${resAtt4.body?.error} (status ${resAtt4.statusCode})`
  );

  console.log("\n================================================================================");
  console.log(`       TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner encountered unhandled error:", err);
  process.exit(1);
});
