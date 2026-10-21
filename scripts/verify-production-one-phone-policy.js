/**
 * CampusAttend — Live Production One Faculty ID = One Phone Verification Suite
 * Target: https://geo-fenced-attendence-system.vercel.app
 */

import assert from "node:assert";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.PRODUCTION_URL || "https://geo-fenced-attendence-system.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    failed++;
  }
}

async function runProductionTests() {
  console.log("================================================================================");
  console.log("   LIVE PRODUCTION VERIFICATION: ONE FACULTY ID = ONE PHONE POLICY             ");
  console.log(`   Target: ${BASE_URL}`);
  console.log("================================================================================\n");

  // Wait a few seconds for Vercel deployment if fresh push
  console.log("Checking live production service availability...");
  const ping = await fetch(BASE_URL);
  assert.strictEqual(ping.status, 200, `Production web app must be live (got HTTP ${ping.status})`);
  console.log("Live production web app is reachable (HTTP 200).\n");

  // Pre-test clean up for devices belonging to SCT-001 so we test fresh registration
  await supabase.from("devices").delete().eq("staff_code", "SCT-001");

  const phoneA = await generateDeviceKeyPair();
  const phoneB = await generateDeviceKeyPair();

  let phoneADeviceId;
  let phoneAToken;
  let adminToken;

  console.log("--- 1. CRITICAL ACCOUNT & DATA PRESERVATION CHECKS ---");
  await test("Administrator 'moulish' can authenticate on live production API", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "moulish",
        password: "moulish@123",
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
    adminToken = data.token;
    assert.ok(adminToken, "Admin token received");
  });

  await test("Faculty accounts (SCT-001 to SCT-005) are preserved in Supabase production", async () => {
    const { data: staffList, error } = await supabase
      .from("staff")
      .select("staff_code, name, active")
      .in("staff_code", ["SCT-001", "SCT-002", "SCT-003", "SCT-004", "SCT-005"]);
    assert.ifError(error);
    assert.strictEqual(staffList.length, 5);
    const sct001 = staffList.find((s) => s.staff_code === "SCT-001");
    assert.ok(sct001 && sct001.active);
  });

  console.log("\n--- 2. REGISTER SCT-001 ON PHONE A (LIVE DEPLOYED API) ---");
  await test("First login of SCT-001 on Phone A binds device and succeeds (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const deviceSignature = await signWithDeviceKey(phoneA.keyPair.privateKey, payloadToSign);

    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
        publicKey: phoneA.publicKeyBase64,
        deviceSignature,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Production Phone A (Samsung S24 Ultra)",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
    assert.ok(data.token, "Must return signed session token");
    assert.ok(data.device, "Must return registered device info");
    phoneADeviceId = data.device.id;
    phoneAToken = data.token;
    assert.ok(phoneADeviceId);
  });

  await test("Production Supabase database recorded Phone A for SCT-001", async () => {
    const { data: device } = await supabase
      .from("devices")
      .select("*")
      .eq("staff_code", "SCT-001")
      .eq("status", "Active")
      .maybeSingle();

    assert.ok(device, "Active device must exist in Supabase");
    assert.strictEqual(device.id, phoneADeviceId);
    assert.strictEqual(device.status, "Active");
  });

  console.log("\n--- 3. ENTER SCT-001 CREDENTIALS ON PHONE B (LIVE REJECTION) ---");
  await test("Enter SCT-001 credentials on Phone B: rejected with HTTP 403 DEVICE_MISMATCH", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneBSig = await signWithDeviceKey(phoneB.keyPair.privateKey, payloadToSign);

    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend", // Correct password!
        publicKey: phoneB.publicKeyBase64,
        deviceSignature: phoneBSig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Production Phone B (Google Pixel 8 Pro)",
        os: "Android 14",
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.error, "DEVICE_MISMATCH");
    assert.ok(data.message.includes("bound to another registered device") || data.message.includes("One Faculty ID = One Phone"));
  });

  await test("Database binding was NOT automatically changed to Phone B", async () => {
    const { data: device } = await supabase
      .from("devices")
      .select("*")
      .eq("staff_code", "SCT-001")
      .eq("status", "Active")
      .maybeSingle();

    assert.ok(device);
    assert.strictEqual(device.id, phoneADeviceId, "Device ID must STILL be Phone A");
  });

  console.log("\n--- 4. TRY LOGGING IN AGAIN ON PHONE A (LIVE SUCCESS) ---");
  await test("Original phone (Phone A) logs in again and succeeds (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneASig = await signWithDeviceKey(phoneA.keyPair.privateKey, payloadToSign);

    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: phoneASig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        deviceKeyId: phoneADeviceId,
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
    phoneAToken = data.token;
  });

  console.log("\n--- 5. BACKEND API BYPASS ATTEMPTS ON PRODUCTION ---");
  await test("Bypass attempt without signature: strictly rejected (HTTP 403)", async () => {
    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, "DEVICE_MISMATCH");
  });

  console.log("\n--- 6. SESSION RESTORATION ON LIVE PRODUCTION ---");
  await test("Session restoration on Phone A via GET /api/staff/session succeeds (HTTP 200)", async () => {
    const res = await fetch(`${BASE_URL}/api/staff/session`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${phoneAToken}`,
      },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.device.id, phoneADeviceId);
  });

  console.log("\n--- 7. ADMINISTRATOR REVOCATION ON LIVE PRODUCTION ---");
  await test("Admin 'moulish' revokes Phone A via POST /api/admin/devices/revoke", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/devices/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        deviceId: phoneADeviceId,
        staffCode: "SCT-001",
        reason: "Production test: Authorized replacement procedure",
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
  });

  await test("Revoked Phone A cannot log in on production (HTTP 403 DEVICE_REVOKED)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneASig = await signWithDeviceKey(phoneA.keyPair.privateKey, payloadToSign);

    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
        deviceSignature: phoneASig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        deviceKeyId: phoneADeviceId,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, "DEVICE_REVOKED");
  });

  console.log("\n--- 8. PHONE B REPLACEMENT REGISTRATION ON LIVE PRODUCTION ---");
  await test("Phone B can now register as replacement device (HTTP 200)", async () => {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const payloadToSign = `SCT-001:${nonce}:${timestamp}`;
    const phoneBSig = await signWithDeviceKey(phoneB.keyPair.privateKey, payloadToSign);

    const res = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
        publicKey: phoneB.publicKeyBase64,
        deviceSignature: phoneBSig,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        platform: "android",
        model: "Production Phone B (Google Pixel 8 Pro)",
        os: "Android 14",
        isHardwareBacked: true,
        isStrongBox: true,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.device.model, "Production Phone B (Google Pixel 8 Pro)");
  });

  // Final cleanup of test device for SCT-001
  await supabase.from("devices").delete().eq("staff_code", "SCT-001");

  console.log("\n================================================================================");
  console.log(`PRODUCTION TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

runProductionTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
