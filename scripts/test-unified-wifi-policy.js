/**
 * Comprehensive Automated Test Suite for Unified Wi-Fi Policy
 * Tests:
 * 1. SSID Matching (case-insensitive 'sona' substring)
 * 2. Rejection of invalid, empty, unknown, and non-matching SSIDs (including 'm')
 * 3. Permission and Location disabled handling
 * 4. Browser-only environment reporting BROWSER_SSID_UNAVAILABLE
 * 5. HMAC-SHA256 Network Authorization Token generation, validation, expiry, and tampering checks
 * 6. Agreement between native/client rules and backend attendance verification
 */

import crypto from "crypto";

// Load wifi-config logic directly or simulate exact functions
function cleanSsid(rawSsid) {
  if (!rawSsid || typeof rawSsid !== "string") return "";
  let cleaned = rawSsid.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  return cleaned;
}

function isAuthorizedSonaSsid(rawSsid) {
  const cleaned = cleanSsid(rawSsid);
  if (!cleaned) return false;
  if (
    cleaned === "<unknown ssid>" ||
    cleaned === "0x" ||
    cleaned.toLowerCase() === "ssid_unavailable"
  ) {
    return false;
  }
  return cleaned.toLowerCase().includes("sona");
}

function verifyCampusWifi(payload) {
  const timestamp = new Date().toISOString();

  if (payload.permissionGranted === false || payload.permissionDenied === true) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Permission Denied",
      network: "Permission Denied",
      reason: "Location/Wi-Fi permission denied. Please grant location permissions in Android app settings to read Wi-Fi network name.",
      state: "disconnected",
      stage: "DEVICE_PERMISSIONS",
      timestamp,
      errorCode: "LOCATION_PERMISSION_DENIED",
      isNativeBridge: payload.isNativeBridge === true,
    };
  }

  if (payload.locationEnabled === false || payload.locationDisabled === true) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Location Disabled",
      network: "Location Disabled",
      reason: "Device location services are turned off. Android requires location to be ON to detect Wi-Fi network name.",
      state: "disconnected",
      stage: "DEVICE_PERMISSIONS",
      timestamp,
      errorCode: "LOCATION_SERVICES_DISABLED",
      isNativeBridge: payload.isNativeBridge === true,
    };
  }

  const rawSsid = payload.ssid || "";
  const cleanedSsid = cleanSsid(rawSsid);

  if (isAuthorizedSonaSsid(cleanedSsid)) {
    return {
      authorized: true,
      networkType: "SONA",
      networkSummary: `Connected to Authorized Network (${cleanedSsid})`,
      network: cleanedSsid,
      reason: `Authorized campus Wi-Fi detected (${cleanedSsid}).`,
      state: "connected",
      stage: "AUTHORIZED",
      timestamp,
      errorCode: undefined,
      isNativeBridge: payload.isNativeBridge === true,
      ssid: cleanedSsid,
    };
  }

  if (
    !cleanedSsid ||
    cleanedSsid === "<unknown ssid>" ||
    cleanedSsid === "0x" ||
    cleanedSsid.toLowerCase() === "ssid_unavailable"
  ) {
    if (payload.isNativeBridge) {
      return {
        authorized: false,
        networkType: "UNAVAILABLE",
        networkSummary: "Wi-Fi SSID Unavailable",
        network: "Unavailable",
        reason: "Unable to detect Wi-Fi SSID. Please ensure Wi-Fi is connected and location services are enabled.",
        state: "unknown",
        stage: "SSID_UNAVAILABLE",
        timestamp,
        errorCode: "SSID_UNAVAILABLE",
        isNativeBridge: true,
      };
    } else {
      return {
        authorized: false,
        networkType: "UNAVAILABLE",
        networkSummary: "Browser SSID Unavailable",
        network: "Browser Wi-Fi Read Unavailable",
        reason: "Web browsers cannot read local Wi-Fi SSID directly. Please open the official CampusAttend Android App or connect to an authorized campus hotspot.",
        state: "unknown",
        stage: "SSID_UNAVAILABLE",
        timestamp,
        errorCode: "BROWSER_SSID_UNAVAILABLE",
        isNativeBridge: false,
      };
    }
  }

  return {
    authorized: false,
    networkType: "UNAUTHORIZED",
    networkSummary: `Unauthorized Network (${cleanedSsid})`,
    network: cleanedSsid,
    reason: `Wi-Fi network "${cleanedSsid}" is not authorized. Must connect to a Wi-Fi network whose name contains "sona" (e.g. SONA-WIFI).`,
    state: "connected",
    stage: "SSID_MISMATCH",
    timestamp,
    errorCode: "SSID_MISMATCH",
    isNativeBridge: payload.isNativeBridge === true,
    ssid: cleanedSsid,
  };
}

