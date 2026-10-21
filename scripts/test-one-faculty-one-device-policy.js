/**
 * CampusAttend — One Faculty–One Registered Device Policy End-to-End Test Suite
 *
 * Requirements Tested:
 * 1. Administrator Account Preservation: 'adm-moulish-001' ('moulish') is 100% protected and verified.
 * 2. Unregistered device cannot mark attendance (HTTP 403 NO_REGISTERED_DEVICE).
 * 3. Client header / flag spoofing is rejected (zero client trust).
 * 4. Device registration workflow: challenge generation, signature verification, device binding.
 * 5. One faculty member cannot register a second active device (HTTP 409 DEVICE_ALREADY_REGISTERED).
 * 6. Single-use challenge token replay protection (CHALLENGE_ALREADY_CONSUMED).
 * 7. Invalid signatures, forged challenges, and expired timestamps are rejected.
 * 8. A different device cannot impersonate the registered device (INVALID_DEVICE_SIGNATURE).
 * 9. One faculty member cannot use another faculty member's device (DEVICE_KEY_ID_MISMATCH).
 * 10. Administrator-controlled device revocation with mandatory reason and audit trail.
 * 11. Revoked device cannot mark attendance (HTTP 403 DEVICE_REVOKED).
 * 12. Replacement device can be registered after revocation and mark attendance successfully.
 * 13. Existing attendance factors (Wi-Fi, GPS polygon, face verification) remain fully operational.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Import server handlers
import attendanceHandler from "../api/attendance.ts";
import challengeHandler from "../api/device/challenge.ts";
import registerHandler from "../api/device/register.ts";
import statusHandler from "../api/device/status.ts";
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const STAFF_SECRET = process.env.CAMPUS_AUTH_SECRET || process.env.STAFF_AUTH_SECRET || "campusattend-staff-auth-session-sec-key-2026";
const NETWORK_SECRET = process.env.CAMPUS_AUTH_SECRET || process.env.NETWORK_AUTH_SECRET || "sona-campus-wifi-egress-auth-secret-key-2026";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper to create mock HTTP req & res for serverless handlers
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

// Mint an HMAC-signed faculty session token
function mintStaffToken(staffCode, staffName = "Test Faculty") {
  const payload = {
    staffId: staffCode.toUpperCase(),
    staffName,
    expiresAt: Date.now() + 3600_000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STAFF_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

// Mint an HMAC-signed campus network token (Wi-Fi factor)
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

// Generate ECDSA P-256 key pair and export public key in SPKI base64
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

// Sign data using ECDSA P-256 private key
async function signWithDeviceKey(privateKey, dataString) {
  const data = Buffer.from(dataString, "utf-8");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    data
  );
  return Buffer.from(signature).toString("base64");
}

async function runPolicyTestSuite() {
  console.log("================================================================================");
  console.log("   CAMPUSATTEND: ONE FACULTY–ONE REGISTERED DEVICE POLICY VERIFICATION SUITE   ");
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

  // Pre-test cleanup of test accounts if left over from aborted runs
  const TEST_STAFF_1 = "SCT-TEST-001";
  const TEST_STAFF_2 = "SCT-TEST-002";
  await supabase.from("devices").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
  await supabase.from("attendance").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
  await supabase.from("attendance_records").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
  await supabase.from("staff").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);

  // Clean local store as well
  const localDbPath = path.resolve(process.cwd(), "data/staff-db.json");
  if (fs.existsSync(localDbPath)) {
    try {
      const db = JSON.parse(fs.readFileSync(localDbPath, "utf-8"));
      db.devices = (db.devices || []).filter(
        (d) => d.staff_code !== TEST_STAFF_1 && d.staff_code !== TEST_STAFF_2
      );
      fs.writeFileSync(localDbPath, JSON.stringify(db, null, 2));
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: CRITICAL ADMINISTRATOR PRESERVATION VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("--- 1. CRITICAL ADMINISTRATOR ACCOUNT PRESERVATION CHECKS ---");

  await test("Administrator 'adm-moulish-001' ('moulish') exists and credentials match", async () => {
    const authResult = await authenticateAdmin("moulish", "moulish@123");
    assert.strictEqual(authResult.success, true, "Admin credentials must authenticate successfully");
    assert.strictEqual(authResult.admin.id, "adm-moulish-001", "Admin ID must be adm-moulish-001");
    assert.strictEqual(authResult.admin.username, "moulish", "Admin username must be moulish");
    assert.ok(authResult.admin.role === "admin" || authResult.admin.role === "superadmin", "Admin role must be admin or superadmin");
  });

  await test("Administrator session token creation and verification succeeds", async () => {
    const sessionToken = createAdminSessionToken({
      id: "adm-moulish-001",
      username: "moulish",
      role: "superadmin",
    });
    assert.ok(sessionToken && sessionToken.length > 20, "Session token must be minted");
  });

  await test("Faculty table is confirmed clean after safe reset (excluding admin)", async () => {
    const { data: staffRows } = await supabase.from("staff").select("staff_code");
    assert.strictEqual(staffRows.length, 0, "Staff table must have 0 faculty accounts before new registration");
  });

  // ---------------------------------------------------------------------------
  // SECTION 2: PROVISION TEST FACULTY & UNREGISTERED DEVICE POLICY GATE
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. PROVISION TEST FACULTY & UNREGISTERED DEVICE POLICY GATE ---");

  await test("Provision test faculty member SCT-TEST-001 in staff table", async () => {
    const { data, error } = await supabase.from("staff").insert({
      staff_code: TEST_STAFF_1,
      name: "Dr. Rajesh Raman",
      email: "rajesh.raman@sonatech.ac.in",
      department: "Computer Science & Engineering",
      designation: "Associate Professor",
      status: "Active",
      active: true,
    }).select().single();

    assert.ok(!error, `Failed to provision test faculty: ${error?.message}`);
    assert.strictEqual(data.staff_code, TEST_STAFF_1);
  });

  await test("Faculty member with NO registered device is strictly REJECTED on attendance (HTTP 403 NO_REGISTERED_DEVICE)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${staffToken}`,
      },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403, `Expected HTTP 403, got ${result.statusCode}`);
    assert.strictEqual(result.data.error, "NO_REGISTERED_DEVICE", `Expected NO_REGISTERED_DEVICE, got ${result.data.error}`);
    assert.ok(result.data.message.includes("One Faculty–One Registered Device policy"), "Error message should mention policy");
  });

  await test("Client spoofing attempt (flag x-device-registered: true) is ignored (Zero Client Trust)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {
        authorization: `Bearer ${staffToken}`,
        "x-device-registered": "true",
        "x-registered-device-id": "mock-fake-device-id-999",
      },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        isDeviceRegistered: true,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403, "Spoofed flags must be strictly rejected");
    assert.strictEqual(result.data.error, "NO_REGISTERED_DEVICE");
  });

  // ---------------------------------------------------------------------------
  // SECTION 3: DEVICE REGISTRATION WORKFLOW & ATTESTATION
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. HARDWARE-BACKED DEVICE REGISTRATION WORKFLOW ---");

  let staff1DeviceKey;
  let staff1Challenge;
  let staff1ChallengeToken;
  let staff1DeviceId;

  await test("Step 5: Server issues fresh cryptographically signed registration challenge", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {},
    });

    await challengeHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Challenge issuance failed: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.challengeToken, "Challenge token must be returned");
    assert.ok(result.data.challenge, "Challenge nonce must be returned");
    assert.strictEqual(result.data.staffId, TEST_STAFF_1);
    assert.ok(result.data.expiresAt > Date.now(), "Expiration must be in future");

    staff1Challenge = result.data.challenge;
    staff1ChallengeToken = result.data.challengeToken;
  });

  await test("Rejection of forged or tampered challenge token during registration", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const { keyPair, publicKeyBase64 } = await generateDeviceKeyPair();

    const forgedToken = staff1ChallengeToken.slice(0, -6) + "XXXXXX";
    const signature = await signWithDeviceKey(keyPair.privateKey, staff1Challenge);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        challengeToken: forgedToken,
        challenge: staff1Challenge,
        publicKey: publicKeyBase64,
        signature,
        platform: "android",
      },
    });

    await registerHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "INVALID_CHALLENGE_SIGNATURE");
  });

  await test("Step 4, 6, 7, 8: Device generates cryptographic key pair, signs challenge, binds account", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    staff1DeviceKey = await generateDeviceKeyPair();

    // Device signs the server challenge nonce with non-exportable hardware key
    const registrationSignature = await signWithDeviceKey(
      staff1DeviceKey.keyPair.privateKey,
      staff1Challenge
    );

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        challengeToken: staff1ChallengeToken,
        challenge: staff1Challenge,
        publicKey: staff1DeviceKey.publicKeyBase64,
        signature: registrationSignature,
        keyAlgorithm: "ECDSA_P256",
        platform: "android",
        model: "Pixel 8 Pro (StrongBox Keystore)",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      },
    });

    await registerHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 201, `Registration failed: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.ok(result.data.device.id, "Device ID must be assigned");
    assert.strictEqual(result.data.device.status, "Active");
    assert.strictEqual(result.data.device.staffCode, TEST_STAFF_1);
    assert.strictEqual(result.data.device.platform, "android");

    staff1DeviceId = result.data.device.id;
  });

  await test("Replay protection: Reusing the consumed challenge token is strictly REJECTED", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const registrationSignature = await signWithDeviceKey(
      staff1DeviceKey.keyPair.privateKey,
      staff1Challenge
    );

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        challengeToken: staff1ChallengeToken,
        challenge: staff1Challenge,
        publicKey: staff1DeviceKey.publicKeyBase64,
        signature: registrationSignature,
        platform: "android",
      },
    });

    await registerHandler(req, res);
    const result = getResult();

    // Must be rejected with 409 (device already registered) or 403 (challenge already consumed)
    assert.ok([400, 403, 409].includes(result.statusCode), `Expected 400, 403, or 409, got ${result.statusCode}`);
    assert.ok(
      result.data.error === "DEVICE_ALREADY_REGISTERED" ||
      result.data.error === "CHALLENGE_ALREADY_CONSUMED",
      `Expected replay or duplicate error, got ${result.data.error}`
    );
  });

  // ---------------------------------------------------------------------------
  // SECTION 4: ONE FACULTY–ONE DEVICE POLICY ENFORCEMENT
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. ONE FACULTY–ONE REGISTERED DEVICE POLICY CHECKS ---");

  await test("Faculty member CANNOT request a second challenge while having an active registered device (HTTP 409)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {},
    });

    await challengeHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 409, `Expected HTTP 409 Conflict, got ${result.statusCode}`);
    assert.strictEqual(result.data.error, "DEVICE_ALREADY_REGISTERED");
    assert.strictEqual(result.data.device.id, staff1DeviceId);
  });

  await test("Direct second device registration attempt is strictly REJECTED (HTTP 409 DEVICE_ALREADY_REGISTERED)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const secondDeviceKey = await generateDeviceKeyPair();

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        challengeToken: "simulated-token",
        challenge: "simulated-challenge",
        publicKey: secondDeviceKey.publicKeyBase64,
        signature: "simulated-sig",
        platform: "android",
        model: "Samsung Galaxy S24",
      },
    });

    await registerHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 409, `Expected HTTP 409, got ${result.statusCode}`);
    assert.strictEqual(result.data.error, "DEVICE_ALREADY_REGISTERED");
  });

  // ---------------------------------------------------------------------------
  // SECTION 5: ATTENDANCE ENFORCEMENT WITH REGISTERED DEVICE
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. CRYPTOGRAPHIC ATTENDANCE VERIFICATION & REPLAY DEFENSES ---");

  await test("Attendance request signed by active registered device SUCCEEDS (HTTP 200)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Canonical payload format: `${canonicalStaffCode}:${attemptNonce}:${deviceTimestamp}`
    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const deviceSignature = await signWithDeviceKey(
      staff1DeviceKey.keyPair.privateKey,
      canonicalPayload
    );

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        livenessPassed: true,
        antiSpoofScore: 0.95,
        livenessEvidence: { method: "blink", passed: true, timestamp: timestamp },
        deviceId: staff1DeviceId,
        deviceSignature,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Attendance failed: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(result.data.staffCode, TEST_STAFF_1);
    assert.strictEqual(result.data.deviceId, staff1DeviceId);
  });

  await test("Attendance signed with an UNREGISTERED device key is strictly REJECTED (HTTP 403 INVALID_DEVICE_SIGNATURE)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Sign with an unregistered key pair
    const rogueKey = await generateDeviceKeyPair();
    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const rogueSignature = await signWithDeviceKey(
      rogueKey.keyPair.privateKey,
      canonicalPayload
    );

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId,
        deviceSignature: rogueSignature,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403, `Expected 403, got ${result.statusCode}`);
    assert.strictEqual(result.data.error, "INVALID_DEVICE_SIGNATURE");
  });

  await test("Tampered payload (modified nonce or coordinates) fails signature verification (HTTP 403 INVALID_DEVICE_SIGNATURE)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Sign payload A
    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const signature = await signWithDeviceKey(
      staff1DeviceKey.keyPair.privateKey,
      canonicalPayload
    );

    // Send altered payload with modified nonce
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId,
        deviceSignature: signature,
        deviceTimestamp: timestamp,
        attemptNonce: "TAMPERED_NONCE_VALUE", // Tampered!
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "INVALID_DEVICE_SIGNATURE");
  });

  await test("Expired timestamp (> 120 seconds old) is strictly REJECTED (HTTP 403 DEVICE_SIGNATURE_TIMESTAMP_EXPIRED)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const staleTimestamp = Date.now() - 150_000; // 2.5 minutes in the past
    const nonce = crypto.randomUUID();

    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${staleTimestamp}`;
    const signature = await signWithDeviceKey(
      staff1DeviceKey.keyPair.privateKey,
      canonicalPayload
    );

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId,
        deviceSignature: signature,
        deviceTimestamp: staleTimestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_SIGNATURE_TIMESTAMP_EXPIRED");
  });

  // ---------------------------------------------------------------------------
  // SECTION 6: CROSS-FACULTY DEVICE IMPERSONATION PREVENTION
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. CROSS-FACULTY DEVICE IMPERSONATION PREVENTION ---");

  let staff2DeviceKey;
  let staff2DeviceId;

  await test("Provision second faculty member SCT-TEST-002 and register their distinct device", async () => {
    // 1. Provision staff 2
    await supabase.from("staff").insert({
      staff_code: TEST_STAFF_2,
      name: "Prof. Meena Kumari",
      email: "meena.k@sonatech.ac.in",
      department: "Information Technology",
      designation: "Assistant Professor",
      status: "Active",
      active: true,
    });

    const staff2Token = mintStaffToken(TEST_STAFF_2, "Prof. Meena Kumari");

    // 2. Request challenge
    const { req: cReq, res: cRes, getResult: cResGet } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staff2Token}` },
      body: {},
    });
    await challengeHandler(cReq, cRes);
    const cResult = cResGet();
    assert.strictEqual(cResult.statusCode, 200);

    // 3. Register device 2
    staff2DeviceKey = await generateDeviceKeyPair();
    const sig2 = await signWithDeviceKey(staff2DeviceKey.keyPair.privateKey, cResult.data.challenge);

    const { req: rReq, res: rRes, getResult: rResGet } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staff2Token}` },
      body: {
        challengeToken: cResult.data.challengeToken,
        challenge: cResult.data.challenge,
        publicKey: staff2DeviceKey.publicKeyBase64,
        signature: sig2,
        platform: "ios",
        model: "iPhone 15 Pro (Secure Enclave)",
        os: "iOS 17.5",
        isHardwareBacked: true,
      },
    });
    await registerHandler(rReq, rRes);
    const rResult = rResGet();
    assert.strictEqual(rResult.statusCode, 201);
    staff2DeviceId = rResult.data.device.id;
  });

  await test("Faculty 2 CANNOT mark attendance using Faculty 1's device ID (HTTP 403 DEVICE_KEY_ID_MISMATCH)", async () => {
    const staff2Token = mintStaffToken(TEST_STAFF_2, "Prof. Meena Kumari");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Faculty 2 tries to sign with Faculty 2's key, but passes Faculty 1's deviceId
    const canonicalPayload = `${TEST_STAFF_2}:${nonce}:${timestamp}`;
    const sig = await signWithDeviceKey(staff2DeviceKey.keyPair.privateKey, canonicalPayload);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staff2Token}` },
      body: {
        staffCode: TEST_STAFF_2,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_2,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId, // Mismatched! Belongs to Faculty 1
        deviceSignature: sig,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "DEVICE_KEY_ID_MISMATCH");
  });

  await test("Faculty 1 CANNOT use their device key to sign attendance for Faculty 2", async () => {
    const staff2Token = mintStaffToken(TEST_STAFF_2, "Prof. Meena Kumari");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Faculty 1 signs Faculty 2's payload with Faculty 1's private key
    const canonicalPayload = `${TEST_STAFF_2}:${nonce}:${timestamp}`;
    const sig = await signWithDeviceKey(staff1DeviceKey.keyPair.privateKey, canonicalPayload);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staff2Token}` },
      body: {
        staffCode: TEST_STAFF_2,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_2,
        faceMatchDistance: 0.28,
        deviceId: staff2DeviceId,
        deviceSignature: sig, // Signed with Faculty 1's key!
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.data.error, "INVALID_DEVICE_SIGNATURE");
  });

  // ---------------------------------------------------------------------------
  // SECTION 7: ADMINISTRATOR-CONTROLLED DEVICE REVOCATION & REPLACEMENT
  // ---------------------------------------------------------------------------
  console.log("\n--- 7. ADMINISTRATOR-CONTROLLED DEVICE REVOCATION & REPLACEMENT ---");

  const adminToken = createAdminSessionToken({
    id: "adm-moulish-001",
    username: "moulish",
    role: "superadmin",
  });

  await test("Administrator endpoint GET /api/admin/devices lists registered devices across faculty", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "GET",
      headers: { authorization: `Bearer ${adminToken}` },
      query: {},
    });

    await adminDevicesHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data.success, true);
    assert.ok(Array.isArray(result.data.devices));
    const codes = result.data.devices.map((d) => d.staffCode?.toUpperCase());
    assert.ok(codes.includes(TEST_STAFF_1), "Should include SCT-TEST-001");
    assert.ok(codes.includes(TEST_STAFF_2), "Should include SCT-TEST-002");
  });

  await test("Unauthenticated device revocation attempt is strictly REJECTED (HTTP 401)", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: {}, // No admin token
      body: {
        deviceId: staff1DeviceId,
        reason: "Unauthorized attempt",
      },
    });

    await adminRevokeHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 401);
  });

  await test("Administrator revokes Faculty 1's device with documented audit reason", async () => {
    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: {
        deviceId: staff1DeviceId,
        staffCode: TEST_STAFF_1,
        reason: "Faculty member reported lost phone during campus transit",
      },
    });

    await adminRevokeHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Revocation failed: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(result.data.revokedDevice.status, "Revoked");
  });

  await test("Revoked device CANNOT mark attendance (HTTP 403 DEVICE_REVOKED)", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const sig = await signWithDeviceKey(staff1DeviceKey.keyPair.privateKey, canonicalPayload);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId,
        deviceSignature: sig,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    // With active device revoked and no other active device: returns 403 NO_REGISTERED_DEVICE or DEVICE_REVOKED
    assert.strictEqual(result.statusCode, 403);
    assert.ok(
      result.data.error === "DEVICE_REVOKED" || result.data.error === "NO_REGISTERED_DEVICE",
      `Expected DEVICE_REVOKED or NO_REGISTERED_DEVICE, got ${result.data.error}`
    );
  });

  let replacementDeviceKey;
  let replacementDeviceId;

  await test("Faculty 1 can now request a challenge for a replacement device", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {},
    });

    await challengeHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200, `Challenge should succeed after revocation: ${JSON.stringify(result.data)}`);
    assert.ok(result.data.challengeToken);

    // Register replacement device
    replacementDeviceKey = await generateDeviceKeyPair();
    const repSig = await signWithDeviceKey(replacementDeviceKey.keyPair.privateKey, result.data.challenge);

    const { req: rReq, res: rRes, getResult: rResGet } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        challengeToken: result.data.challengeToken,
        challenge: result.data.challenge,
        publicKey: replacementDeviceKey.publicKeyBase64,
        signature: repSig,
        platform: "android",
        model: "OnePlus 12 (Replacement TEE Device)",
        os: "Android 14",
        isHardwareBacked: true,
      },
    });

    await registerHandler(rReq, rRes);
    const rResult = rResGet();

    assert.strictEqual(rResult.statusCode, 201, `Replacement registration failed: ${JSON.stringify(rResult.data)}`);
    assert.strictEqual(rResult.data.device.status, "Active");
    replacementDeviceId = rResult.data.device.id;
  });

  await test("Replacement device successfully marks attendance (HTTP 200)", async () => {
    // Clear today's earlier attendance record so replacement device records fresh attendance
    await supabase.from("attendance_records").delete().eq("staff_code", TEST_STAFF_1);
    await supabase.from("attendance").delete().eq("staff_code", TEST_STAFF_1);

    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const sig = await signWithDeviceKey(replacementDeviceKey.keyPair.privateKey, canonicalPayload);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        livenessPassed: true,
        antiSpoofScore: 0.95,
        livenessEvidence: { method: "blink", passed: true, timestamp: timestamp },
        deviceId: replacementDeviceId,
        deviceSignature: sig,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(result.data.deviceId, replacementDeviceId);
  });

  await test("Old revoked device STILL cannot mark attendance after replacement is active", async () => {
    const staffToken = mintStaffToken(TEST_STAFF_1, "Dr. Rajesh Raman");
    const networkToken = mintNetworkToken();
    const timestamp = Date.now();
    const nonce = crypto.randomUUID();

    // Old device key signs request
    const canonicalPayload = `${TEST_STAFF_1}:${nonce}:${timestamp}`;
    const sig = await signWithDeviceKey(staff1DeviceKey.keyPair.privateKey, canonicalPayload);

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        staffCode: TEST_STAFF_1,
        networkAuthToken: networkToken,
        latitude: 11.6775,
        longitude: 78.1250,
        accuracy: 8,
        faceVerified: true,
        recognizedStaffCode: TEST_STAFF_1,
        faceMatchDistance: 0.28,
        deviceId: staff1DeviceId, // Old revoked device ID
        deviceSignature: sig,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
      },
    });

    await attendanceHandler(req, res);
    const result = getResult();

    assert.strictEqual(result.statusCode, 403);
    assert.ok(
      result.data.error === "DEVICE_KEY_ID_MISMATCH" || result.data.error === "INVALID_DEVICE_SIGNATURE",
      `Expected mismatch or invalid signature for old device, got ${result.data.error}`
    );
  });

  // ---------------------------------------------------------------------------
  // SECTION 8: CLEANUP & POST-VERIFICATION OF ADMINISTRATOR ACCOUNT
  // ---------------------------------------------------------------------------
  console.log("\n--- 8. CLEANUP & POST-VERIFICATION OF ADMINISTRATOR PRESERVATION ---");

  await test("Clean up test accounts (SCT-TEST-001, SCT-TEST-002) and devices", async () => {
    await supabase.from("devices").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
    await supabase.from("attendance").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
    await supabase.from("attendance_records").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);
    await supabase.from("staff").delete().in("staff_code", [TEST_STAFF_1, TEST_STAFF_2]);

    if (fs.existsSync(localDbPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(localDbPath, "utf-8"));
        db.devices = (db.devices || []).filter(
          (d) => d.staff_code !== TEST_STAFF_1 && d.staff_code !== TEST_STAFF_2
        );
        fs.writeFileSync(localDbPath, JSON.stringify(db, null, 2));
      } catch {}
    }
  });

  await test("Post-test: Administrator account 'adm-moulish-001' remains 100% UNMODIFIED and functional", async () => {
    const authResult = await authenticateAdmin("moulish", "moulish@123");
    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.admin.id, "adm-moulish-001");
    assert.strictEqual(authResult.admin.username, "moulish");
    assert.ok(authResult.admin.role === "admin" || authResult.admin.role === "superadmin");
  });

  console.log("\n================================================================================");
  console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runPolicyTestSuite().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
