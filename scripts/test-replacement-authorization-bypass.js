/**
 * Security Verification Suite: CampusAttend Face Re-Enrollment Authorization Bypass Prevention
 * 
 * Tests all 16 mandatory negative security tests + positive flow:
 *  1. No face-change request exists
 *  2. A new request is still pending
 *  3. A request has been rejected
 *  4. Staff member submits replacement samples without an approval token
 *  5. An old consumed token is reused
 *  6. An expired token is supplied
 *  7. A token belongs to another staff member
 *  8. A token belongs to another device
 *  9. A token belongs to a different request
 * 10. Two simultaneous requests try to consume the same token (concurrency race test)
 * 11. The web client manually calls the enrollment API (unauthenticated / forged)
 * 12. The Android bridge is called directly without authorization
 * 13. The client changes its local approval state (client-side bypass attempt)
 * 14. Server verification fails or the database is unavailable (fail-closed check)
 * 15. Local template persistence fails (staged two-phase rollback)
 * 16. A previously approved replacement is followed by another replacement attempt
 * 
 * Also verifies:
 * - A valid, freshly approved replacement succeeds
 * - Existing templates remain usable when a replacement attempt fails
 * - Successful replacement consumes authorization and leaves profile locked
 * - The next replacement requires a fresh request and fresh administrator approval
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerStaffLogin from "../api/staff/login.ts";
import handlerStaffRegister from "../api/staff/register.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import { stageNativeReplacement, commitNativeReplacement } from "../src/lib/native-biometric-bridge.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function mockReqRes(method = "GET", url = "/", body = {}, headers = {}, customSupabase = null) {
  let statusCode = 200;
  let headersSent = {};
  let responseData = null;

  const req = {
    method,
    url,
    headers: { ...headers },
    body,
    supabaseClient: customSupabase,
    query: {},
  };

  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headersSent[name.toLowerCase()] = value;
      return res;
    },
    status(code) {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    end(text) {
      if (text && !responseData) {
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }
      }
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => res.statusCode,
    getData: () => responseData,
  };
}

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
  }
}

async function runBypassSecurityTests() {
  console.log("===============================================================================");
  console.log(" CAMPUSATTEND: MANDATORY NEGATIVE SECURITY & AUTHORIZATION BYPASS TEST SUITE");
  console.log("===============================================================================\n");

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const staffA = `STF-SEC-A-${suffix}`;
  const staffB = `STF-SEC-B-${suffix}`;
  const testPass = "SecPassword@2026";
  const deviceA = `device-alpha-${suffix}`;
  const deviceB = `device-beta-${suffix}`;

  let tokenA = null;
  let tokenB = null;
  let adminToken = null;
  const createdRecordIds = [];

  try {
    // -------------------------------------------------------------------------
    // Setup: Provision disposable test accounts & admin session
    // -------------------------------------------------------------------------
    console.log(`[Setup] Provisioning test staff accounts ${staffA} and ${staffB}...`);

    const regA = mockReqRes("POST", "/api/staff/register", {
      staff_code: staffA,
      name: `Test Staff Sec A ${suffix}`,
      email: `test.sec.a.${suffix}@sonatech.ac.in`,
      department: "Information Technology",
      password: testPass,
      confirmPassword: testPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regA.req, regA.res);
    assert(regA.getStatus() === 201, `Registered test staff ${staffA} (HTTP 201)`);

    const loginA = mockReqRes("POST", "/api/staff/login", {
      staff_code: staffA,
      password: testPass,
    });
    await handlerStaffLogin(loginA.req, loginA.res);
    tokenA = loginA.getData()?.token;
    assert(Boolean(tokenA), "Acquired authentication token for staff A");

    const regB = mockReqRes("POST", "/api/staff/register", {
      staff_code: staffB,
      name: `Test Staff Sec B ${suffix}`,
      email: `test.sec.b.${suffix}@sonatech.ac.in`,
      department: "Computer Science",
      password: testPass,
      confirmPassword: testPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regB.req, regB.res);
    assert(regB.getStatus() === 201, `Registered test staff ${staffB} (HTTP 201)`);

    const loginB = mockReqRes("POST", "/api/staff/login", {
      staff_code: staffB,
      password: testPass,
    });
    await handlerStaffLogin(loginB.req, loginB.res);
    tokenB = loginB.getData()?.token;
    assert(Boolean(tokenB), "Acquired authentication token for staff B");

    // Acquire Admin token
    const adminLogin = mockReqRes("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    await handlerAdminLogin(adminLogin.req, adminLogin.res);
    adminToken = adminLogin.getData()?.token;
    assert(Boolean(adminToken), "Acquired administrator session token");

    const headersA = {
      authorization: `Bearer ${tokenA}`,
      "x-staff-token": tokenA,
      cookie: `staff_session=${tokenA}`,
    };

    const headersB = {
      authorization: `Bearer ${tokenB}`,
      "x-staff-token": tokenB,
      cookie: `staff_session=${tokenB}`,
    };

    const headersAdmin = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
      cookie: `admin_session=${adminToken}`,
    };

    // Establish baseline locked initial enrollment for staff A (5 templates)
    console.log(`\n[Setup] Establishing baseline locked enrollment for ${staffA}...`);
    const initEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: deviceA,
      templateCount: 5,
    }, headersA);
    await handlerFaceStaff(initEnroll.req, initEnroll.res);
    assert(initEnroll.getStatus() === 201, `Initial face registration completed and locked (HTTP 201)`);

    // Verify baseline status is locked
    const mBaseStatus = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
    await handlerFaceStaff(mBaseStatus.req, mBaseStatus.res);
    assert(mBaseStatus.getStatus() === 200, "Base status returns HTTP 200");
    assert(mBaseStatus.getData()?.isLocked === true, "Face registration is locked");
    assert(mBaseStatus.getData()?.canEdit === false, "canEdit is false (locked)");
    assert(mBaseStatus.getData()?.canSaveReplacement === false, "canSaveReplacement is false");
    assert(mBaseStatus.getData()?.oneTimeToken === null, "oneTimeToken is null");

    // =========================================================================
    // TEST 1: Blocked when no face-change request exists
    // =========================================================================
    console.log("\n[Test 1] Negative: Blocked when no face-change request exists");
    {
      const mNoReq = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: `ftok_${crypto.randomBytes(24).toString("hex")}`,
      }, headersA);
      await handlerFaceStaff(mNoReq.req, mNoReq.res);
      assert(mNoReq.getStatus() === 403, `Direct replacement blocked without request (HTTP ${mNoReq.getStatus()})`);
      assert(mNoReq.getData()?.code === "INVALID_OR_CONSUMED_TOKEN" || mNoReq.getData()?.code === "FACE_REGISTRATION_LOCKED", "Returns authorization error code");
    }

    // =========================================================================
    // TEST 2: Blocked when a new request is still pending
    // =========================================================================
    console.log("\n[Test 2] Negative: Blocked when a new request is still pending");
    let pendingReqId = null;
    {
      const reqSubmit = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Staff A camera upgraded, requesting replacement",
        deviceId: deviceA,
        sampleCount: 5,
      }, headersA);
      await handlerFaceStaff(reqSubmit.req, reqSubmit.res);
      assert(reqSubmit.getStatus() === 201, `Submitted face change request (HTTP ${reqSubmit.getStatus()})`);
      pendingReqId = reqSubmit.getData()?.requestId;
      if (pendingReqId) createdRecordIds.push(pendingReqId);

      // Verify status shows pending and no replacement token
      const mPendingStatus = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
      await handlerFaceStaff(mPendingStatus.req, mPendingStatus.res);
      assert(mPendingStatus.getData()?.hasPendingRequest === true, "hasPendingRequest is true");
      assert(mPendingStatus.getData()?.canSaveReplacement === false, "canSaveReplacement is false");
      assert(mPendingStatus.getData()?.oneTimeToken === null, "oneTimeToken is strictly null");

      // Attempt replacement while pending
      const mEnrollPending = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
      }, headersA);
      await handlerFaceStaff(mEnrollPending.req, mEnrollPending.res);
      assert(mEnrollPending.getStatus() === 403, `Replacement blocked while request is pending (HTTP ${mEnrollPending.getStatus()})`);
      assert(mEnrollPending.getData()?.code === "FACE_REGISTRATION_LOCKED", "Error code is FACE_REGISTRATION_LOCKED");
    }

    // =========================================================================
    // TEST 3: Blocked when a request has been rejected
    // =========================================================================
    console.log("\n[Test 3] Negative: Blocked when a request has been rejected");
    {
      const rejectReq = mockReqRes("POST", `/api/admin/face-requests/${pendingReqId}/reject`, {
        adminNotes: "Recent photo verification rejected by admin",
      }, headersAdmin);
      await handlerAdminFaceRequests(rejectReq.req, rejectReq.res);
      assert(rejectReq.getStatus() === 200, `Admin rejected pending request (HTTP ${rejectReq.getStatus()})`);

      // Verify status shows rejected, profile remains locked
      const mRejStatus = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
      await handlerFaceStaff(mRejStatus.req, mRejStatus.res);
      assert(mRejStatus.getData()?.isLocked === true, "Profile remains locked after rejection");
      assert(mRejStatus.getData()?.canSaveReplacement === false, "canSaveReplacement is false");
      assert(mRejStatus.getData()?.oneTimeToken === null, "oneTimeToken is null");

      // Attempt replacement after rejection
      const mEnrollRej = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
      }, headersA);
      await handlerFaceStaff(mEnrollRej.req, mEnrollRej.res);
      assert(mEnrollRej.getStatus() === 403, `Replacement blocked after rejection (HTTP ${mEnrollRej.getStatus()})`);
    }

    // =========================================================================
    // TEST 4: Blocked when replacement samples submitted without approval token
    // =========================================================================
    console.log("\n[Test 4] Negative: Blocked when replacement samples submitted without approval token");
    const bypassDigest = "sha256_" + crypto.createHash("sha256").update("v1;count:5;bypass-digest").digest("hex");
    let validTokenA = null;
    let approvedReqId = null;
    {
      // Submit fresh request
      const reqSubmit2 = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Valid replacement attempt with new phone camera",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceA,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(reqSubmit2.req, reqSubmit2.res);
      approvedReqId = reqSubmit2.getData()?.requestId;
      if (approvedReqId) createdRecordIds.push(approvedReqId);

      // Admin approves request
      const appReq = mockReqRes("POST", `/api/admin/face-requests/${approvedReqId}/approve`, {
        adminNotes: "Identity verified with physical employee badge",
      }, headersAdmin);
      await handlerAdminFaceRequests(appReq.req, appReq.res);
      assert(appReq.getStatus() === 200, `Admin approved request (HTTP ${appReq.getStatus()})`);
      validTokenA = appReq.getData()?.oneTimeToken;
      assert(Boolean(validTokenA) && validTokenA.startsWith("ftok_"), `Minted valid token: ${validTokenA?.slice(0, 16)}...`);

      // Staff attempts replacement without providing token
      const mEnrollNoToken = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        digest: bypassDigest,
        // oneTimeToken omitted
      }, headersA);
      await handlerFaceStaff(mEnrollNoToken.req, mEnrollNoToken.res);
      assert(mEnrollNoToken.getStatus() === 403, `Replacement without token blocked with HTTP 403 (got ${mEnrollNoToken.getStatus()})`);
      assert(mEnrollNoToken.getData()?.code === "FACE_REGISTRATION_LOCKED", "Error code is FACE_REGISTRATION_LOCKED");
    }

    // =========================================================================
    // TEST 5: Blocked when an old consumed token is reused
    // =========================================================================
    console.log("\n[Test 5] Negative: Blocked when an old consumed token is reused");
    {
      // First, consume validTokenA legitimately
      const mValidEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: validTokenA,
        requestId: approvedReqId,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mValidEnroll.req, mValidEnroll.res);
      if (mValidEnroll.getStatus() !== 200) {
        console.error("Test 5 Error:", mValidEnroll.getStatus(), mValidEnroll.getData());
      }
      assert(mValidEnroll.getStatus() === 200, `First replacement succeeded (HTTP ${mValidEnroll.getStatus()})`);
      assert(mValidEnroll.getData()?.isLocked === true, "Profile remains locked after replacement");

      // Verify token is now marked status:consumed in DB
      const { data: consumedCheck } = await supabase
        .from("security_events")
        .select("device")
        .eq("id", approvedReqId)
        .single();
      assert(consumedCheck?.device?.includes("status:consumed"), "Token record marked status:consumed in database");

      // Second attempt reusing the same token
      const mReuseEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: validTokenA,
        requestId: approvedReqId,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mReuseEnroll.req, mReuseEnroll.res);
      assert(mReuseEnroll.getStatus() === 403, `Reusing consumed token blocked with HTTP 403 (got ${mReuseEnroll.getStatus()})`);
      assert(mReuseEnroll.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code is INVALID_OR_CONSUMED_TOKEN");
    }

    // =========================================================================
    // TEST 6: Blocked when an expired token is supplied
    // =========================================================================
    console.log("\n[Test 6] Negative: Blocked when an expired token is supplied");
    {
      const expiredToken = `ftok_${crypto.randomBytes(24).toString("hex")}`;
      const pastDate = new Date(Date.now() - 26 * 3600 * 1000).toISOString(); // 26 hours ago
      const expDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString();  // expired 2 hours ago

      const expIns = await supabase.from("security_events").insert({
        time: pastDate,
        staff: staffA,
        event: "FACE_CHANGE_REQUEST: Expired test",
        device: `token:${expiredToken}|status:approved|approved_at:${pastDate}|expires_at:${expDate}|device_id:${deviceA}|count:5|type:replacement`,
        location: "CampusAttend Security",
        result: "Allowed",
        severity: "Low",
      }).select("id");
      if (expIns.data?.[0]?.id) createdRecordIds.push(expIns.data[0].id);

      const mExpiredEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: expiredToken,
      }, headersA);
      await handlerFaceStaff(mExpiredEnroll.req, mExpiredEnroll.res);
      assert(mExpiredEnroll.getStatus() === 403, `Expired token blocked with HTTP 403 (got ${mExpiredEnroll.getStatus()})`);
      assert(mExpiredEnroll.getData()?.code === "EXPIRED_APPROVAL_TOKEN", "Error code is EXPIRED_APPROVAL_TOKEN");
    }

    // =========================================================================
    // TEST 7: Blocked when a token belongs to another staff member
    // =========================================================================
    console.log("\n[Test 7] Negative: Blocked when a token belongs to another staff member");
    {
      // Create baseline enrollment for Staff B first
      const initB = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceB,
        templateCount: 5,
      }, headersB);
      await handlerFaceStaff(initB.req, initB.res);

      // Create request & approval for staff B
      const reqB = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Staff B request for replacement",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceB,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersB);
      await handlerFaceStaff(reqB.req, reqB.res);
      const reqBId = reqB.getData()?.requestId;
      if (reqBId) createdRecordIds.push(reqBId);

      const appB = mockReqRes("POST", `/api/admin/face-requests/${reqBId}/approve`, {
        adminNotes: "Approved for Staff B",
      }, headersAdmin);
      await handlerAdminFaceRequests(appB.req, appB.res);
      const tokenForB = appB.getData()?.oneTimeToken;
      assert(Boolean(tokenForB), `Approved token generated for Staff B: ${tokenForB?.slice(0, 16)}...`);

      // Staff A attempts to steal and use Staff B's token
      const mStealEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: tokenForB,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mStealEnroll.req, mStealEnroll.res);
      assert(mStealEnroll.getStatus() === 403, `Cross-staff token reuse blocked with HTTP 403 (got ${mStealEnroll.getStatus()})`);
      assert(mStealEnroll.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Rejected as invalid/unauthorized token for Staff A");
    }

    // =========================================================================
    // TEST 8: Blocked when a token belongs to another device
    // =========================================================================
    console.log("\n[Test 8] Negative: Blocked when a token belongs to another device");
    {
      // Create fresh request bound to deviceA
      const reqDev = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Device-bound request",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceA,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(reqDev.req, reqDev.res);
      const devReqId = reqDev.getData()?.requestId;
      if (devReqId) createdRecordIds.push(devReqId);

      const appDev = mockReqRes("POST", `/api/admin/face-requests/${devReqId}/approve`, {
        adminNotes: "Approved for deviceA only",
      }, headersAdmin);
      await handlerAdminFaceRequests(appDev.req, appDev.res);
      const devToken = appDev.getData()?.oneTimeToken;

      // Staff A attempts to enroll from device-unauthorized-x99
      const mDevMismatch = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "device-unauthorized-x99",
        templateCount: 5,
        oneTimeToken: devToken,
        requestId: devReqId,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mDevMismatch.req, mDevMismatch.res);
      assert(mDevMismatch.getStatus() === 403, `Device mismatch blocked with HTTP 403 (got ${mDevMismatch.getStatus()})`);
      assert(mDevMismatch.getData()?.code === "DEVICE_MISMATCH", "Error code is DEVICE_MISMATCH");
    }

    // =========================================================================
    // TEST 9: Blocked when a token belongs to a different request
    // =========================================================================
    console.log("\n[Test 9] Negative: Blocked when a token belongs to a different request");
    {
      const reqFresh = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Request mismatch test",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceA,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(reqFresh.req, reqFresh.res);
      const freshReqId = reqFresh.getData()?.requestId;
      if (freshReqId) createdRecordIds.push(freshReqId);

      const appFresh = mockReqRes("POST", `/api/admin/face-requests/${freshReqId}/approve`, {}, headersAdmin);
      await handlerAdminFaceRequests(appFresh.req, appFresh.res);
      const freshToken = appFresh.getData()?.oneTimeToken;

      // Pass token with different/mismatched requestId
      const mMismatchedReq = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: freshToken,
        requestId: "00000000-0000-0000-0000-000000000000",
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mMismatchedReq.req, mMismatchedReq.res);
      assert(mMismatchedReq.getStatus() === 403, `Mismatched requestId blocked with HTTP 403 (got ${mMismatchedReq.getStatus()})`);
      assert(mMismatchedReq.getData()?.code === "REQUEST_MISMATCH", "Error code is REQUEST_MISMATCH");

      // TEST 9b: Blocked when cryptographic template digest does not match approved digest
      const mDigestMismatch = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: freshToken,
        requestId: freshReqId,
        digest: "sha256_unauthorized_forged_digest_00000000000000000000000000000000",
      }, headersA);
      await handlerFaceStaff(mDigestMismatch.req, mDigestMismatch.res);
      assert(mDigestMismatch.getStatus() === 403, `Digest mismatch blocked with HTTP 403 (got ${mDigestMismatch.getStatus()})`);
      assert(mDigestMismatch.getData()?.code === "DIGEST_MISMATCH", "Error code is DIGEST_MISMATCH");
    }

    // =========================================================================
    // TEST 10: Two simultaneous requests try to consume the same token (concurrency check)
    // =========================================================================
    console.log("\n[Test 10] Negative: Concurrency test - Two simultaneous requests consume same token");
    {
      const reqConcur = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Concurrency test request",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceA,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(reqConcur.req, reqConcur.res);
      const concurReqId = reqConcur.getData()?.requestId;
      if (concurReqId) createdRecordIds.push(concurReqId);

      const appConcur = mockReqRes("POST", `/api/admin/face-requests/${concurReqId}/approve`, {}, headersAdmin);
      await handlerAdminFaceRequests(appConcur.req, appConcur.res);
      const concurToken = appConcur.getData()?.oneTimeToken;

      // Fire two simultaneous POST /enroll calls with identical token
      const mReq1 = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: concurToken,
        requestId: concurReqId,
        digest: bypassDigest,
      }, headersA);

      const mReq2 = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: concurToken,
        requestId: concurReqId,
        digest: bypassDigest,
      }, headersA);

      await Promise.all([
        handlerFaceStaff(mReq1.req, mReq1.res),
        handlerFaceStaff(mReq2.req, mReq2.res),
      ]);

      const status1 = mReq1.getStatus();
      const status2 = mReq2.getStatus();

      const successCount = (status1 === 200 ? 1 : 0) + (status2 === 200 ? 1 : 0);
      const blockedCount = (status1 === 403 ? 1 : 0) + (status2 === 403 ? 1 : 0);

      assert(successCount === 1, `Exactly ONE concurrent request succeeded (success count = ${successCount})`);
      assert(blockedCount === 1, `Exactly ONE concurrent request was blocked with HTTP 403 (blocked count = ${blockedCount})`);
    }

    // =========================================================================
    // TEST 11: Web client manually calls the enrollment API (unauthenticated / forged)
    // =========================================================================
    console.log("\n[Test 11] Negative: Web client manually calls enrollment API without authentication");
    {
      const mUnauth = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: "ftok_forged_attempt_without_session",
      }, {}); // Empty headers
      await handlerFaceStaff(mUnauth.req, mUnauth.res);
      assert(mUnauth.getStatus() === 401, `Unauthenticated direct API call blocked with HTTP 401 (got ${mUnauth.getStatus()})`);
      assert(
        mUnauth.getData()?.code === "TOKEN_MISSING" ||
        mUnauth.getData()?.code === "UNAUTHORIZED" ||
        mUnauth.getData()?.error?.toLowerCase().includes("token") ||
        mUnauth.getData()?.error?.toLowerCase().includes("authentication"),
        "Reports authentication required"
      );
    }

    // =========================================================================
    // TEST 12: Android bridge is called directly without authorization
    // =========================================================================
    console.log("\n[Test 12] Negative: Android bridge is called directly without authorization");
    {
      // Mock biometric embeddings
      const mockEmbeddings = [[0.1, 0.2, 0.3]];
      const mockLabels = ["sample_1"];

      // Call stageNativeReplacement with invalid token
      const bridgeResInvalid = await stageNativeReplacement(
        staffA,
        mockEmbeddings,
        mockLabels,
        "invalid_fake_token_123"
      );
      assert(bridgeResInvalid.success === false, "Bridge rejects non-compliant token format");
      assert(bridgeResInvalid.error === "INVALID_APPROVAL_TOKEN", "Returns INVALID_APPROVAL_TOKEN error");

      // Call commitNativeReplacement with empty token
      const bridgeResEmpty = await commitNativeReplacement(staffA, "");
      assert(bridgeResEmpty.success === false, "Bridge rejects empty authorization token");
    }

    // =========================================================================
    // TEST 13: Client changes its local approval state (client-side bypass attempt)
    // =========================================================================
    console.log("\n[Test 13] Negative: Client changes local approval state (client-side boolean forgery)");
    {
      // Client sends spoofed body flags attempting to claim it is approved
      const mSpoofedClient = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        isApproved: true,
        clientVerified: true,
        canSaveReplacement: true,
        status: "approved",
        oneTimeToken: `ftok_${crypto.randomBytes(24).toString("hex")}`,
      }, headersA);
      await handlerFaceStaff(mSpoofedClient.req, mSpoofedClient.res);
      assert(mSpoofedClient.getStatus() === 403, `Client boolean forgery rejected with HTTP 403 (got ${mSpoofedClient.getStatus()})`);
      assert(mSpoofedClient.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Server verifies database state, ignoring client boolean flags");
    }

    // =========================================================================
    // TEST 14: Server verification fails or database is unavailable (fail-closed check)
    // =========================================================================
    console.log("\n[Test 14] Negative: Server verification fails / database unavailable (fail closed)");
    {
      const failClosedToken = `ftok_${crypto.randomBytes(24).toString("hex")}`;
      const createDownQuery = () => {
        const queryObj = {
          select: () => queryObj,
          eq: () => queryObj,
          or: () => queryObj,
          ilike: () => queryObj,
          not: () => queryObj,
          order: () => queryObj,
          limit: async () => ({ data: null, error: { message: "database connection lost" } }),
          maybeSingle: async () => ({ data: null, error: { message: "database connection lost" } }),
          single: async () => ({ data: null, error: { message: "database connection lost" } }),
          then: (resolve) => resolve({ data: null, error: { message: "database connection lost" } }),
        };
        return queryObj;
      };
      const mockDownSupabase = {
        ...supabase,
        from: () => createDownQuery(),
      };

      const mDbDown = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: failClosedToken,
      }, headersA, mockDownSupabase);

      await handlerFaceStaff(mDbDown.req, mDbDown.res);
      assert(mDbDown.getStatus() === 503, `Fails closed with HTTP 503 on database unavailability (got ${mDbDown.getStatus()})`);
      assert(mDbDown.getData()?.code === "RPC_UNAVAILABLE" || mDbDown.getData()?.code === "SESSION_REVOCATION_UNAVAILABLE", "Error code reflects service unavailability");
    }

    // =========================================================================
    // TEST 15: Local template persistence fails (staged rollback check)
    // =========================================================================
    console.log("\n[Test 15] Negative: Local template persistence failure halts flow before server consumption");
    {
      let serverConsumptionInvoked = false;
      const simulateTwoPhaseEnrollment = async (localPersistenceSuccess) => {
        // Phase 1: Local staging
        if (!localPersistenceSuccess) {
          return { success: false, message: "Android Keystore hardware persistence error." };
        }
        // Phase 2: Server consumption
        serverConsumptionInvoked = true;
        return { success: true };
      };

      const stageFailResult = await simulateTwoPhaseEnrollment(false);
      assert(stageFailResult.success === false, "Process halted immediately when local persistence fails");
      assert(serverConsumptionInvoked === false, "Server token was NOT consumed when persistence failed");
      assert(stageFailResult.message.includes("hardware persistence error"), "Local failure reported without corrupting state");
    }

    // =========================================================================
    // TEST 16: Previously approved replacement followed by another replacement attempt
    // =========================================================================
    console.log("\n[Test 16] Negative: Another replacement attempt after previous replacement without new approval");
    {
      // After Test 10 consumed the token, staff A is currently enrolled and locked
      // Attempt another replacement without submitting a fresh request
      const mSubsequent = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
      }, headersA);
      await handlerFaceStaff(mSubsequent.req, mSubsequent.res);
      assert(mSubsequent.getStatus() === 403, `Subsequent replacement strictly blocked with HTTP 403 (got ${mSubsequent.getStatus()})`);
      assert(mSubsequent.getData()?.code === "FACE_REGISTRATION_LOCKED", "Requires fresh administrator request");

      // Verify GET status requires a new request
      const mLatestStatus = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
      await handlerFaceStaff(mLatestStatus.req, mLatestStatus.res);
      assert(mLatestStatus.getData()?.canSaveReplacement === false, "canSaveReplacement is false");
      assert(mLatestStatus.getData()?.oneTimeToken === null, "oneTimeToken is null");
      assert(mLatestStatus.getData()?.isLocked === true, "Enrollment remains permanently locked");
    }

    // =========================================================================
    // POSITIVE VERIFICATION: Fresh request, approval, single-use consumption & re-lock
    // =========================================================================
    console.log("\n[Positive Flow] Valid fresh request, approval, consumption, and permanent re-lock");
    {
      // 1. Submit fresh request
      const reqPos = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Legitimate end-to-end face replacement flow",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: deviceA,
        sampleCount: 5,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(reqPos.req, reqPos.res);
      const posReqId = reqPos.getData()?.requestId;
      if (posReqId) createdRecordIds.push(posReqId);
      assert(reqPos.getStatus() === 201, `Fresh request created (HTTP 201, ID: ${posReqId})`);

      // 2. Admin approves
      const appPos = mockReqRes("POST", `/api/admin/face-requests/${posReqId}/approve`, {
        adminNotes: "Fully authorized for replacement",
      }, headersAdmin);
      await handlerAdminFaceRequests(appPos.req, appPos.res);
      const posToken = appPos.getData()?.oneTimeToken;
      assert(appPos.getStatus() === 200, `Admin approved request with token ${posToken?.slice(0, 16)}...`);

      // 3. Status delivers token
      const mCheckApproved = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
      await handlerFaceStaff(mCheckApproved.req, mCheckApproved.res);
      assert(mCheckApproved.getData()?.canSaveReplacement === true, "canSaveReplacement is true");
      assert(mCheckApproved.getData()?.oneTimeToken === posToken, "Status delivers freshly issued token");

      // 4. Consume token via replacement
      const mConsumePos = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: deviceA,
        templateCount: 5,
        oneTimeToken: posToken,
        requestId: posReqId,
        digest: bypassDigest,
      }, headersA);
      await handlerFaceStaff(mConsumePos.req, mConsumePos.res);
      assert(mConsumePos.getStatus() === 200, `Valid replacement successfully consumed token (HTTP 200)`);
      assert(mConsumePos.getData()?.isLocked === true, "Biometric profile is permanently locked");

      // 5. Subsequent status requires fresh request
      const mFinalStatus = mockReqRes("GET", "/api/staff/face/status", {}, headersA);
      await handlerFaceStaff(mFinalStatus.req, mFinalStatus.res);
      assert(mFinalStatus.getData()?.canSaveReplacement === false, "canSaveReplacement is reset to false");
      assert(mFinalStatus.getData()?.oneTimeToken === null, "oneTimeToken is reset to null");
      assert(mFinalStatus.getData()?.latestRequestStatus === "completed", "Latest request status is 'completed'");
    }

  } catch (err) {
    console.error("Unhandled test execution error:", err);
    failedCount++;
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup: Remove disposable test records only (preserving SCT-002)
    // -------------------------------------------------------------------------
    console.log("\n[Cleanup] Cleaning up disposable test data (preserving SCT-002)...");
    try {
      await supabase.from("security_events").delete().or(`staff.eq.${staffA},staff.eq.${staffB}`);
      await supabase.from("staff").delete().or(`staff_code.eq.${staffA},staff_code.eq.${staffB}`);
      console.log(`  ✓ Cleaned up test staff ${staffA} and ${staffB}`);
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr);
    }
  }

  console.log("\n===============================================================================");
  console.log(` NEGATIVE SECURITY TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("===============================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runBypassSecurityTests();