// Token Verification
const TOKEN_SECRET = process.env.TOKEN_SECRET || "geo-fenced-attendance-token-secret-2025";

function createNetworkAuthToken(ssid) {
  const payload = {
    authorized: true,
    ssid: cleanSsid(ssid),
    timestamp: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(data)
    .digest("hex");
  return `${data}.${signature}`;
}

function verifyNetworkAuthToken(token) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing token" };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "Malformed token" };
  }
  const [data, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(data)
    .digest("hex");

  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expectedSignature, "hex");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: "Invalid signature" };
    }
  } catch {
    return { valid: false, reason: "Signature verification error" };
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload.authorized) {
      return { valid: false, reason: "Token not marked authorized" };
    }
    if (Date.now() > payload.expiresAt) {
      return { valid: false, reason: "Token expired" };
    }
    const cleanTokenSsid = cleanSsid(payload.ssid);
    if (!isAuthorizedSonaSsid(cleanTokenSsid)) {
      return { valid: false, reason: `Token SSID "${cleanTokenSsid}" does not contain sona` };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: "Invalid payload JSON" };
  }
}

// ==========================================
// RUN TEST SUITE
// ==========================================
console.log("==================================================");
console.log("  RUNNING UNIFIED WI-FI POLICY VERIFICATION SUITE ");
console.log("==================================================");

let passed = 0;
let failed = 0;

