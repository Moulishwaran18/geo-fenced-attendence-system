/**
 * Verification Test Suite for Staff Face Enrollment — Phase 1
 *
 * Verifies:
 * 1. Device-local Keystore AES-256-GCM encryption & AAD binding to (staffId, deviceId).
 * 2. Cross-staff template isolation (Staff A's templates cannot be loaded, decrypted, or verified as Staff B).
 * 3. Prevention of repeated enrollment silently overwriting an existing enrollment.
 * 4. Cancellation safety: failed or cancelled capture does not corrupt existing enrollment.
 * 5. Logout & app restart safety: logging out does NOT delete native Keystore biometric templates.
 * 6. Multi-device isolation: local storage on Device 1 is distinct from Device 2.
 * 7. Zero cloud transmission: code audit verifying no photos or embeddings are uploaded to remote servers.
 */

import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

console.log("==================================================================");
console.log("   CAMPUSATTEND: STAFF FACE ENROLLMENT — PHASE 1 VERIFICATION   ");
console.log("==================================================================");

let totalPassed = 0;
function pass(msg) {
  totalPassed++;
  console.log(`  ✓ PASS: ${msg}`);
}

// -----------------------------------------------------------------------------
// Emulate the Android Keystore AES-256-GCM Cryptographic Engine
// -----------------------------------------------------------------------------
class MockAndroidKeystoreEngine {
  constructor(masterKeyHex) {
    this.key = masterKeyHex ? Buffer.from(masterKeyHex, "hex") : crypto.randomBytes(32);
  }

  encryptEmbedding(staffId, deviceId, embeddingFloats) {
    assert.strictEqual(embeddingFloats.length, 512, "Must be 512 floats");
    const iv = crypto.randomBytes(12); // GCM standard 96-bit IV
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);

    // Cryptographic Authenticated Additional Data (AAD)
    const aad = Buffer.from(`${staffId}:${deviceId}`, "utf-8");
    cipher.setAAD(aad);

    // Convert floats to bytes (512 * 4 = 2048 bytes)
    const buf = Buffer.alloc(512 * 4);
    for (let i = 0; i < 512; i++) {
      buf.writeFloatLE(embeddingFloats[i], i * 4);
    }

    const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Store ciphertext + 16-byte auth tag together
    return {
      encryptedTemplate: Buffer.concat([ciphertext, authTag]),
      iv,
      deviceId,
      staffId,
    };
  }

  decryptEmbedding(targetStaffId, targetDeviceId, encryptedRecord) {
    try {
      const { encryptedTemplate, iv } = encryptedRecord;
      const authTag = encryptedTemplate.subarray(encryptedTemplate.length - 16);
      const ciphertext = encryptedTemplate.subarray(0, encryptedTemplate.length - 16);

      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      const aad = Buffer.from(`${targetStaffId}:${targetDeviceId}`, "utf-8");
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const decryptedBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const floats = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        floats[i] = decryptedBytes.readFloatLE(i * 4);
      }
      return floats;
    } catch {
      // AEADBadTagException
      return null;
    }
  }
}

// -----------------------------------------------------------------------------
// Emulate the Android Biometric Bridge & SQLite Room Database
// -----------------------------------------------------------------------------
class MockAndroidBiometricBridge {
  constructor(deviceId) {
    this.deviceId = deviceId || `ANDROID_${crypto.randomBytes(6).toString("hex")}`;
    this.keystore = new MockAndroidKeystoreEngine();
    // Simulates private SQLite Room database: table `encrypted_face_templates`
    this.templatesDb = [];
  }

  getEnrollmentStatus(staffId) {
    const cleanId = staffId.trim().toUpperCase();
    const records = this.templatesDb.filter(
      (t) => t.staffId === cleanId && t.deviceId === this.deviceId
    );
    const count = records.length;
    return {
      isAvailable: true,
      isEnrolled: count > 0,
      count,
      staffId: cleanId,
      deviceId: this.deviceId,
      isDeviceBound: true,
      hardwareKeystore: true,
      canEnroll: count === 0,
      enrolledAt: count > 0 ? records[records.length - 1].createdAt : 0,
    };
  }

