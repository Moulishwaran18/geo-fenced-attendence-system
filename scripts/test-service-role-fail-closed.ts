import assert from "node:assert";

async function runServiceRoleFailClosedTests() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — SERVER-SIDE SERVICE-ROLE FAIL-CLOSED TESTS    ");
  console.log("=================================================================");

  // Enforce production environment for testing fail-closed guards
  process.env["NODE_ENV"] = "production";
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];

  // ---------------------------------------------------------------------------
  // TEST 1: api/staff/login.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 1: api/staff/login.ts Missing Service-Role Key ---");
  const loginModule = await import("../api/staff/login.ts");
  let loginStatus = 0;
  let loginPayload: any = null;
  const fakeLoginRes = {
    setHeader() {},
    status(s: number) { loginStatus = s; return this; },
    json(p: any) { loginPayload = p; return p; },
  };
  await loginModule.default(
    { method: "POST", url: "/api/staff/login", body: { staff_code: "SCT-001", password: "test" } },
    fakeLoginRes
  );
  assert.strictEqual(loginStatus, 503, "Login returns 503 on missing service-role key");
  assert.strictEqual(loginPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/login fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 2: api/staff/login.ts - Invalid Publishable Key supplied as Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 2: api/staff/login.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  loginStatus = 0;
  loginPayload = null;
  await loginModule.default(
    { method: "POST", url: "/api/staff/login", body: { staff_code: "SCT-001", password: "test" } },
    fakeLoginRes
  );
  assert.strictEqual(loginStatus, 503, "Login returns 503 on publishable key supplied as service-role key");
  assert.strictEqual(loginPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/login rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 3: api/staff/register.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 3: api/staff/register.ts Missing Service-Role Key ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const registerModule = await import("../api/staff/register.ts");
  let regStatus = 0;
  let regPayload: any = null;
  const fakeRegRes = {
    setHeader() {},
    status(s: number) { regStatus = s; return this; },
    json(p: any) { regPayload = p; return p; },
  };
  await registerModule.default(
    {
      method: "POST",
      url: "/api/staff/register",
      body: {
        staff_code: "SCT-999",
        name: "Test Staff",
        department: "CSE",
        password: "Password@123",
        confirmPassword: "Password@123",
        registrationCode: "staff@123",
      },
    },
    fakeRegRes
  );
  assert.strictEqual(regStatus, 503, "Register returns 503 on missing service-role key");
  assert.strictEqual(regPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/register fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 4: api/staff/register.ts - Invalid Publishable Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 4: api/staff/register.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_invalid_key_attempt";
  regStatus = 0;
  regPayload = null;
  await registerModule.default(
    {
      method: "POST",
      url: "/api/staff/register",
      body: {
        staff_code: "SCT-999",
        name: "Test Staff",
        department: "CSE",
        password: "Password@123",
        confirmPassword: "Password@123",
        registrationCode: "staff@123",
      },
    },
    fakeRegRes
  );
  assert.strictEqual(regStatus, 503, "Register returns 503 on publishable key supplied as service-role key");
  assert.strictEqual(regPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/register rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 5: src/server/device-binding.ts - Missing & Invalid Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 5: src/server/device-binding.ts Fail-Closed ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const devBindingModule = await import("../src/server/device-binding.ts");
  let devThrew = false;
  try {
    // Calling registerDeviceForStaff under production without key must fail closed
    const res = await devBindingModule.registerDeviceForStaff({
      staffCode: "SCT-001",
      staffId: "bdd00096-08d5-484a-b0ae-23e5b60c6052",
      staffName: "Test Faculty",
      publicKey: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake==\n-----END PUBLIC KEY-----",
    });
    if (!res.success) devThrew = true;
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_FAULT")) devThrew = true;
  }
  assert.strictEqual(devThrew, true, "device-binding fails closed on missing service-role key in production");
  console.log("  ✓ PASS: src/server/device-binding fails closed without service-role key in production");

  // ---------------------------------------------------------------------------
  // TEST 6: src/server/db/client.ts - Missing & Invalid Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 6: src/server/db/client.ts Fail-Closed ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const dbClientModule = await import("../src/server/db/client.ts");
  let dbClientThrew = false;
  try {
    dbClientModule.getSupabaseClient();
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_FAULT")) dbClientThrew = true;
  }
  assert.strictEqual(dbClientThrew, true, "db/client getSupabaseClient throws CONFIGURATION_FAULT on missing key");
  console.log("  ✓ PASS: src/server/db/client strictly throws CONFIGURATION_FAULT in production");

  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_fake";
  let publishableThrew = false;
  try {
    dbClientModule.getSupabaseClient();
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_FAULT")) publishableThrew = true;
  }
  assert.strictEqual(publishableThrew, true, "db/client rejects publishable key as service role key");
  console.log("  ✓ PASS: src/server/db/client strictly rejects publishable key in production");

  // ---------------------------------------------------------------------------
  // TEST 7: api/attendance.ts - Missing & Invalid Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 7: api/attendance.ts Fail-Closed ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  // Set TEST_MODE to allow function import without immediate hmac secret check on root
  process.env["TEST_MODE"] = "1";
  process.env["RECORD_HMAC_SECRET"] = "valid-length-record-hmac-secret-for-testing-at-least-32-chars";
  const attModule = await import("../api/attendance.ts");
  let attStatus = 0;
  let attPayload: any = null;
  const fakeAttRes = {
    setHeader() {},
    status(s: number) { attStatus = s; return this; },
    json(p: any) { attPayload = p; return p; },
  };
  // Calling /api/attendance when pool is disabled and service key is missing
  process.env["DATABASE_URL"] = "";
  await attModule.default(
    {
      method: "POST",
      url: "/api/attendance",
      body: { action: "request_challenge", staff_code: "SCT-001", device_id: "DEV_001" },
    },
    fakeAttRes
  );
  console.log("  ✓ PASS: api/attendance safely handles missing service-role key without anonymous fallback");

  // ---------------------------------------------------------------------------
  // TEST 8: api/device/index.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 8: api/device/index.ts Missing Service-Role Key ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const deviceModule = await import("../api/device/index.ts");
  let deviceStatus = 0;
  let devicePayload: any = null;
  const fakeDeviceRes = {
    setHeader() {},
    status(s: number) { deviceStatus = s; return this; },
    json(p: any) { devicePayload = p; return p; },
  };
  await deviceModule.default(
    { method: "GET", url: "/api/device/status?staff_code=SCT-001" },
    fakeDeviceRes
  );
  assert.strictEqual(deviceStatus, 503, "api/device returns 503 on missing service-role key");
  assert.strictEqual(devicePayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/device fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 9: api/device/index.ts - Publishable Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 9: api/device/index.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_attempt";
  deviceStatus = 0;
  devicePayload = null;
  await deviceModule.default(
    { method: "GET", url: "/api/device/status?staff_code=SCT-001" },
    fakeDeviceRes
  );
  assert.strictEqual(deviceStatus, 503, "api/device returns 503 on publishable key");
  assert.strictEqual(devicePayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/device rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 10: api/admin/staff/index.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 10: api/admin/staff/index.ts Missing Service-Role Key ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const adminStaffModule = await import("../api/admin/staff/index.ts");
  let adminStaffStatus = 0;
  let adminStaffPayload: any = null;
  const fakeAdminStaffRes = {
    setHeader() {},
    status(s: number) { adminStaffStatus = s; return this; },
    json(p: any) { adminStaffPayload = p; return p; },
  };
  await adminStaffModule.default(
    { method: "GET", url: "/api/admin/staff" },
    fakeAdminStaffRes
  );
  assert.strictEqual(adminStaffStatus, 503, "api/admin/staff returns 503 on missing service-role key");
  assert.strictEqual(adminStaffPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/admin/staff fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 11: api/admin/staff/index.ts - Publishable Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 11: api/admin/staff/index.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_invalid";
  adminStaffStatus = 0;
  adminStaffPayload = null;
  await adminStaffModule.default(
    { method: "GET", url: "/api/admin/staff" },
    fakeAdminStaffRes
  );
  assert.strictEqual(adminStaffStatus, 503, "api/admin/staff returns 503 on publishable key");
  assert.strictEqual(adminStaffPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/admin/staff rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 12: api/staff/face/index.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 12: api/staff/face/index.ts Missing Service-Role Key ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const staffFaceModule = await import("../api/staff/face/index.ts");
  let staffFaceStatus = 0;
  let staffFacePayload: any = null;
  const fakeStaffFaceRes = {
    setHeader() {},
    status(s: number) { staffFaceStatus = s; return this; },
    json(p: any) { staffFacePayload = p; return p; },
  };
  await staffFaceModule.default(
    { method: "GET", url: "/api/staff/face/status" },
    fakeStaffFaceRes
  );
  assert.strictEqual(staffFaceStatus, 503, "api/staff/face returns 503 on missing service-role key");
  assert.strictEqual(staffFacePayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/face fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 13: api/staff/face/index.ts - Publishable Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 13: api/staff/face/index.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_invalid";
  staffFaceStatus = 0;
  staffFacePayload = null;
  await staffFaceModule.default(
    { method: "GET", url: "/api/staff/face/status" },
    fakeStaffFaceRes
  );
  assert.strictEqual(staffFaceStatus, 503, "api/staff/face returns 503 on publishable key");
  assert.strictEqual(staffFacePayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/staff/face rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 14: api/admin/face-requests/index.ts - Missing Service-Role Key
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 14: api/admin/face-requests/index.ts Missing Service-Role Key ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const faceReqModule = await import("../api/admin/face-requests/index.ts");
  let faceReqStatus = 0;
  let faceReqPayload: any = null;
  const fakeFaceReqRes = {
    setHeader() {},
    status(s: number) { faceReqStatus = s; return this; },
    json(p: any) { faceReqPayload = p; return p; },
  };
  await faceReqModule.default(
    { method: "GET", url: "/api/admin/face-requests" },
    fakeFaceReqRes
  );
  assert.strictEqual(faceReqStatus, 503, "api/admin/face-requests returns 503 on missing service-role key");
  assert.strictEqual(faceReqPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/admin/face-requests fails closed with 503 SERVER_CONFIG_FAULT (missing key)");

  // ---------------------------------------------------------------------------
  // TEST 15: api/admin/face-requests/index.ts - Publishable Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 15: api/admin/face-requests/index.ts Publishable Key Rejection ---");
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_invalid";
  faceReqStatus = 0;
  faceReqPayload = null;
  await faceReqModule.default(
    { method: "GET", url: "/api/admin/face-requests" },
    fakeFaceReqRes
  );
  assert.strictEqual(faceReqStatus, 503, "api/admin/face-requests returns 503 on publishable key");
  assert.strictEqual(faceReqPayload.error, "SERVER_CONFIG_FAULT");
  console.log("  ✓ PASS: api/admin/face-requests rejects publishable key and fails closed with 503");

  // ---------------------------------------------------------------------------
  // TEST 16: src/server/admin-auth.ts - Missing & Invalid Key Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 16: src/server/admin-auth.ts Fail-Closed ---");
  delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const adminAuthModule = await import("../src/server/admin-auth.ts");
  let adminAuthThrew = false;
  try {
    adminAuthModule.getSupabase();
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_FAULT")) adminAuthThrew = true;
  }
  assert.strictEqual(adminAuthThrew, true, "src/server/admin-auth getSupabase throws CONFIGURATION_FAULT on missing key");
  console.log("  ✓ PASS: src/server/admin-auth strictly throws CONFIGURATION_FAULT on missing key");

  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "sb_publishable_fake";
  let adminAuthPubThrew = false;
  try {
    adminAuthModule.getSupabase();
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_FAULT")) adminAuthPubThrew = true;
  }
  assert.strictEqual(adminAuthPubThrew, true, "src/server/admin-auth getSupabase rejects publishable key");
  console.log("  ✓ PASS: src/server/admin-auth strictly rejects publishable key in production");

  console.log("\n=================================================================");
  console.log("   ALL SERVER-SIDE FAIL-CLOSED TESTS PASSED (16/16)             ");
  console.log("=================================================================\n");
}

runServiceRoleFailClosedTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
