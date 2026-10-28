import crypto from "node:crypto";
import { registerDeviceForStaff, getActiveDeviceForStaff, revokeDevice } from "../src/server/device-binding";

console.log("=================================================================");
console.log("   CAMPUSATTEND — REGISTERED DEVICES FLOW & ENFORCEMENT TEST    ");
console.log("=================================================================\n");

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} - ${detail || "Condition not met"}`);
  }
}

// Generate valid ECDSA P-256 key pair
const { publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const pemKey = publicKey.export({ type: "spki", format: "pem" }).toString();

const { publicKey: publicKey2 } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const pemKey2 = publicKey2.export({ type: "spki", format: "pem" }).toString();

async function runTests() {
  const staffId1 = "TEST_STAFF_001";
  const staffName1 = "Dr. Test Professor";
  const dept1 = "Computer Science and Engineering";
  const deviceId1 = "DEV_ANDROID_TEST_PHONE_001";

  const staffId2 = "TEST_STAFF_002";
  const staffName2 = "Prof. Second Faculty";
  const dept2 = "Electronics and Communication Engineering";
  const deviceId2 = "DEV_ANDROID_TEST_PHONE_002";

  console.log("--- TEST 1: Initial Registration & Persistence ---");
  const reg1 = await registerDeviceForStaff({
    staffId: staffId1,
    staffCode: staffId1,
    staffName: staffName1,
    keyId: deviceId1,
    publicKey: pemKey,
    platform: "android",
    attestationStatus: "Verified",
    attestationType: "StrongBox",
    model: "Google Pixel 8 Pro",
    os: "Android 14",
    auditMetadata: { department: dept1 },
  });

  assert(reg1.success === true, "Staff 1 device registration succeeded");
  assert(reg1.device?.id === deviceId1, "Device ID matches registered ID");
  assert(reg1.device?.staff_code === staffId1, "Staff code bound correctly");

  console.log("\n--- TEST 2: Active Device Query ---");
  const activeDev = await getActiveDeviceForStaff(staffId1);
  assert(activeDev !== null, "Active device found for registered staff");
  assert(activeDev?.id === deviceId1, "Active device ID matches");
  assert(activeDev?.status === "Active", "Device status is Active");

  console.log("\n--- TEST 3: Rule 1 — Duplicate Active Device for Same Staff Blocked ---");
  const dupStaffReg = await registerDeviceForStaff({
    staffId: staffId1,
    staffCode: staffId1,
    staffName: staffName1,
    keyId: "DEV_ANDROID_ANOTHER_PHONE",
    publicKey: pemKey2,
    platform: "android",
    attestationStatus: "Verified",
    attestationType: "StrongBox",
    model: "Samsung Galaxy S24",
    os: "Android 14",
  });

  assert(dupStaffReg.success === false, "Second device registration for same staff rejected");
  assert(dupStaffReg.statusCode === 409, "Rejection returns HTTP 409 Conflict");
  assert(dupStaffReg.error?.includes("DEVICE_ALREADY_EXISTS"), "Error indicates DEVICE_ALREADY_EXISTS");

  console.log("\n--- TEST 4: Rule 2 — Same Physical Device Bound to Another Account Blocked ---");
  const dupDevReg = await registerDeviceForStaff({
    staffId: staffId2,
    staffCode: staffId2,
    staffName: staffName2,
    keyId: deviceId1, // Attempting to bind Staff 1's device to Staff 2
    publicKey: pemKey,
    platform: "android",
    attestationStatus: "Verified",
    attestationType: "StrongBox",
    model: "Google Pixel 8 Pro",
    os: "Android 14",
  });

  assert(dupDevReg.success === false, "Binding same device to another staff rejected");
  assert(dupDevReg.statusCode === 409, "Rejection returns HTTP 409 Conflict");
  assert(dupDevReg.error?.includes("DEVICE_BOUND_TO_ANOTHER_ACCOUNT"), "Error indicates DEVICE_BOUND_TO_ANOTHER_ACCOUNT");

  console.log("\n--- TEST 5: Idempotent Re-registration for Same Device & Staff Allowed ---");
  const retrySame = await registerDeviceForStaff({
    staffId: staffId1,
    staffCode: staffId1,
    staffName: staffName1,
    keyId: deviceId1,
    publicKey: pemKey,
    platform: "android",
    attestationStatus: "Verified",
    attestationType: "StrongBox",
    model: "Google Pixel 8 Pro",
    os: "Android 14",
  });

  assert(retrySame.success === true, "Idempotent re-registration of same device succeeds");
  assert(retrySame.statusCode === 200, "Returns HTTP 200 for idempotent retry");

  console.log("\n--- TEST 6: Unregistered Staff Attendance Rejection ---");
  const unregStaffDev = await getActiveDeviceForStaff("UNKNOWN_STAFF_999");
  assert(unregStaffDev === null, "Unregistered staff has no active device");

  console.log("\n--- TEST 7: Authorized Device Revocation & Replacement Lifecycle ---");
  const revokeRes = await revokeDevice({
    deviceId: deviceId1,
    reason: "Device lost by faculty member",
    adminUsername: "admin_tester",
    staffCode: staffId1,
  });

  assert(revokeRes.success === true, "Admin device revocation succeeded");

  const devAfterRevoke = await getActiveDeviceForStaff(staffId1);
  assert(devAfterRevoke === null, "Staff member has no active device after revocation");

  // Now faculty can register replacement device
  const replacementReg = await registerDeviceForStaff({
    staffId: staffId1,
    staffCode: staffId1,
    staffName: staffName1,
    keyId: deviceId2,
    publicKey: pemKey2,
    platform: "android",
    attestationStatus: "Verified",
    attestationType: "StrongBox",
    model: "Samsung Galaxy S24 Ultra",
    os: "Android 14",
    auditMetadata: { department: dept1 },
  });

  assert(replacementReg.success === true, "Replacement device registration succeeded after authorized revocation");
  assert(replacementReg.device?.id === deviceId2, "Replacement device ID matches");

  console.log(`\n=================================================================`);
  console.log(`   TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log(`=================================================================`);

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