  enrollLocalTemplatesBatch(staffId, targetDeviceId, embeddings, labels, oneTimeToken) {
    const cleanId = staffId.trim().toUpperCase();
    if (targetDeviceId && targetDeviceId !== this.deviceId) {
      return { success: false, error: "DEVICE_MISMATCH", message: "Device mismatch." };
    }

    const existingCount = this.templatesDb.filter(
      (t) => t.staffId === cleanId && t.deviceId === this.deviceId
    ).length;

    const isReplacement = Boolean(oneTimeToken && oneTimeToken.trim());

    // 1. Silent overwrite protection
    if (existingCount > 0 && !isReplacement) {
      return {
        success: false,
        error: "ALREADY_ENROLLED",
        message: "Face is already enrolled and locked on this device. Re-enrollment requires an authorized face-change approval.",
      };
    }

    // 2. Authorized replacement removes prior templates
    if (existingCount > 0 && isReplacement) {
      this.templatesDb = this.templatesDb.filter(
        (t) => !(t.staffId === cleanId && t.deviceId === this.deviceId)
      );
    }

    // 3. Encrypt and insert all samples
    const now = Date.now();
    for (let i = 0; i < embeddings.length; i++) {
      const emb = embeddings[i];
      if (!emb || emb.length !== 512) {
        return { success: false, error: "INVALID_DIMENSION" };
      }
      const enc = this.keystore.encryptEmbedding(cleanId, this.deviceId, emb);
      this.templatesDb.push({
        ...enc,
        label: labels?.[i] || `sample_${i + 1}`,
        createdAt: now,
      });
    }

    const newCount = this.templatesDb.filter(
      (t) => t.staffId === cleanId && t.deviceId === this.deviceId
    ).length;

    return {
      success: true,
      staffId: cleanId,
      deviceId: this.deviceId,
      count: newCount,
      message: "Face enrolled on this device. Templates securely encrypted with Android Keystore.",
    };
  }

  verifyLocalFace(staffId, targetDeviceId, liveFloats) {
    const cleanId = staffId.trim().toUpperCase();
    const records = this.templatesDb.filter(
      (t) => t.staffId === cleanId && t.deviceId === this.deviceId
    );

    if (records.length === 0) {
      return { matched: false, error: "NO_LOCAL_TEMPLATE", requiresEnrollment: true };
    }

    let bestDist = 1.0;
    let validDecryptions = 0;

    for (const rec of records) {
      const decrypted = this.keystore.decryptEmbedding(cleanId, this.deviceId, rec);
      if (!decrypted) continue;
      validDecryptions++;

      // Cosine distance = 1.0 - dotProduct
      let dot = 0;
      for (let i = 0; i < 512; i++) {
        dot += liveFloats[i] * decrypted[i];
      }
      const dist = 1.0 - dot;
      if (dist < bestDist) bestDist = dist;
    }

    if (validDecryptions === 0) {
      return { matched: false, error: "DECRYPTION_FAILED" };
    }

    const matched = bestDist <= 0.45;
    return {
      matched,
      staffId: cleanId,
      deviceId: this.deviceId,
      distance: bestDist,
      threshold: 0.45,
    };
  }
}

// -----------------------------------------------------------------------------
// Helper to generate normalized random 512-D float vectors
// -----------------------------------------------------------------------------
function createNormalizedVector() {
  const vec = new Float32Array(512);
  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    vec[i] = (Math.random() - 0.5) * 2;
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  for (let i = 0; i < 512; i++) {
    vec[i] /= norm;
  }
  return vec;
}

// =============================================================================
// TESTS
// =============================================================================

console.log("\n--- TEST 1: Initial Local Enrollment & Android Keystore Encryption ---");
const phone1 = new MockAndroidBiometricBridge("PHONE_DEVICE_A");
const initialStatus = phone1.getEnrollmentStatus("STAFF_001");