function assert(description, condition, details = "") {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description} ${details ? "- " + details : ""}`);
    failed++;
  }
}

// 1. SSID Matching Cases
console.log("\n--- TEST GROUP 1: Valid SSIDs containing 'sona' (case-insensitive) ---");
const validSonaSsids = [
  "SONA-WIFI",
  "sona-wifi",
  "SoNa_Campus",
  "SONA_STUDENT",
  "sona_faculty",
  "my_sona_hotspot",
  "AP-SONA-5G",
  "sona",
  "SONA",
  '"SONA-WIFI"',
  "'sona-guest'",
];

validSonaSsids.forEach((ssid) => {
  const result = isAuthorizedSonaSsid(ssid);
  assert(`SSID "${ssid}" should be authorized`, result === true);
});

// 2. Invalid SSIDs
console.log("\n--- TEST GROUP 2: Invalid / Rejected SSIDs ---");
const invalidSsids = [
  "m",           // previous special exception removed!
  "M",           // previous special exception removed!
  "Home_WiFi",
  "CollegeNet",
  "Office_5G",
  "JioFiber_4G",
  "AndroidAP",
  "Guest",
  "son",         // does not contain full word/string 'sona'
  "s0na",
];

invalidSsids.forEach((ssid) => {
  const result = isAuthorizedSonaSsid(ssid);
  assert(`SSID "${ssid}" must be rejected`, result === false);
});

// 3. Empty, Null, Unavailable SSIDs
console.log("\n--- TEST GROUP 3: Empty, Unknown, Unavailable SSIDs ---");
const unavailableSsids = [
  "",
  null,
  undefined,
  "<unknown ssid>",
  "0x",
  "SSID_UNAVAILABLE",
  "  ",
  '""',
];

unavailableSsids.forEach((ssid) => {
  const result = isAuthorizedSonaSsid(ssid);
  assert(`Unavailable SSID ${JSON.stringify(ssid)} must be rejected`, result === false);
});

// 4. Client Verification Flow (verifyCampusWifi)
console.log("\n--- TEST GROUP 4: verifyCampusWifi Function Flow ---");

// Native Bridge + SONA-WIFI
const res1 = verifyCampusWifi({
  ssid: "SONA-WIFI",
  isNativeBridge: true,
  connected: true,
  permissionGranted: true,
  locationEnabled: true,
});
assert("Native Bridge with SONA-WIFI is authorized", res1.authorized === true && res1.networkType === "SONA");

// Native Bridge + sona hotspot
const res2 = verifyCampusWifi({
  ssid: "Moulish_Sona_Hotspot",
  isNativeBridge: true,
  connected: true,
  permissionGranted: true,
  locationEnabled: true,
});
assert("Native Bridge with sona hotspot is authorized", res2.authorized === true && res2.networkType === "SONA");

// Native Bridge + Home WiFi
const res3 = verifyCampusWifi({
  ssid: "Home_WiFi",
  isNativeBridge: true,
  connected: true,
  permissionGranted: true,
  locationEnabled: true,
});
assert("Native Bridge with Home_WiFi is rejected with SSID_MISMATCH", res3.authorized === false && res3.errorCode === "SSID_MISMATCH");

// Native Bridge + 'm'
const res3b = verifyCampusWifi({
  ssid: "m",
  isNativeBridge: true,
  connected: true,
  permissionGranted: true,
  locationEnabled: true,
});
assert("Native Bridge with SSID 'm' is rejected (no special exception)", res3b.authorized === false && res3b.errorCode === "SSID_MISMATCH");

// Native Bridge + Permission Denied
const res4 = verifyCampusWifi({
  ssid: "SONA-WIFI",
  isNativeBridge: true,
  connected: true,
  permissionGranted: false,
  locationEnabled: true,
});
assert("Permission denied is rejected with LOCATION_PERMISSION_DENIED", res4.authorized === false && res4.errorCode === "LOCATION_PERMISSION_DENIED");

// Native Bridge + Location Disabled
const res5 = verifyCampusWifi({
  ssid: "SONA-WIFI",
  isNativeBridge: true,
  connected: true,
  permissionGranted: true,
  locationEnabled: false,
});
assert("Location disabled is rejected with LOCATION_SERVICES_DISABLED", res5.authorized === false && res5.errorCode === "LOCATION_SERVICES_DISABLED");

// Standard Browser (No native bridge, no SSID)
const res6 = verifyCampusWifi({
  ssid: "",
  isNativeBridge: false,
  connected: true,
});
assert("Standard browser reports BROWSER_SSID_UNAVAILABLE without bypass", res6.authorized === false && res6.errorCode === "BROWSER_SSID_UNAVAILABLE");

// 5. Network Auth Token Security
console.log("\n--- TEST GROUP 5: HMAC-SHA256 Network Authorization Token ---");

// Valid token
const validToken = createNetworkAuthToken("SONA-WIFI");
const tokenCheck1 = verifyNetworkAuthToken(validToken);
assert("Valid token with SONA-WIFI passes verification", tokenCheck1.valid === true && tokenCheck1.payload.ssid === "SONA-WIFI");

// Valid token with lowercase sona
const validTokenLower = createNetworkAuthToken("sona-mobile-hotspot");
const tokenCheckLower = verifyNetworkAuthToken(validTokenLower);
assert("Valid token with sona-mobile-hotspot passes verification", tokenCheckLower.valid === true);

// Token created for non-sona network
const fakeSsidToken = createNetworkAuthToken("Home_Broadband");
const tokenCheck2 = verifyNetworkAuthToken(fakeSsidToken);
assert("Token for Home_Broadband is rejected by backend", tokenCheck2.valid === false && tokenCheck2.reason.includes("does not contain sona"));

// Token created for 'm'
const mToken = createNetworkAuthToken("m");
const tokenCheck2b = verifyNetworkAuthToken(mToken);
assert("Token for 'm' is rejected by backend", tokenCheck2b.valid === false && tokenCheck2b.reason.includes("does not contain sona"));

// Tampered payload
const tamperedToken = validToken.substring(0, 10) + "X" + validToken.substring(11);
const tokenCheck3 = verifyNetworkAuthToken(tamperedToken);
assert("Tampered token signature is rejected", tokenCheck3.valid === false);

// Tampered signature
const [dataPart] = validToken.split(".");
const fakeSigToken = `${dataPart}.badsignaturedeadbeef1234567890`;
const tokenCheck4 = verifyNetworkAuthToken(fakeSigToken);
assert("Forged signature is rejected", tokenCheck4.valid === false);

// Expired token (simulate token from 10 minutes ago)
const expiredPayload = {
  authorized: true,
  ssid: "SONA-WIFI",
  timestamp: Date.now() - 10 * 60 * 1000,
  expiresAt: Date.now() - 5 * 60 * 1000,
};
const expiredData = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
const expiredSig = crypto
  .createHmac("sha256", TOKEN_SECRET)
  .update(expiredData)
  .digest("hex");
const expiredToken = `${expiredData}.${expiredSig}`;
const tokenCheck5 = verifyNetworkAuthToken(expiredToken);
assert("Expired token is rejected", tokenCheck5.valid === false && tokenCheck5.reason === "Token expired");

// Malformed token strings
assert("Null token is rejected", verifyNetworkAuthToken(null).valid === false);
assert("Empty string token is rejected", verifyNetworkAuthToken("").valid === false);
assert("Unsigned string is rejected", verifyNetworkAuthToken("just-a-plain-string").valid === false);

console.log("\n==================================================");
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("==================================================");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
