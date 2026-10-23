/**
 * Direct Unit & Integration Test for api/admin/session.ts and api/admin/logout.ts
 */

import assert from "assert";
import crypto from "node:crypto";
import sessionHandler from "../api/admin/session.ts";
import logoutHandler from "../api/admin/logout.ts";
import loginHandler from "../api/admin/login.ts";

function createMockReqRes(options = {}) {
  const req = {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
    url: options.url || "/api/admin/session",
  };

  const responseHeaders = {};
  let statusCode = 200;
  let responseData = null;

  const res = {
    statusCode: 200,
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
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
    status(code) {
      this.statusCode = code;
      statusCode = code;
      return this;
    },
  };

  return {
    req,
    res,
    getStatus: () => res.statusCode || statusCode,
    getData: () => responseData,
    getHeaders: () => responseHeaders,
  };
}

async function runTests() {
  console.log("=== Testing api/admin/session.ts & api/admin/logout.ts ===");

  // 1. Generate valid token via loginHandler
  const loginMock = createMockReqRes({
    method: "POST",
    body: { username: "moulish", password: "moulish@123" },
  });
  await loginHandler(loginMock.req, loginMock.res);
  assert.strictEqual(loginMock.getStatus(), 200, "Login must succeed with 200");
  const loginData = loginMock.getData();
  assert.ok(loginData.token, "Login must return token");
  const validToken = loginData.token;
  console.log("✓ Login succeeded, token obtained");

  // 2. Test GET /api/admin/session with Bearer token
  const sessBearer = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${validToken}` },
  });
  await sessionHandler(sessBearer.req, sessBearer.res);
  assert.strictEqual(sessBearer.getStatus(), 200);
  const bearerData = sessBearer.getData();
  assert.strictEqual(bearerData.authenticated, true);
  assert.strictEqual(bearerData.admin.username, "moulish");
  assert.strictEqual(bearerData.admin.role, "admin");
  console.log("✓ Session verified via Authorization: Bearer");

  // 3. Test GET /api/admin/session with Cookie
  const sessCookie = createMockReqRes({
    method: "GET",
    headers: { cookie: `admin_session=${validToken}` },
  });
  await sessionHandler(sessCookie.req, sessCookie.res);
  assert.strictEqual(sessCookie.getStatus(), 200);
  const cookieData = sessCookie.getData();
  assert.strictEqual(cookieData.authenticated, true);
  assert.strictEqual(cookieData.admin.username, "moulish");
  console.log("✓ Session verified via Cookie: admin_session");

  // 4. Test missing token -> 401 TOKEN_MISSING
  const sessMissing = createMockReqRes({ method: "GET" });
  await sessionHandler(sessMissing.req, sessMissing.res);
  assert.strictEqual(sessMissing.getStatus(), 401);
  assert.strictEqual(sessMissing.getData().code, "TOKEN_MISSING");
  console.log("✓ Missing token rejected with 401 TOKEN_MISSING");

  // 5. Test tampered signature -> 401 SIGNATURE_INVALID
  const tamperedToken = validToken.slice(0, -5) + "abcde";
  const sessTampered = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${tamperedToken}` },
  });
  await sessionHandler(sessTampered.req, sessTampered.res);
  assert.strictEqual(sessTampered.getStatus(), 401);
  assert.strictEqual(sessTampered.getData().code, "SIGNATURE_INVALID");
  console.log("✓ Tampered token rejected with 401 SIGNATURE_INVALID");

  // 6. Test expired token -> 401 TOKEN_EXPIRED
  const expiredPayload = {
    sub: "moulish",
    username: "moulish",
    name: "Moulishwaran S",
    email: "moulish@sonatech.ac.in",
    role: "admin",
    issuedAt: Date.now() - 100000,
    expiresAt: Date.now() - 1000, // already expired
    nonce: "expired-test-nonce",
  };
  const secret = "campusattend-admin-sec-key-moulish-2026-auth-token";
  const pStr = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(pStr).digest("base64url");
  const expiredToken = `${pStr}.${sig}`;

  const sessExpired = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  await sessionHandler(sessExpired.req, sessExpired.res);
  assert.strictEqual(sessExpired.getStatus(), 401);
  assert.strictEqual(sessExpired.getData().code, "TOKEN_EXPIRED");
  console.log("✓ Expired token rejected with 401 TOKEN_EXPIRED");

  // 7. Test OPTIONS -> 204
  const sessOptions = createMockReqRes({ method: "OPTIONS" });
  await sessionHandler(sessOptions.req, sessOptions.res);
  assert.strictEqual(sessOptions.getStatus(), 204);
  console.log("✓ OPTIONS handled with 204");

  // 8. Test POST /api/admin/logout
  const logoutMock = createMockReqRes({
    method: "POST",
    headers: { authorization: `Bearer ${validToken}` },
  });
  await logoutHandler(logoutMock.req, logoutMock.res);
  assert.strictEqual(logoutMock.getStatus(), 200);
  assert.strictEqual(logoutMock.getData().success, true);
  assert.ok(logoutMock.getHeaders()["set-cookie"].includes("Max-Age=0"), "Must clear cookie");
  console.log("✓ Logout succeeded and cleared cookie");

  // 9. Test logged out token on session check -> 401 TOKEN_REVOKED
  const sessRevoked = createMockReqRes({
    method: "GET",
    headers: { authorization: `Bearer ${validToken}` },
  });
  await sessionHandler(sessRevoked.req, sessRevoked.res);
  assert.strictEqual(sessRevoked.getStatus(), 401);
  assert.strictEqual(sessRevoked.getData().code, "TOKEN_REVOKED");
  console.log("✓ Logged-out token rejected with 401 TOKEN_REVOKED");

  console.log("\nALL 9 TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