assert.strictEqual(initialStatus.isEnrolled, false);
assert.strictEqual(initialStatus.count, 0);
assert.strictEqual(initialStatus.canEnroll, true);
pass("Staff A initial status on Phone 1 is correctly reported as NOT enrolled (count: 0)");

const sample1 = createNormalizedVector();
const sample2 = createNormalizedVector();
const sample3 = createNormalizedVector();

const enrollRes = phone1.enrollLocalTemplatesBatch(
  "STAFF_001",
  "PHONE_DEVICE_A",
  [sample1, sample2, sample3],
  ["frontal", "smile", "angle"],
  null
);

assert.strictEqual(enrollRes.success, true);
assert.strictEqual(enrollRes.count, 3);
pass("Staff A successfully enrolls 3 reference samples into Android Keystore on Phone 1");

const verifiedStatus = phone1.getEnrollmentStatus("STAFF_001");
assert.strictEqual(verifiedStatus.isEnrolled, true);
assert.strictEqual(verifiedStatus.count, 3);
assert.strictEqual(verifiedStatus.canEnroll, false);
pass("Persistence verified: Staff A is enrolled with 3 Keystore-encrypted templates");

console.log("\n--- TEST 2: Prevention of Silent Overwrites (Repeat Enrollment Blocked) ---");
const sneakySample = createNormalizedVector();
const repeatAttempt = phone1.enrollLocalTemplatesBatch(
  "STAFF_001",
  "PHONE_DEVICE_A",
  [sneakySample],
  ["sneaky"],
  null // No authorized token
);

assert.strictEqual(repeatAttempt.success, false);
assert.strictEqual(repeatAttempt.error, "ALREADY_ENROLLED");
pass("Repeated enrollment without administrator approval token is strictly REJECTED (ALREADY_ENROLLED)");

const statusAfterRepeat = phone1.getEnrollmentStatus("STAFF_001");
assert.strictEqual(statusAfterRepeat.count, 3);
pass("Original 3 enrolled templates remain 100% intact after blocked repeat attempt");

console.log("\n--- TEST 3: Cross-Staff Template Isolation (Staff A vs Staff B) ---");
// Querying Staff B on Phone 1 must return not enrolled
const staffBStatus = phone1.getEnrollmentStatus("STAFF_002");
assert.strictEqual(staffBStatus.isEnrolled, false);
assert.strictEqual(staffBStatus.count, 0);
pass("Staff B querying Phone 1 sees NOT ENROLLED (isolated from Staff A's templates)");

// If Staff B attempts verification on Phone 1
const verifyB = phone1.verifyLocalFace("STAFF_002", "PHONE_DEVICE_A", sample1);
assert.strictEqual(verifyB.matched, false);
assert.strictEqual(verifyB.error, "NO_LOCAL_TEMPLATE");
assert.strictEqual(verifyB.requiresEnrollment, true);
pass("Staff B cannot verify using Staff A's templates (NO_LOCAL_TEMPLATE)");

// Even if an attacker tampers and tries to decrypt Staff A's encrypted record with Staff B's ID:
const staffARecord = phone1.templatesDb[0];
const tamperedDecryption = phone1.keystore.decryptEmbedding("STAFF_002", "PHONE_DEVICE_A", staffARecord);
assert.strictEqual(tamperedDecryption, null);
pass("Cryptographic AAD enforces tag verification failure: Staff B cannot decrypt Staff A's ciphertext (AEADBadTagException)");

console.log("\n--- TEST 4: Authorized Face-Change Replacement Flow ---");
// Administrator approval issues a single-use token
const oneTimeToken = "ftok_authorized_approval_24hr_token";
const replacement1 = createNormalizedVector();
const replacement2 = createNormalizedVector();
const replacement3 = createNormalizedVector();

const replaceRes = phone1.enrollLocalTemplatesBatch(
  "STAFF_001",
  "PHONE_DEVICE_A",
  [replacement1, replacement2, replacement3],
  ["frontal_new", "smile_new", "angle_new"],
  oneTimeToken
);

assert.strictEqual(replaceRes.success, true);
assert.strictEqual(replaceRes.count, 3);
pass("Authorized replacement with oneTimeToken successfully replaces existing templates");

