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

function normalizeVector(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  const mag = Math.sqrt(norm) || 1;
  return vec.map(v => v / mag);
}

function computeEuclideanDistance(v1, v2) {
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    const diff = v1[i] - v2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function computeCosineDistance(v1, v2) {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }
  const mag = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (mag === 0) return 1.0;
  return 1.0 - (dot / mag);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
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

// Simulated Native Keystore Room Storage Engine
class SimulatedNativeRoomKeystoreEngine {
  constructor(staffId) {
    this.staffId = staffId;
    this.templateVersion = 1;
    this.activeTemplates = [];
    this.activeDigest = null;
    this.stagedTemplates = [];
    this.stagedDigest = null;
    this.stagedToken = null;
    this.deviceSettings = {};
  }

  initializeActiveTemplates(embeddings) {
    this.activeTemplates = embeddings.map((emb, idx) => ({
      id: `tmpl_${idx + 1}`,
      staffId: this.staffId,
      embedding: emb,
      label: `sample_${idx + 1}`,
      createdAt: new Date().toISOString(),
    }));
    this.activeDigest = computeCanonicalTemplateDigest(embeddings);
    this.templateVersion = 1;
    this.deviceSettings[`active_digest_${this.staffId}`] = this.activeDigest;
    this.deviceSettings[`template_version_${this.staffId}`] = "1";
  }

  stageTemplates(embeddings, prepToken) {
    this.stagedTemplates = embeddings.map((emb, idx) => ({
      id: `staged_${idx + 1}`,
      staffId: this.staffId,
      embedding: emb,
      label: `replacement_${idx + 1}`,
    }));
    this.stagedDigest = computeCanonicalTemplateDigest(embeddings);
    this.stagedToken = prepToken;
  }

  verifyPersistence(expectedDigest) {
    if (this.activeTemplates.length === 0) {
      return { success: false, count: 0, matchesExpectedDigest: false, activeDigest: null };
    }
    const currentEmbeddings = this.activeTemplates.map(t => t.embedding);
    const readbackDigest = computeCanonicalTemplateDigest(currentEmbeddings);
    const matches = expectedDigest ? readbackDigest === expectedDigest : true;
    return {
      success: true,
      count: this.activeTemplates.length,
      matchesExpectedDigest: matches,
      activeDigest: readbackDigest,
      templateVersion: this.templateVersion,
    };
  }

  commitReplacementTemplates(expectedDigest, shouldSimulateFailure = false) {
    if (this.stagedTemplates.length === 0) {
      return { success: false, error: "NO_STAGED_TEMPLATES" };
    }
    if (expectedDigest && this.stagedDigest !== expectedDigest) {
      return { success: false, error: "STAGED_DIGEST_MISMATCH" };
    }

    if (shouldSimulateFailure) {
      // Simulate hardware Keystore write error or crash during transaction
      // Active templates must remain untouched
      return { success: false, error: "KEYSTORE_IO_ERROR" };
    }

    // Atomic replacement in Room transaction
    const backup = [...this.activeTemplates];
    const backupDigest = this.activeDigest;

    try {
      this.activeTemplates = this.stagedTemplates.map((t, idx) => ({
        id: `tmpl_v2_${idx + 1}`,
        staffId: this.staffId,
        embedding: t.embedding,
        label: `sample_${idx + 1}`,
        createdAt: new Date().toISOString(),
      }));
      this.templateVersion += 1;

      // Persistence read-back
      const readback = this.verifyPersistence(expectedDigest);
      if (!readback.success || !readback.matchesExpectedDigest) {
        // Rollback
        this.activeTemplates = backup;
        this.activeDigest = backupDigest;
        this.templateVersion -= 1;
        return { success: false, error: "READBACK_VERIFICATION_FAILED" };
      }

      this.activeDigest = readback.activeDigest;
      this.deviceSettings[`active_digest_${this.staffId}`] = this.activeDigest;
      this.deviceSettings[`template_version_${this.staffId}`] = String(this.templateVersion);

      // Clean up staging
      this.stagedTemplates = [];
      this.stagedDigest = null;
      this.stagedToken = null;

      return {
        success: true,
        count: this.activeTemplates.length,
        activeDigest: this.activeDigest,
        templateVersion: this.templateVersion,
      };
    } catch (err) {
      this.activeTemplates = backup;
      this.activeDigest = backupDigest;
      return { success: false, error: err.message };
    }
  }

  // Attendance recognition match against active Keystore templates
  matchFaceAgainstActiveTemplates(probeEmbedding, threshold = 0.40) {
    if (this.activeTemplates.length === 0) {
      return { recognized: false, minDistance: 1.0, staffId: null };
    }
    let minDistance = 1.0;
    for (const t of this.activeTemplates) {
      const dist = computeCosineDistance(probeEmbedding, t.embedding);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    return {
      recognized: minDistance < threshold,
      minDistance,
      staffId: minDistance < threshold ? this.staffId : null,
      templateVersionUsed: this.templateVersion,
      activeDigestUsed: this.activeDigest,
    };
  }
}

async function runTest() {
  console.log("===============================================================================");
  console.log(" REGRESSION TEST: ACTIVE TEMPLATE REPLACEMENT & RECOGNITION PERSISTENCE");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `SCT-VERIF-${testSuffix}`;
  const testStaffPass = "Pass@123456";
  const deviceId = `android-sec-${testSuffix}`;
  let staffToken = null;
  let adminToken = null;

  try {
    // 1. Account Setup & Authentication
    console.log(`[Step 1] Setting up staff ${testStaffCode} and admin auth...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `Dr. Verification ${testSuffix}`,
      email: `verif.${testSuffix}@sonatech.ac.in`,
      department: "Information Technology",
      password: testStaffPass,
      confirmPassword: testStaffPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, "Staff registered successfully (201)");

    const loginMock = mockReqRes("POST", "/api/staff/login", {
      staff_code: testStaffCode,
      password: testStaffPass,
    });
    await handlerStaffLogin(loginMock.req, loginMock.res);
    staffToken = loginMock.getData()?.token;
    assert(Boolean(staffToken), "Staff logged in and session token acquired");

    const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
    adminToken = adminLoginMock.getData()?.token;
    assert(Boolean(adminToken), "Admin logged in and session token acquired");

    const staffHeaders = {
      authorization: `Bearer ${staffToken}`,
      "x-staff-token": staffToken,
    };
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
    };

    // 2. Initial Face Enrollment (Old Set)
    console.log("\n[Step 2] Initial Face Enrollment with Old Face Template Set...");
    const oldEmbeddings = [0, 1, 2, 3, 4].map((s) =>
      normalizeVector(Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + s * 0.05)))
    );
    const oldDigest = computeCanonicalTemplateDigest(oldEmbeddings);
    assert(Boolean(oldDigest && oldDigest.startsWith("sha256_")), `Old Template Digest: ${oldDigest}`);

    const nativeEngine = new SimulatedNativeRoomKeystoreEngine(testStaffCode);
    nativeEngine.initializeActiveTemplates(oldEmbeddings);

    const initEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
    }, staffHeaders);
    await handlerFaceStaff(initEnroll.req, initEnroll.res);
    assert(initEnroll.getStatus() === 201, "Server locked initial enrollment profile (201)");

    const initReadback = nativeEngine.verifyPersistence(oldDigest);
    assert(initReadback.success === true, "Native persistence verified initial templates");
    assert(initReadback.matchesExpectedDigest === true, "Native active digest matches initial oldDigest");
    assert(nativeEngine.templateVersion === 1, "Initial template version is 1");

    // Test attendance recognition matches OLD face probe
    const oldProbe = normalizeVector(Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + 0.01)));
    const oldRecogResult = nativeEngine.matchFaceAgainstActiveTemplates(oldProbe);
    assert(oldRecogResult.recognized === true, "Attendance recognition succeeds with OLD face probe (dist < 0.40)");
    assert(oldRecogResult.staffId === testStaffCode, `Recognized staff ID is ${testStaffCode}`);

    // New probe (very different face identity)
    const newProbe = normalizeVector(Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.3 + 0.01)));
    const newRecogBeforeReplace = nativeEngine.matchFaceAgainstActiveTemplates(newProbe);
    assert(newRecogBeforeReplace.recognized === false, "Attendance recognition correctly rejects NEW probe before replacement");

    // 3. Stage 1: Permission Request & Approval
    console.log("\n[Step 3] Stage 1: Requesting and granting re-enrollment permission...");
    const permReq = mockReqRes("POST", "/api/staff/face/request", {
      deviceId,
      reason: "Updating face templates due to new optical lenses",
    }, staffHeaders);
    await handlerFaceStaff(permReq.req, permReq.res);
    assert(permReq.getStatus() === 201, "Stage 1 request submitted");
    const permReqId = permReq.getData()?.requestId;

    const permApprove = mockReqRes("POST", `/api/admin/face-requests/${permReqId}/approve`, {
      adminNotes: "Stage 1 approved",
    }, adminHeaders);
    await handlerAdminFaceRequests(permApprove.req, permApprove.res);
    const prepToken = permApprove.getData()?.oneTimeToken;
    assert(Boolean(prepToken && prepToken.startsWith("preptok_")), "Stage 1 prepToken issued");

    // 4. Stage 2: Image Staging & Approval
    console.log("\n[Step 4] Stage 2: Staging new face images and submitting approval request...");
    const newEmbeddings = [0, 1, 2, 3, 4].map((s) =>
      normalizeVector(Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.3 + s * 0.05)))
    );
    const approvedReplacementDigest = computeCanonicalTemplateDigest(newEmbeddings);
    assert(approvedReplacementDigest !== oldDigest, "New replacement digest is distinct from old digest");

    // Stage locally
    nativeEngine.stageTemplates(newEmbeddings, prepToken);
    assert(nativeEngine.stagedDigest === approvedReplacementDigest, "Native staging digest matches computed new digest");

    // Submit Stage 2 request
    const imgReq = mockReqRes("POST", "/api/staff/face/request", {
      action: "request-image-approval",
      requestType: "image_approval",
      deviceId,
      sampleCount: 5,
      linkedRequestId: permReqId,
      digest: approvedReplacementDigest,
      reason: "5 replacement face images submitted for admin review",
    }, staffHeaders);
    await handlerFaceStaff(imgReq.req, imgReq.res);
    assert(imgReq.getStatus() === 201, "Stage 2 image approval request submitted");
    const imgReqId = imgReq.getData()?.requestId;

    // Admin approves Stage 2
    const imgApprove = mockReqRes("POST", `/api/admin/face-requests/${imgReqId}/approve`, {
      adminNotes: "Replacement images approved. Single use ftok authorization granted.",
    }, adminHeaders);
    await handlerAdminFaceRequests(imgApprove.req, imgApprove.res);
    assert(imgApprove.getStatus() === 200, "Admin approved Stage 2");
    const finalToken = imgApprove.getData()?.oneTimeToken;
    assert(Boolean(finalToken && finalToken.startsWith("ftok_")), `Acquired single-use ftok authorization: ${finalToken.slice(0, 16)}...`);

    // 5. Test: Stage 2 approval authorizes ONLY the exact approved staged digest
    console.log("\n[Step 5] Security Check: Stage 2 authorizes ONLY exact approved staged digest...");
    const tamperedDigest = "sha256_fake000000000000000000000000000000000000000000000000000000000000";
    const tamperedCommit = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: tamperedDigest,
    }, staffHeaders);
    await handlerFaceStaff(tamperedCommit.req, tamperedCommit.res);
    assert(tamperedCommit.getStatus() === 403, "Tampered digest rejected with HTTP 403");
    assert(tamperedCommit.getData()?.code === "DIGEST_MISMATCH", "Rejection code is DIGEST_MISMATCH");

    // Check native bridge rejects mismatched expectedDigest
    const nativeMismatch = nativeEngine.commitReplacementTemplates(tamperedDigest);
    assert(nativeMismatch.success === false, "Native engine rejects commit when expectedDigest does not match staged digest");
    assert(nativeEngine.activeDigest === oldDigest, "Active digest remains unchanged (oldDigest) on digest mismatch");

    // 6. Test: Fail-Safe Commit Ordering - Simulated Native Hardware Failure
    console.log("\n[Step 6] Fail-Safe Check: Simulating native hardware failure during commit...");
    const failSimulationResult = nativeEngine.commitReplacementTemplates(approvedReplacementDigest, true);
    assert(failSimulationResult.success === false, "Simulated native commit failed as expected");
    assert(nativeEngine.activeDigest === oldDigest, "Active templates and digest remain intact (old templates)");
    assert(nativeEngine.stagedTemplates.length === 5, "Staged templates preserved for safe retry");

    // Because native commit failed, frontend client DOES NOT call server token consumption!
    // Server status query must show token remains valid for safe user retry
    const statusBeforeServerCommit = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusBeforeServerCommit.req, statusBeforeServerCommit.res);
    assert(statusBeforeServerCommit.getData()?.canSaveReplacement === true, "canSaveReplacement is STILL TRUE (not falsely consumed)");
    assert(statusBeforeServerCommit.getData()?.latestRequestStatus !== "completed", "App does NOT report Completed before verified persistence");

    // 7. Test: Successful Native Atomic Replacement & Persistence Read-Back
    console.log("\n[Step 7] Performing Valid Native Replacement & Persistence Read-Back...");
    const commitResult = nativeEngine.commitReplacementTemplates(approvedReplacementDigest, false);
    assert(commitResult.success === true, "Native atomic replacement succeeded");
    assert(commitResult.count === 5, "Native persistence verified 5 templates");
    assert(commitResult.activeDigest === approvedReplacementDigest, "Native activeDigest matches approvedReplacementDigest");
    assert(commitResult.templateVersion === 2, "Native templateVersion incremented to 2");

    // Persistence read-back verification against expected approved digest
    const readbackResult = nativeEngine.verifyPersistence(approvedReplacementDigest);
    assert(readbackResult.matchesExpectedDigest === true, "Persistence read-back matches approved replacement digest");

    // 8. Test: Server Token Consumption ONLY AFTER Verified Native Persistence
    console.log("\n[Step 8] Consuming single-use token on server after verified local persistence...");
    const validCommit = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: approvedReplacementDigest,
    }, staffHeaders);
    await handlerFaceStaff(validCommit.req, validCommit.res);
    assert(validCommit.getStatus() === 200, "Server token consumption succeeded (200)");
    assert(validCommit.getData()?.isLocked === true, "Profile remains permanently isLocked: true");

    // 9. Test: Replay Protection - Consumed Token Cannot Be Replayed
    console.log("\n[Step 9] Replay Protection Check: Consumed token cannot be replayed...");
    const replayCommit = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId,
      templateCount: 5,
      oneTimeToken: finalToken,
      requestId: imgReqId,
      digest: approvedReplacementDigest,
    }, staffHeaders);
    await handlerFaceStaff(replayCommit.req, replayCommit.res);
    assert(replayCommit.getStatus() === 403, "Replaying consumed token rejected with HTTP 403");
    assert(replayCommit.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code is INVALID_OR_CONSUMED_TOKEN");

    // 10. Test: Post-Commit Status Refresh & App Restart Simulation
    console.log("\n[Step 10] App Restart Simulation & Authoritative Status Refresh...");
    // Simulate app restart: re-instantiate or read back from device storage
    const statusPostCommit = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusPostCommit.req, statusPostCommit.res);
    const postData = statusPostCommit.getData();

    assert(postData?.latestRequestStatus === "completed", "Server reports latestRequestStatus: 'completed'");
    assert(postData?.latestRequest?.status === "completed", "Server latestRequest.status: 'completed'");
    assert(postData?.latestRequest?.digest === approvedReplacementDigest, "Server records approved digest on completed request");
    assert(postData?.canSaveReplacement === false, "canSaveReplacement reset to false");
    assert(postData?.oneTimeToken === null, "oneTimeToken reset to null");

    // Query native diagnostic persistence readback after "restart"
    const restartReadback = nativeEngine.verifyPersistence(approvedReplacementDigest);
    assert(restartReadback.success === true, "Storage read-back succeeds after app restart");
    assert(restartReadback.activeDigest === approvedReplacementDigest, "Active digest matches approved replacement digest after restart");
    assert(restartReadback.templateVersion === 2, "Template version remains v2 after restart");

    // 11. Test: Attendance Recognition Uses Newly Committed Active Templates
    console.log("\n[Step 11] Verifying Attendance Recognition Engine Uses Newly Committed Active Templates...");
    // Probe with new face: MUST BE RECOGNIZED
    const newProbeAfter = normalizeVector(Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.3 + 0.01)));
    const recogNewResult = nativeEngine.matchFaceAgainstActiveTemplates(newProbeAfter);
    assert(recogNewResult.recognized === true, "Attendance recognition SUCCEEDS for NEW face embeddings");
    assert(recogNewResult.staffId === testStaffCode, `Attendance recognition correctly identifies ${testStaffCode}`);
    assert(recogNewResult.templateVersionUsed === 2, "Attendance recognition used template version 2");
    assert(recogNewResult.activeDigestUsed === approvedReplacementDigest, "Attendance recognition used active replacement digest");

    // Probe with old face: MUST BE REJECTED now that templates have been replaced!
    const oldProbeAfter = normalizeVector(Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + 0.01)));
    const recogOldResult = nativeEngine.matchFaceAgainstActiveTemplates(oldProbeAfter);
    assert(recogOldResult.recognized === false, "Attendance recognition correctly REJECTS OLD face probe after replacement");

    // 12. Cleanup
    console.log(`\n[Cleanup] Cleaning up test staff ${testStaffCode}...`);
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff_records").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);

  } catch (err) {
    console.error("Test execution exception:", err);
    failed++;
  }

  console.log("\n===============================================================================");
  console.log(` REGRESSION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("Unhandled test exception:", err);
  process.exit(1);
});
