process.env["TEST_MODE"] = "1";

import assert from "node:assert";
import crypto from "node:crypto";
import {
  buildCanonicalRecordString,
  computeRecordHmac,
  verifyRecordHmac,
} from "../api/attendance.js";

console.log("=================================================================");
console.log("   CAMPUSATTEND — END-TO-END HMAC RECORD INTEGRITY TEST SUITE   ");
console.log("=================================================================");

// 1. CANONICAL RECORD SERIALIZATION TEST
console.log("\n--- TEST 1: CANONICAL SERIALIZATION IS DETERMINISTIC ---");
const sampleRecord = {
  staff_code: "sct-001 ",
  date: "2026-10-24",
  time: "09:30 AM",
  status: "Present",
  device_id: "DEV_TEST_01",
};

const canonical1 = buildCanonicalRecordString(sampleRecord);
const canonical2 = buildCanonicalRecordString({
  staff_code: "SCT-001",
  date: "2026-10-24",
  time: "09:30 AM",
  status: "Present",
  device_id: "DEV_TEST_01",
});
assert.strictEqual(canonical1, "v1:SCT-001:2026-10-24:09:30 AM:Present:DEV_TEST_01");
assert.strictEqual(canonical1, canonical2, "Case and trimming differences produce identical canonical string");
console.log("  ✓ PASS: Canonical serialization is deterministic and normalized:", canonical1);

// 2. VALID HASH GENERATION & VERIFICATION
console.log("\n--- TEST 2: VALID HMAC PRODUCES 'VERIFIED' STATUS ---");
const validHmac = computeRecordHmac(sampleRecord);
assert.strictEqual(typeof validHmac, "string");
assert.strictEqual(validHmac.length, 64, "SHA-256 HMAC is 64 hex characters");

const validCheck = verifyRecordHmac({
  ...sampleRecord,
  record_hash: validHmac,
  tamper_status: "VERIFIED",
});
assert.strictEqual(validCheck.verified, true);
assert.strictEqual(validCheck.status, "VERIFIED");
console.log("  ✓ PASS: Authentic record hash verifies successfully as 'VERIFIED'");

// 3. TAMPERED FIELDS ARE DETECTED
console.log("\n--- TEST 3: MODIFIED FIELDS EVALUATE TO 'TAMPERED' ---");
// 3a. Altered status (e.g. Present -> Absent)
const tamperedStatus = verifyRecordHmac({
  ...sampleRecord,
  status: "Absent",
  record_hash: validHmac,
  tamper_status: "VERIFIED",
});
assert.strictEqual(tamperedStatus.verified, false);
assert.strictEqual(tamperedStatus.status, "TAMPERED");
console.log("  ✓ PASS: Modified status detected and marked 'TAMPERED'");

// 3b. Altered date
const tamperedDate = verifyRecordHmac({
  ...sampleRecord,
  date: "2026-10-25",
  record_hash: validHmac,
  tamper_status: "VERIFIED",
});
assert.strictEqual(tamperedDate.verified, false);
assert.strictEqual(tamperedDate.status, "TAMPERED");
console.log("  ✓ PASS: Modified date detected and marked 'TAMPERED'");

// 3c. Altered staff code
const tamperedStaff = verifyRecordHmac({
  ...sampleRecord,
  staff_code: "SCT-002",
  record_hash: validHmac,
  tamper_status: "VERIFIED",
});
assert.strictEqual(tamperedStaff.verified, false);
assert.strictEqual(tamperedStaff.status, "TAMPERED");
console.log("  ✓ PASS: Modified staff_code detected and marked 'TAMPERED'");

// 3d. Altered device ID
const tamperedDevice = verifyRecordHmac({
  ...sampleRecord,
  device_id: "DEV_FORGED_99",
  record_hash: validHmac,
  tamper_status: "VERIFIED",
});
assert.strictEqual(tamperedDevice.verified, false);
assert.strictEqual(tamperedDevice.status, "TAMPERED");
console.log("  ✓ PASS: Modified device_id detected and marked 'TAMPERED'");

// 4. INVALID / FORGED HASH
console.log("\n--- TEST 4: FORGED RECORD HASH EVALUATES TO 'TAMPERED' ---");
const forgedCheck = verifyRecordHmac({
  ...sampleRecord,
  record_hash: "0000000000000000000000000000000000000000000000000000000000000000",
  tamper_status: "VERIFIED",
});
assert.strictEqual(forgedCheck.verified, false);
assert.strictEqual(forgedCheck.status, "TAMPERED");
console.log("  ✓ PASS: Forged hash strictly rejected as 'TAMPERED'");