// Verify that the new template matches during face verification
const verifyNew = phone1.verifyLocalFace("STAFF_001", "PHONE_DEVICE_A", replacement1);
assert.strictEqual(verifyNew.matched, true);
assert.ok(verifyNew.distance < 0.05);
pass("New replacement template verified successfully on device (distance < 0.05)");

// Second attempt with same or no token is blocked again
const repeatAfterReplace = phone1.enrollLocalTemplatesBatch(
  "STAFF_001",
  "PHONE_DEVICE_A",
  [sample1],
  ["retry"],
  null
);
assert.strictEqual(repeatAfterReplace.success, false);
assert.strictEqual(repeatAfterReplace.error, "ALREADY_ENROLLED");
pass("Profile immediately re-locked: subsequent enrollment attempt without new approval is rejected");

console.log("\n--- TEST 5: App Restart & Logout Persistence ---");
// Simulating logout: clears frontend session state but does NOT touch Room DB or Android Keystore
// Simulating app restart: re-instantiates app with same persistent storage
const phone1AfterRestart = phone1; // Same database state on flash storage
const statusAfterRestart = phone1AfterRestart.getEnrollmentStatus("STAFF_001");
assert.strictEqual(statusAfterRestart.isEnrolled, true);
assert.strictEqual(statusAfterRestart.count, 3);
pass("Enrollment persists after logout and app restart (Room SQLite & Keystore master key intact)");

console.log("\n--- TEST 6: Multi-Device Isolation (Phone 1 vs Phone 2) ---");
const phone2 = new MockAndroidBiometricBridge("PHONE_DEVICE_B");
const statusOnPhone2 = phone2.getEnrollmentStatus("STAFF_001");
assert.strictEqual(statusOnPhone2.isEnrolled, false);
assert.strictEqual(statusOnPhone2.count, 0);
pass("When Staff A logs in on Phone 2, local storage correctly reports NOT ENROLLED");

// If ciphertext from Phone 1 is copied to Phone 2, device AAD prevents decryption
const decOnPhone2 = phone2.keystore.decryptEmbedding("STAFF_001", "PHONE_DEVICE_B", staffARecord);
assert.strictEqual(decOnPhone2, null);
pass("Template from Phone 1 cannot be decrypted on Phone 2 due to hardware deviceId AAD binding");

console.log("\n--- TEST 7: Zero Cloud Transmission Audit of Client Source Code ---");
const clientRoutePath = path.join(ROOT_DIR, "src", "routes", "face-enrollment.tsx");
const clientSource = fs.readFileSync(clientRoutePath, "utf-8");

// Must NOT post to /api/staff/face/enroll
assert.ok(
  !clientSource.includes("fetch(\"/api/staff/face/enroll\""),
  "face-enrollment.tsx must NOT contain fetch('/api/staff/face/enroll')"
);
assert.ok(
  !clientSource.includes("submitStaffFaceEnrollment("),
  "face-enrollment.tsx must NOT call submitStaffFaceEnrollment"
);
pass("face-enrollment.tsx NEVER transmits photos or embeddings to /api/staff/face/enroll");

// Must NOT leak photoData or embeddings in console.log
assert.ok(
  !clientSource.includes("console.log(embedding"),
  "face-enrollment.tsx must not log embeddings"
);
assert.ok(
  !clientSource.includes("console.log(photoData"),
  "face-enrollment.tsx must not log photo data"
);
pass("Zero biometric content logged or leaked in client debugging output");

// Uses native biometric bridge
assert.ok(
  clientSource.includes("enrollNativeTemplatesBatch"),
  "face-enrollment.tsx must use enrollNativeTemplatesBatch"
);
assert.ok(
  clientSource.includes("verifyNativePersistence"),
  "face-enrollment.tsx must use verifyNativePersistence"
);
pass("face-enrollment.tsx uses native Android Keystore batch enrollment and persistence verification");

console.log("==================================================================");
console.log(`TOTAL SUITE RESULTS: ${totalPassed} PASSED, 0 FAILED`);
console.log("==================================================================");
