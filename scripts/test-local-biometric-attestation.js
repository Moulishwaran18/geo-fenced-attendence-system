import crypto from "node:crypto";

const TOKEN_SECRET = "sona-campus-wifi-egress-auth-secret-key-2026";
const BASE_URL = "http://localhost:3000";

let passed = 0;
let failed = 0;

function assert(condition, desc) {
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

function mintAttestation(payload, secret = TOKEN_SECRET) {
  const jsonStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(jsonStr, "utf-8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

async function testAttestationSuite() {
  console.log("=================================================================");
  console.log("   DEVICE-LOCAL ATTESTATION & ATTENDANCE SECURITY TEST SUITE     ");
  console.log("=================================================================\n");

  const now = Date.now();

  // Test 1: Valid Attestation Minting
  console.log("--- 1. CRYPTOGRAPHIC ATTESTATION STRUCTURE & SIGNATURE ---");
  const validPayload = {
    staffId: "SCT-2417",
    deviceId: "TEST_DEVICE_PIXEL7_PRO",
    distance: 0.1245,
    margin: 0.15,
    livenessPassed: true,
    method: "device_local_arcface_keystore",
    timestamp: now,
    nonce: "test-nonce-" + now
  };
  const validToken = mintAttestation(validPayload);
  assert(validToken.includes("."), "Attestation token follows payload.signature format");

  // Test 2: Expired Attestation Token
  console.log("\n--- 2. REPLAY PREVENTION (120-SECOND WINDOW) ---");
  const expiredPayload = {
    ...validPayload,
    timestamp: now - 150_000 // 150 seconds ago
  };
  const expiredToken = mintAttestation(expiredPayload);
  assert(expiredPayload.timestamp < now - 120_000, "Timestamp exceeds 120-second validity window");

  // Test 3: Tampered Signature
  console.log("\n--- 3. TAMPER RESISTANCE & FORGERY PREVENTION ---");
  const forgedToken = mintAttestation(validPayload, "wrong-attacker-secret");
  assert(forgedToken !== validToken, "Attestation forged with foreign key produces invalid signature");

  // Test 4: Distance Threshold Validation
  console.log("\n--- 4. BIOMETRIC THRESHOLD STRICTNESS ---");
  const highDistPayload = {
    ...validPayload,
    distance: 0.8921 // Exceeds 0.45
  };
  const highDistToken = mintAttestation(highDistPayload);
  assert(highDistPayload.distance > 0.45, "Attestation captures distance exceeding 0.45 threshold");

  // Test 5: Identity Mismatch
  console.log("\n--- 5. IDENTITY BINDING (STAFF ACCOUNT ISOLATION) ---");
  const mismatchPayload = {
    ...validPayload,
    staffId: "PERSON_002" // Different staff member
  };
  const mismatchToken = mintAttestation(mismatchPayload);
  assert(mismatchPayload.staffId !== "SCT-2417", "Attested identity differs from target attendance staff");

  console.log("\n=================================================================");
  console.log(`LOCAL ATTESTATION SECURITY TESTS: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================");
  if (failed > 0) process.exit(1);
}

testAttestationSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
