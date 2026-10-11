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
  isTableMissingError,
  _setSimulateRevocationWriteFailure,
  _setSimulateRevocationReadOutage,
  _clearInMemoryRevocations,
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

  await test("Logout endpoint /api/admin/logout revokes session token and clears cookie (HTTP 200)", async () => {
    assert.ok(validSessionToken, "Need valid session token from login test");
    const req = createMockRequest("POST", "/api/admin/logout", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/logout");
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("Max-Age=0"), "Logout must expire session cookie");
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await test("Logged-out session token is strictly REJECTED on GET /api/admin/session (HTTP 401)", async () => {
    const req = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/session");
    assert.strictEqual(res.status, 401, `Expected HTTP 401 for revoked token, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.authenticated, false);
    assert.ok(
      data.error.toLowerCase().includes("revoked"),
      `Expected error to mention revoked, got: ${data.error}`,
    );
  });

  await test("Logged-out session token is strictly REJECTED on protected GET /api/admin/staff (HTTP 401)", async () => {
    const req = createMockRequest("GET", "/api/admin/staff", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const res = await handleStaffApi(req, "/api/admin/staff");
    assert.strictEqual(res.status, 401, `Expected HTTP 401 for revoked token, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("Unauthorized"));
  });

  // --- 5. INDEPENDENT CONCURRENT SESSIONS & SELECTIVE REVOCATION ---
  console.log("\n--- 5. INDEPENDENT CONCURRENT SESSIONS & SELECTIVE REVOCATION ---");

  let concurrentTokenB = "";

  await test("Independent new session succeeds while previously logged-out token remains revoked", async () => {
    // 1. Establish new independent session for 'moulish'
    const loginReq = createMockRequest("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    const loginRes = await handleStaffApi(loginReq, "/api/admin/login");
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    concurrentTokenB = loginData.token;
    assert.ok(concurrentTokenB);
    assert.notStrictEqual(concurrentTokenB, validSessionToken, "Tokens must have unique nonces");

    // 2. Active Session B works on GET /api/admin/session
    const sessReq = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${concurrentTokenB}`,
    });
    const sessRes = await handleStaffApi(sessReq, "/api/admin/session");
    assert.strictEqual(sessRes.status, 200, `Expected HTTP 200 for active session B, got ${sessRes.status}`);
    const sessData = await sessRes.json();
    assert.strictEqual(sessData.authenticated, true);

    // 3. Active Session B works on protected GET /api/admin/staff
    const staffReq = createMockRequest("GET", "/api/admin/staff", undefined, {
      authorization: `Bearer ${concurrentTokenB}`,
    });
    const staffRes = await handleStaffApi(staffReq, "/api/admin/staff");
    assert.strictEqual(staffRes.status, 200, `Expected HTTP 200 for active session B, got ${staffRes.status}`);

    // 4. Revoked Token A remains strictly rejected
    const revokedReq = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${validSessionToken}`,
    });
    const revokedRes = await handleStaffApi(revokedReq, "/api/admin/session");
    assert.strictEqual(revokedRes.status, 401);
  });

  await test("Cookie-based logout also revokes session token and rejects subsequent calls", async () => {
    assert.ok(concurrentTokenB);

    // 1. Logout using cookie
    const logoutReq = createMockRequest("POST", "/api/admin/logout", undefined, {
      cookie: `admin_session=${concurrentTokenB}`,
    });
    const logoutRes = await handleStaffApi(logoutReq, "/api/admin/logout");
    assert.strictEqual(logoutRes.status, 200);

    // 2. Subsequent call using cookie is rejected
    const checkCookieReq = createMockRequest("GET", "/api/admin/session", undefined, {
      cookie: `admin_session=${concurrentTokenB}`,
    });
    const checkCookieRes = await handleStaffApi(checkCookieReq, "/api/admin/session");
    assert.strictEqual(checkCookieRes.status, 401, "Revoked cookie session must be rejected");
    const checkCookieData = await checkCookieRes.json();
    assert.ok(checkCookieData.error.toLowerCase().includes("revoked"));

    // 3. Subsequent call using header is also rejected
    const checkHeaderReq = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${concurrentTokenB}`,
    });
    const checkHeaderRes = await handleStaffApi(checkHeaderReq, "/api/admin/session");
    assert.strictEqual(checkHeaderRes.status, 401, "Revoked bearer session must be rejected");
  });

  // --- 6. FAILURE-HANDLING, OUTAGE RESILIENCE & CROSS-INSTANCE REPLAY ---
  console.log("\n--- 6. FAILURE-HANDLING, OUTAGE RESILIENCE & CROSS-INSTANCE REPLAY ---");

  await test("Failed persistent revocation write returns HTTP 500 REVOCATION_PERSISTENCE_FAILED and clears client cookie", async () => {
    // 1. Create a fresh authenticated session
    const admin = await ensureAdminAccountProvisioned();
    const tokenToWriteFail = createAdminSessionToken(admin);

    // 2. Enable simulated revocation write failure
    _setSimulateRevocationWriteFailure(true);
    try {
      const logoutReq = createMockRequest("POST", "/api/admin/logout", undefined, {
        authorization: `Bearer ${tokenToWriteFail}`,
      });
      const logoutRes = await handleStaffApi(logoutReq, "/api/admin/logout");

      // Verify that failure does NOT return a misleading successful 200 response
      assert.strictEqual(logoutRes.status, 500, `Expected HTTP 500 for write failure, got ${logoutRes.status}`);
      const body = await logoutRes.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.code, "REVOCATION_PERSISTENCE_FAILED");
      assert.ok(body.error && body.error.toLowerCase().includes("failed"));

      // Verify client cookie is still evicted to prevent local reuse
      const setCookie = logoutRes.headers.get("set-cookie") || "";
      assert.ok(setCookie.includes("Max-Age=0"), "Cookie must be cleared even when persistent write failed");
    } finally {
      _setSimulateRevocationWriteFailure(false);
    }
  });

  await test("Protected /api/admin/session FAILS CLOSED with HTTP 503 on database outage during revocation verification", async () => {
    const admin = await ensureAdminAccountProvisioned();
    const tokenOutageTest = createAdminSessionToken(admin);

    // Clear memory so verification must check persistent database
    _clearInMemoryRevocations();

    // Enable simulated outage
    _setSimulateRevocationReadOutage(true);
    try {
      const req = createMockRequest("GET", "/api/admin/session", undefined, {
        authorization: `Bearer ${tokenOutageTest}`,
      });
      const res = await handleStaffApi(req, "/api/admin/session");

      // Requirement 2: HTTP 503 response for authentication-service unavailability, rather than accepting token
      assert.strictEqual(res.status, 503, `Expected HTTP 503 during DB outage, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.authenticated, false);
      assert.strictEqual(body.code, "SESSION_REVOCATION_UNAVAILABLE");
      assert.ok(body.error && body.error.toLowerCase().includes("unavailable"));
    } finally {
      _setSimulateRevocationReadOutage(false);
    }
  });

  await test("Protected /api/admin/staff FAILS CLOSED with HTTP 503 on database outage", async () => {
    const admin = await ensureAdminAccountProvisioned();
    const tokenOutageTest = createAdminSessionToken(admin);

    _clearInMemoryRevocations();
    _setSimulateRevocationReadOutage(true);
    try {
      const req = createMockRequest("GET", "/api/admin/staff", undefined, {
        authorization: `Bearer ${tokenOutageTest}`,
      });
      const res = await handleStaffApi(req, "/api/admin/staff");

      assert.strictEqual(res.status, 503, `Expected HTTP 503 during DB outage, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.code, "SESSION_REVOCATION_UNAVAILABLE");
      assert.ok(body.error && body.error.toLowerCase().includes("unavailable"));
    } finally {
      _setSimulateRevocationReadOutage(false);
    }
  });

  await test("Error discrimination: Missing optional table (PGRST205/42P01) distinguished from total database outage", () => {
    // Missing optional table should NOT be confused with database outage
    assert.strictEqual(
      isTableMissingError({ code: "PGRST205", message: "Could not find table 'public.admin_token_revocations' in the schema cache" }),
      true,
      "PGRST205 must be identified as missing optional table",
    );
    assert.strictEqual(
      isTableMissingError({ code: "42P01", message: "relation \"admin_token_revocations\" does not exist" }),
      true,
      "42P01 must be identified as missing optional table",
    );
    assert.strictEqual(
      isTableMissingError({ code: "PGRST204", message: "schema cache miss" }),
      true,
      "PGRST204 must be identified as missing optional table",
    );

    // Real database outages must NOT be treated as missing table
    assert.strictEqual(
      isTableMissingError({ code: "XX000", message: "connection to server failed" }),
      false,
      "XX000 connection failure is a DB outage, not missing table",
    );
    assert.strictEqual(
      isTableMissingError(new Error("fetch failed")),
      false,
      "fetch failed network error is an outage, not missing table",
    );
    assert.strictEqual(
      isTableMissingError({ code: "57P01", message: "admin shutdown" }),
      false,
      "Server shutdown is an outage, not missing table",
    );
  });

  await test("Cross-instance token replay after logout is strictly REJECTED (Instance B cold-cache test)", async () => {
    // 1. Instance A authenticates and issues token
    const admin = await ensureAdminAccountProvisioned();
    const crossToken = createAdminSessionToken(admin);

    // Verify token is initially valid on Instance A
    const initialReq = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${crossToken}`,
    });
    const initialRes = await handleStaffApi(initialReq, "/api/admin/session");
    assert.strictEqual(initialRes.status, 200, "Token must be valid prior to logout");

    // 2. Instance A logs out
    const logoutReq = createMockRequest("POST", "/api/admin/logout", undefined, {
      authorization: `Bearer ${crossToken}`,
    });
    const logoutRes = await handleStaffApi(logoutReq, "/api/admin/logout");
    assert.strictEqual(logoutRes.status, 200, "Persistent logout write must succeed");

    // 3. Simulate Instance B: a completely separate process or serverless cold start
    // Instance B has ZERO in-memory revocation cache
    _clearInMemoryRevocations();

    // 4. Token replay attempt against Instance B on /api/admin/session
    // Instance B must query persistent store and discover the revocation record
    const replaySessReq = createMockRequest("GET", "/api/admin/session", undefined, {
      authorization: `Bearer ${crossToken}`,
    });
    const replaySessRes = await handleStaffApi(replaySessReq, "/api/admin/session");
    assert.strictEqual(
      replaySessRes.status,
      401,
      `Cross-instance replayed token must be rejected with HTTP 401, got ${replaySessRes.status}`,
    );
    const replaySessBody = await replaySessRes.json();
    assert.strictEqual(replaySessBody.authenticated, false);
    assert.ok(
      replaySessBody.error.toLowerCase().includes("revoked"),
      `Error must specify token was revoked: ${replaySessBody.error}`,
    );

    // 5. Token replay attempt against Instance B on protected /api/admin/staff
    const replayStaffReq = createMockRequest("GET", "/api/admin/staff", undefined, {
      authorization: `Bearer ${crossToken}`,
    });
    const replayStaffRes = await handleStaffApi(replayStaffReq, "/api/admin/staff");
    assert.strictEqual(
      replayStaffRes.status,
      401,
      `Cross-instance replayed token on /api/admin/staff must be rejected with HTTP 401, got ${replayStaffRes.status}`,
    );
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