// 5. HISTORICAL ROWS
console.log("\n--- TEST 5: HISTORICAL ROWS REMAIN 'UNVERIFIED_HISTORICAL' ---");
const legacyNoHash = verifyRecordHmac({
  ...sampleRecord,
  record_hash: null,
  tamper_status: "UNVERIFIED_HISTORICAL",
});
assert.strictEqual(legacyNoHash.verified, false);
assert.strictEqual(legacyNoHash.status, "UNVERIFIED_HISTORICAL");
console.log("  ✓ PASS: Legacy record without hash correctly preserved as 'UNVERIFIED_HISTORICAL'");

const legacyExplicit = verifyRecordHmac({
  ...sampleRecord,
  record_hash: validHmac,
  tamper_status: "UNVERIFIED_HISTORICAL",
});
assert.strictEqual(legacyExplicit.verified, false);
assert.strictEqual(legacyExplicit.status, "UNVERIFIED_HISTORICAL");
console.log("  ✓ PASS: Legacy record labeled UNVERIFIED_HISTORICAL is NEVER elevated to 'VERIFIED'");

// 6. WRONG SECRET KEY
console.log("\n--- TEST 6: HASH WITH WRONG SECRET KEY EVALUATES TO 'TAMPERED' ---");
const wrongSecretHash = crypto.createHmac("sha256", "wrong-secret-key").update(canonical1).digest("hex");
const wrongSecretCheck = verifyRecordHmac({
  ...sampleRecord,
  record_hash: wrongSecretHash,
  tamper_status: "VERIFIED",
});
assert.strictEqual(wrongSecretCheck.verified, false);
assert.strictEqual(wrongSecretCheck.status, "TAMPERED");
console.log("  ✓ PASS: Hash computed with wrong secret fails closed as 'TAMPERED'");

// 7. KEY ROTATION: PREVIOUS KEY STILL VERIFIES HISTORICAL RECORDS
console.log("\n--- TEST 7: KEY ROTATION PRESERVES HISTORICAL RECORD VERIFICATION ---");
const oldKey = "historical-signing-key-from-2025-at-least-32-chars";
const historicalHash = crypto.createHmac("sha256", oldKey).update(canonical1).digest("hex");

// Configure previous secret in key ring
process.env["RECORD_HMAC_PREVIOUS_SECRETS"] = `${oldKey},another-archived-key-2024`;
const rotationCheck = verifyRecordHmac({
  ...sampleRecord,
  record_hash: historicalHash,
  tamper_status: "VERIFIED",
});
assert.strictEqual(rotationCheck.verified, true, "Historical record verified using rotated previous key");
assert.strictEqual(rotationCheck.status, "VERIFIED");
console.log("  ✓ PASS: Historical record successfully verified using previous key in keyring");

// Clean up previous secrets
delete process.env["RECORD_HMAC_PREVIOUS_SECRETS"];

// 8. PRODUCTION FAIL-CLOSED TEST: MISSING / SHORT SECRET NEVER PRODUCES 'VERIFIED'
console.log("\n--- TEST 8: PRODUCTION FAILS CLOSED IF SECRET IS MISSING OR SHORT ---");
const prevNodeEnv = process.env["NODE_ENV"];
const prevRecordHmac = process.env["RECORD_HMAC_SECRET"];
try {
  // Simulate production with no secret
  process.env["NODE_ENV"] = "production";
  delete process.env["RECORD_HMAC_SECRET"];
  const prodCheckMissing = verifyRecordHmac({
    ...sampleRecord,
    record_hash: validHmac,
    tamper_status: "VERIFIED",
  });
  assert.strictEqual(prodCheckMissing.verified, false);
  assert.strictEqual(prodCheckMissing.status, "TAMPERED");
  console.log("  ✓ PASS: Missing secret in production strictly fails closed (never VERIFIED)");

  // Simulate production with short secret (< 32 chars)
  process.env["RECORD_HMAC_SECRET"] = "short-secret";
  const prodCheckShort = verifyRecordHmac({
    ...sampleRecord,
    record_hash: validHmac,
    tamper_status: "VERIFIED",
  });
  assert.strictEqual(prodCheckShort.verified, false);
  assert.strictEqual(prodCheckShort.status, "TAMPERED");
  console.log("  ✓ PASS: Low-entropy secret (< 32 chars) in production strictly fails closed");
} finally {
  process.env["NODE_ENV"] = prevNodeEnv;
  if (prevRecordHmac) process.env["RECORD_HMAC_SECRET"] = prevRecordHmac;
  else delete process.env["RECORD_HMAC_SECRET"];
}

console.log("\n=================================================================");
console.log("   ALL HMAC RECORD INTEGRITY CHECKS PASSED (8/8)               ");
console.log("=================================================================\n");
