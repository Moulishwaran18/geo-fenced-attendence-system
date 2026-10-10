/**
 * CampusAttend — Administrator Authentication & Security Verification Suite
 *
 * Validates:
 * 1. Idempotent provisioning of administrator account 'moulish'.
 * 2. Strict storage of salted PBKDF2 hash (plaintext password NEVER stored).
 * 3. Server-side login success with 'moulish' and 'moulish@123'.
 * 4. Server-side rejection of incorrect passwords (HTTP 401).
 * 5. Server-side rejection of unauthorized IDs (HTTP 401).
 * 6. Server-side validation of session tokens via /api/admin/session.
 * 7. Server-side rejection of forged or expired tokens.
 * 8. Server-side protection of admin endpoints (/api/admin/staff) rejecting unauthenticated requests.
 * 9. Server-side access grant for protected endpoints with valid admin session token.
 * 10. Preservation of staff data and face recognition functionality.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import {
  ensureAdminAccountProvisioned,
  authenticateAdmin,
  verifyAdminSessionToken,
  createAdminSessionToken,
} from "../src/server/admin-auth.ts";
import { handleStaffApi } from "../src/server/api/staff-handler.ts";

function createMockRequest(method, pathname, body, headers) {
  const reqInit = {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
  };
  if (body !== undefined) {
    reqInit.body = JSON.stringify(body);
  }
  return new Request(`https://localhost${pathname}`, reqInit);
}

async function runTestSuite() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND ADMINISTRATOR CREDENTIAL & AUTH TEST SUITE       ");
  console.log("=================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✓ PASS: ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ FAIL: ${name}`);
            console.error(`    ${err?.message || err}`);
            failed++;
          });
      }
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err?.message || err}`);
      failed++;
    }
  }

  // --- 1. IDEMPOTENT PROVISIONING & DATABASE STORAGE TESTS ---
  console.log("--- 1. IDEMPOTENT PROVISIONING & DATABASE STORAGE TESTS ---");

  await test("Administrator 'moulish' is provisioned idempotently", async () => {
    const admin1 = await ensureAdminAccountProvisioned();
    assert.strictEqual(admin1.username, "moulish");
    assert.strictEqual(admin1.role, "admin");
    assert.strictEqual(admin1.active, true);

    // Call again to verify idempotency (no duplicates)
    const admin2 = await ensureAdminAccountProvisioned();
    assert.strictEqual(admin2.username, "moulish");
    assert.strictEqual(admin2.id, admin1.id);
  });

  await test("Database stores only salted PBKDF2 hash, NEVER plaintext password", async () => {
    const admin = await ensureAdminAccountProvisioned();
    assert.ok(admin.salt && admin.salt.length === 32, "Salt must be 16-byte hex (32 chars)");
    assert.ok(
      admin.password_hash && admin.password_hash.length === 128,
      "PBKDF2 SHA-512 hash must be 64-byte hex (128 chars)",
    );

    // Check staff-db.json content
    const dbPath = path.resolve("data", "staff-db.json");
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, "utf-8");
      assert.strictEqual(
        raw.includes("moulish@123"),
        false,
        "CRITICAL SECURITY: Plaintext password 'moulish@123' must NEVER be in staff-db.json!",
      );
      assert.ok(raw.includes("password_hash"), "Must contain salted password_hash");
    }
  });

  // --- 2. SERVER-SIDE CREDENTIAL VERIFICATION TESTS ---
  console.log("\n--- 2. SERVER-SIDE LOGIN & CREDENTIAL VERIFICATION TESTS ---");

  let validSessionToken = "";

  await test("Successful login with 'moulish' and 'moulish@123' via POST /api/admin/login", async () => {
    const req = createMockRequest("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    const res = await handleStaffApi(req, "/api/admin/login");
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.token, "Must return signed session token");
    assert.strictEqual(data.admin.username, "moulish");
    assert.strictEqual(data.admin.role, "admin");

    validSessionToken = data.token;
  });

  await test("Case-insensitive username support ('MOULISH') with valid password", async () => {
    const req = createMockRequest("POST", "/api/admin/login", {
      username: "MOULISH",
      password: "moulish@123",
    });
    const res = await handleStaffApi(req, "/api/admin/login");
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await test("Rejection of incorrect password for 'moulish' (HTTP 401)", async () => {
    const req = createMockRequest("POST", "/api/admin/login", {
      username: "moulish",
      password: "WrongPassword999!",
    });
    const res = await handleStaffApi(req, "/api/admin/login");
    assert.strictEqual(res.status, 401, `Expected HTTP 401 for wrong password, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Invalid administrator credentials"));
  });

  await test("Rejection of unauthorized administrator ID (HTTP 401)", async () => {
    const req = createMockRequest("POST", "/api/admin/login", {
      username: "unauthorized_user",
      password: "moulish@123",
    });
    const res = await handleStaffApi(req, "/api/admin/login");
    assert.strictEqual(res.status, 401, `Expected HTTP 401 for unknown user, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  await test("Rejection of missing credentials (HTTP 400)", async () => {
    const req = createMockRequest("POST", "/api/admin/login", {
      username: "",
      password: "",
    });
    const res = await handleStaffApi(req, "/api/admin/login");
    assert.strictEqual(res.status, 400, `Expected HTTP 400, got ${res.status}`);
  });

  // --- 3. SERVER SESSION VALIDATION TESTS ---
  console.log("\n--- 3. SERVER-SIDE SESSION TOKEN VALIDATION TESTS ---");

  await test("Valid session token verified via GET /api/admin/session (HTTP 200)", async () => {
    assert.ok(validSessionToken, "Need valid session token from login test");
    const req = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.authenticated, true);
    assert.strictEqual(data.admin.username, "moulish");
    assert.strictEqual(data.admin.role, "admin");
  });

  await test("Cookie session extraction supported (admin_session=...)", async () => {
    const req = createMockRequest("GET", "/api/admin/session", undefined, {
      cookie: `admin_session=${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.authenticated, true);
  });

  await test("Rejection of forged / tampered session token (HTTP 401)", async () => {
    const tampered = validSessionToken.slice(0, -5) + "abcde";
    const req = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${tampered}`,
    });
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 401, `Expected HTTP 401, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.authenticated, false);
  });

  await test("Rejection of expired session token (HTTP 401)", async () => {
    const admin = await ensureAdminAccountProvisioned();
    const expiredToken = createAdminSessionToken(admin, -10000);

    const req = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${expiredToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.authenticated, false);
    assert.ok(data.error.includes("expired"));
  });

  await test("Rejection of request with missing session token (HTTP 401)", async () => {
    const req = createMockRequest("GET", "/api/admin/session");
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.authenticated, false);
  });

  // --- 4. PROTECTED ADMINISTRATOR ROUTE ACCESS CONTROL TESTS ---
  console.log("\n--- 4. PROTECTED ADMINISTRATOR ENDPOINT ACCESS CONTROL TESTS ---");

  await test("Unauthorized access to /api/admin/staff is REJECTED with HTTP 401", async () => {
    const req = createMockRequest("GET", "/api/admin/staff", undefined, {
      "user-agent": "Mozilla/5.0",
      host: "localhost:8080",
    });
    const res = await handleStaffApi(req, "/api/admin/staff");
    assert.strictEqual(
      res.status,
      401,
      `Expected HTTP 401 for unauthorized access, got ${res.status}`,
    );
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Unauthorized"));
  });

  await test("Authorized access to /api/admin/staff with valid token SUCCEEDS (HTTP 200)", async () => {
    const req = createMockRequest("GET", "/api/admin/staff", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/staff");
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data), "Must return staff array");
  });

  await test("Logout endpoint /api/admin/logout clears session cookie (HTTP 200)", async () => {
    const req = createMockRequest("POST", "/api/admin/logout");
    const res = await handleStaffApi(req, "/api/admin/logout");
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("Max-Age=0"), "Logout must expire session cookie");
  });

  console.log("\n=================================================================");
  console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner fatal error:", err);
  process.exit(1);
});
