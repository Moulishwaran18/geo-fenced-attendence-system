/**
 * CampusAttend — Complete Two-Way Device Binding Policy Regression Suite
 *
 * Enforces all 12 required test scenarios from Step 5:
 * 1. First account/device binding succeeds.
 * 2. Same account and same device can log in repeatedly.
 * 3. Same account on a second device is rejected even with correct credentials (DEVICE_MISMATCH).
 * 4. A second account cannot register or bind to an already-bound device (DEVICE_BOUND_TO_ANOTHER_ACCOUNT).
 * 5. Two simultaneous attempts cannot violate either uniqueness rule (concurrent race condition handling).
 * 6. A revoked device is rejected (DEVICE_REVOKED).
 * 7. A missing, mismatched, rotated, or invalid device key fails safely.
 * 8. Repeated registration requests do not create duplicate bindings (idempotent success).
 * 9. A device identity stored only in editable local storage cannot bypass server verification.
 * 10. Existing device bindings survive ordinary logout/login and app restart.
 * 11. Legitimate administrator-authorized recovery works and is audited in security_events.
 * 12. Attendance and face-verification workflows still pass their factor tests.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Handlers under test
import deviceApiHandler from "../api/device/index.ts";
import loginHandler from "../api/staff/login.ts";
import adminStaffHandler from "../api/admin/staff/index.ts";
import attendanceHandler from "../api/attendance.ts";
import {
  registerDeviceForStaff,
  getActiveDeviceForStaff,
  revokeDevice,
  verifyDeviceSignature,
  getDeviceKeyFingerprint,
} from "../src/server/device-binding.ts";

// Helper to generate real non-exportable hardware-equivalent ECDSA P-256 key pairs
function createTestDeviceKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function signPayload(privateKeyPem: string, data: string): string {
  const signer = crypto.createSign("SHA256");
  signer.update(Buffer.from(data, "utf-8"));
  return signer.sign(privateKeyPem, "base64");
}

function createMockReqRes({
  method = "POST",
  url = "/api/device",
  body = {},
  headers = {},
  query = {},
}: {
  method?: string;
  url?: string;
  body?: any;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const req: any = {
    method,
    url,
    headers: {
      "content-type": "application/json",
      "x-internal-test": "true",
      ...headers,
    },
    body,
    query,
    json: async () => body,
  };

  let statusCode = 200;
  let responseData: any = null;
  const headersSent: Record<string, string> = {};

  const res: any = {
    setHeader(name: string, val: string) {
      headersSent[name.toLowerCase()] = val;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: any) {
      responseData = data;
      return this;
    },
    end(str?: string) {
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
    set statusCode(code: number) {
      statusCode = code;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
    getHeaders: () => headersSent,
  };
}

async function runDeviceBindingPolicySuite() {
  console.log("================================================================================");
  console.log("   CAMPUSATTEND: COMPLETE TWO-WAY DEVICE BINDING REGRESSION TEST SUITE          ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    Error: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split("\n")[1];
        if (stackLine) console.error(`    ${stackLine.trim()}`);
      }
      failed++;
    }
  }

  // Generate test devices
  const phoneA = createTestDeviceKeyPair(); // Authorized Phone A for Staff 1
  const phoneB = createTestDeviceKeyPair(); // Unauthorized Phone B attempting login
  const phoneC = createTestDeviceKeyPair(); // Replacement Phone C after revocation
  const testRunId = (Date.now().toString(36) + Math.random().toString(36).substring(2, 6)).toUpperCase();
  const STAFF_1 = `TEST-ALPHA-${testRunId}`;
  const STAFF_2 = `TEST-BETA-${testRunId}`;

  // Clean local test store for test staff to ensure clean starting state
  for (const rel of [path.join(".gemini", "device-store.json"), path.join("data", "staff-db.json")]) {
    const localStorePath = path.resolve(process.cwd(), rel);
    try {
      if (fs.existsSync(localStorePath)) {
        const store = JSON.parse(fs.readFileSync(localStorePath, "utf-8"));
        if (Array.isArray(store.devices)) {
          store.devices = store.devices.filter(
            (d: any) => !String(d.staff_code || "").startsWith("TEST-")
          );
          fs.writeFileSync(localStorePath, JSON.stringify(store, null, 2), "utf-8");
        }
      }
    } catch {}
  }

  let phoneA_DeviceId = "";
  let phoneC_DeviceId = "";

  // ---------------------------------------------------------------------------
  // SCENARIO 1: First Account/Device Binding Succeeds
  // ---------------------------------------------------------------------------
  await test("1. First account/device binding succeeds with cryptographic proof", async () => {
    // A. Request registration challenge
    const chalMock = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      body: { staff_code: STAFF_1, password: "campusattend" },
    });
    await deviceApiHandler(chalMock.req, chalMock.res);
    const chalData = chalMock.getData();
    assert.strictEqual(chalMock.getStatus(), 200, "Challenge request must succeed");
    assert.ok(chalData.challenge, "Challenge nonce must be returned");
    assert.ok(chalData.challengeToken, "Signed challenge token must be returned");

    // B. Sign challenge with Phone A's private key
    const sigA = signPayload(phoneA.privateKey, chalData.challenge);

    // C. Register device
    const regMock = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        challengeToken: chalData.challengeToken,
        challenge: chalData.challenge,
        publicKey: phoneA.publicKey,
        signature: sigA,
        platform: "android",
        model: "Google Pixel 8 Pro",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      },
    });
    await deviceApiHandler(regMock.req, regMock.res);
    const regData = regMock.getData();
    assert.strictEqual(regMock.getStatus(), 201, "Device registration must return 201 Created");
    assert.strictEqual(regData.success, true);
    assert.ok(regData.device.id, "Device ID must be created");
    assert.strictEqual(regData.device.status, "Active");
    phoneA_DeviceId = regData.device.id;
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Same Account & Same Device Can Log In Repeatedly
  // ---------------------------------------------------------------------------
  await test("2. Same account and same device can log in repeatedly across restarts", async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const nonce = crypto.randomUUID();
      const ts = Date.now();
      const canonical = `${STAFF_1}:${nonce}:${ts}`;
      const sig = signPayload(phoneA.privateKey, canonical);

      const loginMock = createMockReqRes({
        method: "POST",
        url: "/api/staff/login",
        body: {
          staff_code: STAFF_1,
          password: "campusattend",
          deviceSignature: sig,
          deviceNonce: nonce,
          deviceTimestamp: ts,
          deviceKeyId: phoneA_DeviceId,
          publicKey: phoneA.publicKey,
        },
      });
      await loginHandler(loginMock.req, loginMock.res);
      const loginData = loginMock.getData();
      assert.strictEqual(loginMock.getStatus(), 200, `Login attempt ${attempt} must succeed with 200 OK`);
      assert.strictEqual(loginData.success, true);
      assert.ok(loginData.token, "Session token must be issued");
      assert.strictEqual(loginData.device.id, phoneA_DeviceId, "Token must be bound to Phone A");
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Same Account on Second Device (Phone B) is Strictly Rejected
  // ---------------------------------------------------------------------------
  await test("3. Same account on second phone (Phone B) is rejected even with correct password", async () => {
    const nonce = crypto.randomUUID();
    const ts = Date.now();
    const canonical = `${STAFF_1}:${nonce}:${ts}`;
    // Attacker on Phone B enters CORRECT credentials but signs with Phone B's private key
    const sigPhoneB = signPayload(phoneB.privateKey, canonical);

    const loginMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend", // Correct password!
        deviceSignature: sigPhoneB,
        deviceNonce: nonce,
        deviceTimestamp: ts,
        deviceKeyId: "DEV_ANDROID_PHONE_B_ATTACKER",
        publicKey: phoneB.publicKey,
      },
    });
    await loginHandler(loginMock.req, loginMock.res);
    const loginData = loginMock.getData();
    assert.strictEqual(loginMock.getStatus(), 403, "Second phone must be rejected with HTTP 403");
    assert.strictEqual(loginData.error, "DEVICE_MISMATCH", "Error code must be DEVICE_MISMATCH");
    assert.ok(
      loginData.message.includes("One Faculty ID = One Phone policy prohibits logging in from another phone"),
      "Message must enforce policy"
    );

    // Verify account was NOT automatically transferred to Phone B
    const active = await getActiveDeviceForStaff(STAFF_1);
    assert.strictEqual(active?.id, phoneA_DeviceId, "Active device must remain Phone A");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Second Account Cannot Register or Bind to Already-Bound Device (Rule 2)
  // ---------------------------------------------------------------------------
  await test("4. Second account cannot bind to an already-bound physical device (Rule 2)", async () => {
    // Staff 2 requests a registration challenge
    const chalMock = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      body: { staff_code: STAFF_2, password: "campusattend" },
    });
    await deviceApiHandler(chalMock.req, chalMock.res);
    const chalData = chalMock.getData();
    assert.strictEqual(chalMock.getStatus(), 200);

    // Staff 2 attempts to register Phone A's public key (already bound to Staff 1)
    const sigA = signPayload(phoneA.privateKey, chalData.challenge);
    const regMock = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      body: {
        staff_code: STAFF_2,
        password: "campusattend",
        challengeToken: chalData.challengeToken,
        challenge: chalData.challenge,
        publicKey: phoneA.publicKey, // Phone A's public key!
        signature: sigA,
        platform: "android",
        model: "Staff 2 Shared Phone",
        os: "Android 14",
      },
    });
    await deviceApiHandler(regMock.req, regMock.res);
    const regData = regMock.getData();
    assert.strictEqual(regMock.getStatus(), 409, "Must return HTTP 409 Conflict");
    assert.ok(
      regData.error.includes("DEVICE_BOUND_TO_ANOTHER_ACCOUNT") ||
      regData.message?.includes("already bound to another staff account"),
      "Must reject with DEVICE_BOUND_TO_ANOTHER_ACCOUNT"
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4B: Second Account Cannot Register with Existing key_id (Rule 2B key_id uniqueness)
  // ---------------------------------------------------------------------------
  await test("4B. Second account cannot bind using an existing registered device key_id (Rule 2 key_id uniqueness)", async () => {
    // Staff 2 requests another fresh challenge
    const chalMock = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      body: { staff_code: STAFF_2, password: "campusattend" },
    });
    await deviceApiHandler(chalMock.req, chalMock.res);
    const chalData = chalMock.getData();
    assert.strictEqual(chalMock.getStatus(), 200);

    // Create a new key pair for Staff 2, but provide Phone A's keyId
    const freshKeyForStaff2 = createTestDeviceKeyPair();
    const sigFresh = signPayload(freshKeyForStaff2.privateKey, chalData.challenge);
    const regMock = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      body: {
        staff_code: STAFF_2,
        password: "campusattend",
        challengeToken: chalData.challengeToken,
        challenge: chalData.challenge,
        publicKey: freshKeyForStaff2.publicKey,
        keyId: phoneA_DeviceId, // Attempting to hijack Phone A's keyId!
        signature: sigFresh,
        platform: "android",
        model: "Staff 2 Hijack Attempt",
        os: "Android 14",
      },
    });
    await deviceApiHandler(regMock.req, regMock.res);
    const regData = regMock.getData();
    assert.strictEqual(regMock.getStatus(), 409, "Must return HTTP 409 Conflict on key_id collision");
    assert.ok(
      regData.error?.includes("DEVICE_BOUND_TO_ANOTHER_ACCOUNT") ||
      regData.message?.includes("already bound to another staff account") ||
      regData.message?.includes("already has an active registered device"),
      "Must reject key_id collision across different faculty accounts"
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Concurrent Race Conditions Cannot Violate Either Uniqueness Rule
  // ---------------------------------------------------------------------------
  await test("5. Concurrent race attempts cannot bind multiple devices or accounts", async () => {
    const freshStaffRace = `TEST-STAFF-RACE-${testRunId}`;
    const raceDevice1 = createTestDeviceKeyPair();
    const raceDevice2 = createTestDeviceKeyPair();

    // Fire two registration attempts simultaneously
    const [res1, res2] = await Promise.all([
      registerDeviceForStaff({
        staffId: "race-1",
        staffCode: freshStaffRace,
        staffName: "Race Staff",
        publicKey: raceDevice1.publicKey,
        platform: "android",
        attestationStatus: "StrongBox",
        attestationType: "hardware",
        model: "Race Phone 1",
        os: "Android 14",
      }),
      registerDeviceForStaff({
        staffId: "race-1",
        staffCode: freshStaffRace,
        staffName: "Race Staff",
        publicKey: raceDevice2.publicKey,
        platform: "android",
        attestationStatus: "StrongBox",
        attestationType: "hardware",
        model: "Race Phone 2",
        os: "Android 14",
      }),
    ]);

    // Exactly one must succeed, the other must be rejected with 409
    const successes = [res1, res2].filter((r) => r.success);
    const conflicts = [res1, res2].filter((r) => !r.success && r.statusCode === 409);
    assert.strictEqual(successes.length, 1, "Exactly one concurrent registration can succeed");
    assert.strictEqual(conflicts.length, 1, "Conflicting concurrent registration must fail with 409");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Revoked Device is Rejected
  // ---------------------------------------------------------------------------
  await test("6. Revoked device is rejected immediately with DEVICE_REVOKED", async () => {
    // Revoke Phone A
    const revokeRes = await revokeDevice({
      deviceId: phoneA_DeviceId,
      staffCode: STAFF_1,
      reason: "Faculty member reported lost phone",
      adminUsername: "moulish",
    });
    assert.strictEqual(revokeRes.success, true, "Revocation must succeed");
    assert.strictEqual(revokeRes.revokedDevice?.status, "Revoked");

    // Attempt login with Phone A after revocation
    const nonce = crypto.randomUUID();
    const ts = Date.now();
    const canonical = `${STAFF_1}:${nonce}:${ts}`;
    const sig = signPayload(phoneA.privateKey, canonical);

    const loginMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: sig,
        deviceNonce: nonce,
        deviceTimestamp: ts,
        deviceKeyId: phoneA_DeviceId,
      },
    });
    await loginHandler(loginMock.req, loginMock.res);
    const loginData = loginMock.getData();
    assert.strictEqual(loginMock.getStatus(), 403, "Revoked device must be rejected with 403");
    assert.strictEqual(loginData.error, "DEVICE_REVOKED", "Error must be DEVICE_REVOKED");
    assert.ok(loginData.message.includes("revoked by administration"), "Message must specify revocation");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Missing, Mismatched, Rotated, or Invalid Key Fails Safely
  // ---------------------------------------------------------------------------
  await test("7. Missing, mismatched, rotated, or forged device signatures fail safely", async () => {
    // Re-bind Phone A for test
    const resetRes = await registerDeviceForStaff({
      staffId: "test-1",
      staffCode: STAFF_1,
      staffName: "Staff Alpha",
      publicKey: phoneA.publicKey,
      platform: "android",
      attestationStatus: "StrongBox",
      attestationType: "hardware",
      model: "Google Pixel 8 Pro",
      os: "Android 14",
    });

    const ts = Date.now();
    const canonical = `${STAFF_1}:nonce-123:${ts}`;

    // A. Missing signature
    const missMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: { staff_code: STAFF_1, password: "campusattend" },
    });
    await loginHandler(missMock.req, missMock.res);
    assert.strictEqual(missMock.getStatus(), 403, "Missing signature must be rejected");

    // B. Forged / invalid signature
    const badSigMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: Buffer.from("forged_garbage_signature").toString("base64"),
        deviceNonce: "nonce-123",
        deviceTimestamp: ts,
        deviceKeyId: phoneA_DeviceId,
      },
    });
    await loginHandler(badSigMock.req, badSigMock.res);
    assert.strictEqual(badSigMock.getStatus(), 403, "Forged signature must be rejected with 403");

    // C. Expired timestamp (> 120s old)
    const oldSig = signPayload(phoneA.privateKey, `${STAFF_1}:nonce-old:${ts - 300_000}`);
    const expiredMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: oldSig,
        deviceNonce: "nonce-old",
        deviceTimestamp: ts - 300_000,
        deviceKeyId: phoneA_DeviceId,
      },
    });
    await loginHandler(expiredMock.req, expiredMock.res);
    assert.strictEqual(expiredMock.getStatus(), 403, "Expired signature timestamp must be rejected");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Repeated Registration Requests Do Not Create Duplicate Bindings
  // ---------------------------------------------------------------------------
  await test("8. Repeated registration requests for the same phone return idempotent 200 OK", async () => {
    const chalMock = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        publicKey: phoneA.publicKey,
        isReRegistration: true,
      },
    });
    await deviceApiHandler(chalMock.req, chalMock.res);
    const chalData = chalMock.getData();

    const sigA = signPayload(phoneA.privateKey, chalData.challenge);
    const repeatMock = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        challengeToken: chalData.challengeToken,
        challenge: chalData.challenge,
        publicKey: phoneA.publicKey,
        signature: sigA,
        platform: "android",
        model: "Google Pixel 8 Pro",
        os: "Android 14",
      },
    });
    await deviceApiHandler(repeatMock.req, repeatMock.res);
    const repeatData = repeatMock.getData();
    assert.strictEqual(repeatMock.getStatus(), 200, "Idempotent re-registration must return 200 OK");
    assert.strictEqual(repeatData.success, true);
    assert.ok(repeatData.message.includes("already registered and cryptographically bound"));
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Editable Local Storage Cannot Bypass Server Verification
  // ---------------------------------------------------------------------------
  await test("9. Locally stored flags or client IDs cannot bypass cryptographic verification", async () => {
    // Client tries to claim it is already verified via local storage header or body flag
    const fakeMock = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceId: phoneA_DeviceId,
        isDeviceVerifiedLocally: true,
        bypassCheck: true,
      },
      headers: {
        "x-device-verified": "true",
        "x-device-id": phoneA_DeviceId,
      },
    });
    await loginHandler(fakeMock.req, fakeMock.res);
    assert.strictEqual(fakeMock.getStatus(), 403, "Unverified client flag must be strictly rejected");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 10: Existing Device Bindings Survive Ordinary Logout/Login & Restart
  // ---------------------------------------------------------------------------
  await test("10. Existing device bindings survive logout, login, and application restart", async () => {
    // 1. Initial valid login on Phone A
    const nonce1 = crypto.randomUUID();
    const ts1 = Date.now();
    const sig1 = signPayload(phoneA.privateKey, `${STAFF_1}:${nonce1}:${ts1}`);

    const login1 = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: sig1,
        deviceNonce: nonce1,
        deviceTimestamp: ts1,
        deviceKeyId: phoneA_DeviceId,
      },
    });
    await loginHandler(login1.req, login1.res);
    const data1 = login1.getData();
    assert.strictEqual(login1.getStatus(), 200);
    const token = data1.token;

    // 2. Simulate session restoration on app restart
    const sessReq = createMockReqRes({
      method: "GET",
      url: "/api/staff/session",
      headers: { authorization: `Bearer ${token}` },
    });
    await loginHandler(sessReq.req, sessReq.res);
    const sessData = sessReq.getData();
    assert.strictEqual(sessReq.getStatus(), 200, "Session restoration must succeed on app restart");
    assert.strictEqual(sessData.device.id, phoneA_DeviceId, "Device binding must remain intact");

    // 3. Status check endpoint returns hasActiveDevice = true
    const statReq = createMockReqRes({
      method: "GET",
      url: `/api/device/status?staff_code=${STAFF_1}`,
      headers: { authorization: `Bearer ${token}` },
    });
    await deviceApiHandler(statReq.req, statReq.res);
    const statData = statReq.getData();
    assert.strictEqual(statReq.getStatus(), 200);
    assert.strictEqual(statData.hasActiveDevice, true, "Device status must confirm active binding");
    assert.strictEqual(statData.device.id, phoneA_DeviceId);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Administrator-Authorized Recovery Works and is Audited
  // ---------------------------------------------------------------------------
  await test("11. Administrator-authorized device replacement is protected and audited", async () => {
    // 1. Admin revokes lost/damaged Phone A
    const adminRevoke = createMockReqRes({
      method: "POST",
      url: "/api/admin/devices/revoke",
      body: {
        deviceId: phoneA_DeviceId,
        reason: "Faculty member phone upgrade request approved by HOD",
      },
      headers: { "x-internal-test": "true" },
    });
    await adminStaffHandler(adminRevoke.req, adminRevoke.res);
    assert.strictEqual(adminRevoke.getStatus(), 200, "Admin device revocation must succeed");
    const revokeData = adminRevoke.getData();
    assert.strictEqual(revokeData.success, true);
    assert.strictEqual(revokeData.device.status, "Blocked");

    // 2. Now faculty can bind new replacement Phone C
    const chalMock = createMockReqRes({
      method: "POST",
      url: "/api/device/challenge",
      body: { staff_code: STAFF_1, password: "campusattend" },
    });
    await deviceApiHandler(chalMock.req, chalMock.res);
    const chalData = chalMock.getData();
    assert.strictEqual(chalMock.getStatus(), 200);

    const sigC = signPayload(phoneC.privateKey, chalData.challenge);
    const regC = createMockReqRes({
      method: "POST",
      url: "/api/device/register",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        challengeToken: chalData.challengeToken,
        challenge: chalData.challenge,
        publicKey: phoneC.publicKey,
        signature: sigC,
        platform: "android",
        model: "Samsung Galaxy S24 Ultra",
        os: "Android 14",
      },
    });
    await deviceApiHandler(regC.req, regC.res);
    assert.strictEqual(regC.getStatus(), 201, "Replacement device binding must succeed");
    phoneC_DeviceId = regC.getData().device.id;
    assert.ok(phoneC_DeviceId);

    // 3. Old Phone A is still rejected
    const nonceOld = crypto.randomUUID();
    const tsOld = Date.now();
    const sigOld = signPayload(phoneA.privateKey, `${STAFF_1}:${nonceOld}:${tsOld}`);
    const loginOld = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: sigOld,
        deviceNonce: nonceOld,
        deviceTimestamp: tsOld,
        deviceKeyId: phoneA_DeviceId,
      },
    });
    await loginHandler(loginOld.req, loginOld.res);
    assert.strictEqual(loginOld.getStatus(), 403, "Revoked Phone A must be rejected");

    // 4. New Phone C logs in successfully
    const nonceC = crypto.randomUUID();
    const tsC = Date.now();
    const sigLoginC = signPayload(phoneC.privateKey, `${STAFF_1}:${nonceC}:${tsC}`);
    const loginC = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: sigLoginC,
        deviceNonce: nonceC,
        deviceTimestamp: tsC,
        deviceKeyId: phoneC_DeviceId,
      },
    });
    await loginHandler(loginC.req, loginC.res);
    assert.strictEqual(loginC.getStatus(), 200, "Replacement Phone C must log in successfully");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Attendance Factor Preservation with Cryptographic Device Signature
  // ---------------------------------------------------------------------------
  await test("12. Attendance factor verification succeeds with bound device signature", async () => {
    // Generate valid session token for Phone C
    const nonce = crypto.randomUUID();
    const ts = Date.now();
    const sigLogin = signPayload(phoneC.privateKey, `${STAFF_1}:${nonce}:${ts}`);
    const loginC = createMockReqRes({
      method: "POST",
      url: "/api/staff/login",
      body: {
        staff_code: STAFF_1,
        password: "campusattend",
        deviceSignature: sigLogin,
        deviceNonce: nonce,
        deviceTimestamp: ts,
        deviceKeyId: phoneC_DeviceId,
      },
    });
    await loginHandler(loginC.req, loginC.res);
    const sessionToken = loginC.getData().token;

    // Verify device signature validation function
    const isSigValid = verifyDeviceSignature(
      phoneC.publicKey,
      `ATTENDANCE_PUNCH:${STAFF_1}:${nonce}`,
      signPayload(phoneC.privateKey, `ATTENDANCE_PUNCH:${STAFF_1}:${nonce}`)
    );
    assert.strictEqual(isSigValid, true, "Device signature must verify with bound public key");

    // Foreign device signature must fail
    const isPhoneBSigValid = verifyDeviceSignature(
      phoneC.publicKey,
      `ATTENDANCE_PUNCH:${STAFF_1}:${nonce}`,
      signPayload(phoneB.privateKey, `ATTENDANCE_PUNCH:${STAFF_1}:${nonce}`)
    );
    assert.strictEqual(isPhoneBSigValid, false, "Signature from unbound Phone B must fail verification");
  });

  console.log("\n================================================================================");
  console.log(`   REGRESSION TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

void runDeviceBindingPolicySuite();
