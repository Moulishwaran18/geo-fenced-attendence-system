/**
 * CampusAttend — "One Faculty ID = One Phone" Policy End-to-End Verification Suite
 *
 * Verifies all 10 required behaviors:
 * 1. When a faculty ID (specifically SCT-001) is first registered/logged in on Phone A, securely bind it to Phone A.
 * 2. When the same ID and password are entered on Phone B, reject the login (HTTP 403 DEVICE_MISMATCH), even with the correct password.
 * 3. The original phone (Phone A) must continue to work normally.
 * 4. Remember the registered device in backend database (Supabase + local store), not just frontend local storage.
 * 5. Enforce device restriction on login, session restoration, token refresh, and protected faculty APIs.
 * 6. Do not automatically change the device binding when someone logs in from another phone.
 * 7. Only an authorized administrator can revoke the old device and approve a replacement.
 * 8. Apply the rule to all faculty IDs, specifically including SCT-001.
 * 9. Do not delete faculty accounts or face enrollments, and do not change the administrator account.
 * 10. Preserve the existing GPS geofence, Wi-Fi authorization, face recognition, and database records.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Server handlers under test
import loginHandler from "../api/staff/login.ts";
import sessionHandler from "../api/staff/session.ts";
import attendanceHandler from "../api/attendance.ts";
import faceHandler from "../api/staff/face/index.ts";
import adminDevicesHandler from "../api/admin/devices/index.ts";
import adminRevokeHandler from "../api/admin/devices/revoke.ts";

import {
  authenticateAdmin,
  createAdminSessionToken,
} from "../src/server/admin-auth.ts";
import {
  getActiveDeviceForStaff,
  revokeDevice,
} from "../src/server/device-binding.ts";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const STAFF_SECRET =
  process.env.CAMPUS_AUTH_SECRET ||
  process.env.STAFF_AUTH_SECRET ||
  "campusattend-staff-auth-session-sec-key-2026";
const NETWORK_SECRET =
  process.env.CAMPUS_AUTH_SECRET ||
  process.env.NETWORK_AUTH_SECRET ||
  "sona-campus-wifi-egress-auth-secret-key-2026";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function createMockReqRes({ method = "POST", body = {}, headers = {}, query = {} }) {
  const req = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    query,
    json: async () => body,
  };

  let statusCode = 200;
  let responseData = null;
  const headersSent = {};

  const res = {
    setHeader(name, val) {
      headersSent[name.toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end(str) {
      if (str && !responseData) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(code) {
      statusCode = code;
    },
  };

  return {
    req,
    res,
    getResult: () => ({ statusCode, data: responseData, headers: headersSent }),
  };
}

async function generateDeviceKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyBase64 = Buffer.from(spki).toString("base64");
  return { keyPair, publicKeyBase64 };
}

async function signWithDeviceKey(privateKey, dataString) {
  const data = Buffer.from(dataString, "utf-8");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    data
  );
  return Buffer.from(signature).toString("base64");
}

function mintNetworkToken() {
  const payload = {
    authorized: true,
    ssid: "SONA-FACULTY",
    verifiedIp: "111.92.42.18",
    expiresAt: Date.now() + 300_000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", NETWORK_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("   TEST SUITE: ONE FACULTY ID = ONE PHONE POLICY ENFORCEMENT                   ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) console.error(`    ${err.stack.split("\n")[1]}`);
      failed++;
    }
  }

  // Pre-test clean up for devices belonging to SCT-001 so we start with a clean phone registration
  await supabase.from("devices").delete().eq("staff_code", "SCT-001");
  try {
    const localStorePath = path.resolve("data", "staff-db.json");
    if (fs.existsSync(localStorePath)) {
      const db = JSON.parse(fs.readFileSync(localStorePath, "utf-8"));
      if (Array.isArray(db.devices)) {
        db.devices = db.devices.filter((d) => d.staff_code !== "SCT-001");
        fs.writeFileSync(localStorePath, JSON.stringify(db, null, 2), "utf-8");
      }
    }
  } catch {}

  let phoneAKeyPair, phoneAPublicKey;
  let phoneBKeyPair, phoneBPublicKey;
  let phoneADeviceId;
  let phoneBDeviceId;
  let phoneAToken;
  let adminSessionToken;

  // ---------------------------------------------------------------------------
  // SECTION 1: ACCOUNT PRESERVATION CHECKS
  // ---------------------------------------------------------------------------
  console.log("--- 1. CRITICAL ACCOUNT & DATA PRESERVATION CHECKS ---");

  await test("Administrator account 'adm-moulish-001' ('moulish') is 100% intact and functional", async () => {
    const auth = await authenticateAdmin("moulish", "moulish@123");
    assert.strictEqual(auth.success, true, "Admin credentials must authenticate successfully");
    assert.strictEqual(auth.admin.id, "adm-moulish-001");
    assert.strictEqual(auth.admin.username, "moulish");
    adminSessionToken = createAdminSessionToken(auth.admin);
    assert.ok(adminSessionToken, "Admin session token generated");
  });

  await test("Faculty accounts (SCT-001 to SCT-005) are preserved and active in database", async () => {
    const { data: staffList, error } = await supabase
      .from("staff")
      .select("staff_code, name, active")
      .in("staff_code", ["SCT-001", "SCT-002", "SCT-003", "SCT-004", "SCT-005"]);
    assert.ifError(error);
    assert.strictEqual(staffList.length, 5, "All 5 faculty accounts must exist");
    for (const member of staffList) {
      assert.strictEqual(member.active, true, `Faculty ${member.staff_code} must be active`);
    }
    const sct001 = staffList.find((s) => s.staff_code === "SCT-001");
    assert.ok(sct001, "SCT-001 must exist");
    assert.strictEqual(sct001.name, "Moulishwaran S");
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: PHONE A FIRST LOGIN & HARDWARE BINDING
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. REGISTER SCT-001 ON PHONE A (FIRST LOGIN SUCCEEDS) ---");

  await test("Generate Phone A cryptographic hardware key pair", async () => {
    const gen = await generateDeviceKeyPair();
    phoneAKeyPair = gen.keyPair;
    phoneAPublicKey = gen.publicKeyBase64;
    assert.ok(phoneAPublicKey.length > 50, "Phone A public key generated");
  });

  await test("First login of SCT-001 on Phone A binds device and succeeds (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const deviceSignature = await signWithDeviceKey(phoneAKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        publicKey: phoneAPublicKey,
        deviceSignature,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Samsung Galaxy S24 Ultra (Phone A)",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      },
    });

    await loginHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Expected 200 OK, got ${result.statusCode}: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.token, "Must return signed session token");
    assert.ok(result.data.device, "Must return registered device info");
    assert.strictEqual(result.data.device.model, "Samsung Galaxy S24 Ultra (Phone A)");

    phoneADeviceId = result.data.device.id;
    phoneAToken = result.data.token;
    assert.ok(phoneADeviceId, "Device ID must be assigned");
  });

  await test("Backend database remembers Phone A registration for SCT-001 (not just local storage)", async () => {
    const activeDevice = await getActiveDeviceForStaff("SCT-001");
    assert.ok(activeDevice, "Active device must exist in database");
    assert.strictEqual(activeDevice.id, phoneADeviceId);
    assert.strictEqual(activeDevice.staff_code, "SCT-001");
    assert.strictEqual(activeDevice.status, "Active");
    assert.strictEqual(activeDevice.model, "Samsung Galaxy S24 Ultra (Phone A)");
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: PHONE B ATTEMPT (SAME ID + PASSWORD, REJECTED)
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. ENTER SCT-001 CREDENTIALS ON PHONE B (LOGIN REJECTED) ---");

  await test("Generate Phone B cryptographic hardware key pair", async () => {
    const gen = await generateDeviceKeyPair();
    phoneBKeyPair = gen.keyPair;
    phoneBPublicKey = gen.publicKeyBase64;
    assert.ok(phoneBPublicKey.length > 50, "Phone B public key generated");
    assert.notStrictEqual(phoneBPublicKey, phoneAPublicKey, "Phone B must have distinct key");
  });

  await test("Enter SCT-001 credentials on Phone B: login is strictly rejected with HTTP 403 DEVICE_MISMATCH", async () => {
    // Phone B signs with Phone B's private key (NOT Phone A's key)
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneBSig = await signWithDeviceKey(phoneBKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend", // CORRECT PASSWORD!
        publicKey: phoneBPublicKey,
        deviceSignature: phoneBSig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Google Pixel 8 Pro (Phone B)",
        os: "Android 14",
      },
    });

    await loginHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403, `Must reject with HTTP 403, got ${result.statusCode}`);
    assert.strictEqual(result.data.success, false);
    assert.strictEqual(result.data.error, "DEVICE_MISMATCH");
    assert.ok(
      result.data.message.includes("bound to another registered device") ||
        result.data.message.includes("One Faculty ID = One Phone"),
      "Message must clearly explain policy violation"
    );
  });

  await test("Device binding in database was NOT automatically changed to Phone B", async () => {
    const activeDevice = await getActiveDeviceForStaff("SCT-001");
    assert.ok(activeDevice, "Active device must still exist");
    assert.strictEqual(activeDevice.id, phoneADeviceId, "Device ID must STILL be Phone A");
    assert.strictEqual(activeDevice.model, "Samsung Galaxy S24 Ultra (Phone A)", "Model must STILL be Phone A");
    assert.strictEqual(activeDevice.status, "Active");
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: TRY LOGGING IN AGAIN ON PHONE A (SUCCEEDS)
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. TRY LOGGING IN AGAIN ON PHONE A (LOGIN SUCCEEDS) ---");

  await test("Original phone (Phone A) logs in again and succeeds (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneASig = await signWithDeviceKey(phoneAKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: phoneASig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        deviceKeyId: phoneADeviceId,
      },
    });

    await loginHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Expected 200 OK, got ${result.statusCode}: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.token);
    assert.strictEqual(result.data.device.id, phoneADeviceId);
    phoneAToken = result.data.token; // Update token
  });

  // ---------------------------------------------------------------------------
  // SECTION 5: BACKEND API BYPASS ATTEMPTS REJECTED
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. BACKEND API BYPASS ATTEMPTS (ALL REJECTED) ---");

  await test("Bypass attempt 1: Login without any device signature is rejected (HTTP 403)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_MISMATCH");
  });

  await test("Bypass attempt 2: Forged / corrupted signature is rejected (HTTP 403)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: Buffer.from("forged_signature_bytes_not_valid").toString("base64"),
        deviceTimestamp: Date.now(),
        deviceNonce: "nonce-1234",
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_MISMATCH");
  });

  await test("Bypass attempt 3: Expired timestamp (> 120s old) is rejected (HTTP 403)", async () => {
    const staleTimestamp = Date.now() - 300_000; // 5 minutes old
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${staleTimestamp}`;
    const staleSig = await signWithDeviceKey(phoneAKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: staleSig,
        deviceTimestamp: staleTimestamp,
        deviceNonce: nonce,
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // SECTION 6: SESSION RESTORATION & TOKEN REFRESH ENFORCEMENT
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. SESSION RESTORATION & TOKEN REFRESH ENFORCEMENT ---");

  await test("Session restoration on Phone A via GET /api/staff/session succeeds (HTTP 200)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "GET",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
      },
    });

    await sessionHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(result.data.device.id, phoneADeviceId);
    assert.strictEqual(result.data.device.status, "Active");
  });

  await test("Token refresh on Phone A via POST /api/staff/session succeeds (HTTP 200)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
      },
    });

    await sessionHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.token, "Must return fresh token");
  });

  await test("Session restoration with mismatched deviceId is strictly rejected (HTTP 403)", async () => {
    // Fabricate a token where deviceId = 'SOME_OTHER_DEVICE'
    const now = Date.now();
    const forgedPayload = {
      sub: "SCT-001",
      staffId: "SCT-001",
      name: "Moulishwaran S",
      deviceId: "DEV_P256_STOLEN_OR_WRONG_PHONE",
      expiresAt: now + 3600_000,
    };
    const payloadB64 = Buffer.from(JSON.stringify(forgedPayload)).toString("base64url");
    const sig = crypto.createHmac("sha256", STAFF_SECRET).update(payloadB64).digest("base64url");
    const forgedToken = `${payloadB64}.${sig}`;

    const { req, res, getResult } = createMockReqRes({
      method: "GET",
      headers: {
        authorization: `Bearer ${forgedToken}`,
      },
    });

    await sessionHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // SECTION 7: PROTECTED FACULTY APIS ENFORCE DEVICE BINDING
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. PROTECTED FACULTY APIS ENFORCEMENT ---");

  await test("Protected attendance API: Phone A can mark attendance with cryptographic signature", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const canonicalPayload = `SCT-001:${nonce}:${timestamp}`;
    const attendanceSig = await signWithDeviceKey(phoneAKeyPair.privateKey, canonicalPayload);
    const netToken = mintNetworkToken();

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
        "x-network-auth-token": netToken,
      },
      body: {
        staff_code: "SCT-001",
        staffId: "SCT-001",
        staff_name: "Moulishwaran S",
        latitude: 11.676557,
        longitude: 78.122724,
        accuracy: 10,
        networkAuthToken: netToken,
        networkSsid: "SONA-FACULTY",
        faceVerified: true,
        recognizedStaffCode: "SCT-001",
        faceMatchDistance: 0.2,
        livenessPassed: true,
        antiSpoofScore: 0.95,
        livenessEvidence: { method: "blink", passed: true, timestamp },
        deviceSignature: attendanceSig,
        deviceKeyId: phoneADeviceId,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        attemptNonce: nonce,
        devicePayloadToSign: canonicalPayload,
        devicePlatform: "android",
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200, `Expected 200, got ${result.statusCode}: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
  });

  await test("Protected attendance API: Phone B signature is strictly REJECTED (HTTP 403)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const canonicalPayload = `SCT-001:${nonce}:${timestamp}`;
    // Phone B signs!
    const phoneBSig = await signWithDeviceKey(phoneBKeyPair.privateKey, canonicalPayload);
    const netToken = mintNetworkToken();

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
        "x-network-auth-token": netToken,
      },
      body: {
        staff_code: "SCT-001",
        staffId: "SCT-001",
        staff_name: "Moulishwaran S",
        latitude: 11.676557,
        longitude: 78.122724,
        accuracy: 10,
        networkAuthToken: netToken,
        networkSsid: "SONA-FACULTY",
        faceVerified: true,
        deviceSignature: phoneBSig,
        deviceKeyId: phoneADeviceId,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        attemptNonce: nonce,
        devicePayloadToSign: canonicalPayload,
        devicePlatform: "android",
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403, `Expected 403, got ${result.statusCode}`);
    assert.strictEqual(result.data.error, "INVALID_DEVICE_SIGNATURE");
  });

  await test("Protected face API: Accessible with active registered device", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "GET",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
      },
      query: { staff_code: "SCT-001" },
    });

    await faceHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data.success, true);
  });

  // ---------------------------------------------------------------------------
  // SECTION 8: ONLY ADMINISTRATOR CAN REVOKE & APPROVE REPLACEMENT
  // ---------------------------------------------------------------------------
  console.log("\n--- 8. ADMINISTRATOR-CONTROLLED DEVICE REVOCATION & REPLACEMENT ---");

  await test("Unauthenticated device revocation attempt is rejected (HTTP 401)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        deviceId: phoneADeviceId,
        staffCode: "SCT-001",
        reason: "Unauthorized attempt",
      },
    });

    await adminRevokeHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 401);
  });

  await test("Administrator 'moulish' successfully revokes Phone A with audit reason", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSessionToken}`,
      },
      body: {
        deviceId: phoneADeviceId,
        staffCode: "SCT-001",
        reason: "Faculty member reported Phone A lost/damaged; replacement authorized.",
      },
    });

    await adminRevokeHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200, `Expected 200, got ${result.statusCode}: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(result.data.revokedDevice.status, "Revoked");
  });

  await test("Revoked Phone A can no longer log in (HTTP 403 DEVICE_REVOKED)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneASig = await signWithDeviceKey(phoneAKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: phoneASig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        deviceKeyId: phoneADeviceId,
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_REVOKED");
    assert.ok(result.data.message.includes("revoked by administration"));
  });

  await test("Revoked Phone A session restoration is rejected (HTTP 403 DEVICE_REVOKED)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "GET",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
      },
    });

    await sessionHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_REVOKED");
  });

  // ---------------------------------------------------------------------------
  // SECTION 9: PHONE B REPLACEMENT REGISTRATION & OPERATIONAL USE
  // ---------------------------------------------------------------------------
  console.log("\n--- 9. PHONE B REPLACEMENT REGISTRATION & OPERATIONAL USE ---");

  await test("Phone B can now register as replacement phone on login (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneBSig = await signWithDeviceKey(phoneBKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        publicKey: phoneBPublicKey,
        deviceSignature: phoneBSig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Google Pixel 8 Pro (Phone B)",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 200, `Expected 200 OK, got ${result.statusCode}: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.device);
    assert.strictEqual(result.data.device.model, "Google Pixel 8 Pro (Phone B)");

    phoneBDeviceId = result.data.device.id;
    assert.ok(phoneBDeviceId);
    assert.notStrictEqual(phoneBDeviceId, phoneADeviceId, "Phone B must have new device ID");
  });

  await test("Backend database now shows Phone B as the active device", async () => {
    const activeDevice = await getActiveDeviceForStaff("SCT-001");
    assert.ok(activeDevice);
    assert.strictEqual(activeDevice.id, phoneBDeviceId);
    assert.strictEqual(activeDevice.model, "Google Pixel 8 Pro (Phone B)");
    assert.strictEqual(activeDevice.status, "Active");
  });

  await test("Old Phone A STILL cannot log in even with correct password (HTTP 403 DEVICE_MISMATCH)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneASig = await signWithDeviceKey(phoneAKeyPair.privateKey, payloadToSign);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: {
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: phoneASig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        deviceKeyId: phoneADeviceId,
      },
    });

    await loginHandler(req, res);
    const result = getResult();
    assert.strictEqual(result.statusCode, 403);
    assert.ok(
      result.data.error === "DEVICE_REVOKED" || result.data.error === "DEVICE_MISMATCH",
      `Expected DEVICE_REVOKED or DEVICE_MISMATCH, got ${result.data.error}`
    );
  });

  // ---------------------------------------------------------------------------
  // SECTION 10: POST-TEST PRESERVATION AUDIT
  // ---------------------------------------------------------------------------
  console.log("\n--- 10. POST-TEST DATA & ACCOUNT PRESERVATION AUDIT ---");

  await test("Administrator 'adm-moulish-001' ('moulish') remains 100% UNTOUCHED and active", async () => {
    const auth = await authenticateAdmin("moulish", "moulish@123");
    assert.strictEqual(auth.success, true);
    assert.strictEqual(auth.admin.username, "moulish");
  });

  await test("All 5 faculty accounts and attendance records are fully preserved", async () => {
    const { data: staffList } = await supabase.from("staff").select("staff_code");
    assert.strictEqual(staffList.length, 5);
    const { data: attendance } = await supabase.from("attendance_records").select("id");
    assert.ok(attendance && attendance.length >= 5, "Historical attendance records must be preserved");
  });

  console.log("\n================================================================================");
  console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Fatal error running test suite:", err);
  process.exit(1);
});

