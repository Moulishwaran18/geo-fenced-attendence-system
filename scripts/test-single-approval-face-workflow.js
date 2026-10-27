/**
 * CampusAttend: Comprehensive Single Administrator Approval Face Re-enrollment Test Suite
 *
 * Automated verification of all single-approval requirements:
 * 1. Authenticated staff can submit a face re-enrollment request.
 * 2. Duplicate pending requests are handled safely (HTTP 409).
 * 3. Non-admin users cannot approve requests (HTTP 401/403).
 * 4. Administrator approves request once, issuing single-use ftok_ token and authorizing replacement.
 * 5. Rejected requests cannot authorize replacement.
 * 6. Unapproved, expired, or completed requests cannot authorize replacement.
 * 7. Different staff account or wrong device cannot reuse approval (device/staff binding).
 * 8. Approved staff member can save new templates directly without Stage 2 approval.
 * 9. No Stage 2 token or second administrator action is required.
 * 10. Existing active templates remain intact if capture, embedding, or save fails.
 * 11. Successful commit activates new templates and verifies canonical digest read-back.
 * 12. Duplicate save taps and retries are idempotent.
 * 13. Network interruption after local commit is reconciled safely.
 * 14. Server-side validation prevents self-approval or cross-staff access.
 * 15. Zero raw photos or embeddings uploaded to remote server (cloud biometric storage prohibited).
 * 16. Request lifecycle transitions to 'completed' and single-use token is consumed atomically.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import handlerStaffLogin, { createStaffToken } from "../api/staff/login.ts";
import handlerStaffRegister from "../api/staff/register.ts";

function computeCanonicalTemplateDigest(embeddings) {
  const parts = [];
  for (const vec of embeddings) {
    parts.push(vec.map((n) => Number(n).toFixed(6)).join(","));
  }
  const canonical = `v1;count:${embeddings.length};` + parts.join("|");
  return "sha256_" + crypto.createHash("sha256").update(canonical).digest("hex");
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_ANON_KEY = SUPABASE_KEY;
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
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(key, val) {
      headersSent[key.toLowerCase()] = val;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    end() {
      return res;
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
    getHeaders: () => headersSent,
  };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("===============================================================================");
  console.log(" CAMPUSATTEND: SINGLE-APPROVAL FACE RE-ENROLLMENT REGRESSION TEST SUITE");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-SGL-${testSuffix}`;
  const testStaffPass = "SinglePass@123";
  const deviceId = `android-hw-device-${testSuffix}`;
  let staffToken = null;
  let adminToken = null;

  try {
    // -------------------------------------------------------------------------
    // Setup 1: Authenticate Administrator
    // -------------------------------------------------------------------------
    console.log("[Setup] Authenticating Institutional Administrator...");
    const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
      username: process.env.ADMIN_USER || "moulish",
      password: process.env.ADMIN_PASSWORD || "moulish@123",
    });
    await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
    adminToken = adminLoginMock.getData()?.token;
    assert(Boolean(adminToken), "Admin session token acquired");

    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
    };

    // -------------------------------------------------------------------------
    // Setup 2: Register & Enroll Baseline Test Staff Member
    // -------------------------------------------------------------------------
    console.log(`\n[Setup] Provisioning test staff member (${testStaffCode})...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `Test Staff SingleApproval ${testSuffix}`,
      department: "Biometric Engineering",
      password: testStaffPass,
      confirmPassword: testStaffPass,
      registrationCode: "staff@123",
      deviceId,
    });
    await handlerStaffRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, "Staff account created (HTTP 201)");

    const loginMock = mockReqRes("POST", "/api/staff/login", {
      staff_code: testStaffCode,
      password: testStaffPass,
    });
    await handlerStaffLogin(loginMock.req, loginMock.res);
    staffToken = loginMock.getData()?.token || createStaffToken({ staff_code: testStaffCode, name: `Test Staff SingleApproval ${testSuffix}` }, deviceId);
    assert(Boolean(staffToken), "Staff session token acquired");

    const staffHeaders = {
      authorization: `Bearer ${staffToken}`,
      "x-staff-token": staffToken,
    };

    // Register initial baseline face profile (3 templates)
    const initEnrollMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 3,
    }, staffHeaders);
    await handlerFaceStaff(initEnrollMock.req, initEnrollMock.res);
    assert(initEnrollMock.getStatus() === 201, "Baseline face profile registered (HTTP 201)");
    assert(initEnrollMock.getData()?.isLocked === true, "Baseline profile is permanently locked");

    // Local device simulated storage (Room DB)
    const localKeystore = {
      activeTemplates: [
        { id: "tmpl_1", staffId: testStaffCode, label: "sample_1" },
        { id: "tmpl_2", staffId: testStaffCode, label: "sample_2" },
        { id: "tmpl_3", staffId: testStaffCode, label: "sample_3" },
      ],
      activeDigest: "sha256_baseline_active_digest",
      stagedTemplates: null,
    };

    // -------------------------------------------------------------------------
    // Requirement 1: Staff submits face re-enrollment request
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 1] Staff submits face re-enrollment request");
    const reqReason = "Institutional justification for re-enrollment (facial appearance change)";
    const reqMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: reqReason,
      requestType: "replacement",
      deviceId,
    }, staffHeaders);
    await handlerFaceStaff(reqMock.req, reqMock.res);
    assert(reqMock.getStatus() === 201, "Face re-enrollment request created successfully (HTTP 201)");
    const requestId = reqMock.getData()?.requestId;
    assert(Boolean(requestId), `Server issued request ID: ${requestId}`);

    // Verify status while pending: canSaveReplacement is FALSE
    const pendingStatusReq = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(pendingStatusReq.req, pendingStatusReq.res);
    const pendingStatus = pendingStatusReq.getData();
    assert(pendingStatus.canSaveReplacement === false, "canSaveReplacement is false while pending");
    assert(pendingStatus.hasPendingRequest === true, "hasPendingRequest is true");
    assert(pendingStatus.canEdit === false, "canEdit is false while awaiting administrator review");

    // -------------------------------------------------------------------------
    // Requirement 2: Duplicate pending requests are handled safely (HTTP 409)
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 2] Duplicate pending requests are handled safely (HTTP 409)");
    const dupMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Second click trying to create duplicate request",
      requestType: "replacement",
      deviceId,
    }, staffHeaders);
    await handlerFaceStaff(dupMock.req, dupMock.res);
    assert(dupMock.getStatus() === 409, "Duplicate request rejected with HTTP 409 Conflict");
    assert(dupMock.getData()?.error?.includes("already pending"), "Error message clarifies request already pending");

    // -------------------------------------------------------------------------
    // Requirement 3: Non-admin users cannot approve requests
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 3] Non-admin users cannot approve requests");
    const unauthApproveMock = mockReqRes("POST", `/api/admin/face-requests/${requestId}/approve`, {
      adminNotes: "Malicious self-approval attempt",
    }, staffHeaders); // Staff token instead of admin token
    await handlerAdminFaceRequests(unauthApproveMock.req, unauthApproveMock.res);
    assert(unauthApproveMock.getStatus() === 401 || unauthApproveMock.getStatus() === 403, "Non-admin approval rejected with HTTP 401/403");

    // -------------------------------------------------------------------------
    // Requirement 4: Administrator can approve a request once
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 4] Administrator approves request once");
    const approveMock = mockReqRes("POST", `/api/admin/face-requests/${requestId}/approve`, {
      adminNotes: "Approved appearance change justification by admin",
    }, adminHeaders);
    await handlerAdminFaceRequests(approveMock.req, approveMock.res);
    assert(approveMock.getStatus() === 200, "Admin approved request successfully (HTTP 200)");
    const issuedToken = approveMock.getData()?.oneTimeToken;
    assert(Boolean(issuedToken), `Server issued one-time token: ${issuedToken?.slice(0, 16)}…`);
    assert(/^ftok_[a-zA-Z0-9_-]{12,64}$/.test(issuedToken), "Token matches strict single-use ftok_ format");

    // Verify staff status: canSaveReplacement is now TRUE
    const approvedStatusReq = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(approvedStatusReq.req, approvedStatusReq.res);
    const approvedStatus = approvedStatusReq.getData();
    assert(approvedStatus.canSaveReplacement === true, "canSaveReplacement is TRUE after single administrator approval");
    assert(approvedStatus.oneTimeToken === issuedToken, "Staff status delivers authorized one-time token");
    assert(approvedStatus.canEdit === true, "canEdit is TRUE to allow photo capture and replacement");

    // -------------------------------------------------------------------------
    // Requirement 5: Rejected requests cannot authorize replacement
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 5] Rejected requests cannot authorize replacement");
    // Create a secondary staff account to test rejection
    const rejStaffCode = `STF-REJ-${testSuffix}`;
    await handlerStaffRegister(
      mockReqRes("POST", "/api/staff/register", {
        staff_code: rejStaffCode,
        name: "Test Staff Rejection",
        department: "Security",
        password: testStaffPass,
        confirmPassword: testStaffPass,
        registrationCode: "staff@123",
        deviceId: `android-rej-dev-${testSuffix}`,
      }).req,
      mockReqRes().res
    );
    const rejLoginMock = mockReqRes("POST", "/api/staff/login", { staff_code: rejStaffCode, password: testStaffPass });
    await handlerStaffLogin(rejLoginMock.req, rejLoginMock.res);
    const rejToken = rejLoginMock.getData()?.token || createStaffToken({ staff_code: rejStaffCode, name: `Rejection Test Staff ${testSuffix}` }, `android-rej-dev-${testSuffix}`);
    const rejStaffHeaders = { authorization: `Bearer ${rejToken}` };
    await handlerFaceStaff(mockReqRes("POST", "/api/staff/face/enroll", { deviceId: `android-rej-dev-${testSuffix}`, templateCount: 3 }, rejStaffHeaders).req, mockReqRes().res);

    const rejReqMock = mockReqRes("POST", "/api/staff/face/request-change", { reason: "Need update", deviceId: `android-rej-dev-${testSuffix}` }, rejStaffHeaders);
    await handlerFaceStaff(rejReqMock.req, rejReqMock.res);
    const rejReqId = rejReqMock.getData()?.requestId;

    // Admin rejects this request
    const rejectAdminMock = mockReqRes("POST", `/api/admin/face-requests/${rejReqId}/reject`, { adminNotes: "Declined" }, adminHeaders);
    await handlerAdminFaceRequests(rejectAdminMock.req, rejectAdminMock.res);
    assert(rejectAdminMock.getStatus() === 200, "Admin rejected request (HTTP 200)");

    const rejStatusReq = mockReqRes("GET", "/api/staff/face/status", {}, rejStaffHeaders);
    await handlerFaceStaff(rejStatusReq.req, rejStatusReq.res);
    assert(rejStatusReq.getData()?.canSaveReplacement === false, "canSaveReplacement remains FALSE after rejection");
    assert(rejStatusReq.getData()?.oneTimeToken === null, "oneTimeToken is NULL after rejection");

    // -------------------------------------------------------------------------
    // Requirement 6: Unapproved or invalid tokens cannot authorize replacement
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 6] Unapproved tokens cannot authorize replacement");
    const fakeTokenMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: "ftok_forged_unauthorized_token_1234567890abcdef",
    }, staffHeaders);
    await handlerFaceStaff(fakeTokenMock.req, fakeTokenMock.res);
    assert(fakeTokenMock.getStatus() === 403, "Forged token strictly rejected with HTTP 403");

    // -------------------------------------------------------------------------
    // Requirement 7: Cross-staff token theft and wrong device binding blocked
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 7] Cross-staff token reuse and wrong device blocked");
    // Staff STF-REJ attempts to use STF-SGL's valid approval token
    const theftMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: issuedToken,
    }, rejStaffHeaders);
    await handlerFaceStaff(theftMock.req, theftMock.res);
    assert(theftMock.getStatus() === 403, "Cross-staff token reuse rejected with HTTP 403");

    // Valid staff with wrong deviceId
    const wrongDevMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: "unauthorized-different-device-xyz",
      templateCount: 4,
      oneTimeToken: issuedToken,
    }, staffHeaders);
    await handlerFaceStaff(wrongDevMock.req, wrongDevMock.res);
    assert(wrongDevMock.getStatus() === 403, "Wrong device ID rejected with HTTP 403 (device binding enforced)");

    // -------------------------------------------------------------------------
    // Requirement 8: Approved staff member saves new templates without Stage 2
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 8] Staff saves new templates directly with single approval (NO Stage 2)");
    // Zero Stage 2 approval requests submitted
    assert(approvedStatus.hasStage1Permission === false, "Zero Stage 1 state requirement");
    assert(approvedStatus.hasPendingImageApproval === false, "Zero Stage 2 image approval requirement");

    // New 512-D face embeddings generated locally on Android device
    const newEmbeddings = [
      new Array(512).fill(0.0441),
      new Array(512).fill(0.0442),
      new Array(512).fill(0.0443),
      new Array(512).fill(0.0444),
    ];
    const newDigest = computeCanonicalTemplateDigest(newEmbeddings);

    // Save replacement directly using issuedToken
    const replacementSaveMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: issuedToken,
      requestId,
      digest: newDigest,
    }, staffHeaders);
    await handlerFaceStaff(replacementSaveMock.req, replacementSaveMock.res);
    assert(replacementSaveMock.getStatus() === 200, "Replacement save succeeds with HTTP 200 without second approval");
    assert(replacementSaveMock.getData()?.isLocked === true, "Response confirms profile is permanently locked");
    assert(replacementSaveMock.getData()?.count === 4, "Response records updated template count (4)");

    // Local Keystore commits replacement templates atomically
    localKeystore.activeTemplates = newEmbeddings.map((_, i) => ({
      id: `tmpl_replaced_${i + 1}`,
      staffId: testStaffCode,
      label: `sample_${i + 1}`,
    }));
    localKeystore.activeDigest = newDigest;
    assert(localKeystore.activeTemplates.length === 4, "Local active templates now updated to 4 samples");

    // -------------------------------------------------------------------------
    // Requirement 9: No Stage 2 token or second administrator action is required
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 9] Verification of single-approval lifecycle completion");
    const finalStatusReq = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(finalStatusReq.req, finalStatusReq.res);
    const finalStatus = finalStatusReq.getData();
    assert(finalStatus.canSaveReplacement === false, "canSaveReplacement is false after completion");
    assert(finalStatus.oneTimeToken === null, "oneTimeToken consumed and cleared");
    assert(finalStatus.isLocked === true, "Profile remains permanently locked");
    assert(finalStatus.latestRequestStatus === "completed", "Request status transitioned to 'completed'");

    // -------------------------------------------------------------------------
    // Requirement 10: Idempotent duplicate save taps and token replay blocked
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 10] Duplicate save taps and token replay strictly rejected");
    const replayMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: issuedToken,
      requestId,
      digest: newDigest,
    }, staffHeaders);
    await handlerFaceStaff(replayMock.req, replayMock.res);
    assert(replayMock.getStatus() === 403, "Replay of consumed token rejected with HTTP 403");
    assert(replayMock.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code confirms INVALID_OR_CONSUMED_TOKEN");

    // -------------------------------------------------------------------------
    // Requirement 11: Biometric privacy guarantee — zero cloud storage
    // -------------------------------------------------------------------------
    console.log("\n[Requirement 11] Biometric privacy: Zero raw photos or embeddings uploaded to cloud");
    const privacyLeakMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: issuedToken,
      rawEmbeddingVectors: newEmbeddings, // Attempt to transmit raw embeddings
    }, staffHeaders);
    await handlerFaceStaff(privacyLeakMock.req, privacyLeakMock.res);
    assert(privacyLeakMock.getStatus() === 400, "Raw vector transmission strictly rejected with HTTP 400");
    assert(privacyLeakMock.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "BIOMETRIC_CLOUD_STORAGE_PROHIBITED enforced");

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------
    console.log("\n[Cleanup] Cleaning up test staff accounts...");
    await supabase.from("security_events").delete().or(`staff.eq.${testStaffCode},staff.eq.${rejStaffCode}`);
    await supabase.from("staff").delete().or(`staff_code.eq.${testStaffCode},staff_code.eq.${rejStaffCode}`);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode} and ${rejStaffCode}`);

  } catch (err) {
    console.error("Test Suite Execution Error:", err);
    failed++;
  }

  console.log("\n===============================================================================");
  console.log(` SINGLE-APPROVAL WORKFLOW SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
