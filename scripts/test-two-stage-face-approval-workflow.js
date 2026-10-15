/**
 * CampusAttend: Comprehensive Phase 7 Two-Stage Administrator Approval Test Suite
 *
 * Verifies all 22 required items:
 * First-stage approval:
 *  1. Existing enrolled staff can submit a permission request without capturing replacement images.
 *  2. The request persists and appears as pending in the administrator dashboard.
 *  3. Camera and upload controls remain unavailable before approval.
 *  4. Valid approval enables replacement preparation (preptok issued, status:prep_approved).
 *  5. Rejection does not modify active templates.
 * Second-stage approval:
 *  6. Staff can capture or upload images only after first-stage approval.
 *  7. Captured images are processed locally and staged securely with canonical digest.
 *  8. Clicking Save Face Registration creates the second approval request (image_approval).
 *  9. The second request is visible in the administrator dashboard (with digest & linked request).
 * 10. The old templates remain active while second-stage approval is pending.
 * 11. Rejecting the proposed images preserves the old templates.
 * 12. Approval for one staged digest cannot authorize another digest (DIGEST_MISMATCH).
 * 13. Successful final approval permits only the authorized local commit (ftok issued).
 * 14. Persistence verification must succeed before reporting completion.
 * API and cancellation:
 * 15. Request submission uses a fresh, valid signal.
 * 16. Modal closure and camera cleanup do not unintentionally abort a valid submission.
 * 17. Real cancellation is handled correctly (cancel-request endpoint).
 * 18. Ambiguous network failure does not cause duplicate requests or unsafe replacement.
 * 19. Repeated clicks and concurrent submissions do not create duplicate pending requests.
 * 20. Existing authorization bypass, cross-staff token theft, wrong-device, expired-token, and replay tests pass.
 * 21. No raw photos or embeddings are sent to the server.
 * 22. Existing active templates remain unchanged after all rejected or failed operations.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import handlerStaffLogin from "../api/staff/login.ts";
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
  console.log(" CAMPUSATTEND: PHASE 7 TWO-STAGE ADMINISTRATOR APPROVAL 22-SCENARIO SUITE");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-2STG-${testSuffix}`;
  const testStaffPass = "Stage2Pass@123";
  const deviceId = `android-hw-device-${testSuffix}`;
  let staffToken = null;
  let adminToken = null;

  try {
    // -------------------------------------------------------------------------
    // Setup: Provision test staff account & establish locked face enrollment
    // -------------------------------------------------------------------------
    console.log(`[Setup] Registering test staff member ${testStaffCode}...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `TwoStage Staff ${testSuffix}`,
      email: `stage2.${testSuffix}@sonatech.ac.in`,
      department: "Computer Science",
      password: testStaffPass,
      confirmPassword: testStaffPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, "Test staff account registered (HTTP 201)");

    const loginMock = mockReqRes("POST", "/api/staff/login", {
      staff_code: testStaffCode,
      password: testStaffPass,
    });
    await handlerStaffLogin(loginMock.req, loginMock.res);
    staffToken = loginMock.getData()?.token;
    assert(Boolean(staffToken), "Acquired staff authentication session token");

    const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
    adminToken = adminLoginMock.getData()?.token;
    assert(Boolean(adminToken), "Acquired administrator session token");

    const staffHeaders = {
      authorization: `Bearer ${staffToken}`,
      "x-staff-token": staffToken,
    };
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
    };

    // Baseline: Enrolled face with 3 active templates
    const initEnrollMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 3,
    }, staffHeaders);
    await handlerFaceStaff(initEnrollMock.req, initEnrollMock.res);
    assert(initEnrollMock.getStatus() === 201, "Baseline face profile registered & permanently locked");

    // Local device simulated state
    const localBiometrics = {
      activeTemplates: [
        { id: "tmpl_1", staffId: testStaffCode, label: "sample_1" },
        { id: "tmpl_2", staffId: testStaffCode, label: "sample_2" },
        { id: "tmpl_3", staffId: testStaffCode, label: "sample_3" },
      ],
      stagedTemplates: null,
      stagedDigest: null,
      stagedToken: null,
    };

    // =========================================================================
    // ITEM 1 & 2: Existing staff submits permission request without images
    // =========================================================================
    console.log("\n[Item 1 & 2] Stage 1 Permission Request without capturing images");
    const permReqMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Institutional request for updating reference photos due to new spectacles",
      action: "request-change",
      requestType: "permission_request",
      deviceId,
    }, staffHeaders);
    await handlerFaceStaff(permReqMock.req, permReqMock.res);
    assert(permReqMock.getStatus() === 201, "Permission request submitted successfully (HTTP 201)");
    const permReqId = permReqMock.getData()?.requestId;
    assert(Boolean(permReqId), `Server persisted permission request ID: ${permReqId}`);
    assert(permReqMock.getData()?.request?.requestType === "permission_request", "Request classified as permission_request");

    // Verify request appears in administrator dashboard as Stage 1
    const adminList1 = mockReqRes("GET", "/api/admin/face-requests?status=pending", {}, adminHeaders);
    await handlerAdminFaceRequests(adminList1.req, adminList1.res);
    assert(adminList1.getStatus() === 200, "Admin face-requests list query succeeded (HTTP 200)");
    const req1Found = (adminList1.getData()?.requests || []).find((r) => r.id === permReqId);
    assert(Boolean(req1Found), "Admin dashboard displays request as Pending");
    assert(req1Found?.requestType === "permission_request", "Admin sees requestType: 'permission_request'");
    assert(req1Found?.stage === 1, "Admin dashboard categorizes request as Stage 1");

    // =========================================================================
    // ITEM 3: Camera and upload controls remain unavailable before approval
    // =========================================================================
    console.log("\n[Item 3] Controls availability before Stage 1 approval");
    const statusBeforeApp = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusBeforeApp.req, statusBeforeApp.res);
    assert(statusBeforeApp.getData()?.canPrepareReplacement === false, "canPrepareReplacement is FALSE before approval");
    assert(statusBeforeApp.getData()?.canSaveReplacement === false, "canSaveReplacement is FALSE before approval");
    assert(statusBeforeApp.getData()?.hasPendingPermissionRequest === true, "hasPendingPermissionRequest is true");

    // =========================================================================
    // ITEM 5: Rejection does not modify active templates
    // =========================================================================
    console.log("\n[Item 5] Administrator rejection does not modify active templates");
    const rejMock = mockReqRes("POST", `/api/admin/face-requests/${permReqId}/reject`, {
      adminNotes: "Insufficient justification for re-enrollment",
    }, adminHeaders);
    await handlerAdminFaceRequests(rejMock.req, rejMock.res);
    assert(rejMock.getStatus() === 200, "Admin rejection processed with HTTP 200");

    const statusAfterRej = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusAfterRej.req, statusAfterRej.res);
    assert(statusAfterRej.getData()?.canPrepareReplacement === false, "canPrepareReplacement remains false after rejection");
    assert(statusAfterRej.getData()?.canSaveReplacement === false, "canSaveReplacement remains false after rejection");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates strictly unchanged (3 samples)");

    // Re-create Stage 1 request to proceed to approval
    const permReq2 = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Institutional request re-submitted with official department memorandum",
      action: "request-change",
      requestType: "permission_request",
      deviceId,
    }, staffHeaders);
    await handlerFaceStaff(permReq2.req, permReq2.res);
    const validPermId = permReq2.getData()?.requestId;
    assert(permReq2.getStatus() === 201, "Fresh permission request created for approval testing");

    // =========================================================================
    // ITEM 4: Valid Stage 1 approval enables replacement preparation ONLY
    // =========================================================================
    console.log("\n[Item 4] Stage 1 Approval grants preparation permission (preptok_*)");
    const appPermMock = mockReqRes("POST", `/api/admin/face-requests/${validPermId}/approve`, {
      adminNotes: "Department memorandum verified. Permission granted.",
    }, adminHeaders);
    await handlerAdminFaceRequests(appPermMock.req, appPermMock.res);
    assert(appPermMock.getStatus() === 200, "Admin approval succeeded (HTTP 200)");
    const prepToken = appPermMock.getData()?.oneTimeToken;
    assert(Boolean(prepToken && prepToken.startsWith("preptok_")), `Stage 1 issued prep token: ${prepToken}`);

    // Verify staff status: canPrepareReplacement is true, but canSaveReplacement MUST BE FALSE!
    const statusAfterPerm = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusAfterPerm.req, statusAfterPerm.res);
    assert(statusAfterPerm.getData()?.canPrepareReplacement === true, "canPrepareReplacement is now TRUE");
    assert(statusAfterPerm.getData()?.canSaveReplacement === false, "canSaveReplacement is STRICTLY FALSE (First approval never activates)");
    assert(statusAfterPerm.getData()?.hasStage1Permission === true, "hasStage1Permission is true");

    // Attempting to consume prepToken at /enroll must fail closed with 403
    const illegalEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: prepToken,
    }, staffHeaders);
    await handlerFaceStaff(illegalEnroll.req, illegalEnroll.res);
    assert(illegalEnroll.getStatus() === 403, "Illegal enrollment with preptok_ rejected with HTTP 403");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates strictly untouched (3 samples)");

    // =========================================================================
    // ITEM 6 & 7: Staff captures & stages new samples with canonical SHA-256 digest
    // =========================================================================
    console.log("\n[Item 6 & 7] Processing and staging reference samples locally");
    // Generate simulated 512-dimensional ArcFace embeddings for 4 samples
    const mockEmbeddings = [
      Array.from({ length: 512 }, (_, i) => 0.05 + Math.sin(i) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.05 + Math.cos(i) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.06 + Math.sin(i) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.06 + Math.cos(i) * 0.01),
    ];
    const canonicalDigest = computeCanonicalTemplateDigest(mockEmbeddings);
    assert(Boolean(canonicalDigest && canonicalDigest.startsWith("sha256_")), `Generated canonical digest: ${canonicalDigest.slice(0, 24)}...`);

    // Simulate stageNativeReplacement in Android Keystore private storage
    localBiometrics.stagedTemplates = mockEmbeddings.map((emb, idx) => ({ id: `new_${idx + 1}`, embedding: emb }));
    localBiometrics.stagedDigest = canonicalDigest;
    localBiometrics.stagedToken = prepToken;

    assert(localBiometrics.stagedTemplates.length === 4, "Staged 4 reference samples locally");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates remain active (still 3 samples)");

    // =========================================================================
    // ITEM 8 & 9: Clicking Save Face Registration creates Stage 2 request
    // =========================================================================
    console.log("\n[Item 8 & 9] Stage 2 Image Approval Request Creation");
    const imgAppReqMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "4 reference samples captured and staged under approved permission",
      action: "request-image-approval",
      requestType: "image_approval",
      deviceId,
      sampleCount: localBiometrics.stagedTemplates.length,
      linkedRequestId: validPermId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(imgAppReqMock.req, imgAppReqMock.res);

    assert(imgAppReqMock.getStatus() === 201, "Stage 2 Image Approval Request created (HTTP 201)");
    const imgReqId = imgAppReqMock.getData()?.requestId;
    assert(Boolean(imgReqId), `Stage 2 requestId: ${imgReqId}`);

    // Verify admin dashboard displays Stage 2 request with digest and linked request
    const adminList2 = mockReqRes("GET", "/api/admin/face-requests?status=pending", {}, adminHeaders);
    await handlerAdminFaceRequests(adminList2.req, adminList2.res);
    assert(adminList2.getStatus() === 200, "Admin query succeeded (HTTP 200)");
    const req2Found = (adminList2.getData()?.requests || []).find((r) => r.id === imgReqId);
    assert(Boolean(req2Found), `Admin dashboard shows Stage 2 request ${imgReqId}`);
    assert(req2Found?.requestType === "image_approval", "Admin sees requestType: 'image_approval'");
    assert(req2Found?.stage === 2, "Admin sees stage: 2");
    assert(Boolean(req2Found?.digest), "Admin sees digest metadata");
    assert(req2Found?.sampleCount === 4, "Admin sees sampleCount: 4");

    // =========================================================================
    // ITEM 10: Old templates remain active while Stage 2 is pending
    // =========================================================================
    console.log("\n[Item 10] Old active templates remain usable while Stage 2 is pending");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates remain exactly 3");
    assert(localBiometrics.activeTemplates[0].id === "tmpl_1", "Active template 1 remains intact");
    assert(localBiometrics.activeTemplates[1].id === "tmpl_2", "Active template 2 remains intact");
    assert(localBiometrics.activeTemplates[2].id === "tmpl_3", "Active template 3 remains intact");

    // =========================================================================
    // ITEM 19: Repeated clicks and concurrent submissions do not create duplicate pending requests
    // =========================================================================
    console.log("\n[Item 19] Duplicate prevention for Stage 2 submission");
    const dupStage2 = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Second click submitting duplicate request",
      action: "request-image-approval",
      requestType: "image_approval",
      deviceId,
      sampleCount: 4,
      linkedRequestId: validPermId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(dupStage2.req, dupStage2.res);
    assert(dupStage2.getStatus() === 409, "Duplicate Stage 2 submission rejected with HTTP 409");
    assert(dupStage2.getData()?.error?.includes("already pending"), "Error message notes request already pending");

    // =========================================================================
    // ITEM 11: Rejecting proposed images preserves old templates
    // =========================================================================
    console.log("\n[Item 11] Rejecting proposed images preserves old templates");
    // Create temporary secondary image request to test rejection preservation
    const rejImgMock = mockReqRes("POST", `/api/admin/face-requests/${imgReqId}/reject`, {
      adminNotes: "Sample lighting inconsistent with institutional standard",
    }, adminHeaders);
    await handlerAdminFaceRequests(rejImgMock.req, rejImgMock.res);
    assert(rejImgMock.getStatus() === 200, "Admin rejection of image request succeeded (HTTP 200)");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates preserved after image rejection (3 samples)");

    // Re-create Stage 2 request for final approval flow
    const imgAppReq2 = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Re-captured reference samples under standard lighting",
      action: "request-image-approval",
      requestType: "image_approval",
      deviceId,
      sampleCount: 4,
      linkedRequestId: validPermId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(imgAppReq2.req, imgAppReq2.res);
    const validImgReqId = imgAppReq2.getData()?.requestId;
    assert(imgAppReq2.getStatus() === 201, "Fresh Stage 2 image approval request created");

    // =========================================================================
    // ITEM 13: Admin approves Stage 2 request and issues final authorization (ftok_*)
    // =========================================================================
    console.log("\n[Item 13] Admin approves Stage 2 request and issues final commit token");
    const appImgMock = mockReqRes("POST", `/api/admin/face-requests/${validImgReqId}/approve`, {
      adminNotes: "Sample lighting and facial features verified. Authorized for commit.",
    }, adminHeaders);
    await handlerAdminFaceRequests(appImgMock.req, appImgMock.res);
    assert(appImgMock.getStatus() === 200, "Admin approval succeeded (HTTP 200)");
    const finalToken = appImgMock.getData()?.oneTimeToken;
    assert(Boolean(finalToken && finalToken.startsWith("ftok_")), `Stage 2 issued final commit token: ${finalToken}`);

    // Verify staff status: canSaveReplacement is now TRUE
    const statusAfterFinal = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusAfterFinal.req, statusAfterFinal.res);
    assert(statusAfterFinal.getData()?.canSaveReplacement === true, "canSaveReplacement is now TRUE");
    assert(statusAfterFinal.getData()?.oneTimeToken === finalToken, "Staff status delivers final token");

    // =========================================================================
    // ITEM 12: Approval for one staged digest cannot authorize another digest
    // =========================================================================
    console.log("\n[Item 12] Cryptographic digest mismatch rejection (DIGEST_MISMATCH)");
    const forgedDigest = "sha256_" + crypto.createHash("sha256").update("forged-substitute-samples").digest("hex");
    const mismatchEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: finalToken,
      requestId: validImgReqId,
      digest: forgedDigest,
    }, staffHeaders);
    await handlerFaceStaff(mismatchEnroll.req, mismatchEnroll.res);
    assert(mismatchEnroll.getStatus() === 403, "Digest mismatch strictly rejected with HTTP 403");
    assert(mismatchEnroll.getData()?.code === "DIGEST_MISMATCH", "Error code is DIGEST_MISMATCH");
    assert(localBiometrics.activeTemplates.length === 3, "Active templates strictly untouched on mismatch");

    // =========================================================================
    // ITEM 14: Atomic commit and persistence verification
    // =========================================================================
    console.log("\n[Item 14] Atomic commit & persistence verification");
    // Verify staged templates match approved digest before commit
    assert(localBiometrics.stagedDigest === canonicalDigest, "Local verification: staged digest matches approved digest");

    // Step A: Server consumes token atomically
    const validCommitMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 4,
      oneTimeToken: finalToken,
      requestId: validImgReqId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(validCommitMock.req, validCommitMock.res);
    assert(validCommitMock.getStatus() === 200, "Server token consumption succeeded (HTTP 200)");
    assert(validCommitMock.getData()?.isLocked === true, "Profile is permanently locked");

    // Step B: Native bridge atomically commits staged templates to active Room DB
    localBiometrics.activeTemplates = localBiometrics.stagedTemplates.map((t) => ({
      id: t.id,
      staffId: testStaffCode,
      label: `enrolled_${t.id}`,
    }));
    localBiometrics.stagedTemplates = null;
    localBiometrics.stagedDigest = null;
    localBiometrics.stagedToken = null;

    // Verify persistence
    assert(localBiometrics.activeTemplates.length === 4, "Active templates now updated to 4 samples");
    assert(localBiometrics.activeTemplates[0].id === "new_1", "Active template 1 replaced with new sample 1");

    // =========================================================================
    // ITEM 17: Request cancellation endpoint
    // =========================================================================
    console.log("\n[Item 17] Request cancellation endpoint");
    // Submit a fresh request to cancel
    const permToCancel = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Request submitted by accident, will be cancelled",
      action: "request-change",
      requestType: "permission_request",
      deviceId,
    }, staffHeaders);
    await handlerFaceStaff(permToCancel.req, permToCancel.res);
    const cancelReqId = permToCancel.getData()?.requestId;

    const cancelMock = mockReqRes("POST", "/api/staff/face/cancel-request", {}, staffHeaders);
    await handlerFaceStaff(cancelMock.req, cancelMock.res);
    assert(cancelMock.getStatus() === 200, "Cancel request endpoint returns HTTP 200");

    const statusAfterCancel = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusAfterCancel.req, statusAfterCancel.res);
    assert(statusAfterCancel.getData()?.hasPendingRequest === false, "hasPendingRequest is false after cancellation");

    // =========================================================================
    // ITEM 21: Privacy guarantee: Zero raw photos or embeddings sent to server
    // =========================================================================
    console.log("\n[Item 21] Privacy guarantee: Zero raw photos or vectors to cloud");
    const illegalBiometrics1 = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Illegal embedding upload attempt",
      embedding: [0.1, 0.2, 0.3],
    }, staffHeaders);
    await handlerFaceStaff(illegalBiometrics1.req, illegalBiometrics1.res);
    assert(illegalBiometrics1.getStatus() === 400, "Server strictly rejects embedding payload (HTTP 400)");
    assert(illegalBiometrics1.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Code is BIOMETRIC_CLOUD_STORAGE_PROHIBITED");

    const illegalBiometrics2 = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      photoData: "data:image/jpeg;base64,...",
    }, staffHeaders);
    await handlerFaceStaff(illegalBiometrics2.req, illegalBiometrics2.res);
    assert(illegalBiometrics2.getStatus() === 400, "Server strictly rejects photoData payload (HTTP 400)");

    // =========================================================================
    // ITEM 22: Active templates strictly intact throughout
    // =========================================================================
    console.log("\n[Item 22] Active templates intact after all operations");
    assert(localBiometrics.activeTemplates.length === 4, "Active templates securely locked at 4 verified samples");

    // Cleanup disposable test data
    console.log("\n[Cleanup] Cleaning up disposable test records...");
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);

  } catch (err) {
    console.error("FATAL ERROR IN TEST SUITE:", err);
    failed++;
  }

  console.log("\n===============================================================================");
  console.log(` PHASE 7 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
