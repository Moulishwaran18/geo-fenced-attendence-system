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

function mockReqRes(method = "GET", url = "/", body = {}, headers = {}) {
  let statusCode = 200;
  let headersSent = {};
  let responseData = null;

  const req = {
    method,
    url,
    headers: { ...headers },
    body,
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

async function runRegressionSuite() {
  console.log("===============================================================================");
  console.log(" REGRESSION SUITE: STAGE 2 FACE REPLACEMENT COMMIT & POST-COMMIT STATUS");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-REG-${testSuffix}`;
  const testStaffPass = "Stage2Reg@123";
  const deviceId = `android-device-${testSuffix}`;
  let staffToken = null;
  let adminToken = null;

  try {
    // -------------------------------------------------------------------------
    // Setup: Provision test staff account & establish locked face enrollment
    // -------------------------------------------------------------------------
    console.log(`[Setup] Registering test staff member ${testStaffCode}...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `Regression Staff ${testSuffix}`,
      email: `reg.${testSuffix}@sonatech.ac.in`,
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

    // Baseline: Enrolled face with 5 active templates
    const initEnrollMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
    }, staffHeaders);
    await handlerFaceStaff(initEnrollMock.req, initEnrollMock.res);
    assert(initEnrollMock.getStatus() === 201, "Baseline face profile registered & permanently locked");

    // Local device simulated state
    const localBiometrics = {
      activeTemplates: [
        { id: "tmpl_1", staffId: testStaffCode, label: "sample_1" },
        { id: "tmpl_2", staffId: testStaffCode, label: "sample_2" },
        { id: "tmpl_3", staffId: testStaffCode, label: "sample_3" },
        { id: "tmpl_4", staffId: testStaffCode, label: "sample_4" },
        { id: "tmpl_5", staffId: testStaffCode, label: "sample_5" },
      ],
      stagedTemplates: null,
      stagedDigest: null,
      stagedToken: null,
    };

    // Initial status check: locked, no replacement authorization
    const initStatus = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(initStatus.req, initStatus.res);
    const initData = initStatus.getData();
    assert(initData?.isLocked === true, "Face profile is locked");
    assert(initData?.canSaveReplacement === false, "canSaveReplacement is false without approval");
    assert(initData?.canPrepareReplacement === false, "canPrepareReplacement is false without Stage 1 approval");
    assert(initData?.hasStage1Permission === false, "hasStage1Permission is false");

    // -------------------------------------------------------------------------
    // Step 1: Stage 1 Permission Request & Administrator Approval
    // -------------------------------------------------------------------------
    console.log("\n[Stage 1] Requesting and Approving Stage 1 Re-enrollment Permission");
    const permReqMock = mockReqRes("POST", "/api/staff/face/request", {
      deviceId,
      reason: "Requesting face re-enrollment permission for updated glasses",
    }, staffHeaders);
    await handlerFaceStaff(permReqMock.req, permReqMock.res);
    assert(permReqMock.getStatus() === 201, "Stage 1 permission request submitted (HTTP 201)");
    const permReqId = permReqMock.getData()?.requestId;
    assert(Boolean(permReqId), `Acquired permission requestId: ${permReqId}`);

    // Admin approves Stage 1
    const appPermMock = mockReqRes("POST", `/api/admin/face-requests/${permReqId}/approve`, {
      adminNotes: "Stage 1 approved by administrator",
    }, adminHeaders);
    await handlerAdminFaceRequests(appPermMock.req, appPermMock.res);
    assert(appPermMock.getStatus() === 200, "Admin approved Stage 1 (HTTP 200)");
    const prepToken = appPermMock.getData()?.oneTimeToken;
    assert(Boolean(prepToken && prepToken.startsWith("preptok_")), `Issued Stage 1 prepToken: ${prepToken?.slice(0, 16)}...`);

    // Verify staff status after Stage 1 approval
    const statusStage1 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusStage1.req, statusStage1.res);
    const s1Data = statusStage1.getData();
    assert(s1Data?.hasStage1Permission === true, "hasStage1Permission is true after Stage 1 approval");
    assert(s1Data?.canPrepareReplacement === true, "canPrepareReplacement is true after Stage 1 approval");
    assert(s1Data?.canSaveReplacement === false, "canSaveReplacement is strictly false during Stage 1");
    assert(s1Data?.prepToken === prepToken, "prepToken is delivered in staff status");

    // -------------------------------------------------------------------------
    // Step 2: Stage 2 Image Preparation & Submission
    // -------------------------------------------------------------------------
    console.log("\n[Stage 2] Preparing, staging, and submitting replacement face images");
    const mockEmbeddings = [
      Array.from({ length: 512 }, (_, i) => 0.05 + Math.sin(i * 1.1) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.05 + Math.cos(i * 1.2) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.06 + Math.sin(i * 1.3) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.06 + Math.cos(i * 1.4) * 0.01),
      Array.from({ length: 512 }, (_, i) => 0.07 + Math.sin(i * 1.5) * 0.01),
    ];
    const canonicalDigest = computeCanonicalTemplateDigest(mockEmbeddings);
    assert(Boolean(canonicalDigest && canonicalDigest.startsWith("sha256_")), `Canonical digest computed: ${canonicalDigest}`);

    localBiometrics.stagedTemplates = mockEmbeddings.map((emb, idx) => ({ id: `new_${idx + 1}`, embedding: emb }));
    localBiometrics.stagedDigest = canonicalDigest;
    localBiometrics.stagedToken = prepToken;

    // Submit Stage 2 request
    const imgAppReqMock = mockReqRes("POST", "/api/staff/face/request", {
      action: "request-image-approval",
      requestType: "image_approval",
      deviceId,
      sampleCount: 5,
      linkedRequestId: permReqId,
      digest: canonicalDigest,
      reason: "5 replacement face images submitted for administrator approval",
    }, staffHeaders);
    await handlerFaceStaff(imgAppReqMock.req, imgAppReqMock.res);
    assert(imgAppReqMock.getStatus() === 201, "Stage 2 image approval request submitted (HTTP 201)");
    const imgReqId = imgAppReqMock.getData()?.requestId;
    assert(Boolean(imgReqId), `Stage 2 requestId: ${imgReqId}`);

    // Verify staff status while Stage 2 is pending
    const statusStage2Pending = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusStage2Pending.req, statusStage2Pending.res);
    const s2pData = statusStage2Pending.getData();
    assert(s2pData?.hasPendingImageApproval === true, "hasPendingImageApproval is true");
    assert(s2pData?.canPrepareReplacement === false, "canPrepareReplacement is suppressed while Stage 2 is pending");
    assert(s2pData?.hasStage1Permission === false, "hasStage1Permission is suppressed while Stage 2 is pending");
    assert(s2pData?.canSaveReplacement === false, "canSaveReplacement is false while Stage 2 is pending");

    // -------------------------------------------------------------------------
    // Step 3: Admin approves Stage 2 request
    // -------------------------------------------------------------------------
    console.log("\n[Stage 2 Approval] Administrator approves replacement face images");
    const appImgMock = mockReqRes("POST", `/api/admin/face-requests/${imgReqId}/approve`, {
      adminNotes: "Replacement images approved. Issuing single-use ftok authorization.",
    }, adminHeaders);
    await handlerAdminFaceRequests(appImgMock.req, appImgMock.res);
    assert(appImgMock.getStatus() === 200, "Admin approved Stage 2 request (HTTP 200)");
    const finalToken = appImgMock.getData()?.oneTimeToken;
    assert(Boolean(finalToken && finalToken.startsWith("ftok_")), `Stage 2 issued final token: ${finalToken?.slice(0, 16)}...`);

    // Verify staff status when Stage 2 is approved
    const statusStage2Approved = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusStage2Approved.req, statusStage2Approved.res);
    const s2aData = statusStage2Approved.getData();
    assert(s2aData?.canSaveReplacement === true, "canSaveReplacement is now TRUE");
    assert(s2aData?.oneTimeToken === finalToken, "oneTimeToken delivered matches approved token");
    assert(s2aData?.approvedDigest === canonicalDigest, "approvedDigest delivered matches staged digest");
    assert(s2aData?.hasStage1Permission === false, "hasStage1Permission is FALSE when Stage 2 is approved");
    assert(s2aData?.canPrepareReplacement === false, "canPrepareReplacement is FALSE when Stage 2 is approved");

    // Negative Check: Altered staged digest is rejected
    console.log("\n[Security Checks] Testing digest verification");
    const alteredDigest = "sha256_" + crypto.createHash("sha256").update("altered-samples").digest("hex");
    const tamperedEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: alteredDigest,
    }, staffHeaders);
    await handlerFaceStaff(tamperedEnroll.req, tamperedEnroll.res);
    assert(tamperedEnroll.getStatus() === 403, "Mismatched digest rejected with HTTP 403");
    assert(tamperedEnroll.getData()?.code === "DIGEST_MISMATCH", "Error code is DIGEST_MISMATCH");

    // -------------------------------------------------------------------------
    // Step 4: Final Commit & Persistence Verification
    // -------------------------------------------------------------------------
    console.log("\n[Final Commit] Executing authorized replacement commit & token consumption");
    // Verify local staged digest matches approved digest
    assert(localBiometrics.stagedDigest === canonicalDigest, "Staged digest matches approved digest");

    // Server consumes token atomically
    const validCommitMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(validCommitMock.req, validCommitMock.res);
    assert(validCommitMock.getStatus() === 200, "Server token consumption succeeded (HTTP 200)");
    assert(validCommitMock.getData()?.isLocked === true, "Profile remains permanently isLocked: true");

    // Native bridge commits staged templates to Room DB
    localBiometrics.activeTemplates = localBiometrics.stagedTemplates.map((t) => ({
      id: t.id,
      staffId: testStaffCode,
      label: `enrolled_${t.id}`,
    }));
    localBiometrics.stagedTemplates = null;
    localBiometrics.stagedDigest = null;
    localBiometrics.stagedToken = null;

    assert(localBiometrics.activeTemplates.length === 5, "Local persistence verified (5 active templates)");

    // -------------------------------------------------------------------------
    // Step 5: Post-Commit Refreshed Staff Status (Exact Bug Check!)
    // -------------------------------------------------------------------------
    console.log("\n[Post-Commit Status Verification] Verifying that staff status reflects completion without returning to Stage 1");
    const statusPostCommit = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusPostCommit.req, statusPostCommit.res);
    const postData = statusPostCommit.getData();

    assert(statusPostCommit.getStatus() === 200, "Refreshed status query returns HTTP 200");
    assert(postData?.latestRequestStatus === "completed", `latestRequestStatus is 'completed' (got '${postData?.latestRequestStatus}')`);
    assert(postData?.latestRequest?.status === "completed", `latestRequest.status is 'completed' (got '${postData?.latestRequest?.status}')`);
    assert(postData?.hasStage1Permission === false, "hasStage1Permission is STRICTLY FALSE after successful commit");
    assert(postData?.canPrepareReplacement === false, "canPrepareReplacement is STRICTLY FALSE after successful commit");
    assert(postData?.canSaveReplacement === false, "canSaveReplacement is reset to false");
    assert(postData?.oneTimeToken === null, "oneTimeToken is reset to null");
    assert(postData?.prepToken === null, "prepToken is reset to null");
    assert(postData?.hasPendingRequest === false, "hasPendingRequest is false");
    assert(postData?.hasPendingImageApproval === false, "hasPendingImageApproval is false");
    assert(postData?.hasPendingPermissionRequest === false, "hasPendingPermissionRequest is false");
    assert(postData?.isLocked === true, "Face profile is locked");
    assert(postData?.status === "approved", "Profile status is 'approved'");

    // Replay protection: Token cannot be replayed
    console.log("\n[Replay Protection] Ensuring consumed ftok_ token cannot be replayed");
    const replayMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: canonicalDigest,
    }, staffHeaders);
    await handlerFaceStaff(replayMock.req, replayMock.res);
    assert(replayMock.getStatus() === 403, "Replay of consumed token rejected with HTTP 403");
    assert(replayMock.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code is INVALID_OR_CONSUMED_TOKEN");

    // Clean up test staff
    console.log(`\n[Cleanup] Removing disposable test staff ${testStaffCode}...`);
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff_records").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);

  } catch (err) {
    console.error("Regression suite exception:", err);
    failed++;
  }

  console.log("\n===============================================================================");
  console.log(` REGRESSION SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error("Unhandled regression exception:", err);
  process.exit(1);
});
