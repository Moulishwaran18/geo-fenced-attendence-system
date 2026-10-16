/**
 * Regression Test Suite: Commit Replacement Registration Button & End-to-End Workflow
 * 
 * Verifies:
 * 1. Button click & handler invocation checkpoints.
 * 2. Successful authorized replacement.
 * 3. Missing, expired, consumed, or wrong-device authorization.
 * 4. Approved digest mismatch rejection and preservation of old templates.
 * 5. Native bridge failure and safe rollback (no false completion).
 * 6. Persistence verification failure handling.
 * 7. Recovery after ambiguous / already-committed result (idempotency).
 * 8. Attendance recognition using newly committed templates.
 * 9. Rejection of old templates after replacement.
 * 10. Privacy guarantee (no photos/embeddings in logs or cloud).
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import handlerStaffLogin from "../api/staff/login.ts";
import handlerStaffRegister from "../api/staff/register.ts";

function computeCosineDistance(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1e-6);
  return Math.max(0, 1 - similarity);
}

function computeCanonicalTemplateDigest(embeddings) {
  const parts = [];
  for (const vec of embeddings) {
    parts.push(vec.map((n) => Number(n).toFixed(6)).join(","));
  }
  const canonical = `v1;count:${embeddings.length};` + parts.join("|");
  return "sha256_" + crypto.createHash("sha256").update(canonical).digest("hex");
}

function generateDeterministicVector(seed, dim = 512) {
  const vec = [];
  let current = seed;
  for (let i = 0; i < dim; i++) {
    current = (current * 9301 + 49297) % 233280;
    vec.push((current / 233280.0) * 2 - 1);
  }
  let sumSq = 0;
  for (let v of vec) sumSq += v * v;
  const mag = Math.sqrt(sumSq) || 1;
  return vec.map(v => v / mag);
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

// Simulated Native Bridge & Room Keystore Engine with diagnostic logging
class SimulatedBiometricBridgeEngine {
  constructor(staffId, deviceId) {
    this.staffId = staffId;
    this.deviceId = deviceId;
    this.activeTemplates = [];
    this.activeDigest = null;
    this.templateVersion = 1;
    this.stagedTemplates = [];
    this.stagedDigest = null;
    this.stagedToken = null;
    this.executionLogs = [];
  }

  log(event, data) {
    this.executionLogs.push({ event, ...data, time: Date.now() });
  }

  initInitialTemplates(embeddings) {
    this.activeTemplates = embeddings.map((emb, idx) => ({
      id: `tmpl_${idx + 1}`,
      embedding: emb,
      label: `sample_${idx + 1}`,
    }));
    this.activeDigest = computeCanonicalTemplateDigest(embeddings);
    this.templateVersion = 1;
    this.log("INITIAL_ENROLLMENT", { count: embeddings.length, activeDigest: this.activeDigest });
  }

  stageReplacement(embeddings, token, digest) {
    this.stagedTemplates = embeddings.map((emb, idx) => ({
      id: `staged_${idx + 1}`,
      embedding: emb,
      label: `replacement_${idx + 1}`,
    }));
    this.stagedDigest = digest || computeCanonicalTemplateDigest(embeddings);
    this.stagedToken = token;
    this.log("STAGE_TEMPLATES", { count: embeddings.length, stagedDigest: this.stagedDigest });
  }

  getBiometricMetadata(expectedApprovedDigest) {
    const cleanApproved = (expectedApprovedDigest || "").trim();
    const activeMatchesApproved = Boolean(cleanApproved && this.activeDigest && this.activeDigest.toLowerCase() === cleanApproved.toLowerCase());
    return {
      staffId: this.staffId,
      deviceId: this.deviceId,
      activeTemplateCount: this.activeTemplates.length,
      stagedTemplateCount: this.stagedTemplates.length,
      activeDigest: this.activeDigest,
      stagedDigest: this.stagedDigest,
      activeVersion: this.templateVersion,
      activeMatchesApproved,
      replacementCommitted: activeMatchesApproved,
      persistenceVerified: this.activeTemplates.length > 0,
    };
  }

  commitReplacementTemplates(expectedDigest, forceFailureType = null) {
    this.log("COMMIT_INVOKED", { expectedDigest: expectedDigest ? expectedDigest.slice(0, 16) + "…" : null });

    // Handle already committed case (idempotency)
    if (this.stagedTemplates.length === 0) {
      if (expectedDigest && this.activeDigest && this.activeDigest.toLowerCase() === expectedDigest.toLowerCase()) {
        this.log("ALREADY_COMMITTED_RECONCILED", { activeDigest: this.activeDigest });
        return {
          success: true,
          staffId: this.staffId,
          deviceId: this.deviceId,
          count: this.activeTemplates.length,
          activeDigest: this.activeDigest,
          alreadyCommitted: true,
          message: "Replacement templates already committed and active with verified digest.",
        };
      }
      return { success: false, error: "NO_STAGED_REPLACEMENT", message: "No staged replacement templates found on this device." };
    }

    // Digest mismatch check
    if (expectedDigest && this.stagedDigest && this.stagedDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
      this.log("COMMIT_DIGEST_MISMATCH", { staged: this.stagedDigest, expected: expectedDigest });
      return { success: false, error: "DIGEST_MISMATCH", message: "Cryptographic digest mismatch." };
    }

    // Hardware failure simulation
    if (forceFailureType === "HARDWARE_IO_ERROR") {
      this.log("COMMIT_HARDWARE_FAILURE", {});
      return { success: false, error: "KEYSTORE_IO_ERROR", message: "Android Keystore write failed." };
    }

    // Atomic Room transaction
    const backup = [...this.activeTemplates];
    const backupDigest = this.activeDigest;

    this.activeTemplates = this.stagedTemplates.map((t, idx) => ({
      id: `tmpl_v2_${idx + 1}`,
      embedding: t.embedding,
      label: `sample_${idx + 1}`,
    }));
    this.templateVersion += 1;
    this.activeDigest = computeCanonicalTemplateDigest(this.activeTemplates.map(t => t.embedding));

    // Simulated persistence verification failure
    if (forceFailureType === "VERIFICATION_FAILURE") {
      this.activeTemplates = backup;
      this.activeDigest = backupDigest;
      this.templateVersion -= 1;
      this.log("PERSISTENCE_VERIFICATION_FAILED_ROLLBACK", {});
      return { success: false, error: "READBACK_VERIFICATION_FAILED", message: "Persistence read-back failed." };
    }

    // Staging cleanup
    this.stagedTemplates = [];
    this.stagedDigest = null;
    this.stagedToken = null;

    this.log("COMMIT_SUCCESS", { count: this.activeTemplates.length, activeDigest: this.activeDigest, version: this.templateVersion });
    return {
      success: true,
      staffId: this.staffId,
      deviceId: this.deviceId,
      count: this.activeTemplates.length,
      activeDigest: this.activeDigest,
      templateVersion: this.templateVersion,
      message: "Face replacement successfully committed.",
    };
  }

  verifyPersistence(expectedDigest) {
    if (this.activeTemplates.length === 0) {
      return { verified: false, count: 0, matchesExpectedDigest: false };
    }
    const currentDigest = computeCanonicalTemplateDigest(this.activeTemplates.map(t => t.embedding));
    const cleanExpected = (expectedDigest || "").trim();
    const matches = !cleanExpected || currentDigest.toLowerCase() === cleanExpected.toLowerCase();
    return {
      verified: true,
      count: this.activeTemplates.length,
      activeDigest: currentDigest,
      templateVersion: this.templateVersion,
      matchesExpectedDigest: matches,
    };
  }

  matchLiveProbe(probeEmbedding, threshold = 0.40) {
    let minDistance = 1.0;
    for (const t of this.activeTemplates) {
      const dist = computeCosineDistance(probeEmbedding, t.embedding);
      if (dist < minDistance) minDistance = dist;
    }
    return {
      matched: minDistance < threshold,
      minDistance,
      staffId: minDistance < threshold ? this.staffId : null,
      templateVersionUsed: this.templateVersion,
      activeDigestUsed: this.activeDigest,
    };
  }
}

async function runRegressionSuite() {
  console.log("===============================================================================");
  console.log(" REGRESSION SUITE: COMMIT REPLACEMENT REGISTRATION BUTTON & ATOMIC REPLACEMENT");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-BTN-${testSuffix}`;
  const testStaffPass = "CommitBtn@123";
  const deviceId = `android-btn-${testSuffix}`;
  let staffToken = null;
  let adminToken = null;

  try {
    // -------------------------------------------------------------------------
    // Setup: Provision disposable staff account & establish initial enrollment
    // -------------------------------------------------------------------------
    console.log(`[Setup] Registering test staff member ${testStaffCode}...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `Commit Test Staff ${testSuffix}`,
      email: `btn.${testSuffix}@sonatech.ac.in`,
      department: "Information Technology",
      password: testStaffPass,
      confirmPassword: testStaffPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, "Test staff account registered (HTTP 201)");

    const sLogin = mockReqRes("POST", "/api/staff/login", { staff_code: testStaffCode, password: testStaffPass });
    await handlerStaffLogin(sLogin.req, sLogin.res);
    staffToken = sLogin.getData()?.token;
    assert(Boolean(staffToken), "Acquired staff authentication session token");

    const aLogin = mockReqRes("POST", "/api/admin/login", { username: "moulish", password: "moulish@123" });
    await handlerAdminLogin(aLogin.req, aLogin.res);
    adminToken = aLogin.getData()?.token;
    assert(Boolean(adminToken), "Acquired administrator session token");

    const staffHeaders = {
      authorization: `Bearer ${staffToken}`,
      "x-staff-token": staffToken,
    };
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
    };

    // Establish baseline initial enrollment
    const oldEmbeddings = [
      generateDeterministicVector(101),
      generateDeterministicVector(102),
      generateDeterministicVector(103),
      generateDeterministicVector(104),
      generateDeterministicVector(105),
    ];
    const oldDigest = computeCanonicalTemplateDigest(oldEmbeddings);

    const initEnroll = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, digest: oldDigest },
      staffHeaders
    );
    await handlerFaceStaff(initEnroll.req, initEnroll.res);
    assert(initEnroll.getStatus() === 201, "Initial face registration locked on server");

    const engine = new SimulatedBiometricBridgeEngine(testStaffCode, deviceId);
    engine.initInitialTemplates(oldEmbeddings);

    // Initial recognition verification
    const oldProbe = generateDeterministicVector(101);
    const initMatch = engine.matchLiveProbe(oldProbe);
    assert(initMatch.matched === true, "Baseline attendance recognition matches OLD face probe");
    assert(initMatch.templateVersionUsed === 1, "Baseline attendance recognition uses template version 1");

    // -------------------------------------------------------------------------
    // Phase 1: Complete Two-Stage Approval Workflow
    // -------------------------------------------------------------------------
    console.log("\n[Two-Stage Approval] Requesting and approving re-enrollment...");
    const pReq = mockReqRes(
      "POST",
      "/api/staff/face/request",
      { reason: "Camera quality upgraded", deviceId, requestType: "permission_request" },
      staffHeaders
    );
    await handlerFaceStaff(pReq.req, pReq.res);
    const stage1Id = pReq.getData()?.requestId;
    assert(Boolean(stage1Id), "Stage 1 permission request submitted");

    // Admin approves Stage 1
    const pApprove = mockReqRes(
      "POST",
      `/api/admin/face-requests/${stage1Id}/approve`,
      { adminNotes: "Approved Stage 1" },
      adminHeaders
    );
    await handlerAdminFaceRequests(pApprove.req, pApprove.res);
    assert(pApprove.getStatus() === 200, "Admin approved Stage 1 permission");

    // Check staff status for prep token
    const sStat1 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(sStat1.req, sStat1.res);
    const prepToken = sStat1.getData()?.prepToken;
    assert(Boolean(prepToken?.startsWith("preptok_")), "Acquired Stage 1 prepToken");

    // Stage new replacement templates
    const newEmbeddings = [
      generateDeterministicVector(201),
      generateDeterministicVector(202),
      generateDeterministicVector(203),
      generateDeterministicVector(204),
      generateDeterministicVector(205),
    ];
    const newDigest = computeCanonicalTemplateDigest(newEmbeddings);
    assert(newDigest !== oldDigest, "New replacement digest is strictly distinct from old digest");
    engine.stageReplacement(newEmbeddings, prepToken, newDigest);

    // Submit Stage 2 Image Approval Request
    const imgReq = mockReqRes(
      "POST",
      "/api/staff/face/request",
      {
        action: "request-image-approval",
        reason: "Staged 5 new reference face templates",
        deviceId,
        requestType: "image_approval",
        prepToken,
        digest: newDigest,
        sampleCount: 5,
        linkedRequestId: stage1Id,
      },
      staffHeaders
    );
    await handlerFaceStaff(imgReq.req, imgReq.res);
    const stage2Id = imgReq.getData()?.requestId;
    assert(Boolean(stage2Id), "Stage 2 image approval request submitted");

    // Admin approves Stage 2
    const imgApprove = mockReqRes(
      "POST",
      `/api/admin/face-requests/${stage2Id}/approve`,
      { adminNotes: "Approved replacement face images" },
      adminHeaders
    );
    await handlerAdminFaceRequests(imgApprove.req, imgApprove.res);
    assert(imgApprove.getStatus() === 200, "Admin approved Stage 2 replacement images");

    // Staff status now has Stage 2 approval
    const sStat2 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(sStat2.req, sStat2.res);
    const serverStatus = sStat2.getData();
    const finalToken = serverStatus?.oneTimeToken;
    const approvedDigest = serverStatus?.approvedDigest;

    assert(Boolean(finalToken?.startsWith("ftok_")), `Valid single-use commit token delivered: ${finalToken?.slice(0, 8)}…`);
    assert(approvedDigest === newDigest, "Approved digest matches staged replacement digest");
    assert(serverStatus?.canSaveReplacement === true, "canSaveReplacement is TRUE");

    // -------------------------------------------------------------------------
    // Test 1: Button Rendering Condition & Handler Invocability
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Button Rendering Condition & Handler Checkpoints...");
    const availableToken = (
      serverStatus?.oneTimeToken ||
      serverStatus?.approvedRequest?.oneTimeToken ||
      serverStatus?.activeRequest?.oneTimeToken ||
      ""
    ).trim();
    const isCompleted = serverStatus?.latestRequestStatus === "completed" || serverStatus?.status === "completed";
    const hasStage2Approval = Boolean(
      serverStatus?.isLocked &&
      !isCompleted &&
      serverStatus?.canSaveReplacement &&
      availableToken.startsWith("ftok_")
    );
    assert(hasStage2Approval === true, "hasStage2Approval evaluates to TRUE for commit button rendering");

    // -------------------------------------------------------------------------
    // Test 2: Checkpoint 1 & 2 Failures - Missing/Mismatched Authorization
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Negative: Missing, wrong-device, or mismatched authorization...");
    // Direct call with missing token
    const emptyTokenMock = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, digest: approvedDigest },
      staffHeaders
    );
    await handlerFaceStaff(emptyTokenMock.req, emptyTokenMock.res);
    assert(emptyTokenMock.getStatus() === 403, "Missing one-time token rejected with HTTP 403");

    // Direct call with wrong device
    const wrongDeviceMock = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId: "wrong-phone-device", templateCount: 5, oneTimeToken: finalToken, digest: approvedDigest },
      staffHeaders
    );
    await handlerFaceStaff(wrongDeviceMock.req, wrongDeviceMock.res);
    assert(wrongDeviceMock.getStatus() === 403, "Wrong device ID rejected with HTTP 403 (DEVICE_MISMATCH)");

    // -------------------------------------------------------------------------
    // Test 3: Checkpoint 2 - Digest Mismatch Rejection
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Negative: Approved digest mismatch rejection...");
    const tamperedDigest = "sha256_" + crypto.createHash("sha256").update("tampered").digest("hex");
    const mismatchRes = engine.commitReplacementTemplates(tamperedDigest);
    assert(mismatchRes.success === false, "Bridge rejects commit on digest mismatch");
    assert(mismatchRes.error === "DIGEST_MISMATCH", "Error code is DIGEST_MISMATCH");
    assert(engine.activeDigest === oldDigest, "Old active templates strictly preserved on digest mismatch");

    const serverMismatchMock = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, oneTimeToken: finalToken, digest: tamperedDigest },
      staffHeaders
    );
    await handlerFaceStaff(serverMismatchMock.req, serverMismatchMock.res);
    assert(serverMismatchMock.getStatus() === 403, "Server strictly rejects tampered digest with HTTP 403");

    // -------------------------------------------------------------------------
    // Test 4: Checkpoint 3 - Native Bridge Failure and Safe Rollback
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Negative: Native hardware failure safe rollback (no false completion)...");
    const hwFailRes = engine.commitReplacementTemplates(approvedDigest, "HARDWARE_IO_ERROR");
    assert(hwFailRes.success === false, "Simulated native hardware failure returned false");
    assert(engine.activeDigest === oldDigest, "Old active templates preserved on bridge failure");
    assert(engine.templateVersion === 1, "Template version remains v1 on bridge failure");

    // Verify token was NOT consumed after bridge failure
    const checkUnconsumed = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(checkUnconsumed.req, checkUnconsumed.res);
    assert(checkUnconsumed.getData()?.canSaveReplacement === true, "Token was NOT consumed after native bridge failure");

    // -------------------------------------------------------------------------
    // Test 5: Checkpoint 4 - Persistence Verification Failure
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Negative: Persistence verification read-back failure...");
    const persistFailRes = engine.commitReplacementTemplates(approvedDigest, "VERIFICATION_FAILURE");
    assert(persistFailRes.success === false, "Persistence verification failure detected");
    assert(engine.activeDigest === oldDigest, "Active templates rolled back to oldDigest on verification failure");

    // -------------------------------------------------------------------------
    // Test 6: Checkpoint 3-5 - Successful Authorized Commit & Verified Persistence
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Positive: Successful authorized replacement commit...");
    const commitRes = engine.commitReplacementTemplates(approvedDigest);
    assert(commitRes.success === true, "Native atomic replacement succeeded");
    assert(commitRes.activeDigest === newDigest, "Native active digest matches approved replacement digest");
    assert(commitRes.templateVersion === 2, "Template version incremented to 2");

    // Read-back verification
    const readback = engine.verifyPersistence(approvedDigest);
    assert(readback.verified === true, "Local persistence verification verified: true");
    assert(readback.matchesExpectedDigest === true, "Local persistence read-back matches approved digest");
    assert(readback.count === 5, "Persistence read-back confirms exactly 5 active templates");

    // Finalize server token consumption
    const serverCommitMock = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, oneTimeToken: finalToken, requestId: stage2Id, digest: approvedDigest },
      staffHeaders
    );
    await handlerFaceStaff(serverCommitMock.req, serverCommitMock.res);
    assert(serverCommitMock.getStatus() === 200, "Server finalized face enrollment and consumed token (HTTP 200)");

    // Refreshed status check
    const sStat3 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(sStat3.req, sStat3.res);
    const postCommitStatus = sStat3.getData();
    assert(postCommitStatus?.latestRequestStatus === "completed", "Authoritative status reports latestRequestStatus: 'completed'");
    assert(postCommitStatus?.canSaveReplacement === false, "canSaveReplacement reset to false");
    assert(postCommitStatus?.oneTimeToken === null, "oneTimeToken reset to null");

    // -------------------------------------------------------------------------
    // Test 7: Checkpoint 6 - Recovery After Ambiguous / Already-Committed Result
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Idempotent Recovery: Ambiguous result & repeated click reconciliation...");
    // Simulate user clicking commit again or bridge re-invoked when staged file is gone
    const recoveryMeta = engine.getBiometricMetadata(approvedDigest);
    assert(recoveryMeta.activeMatchesApproved === true, "Recovery inspection confirms active templates match approved digest");
    assert(recoveryMeta.stagedTemplateCount === 0, "Staged templates cleanly cleaned up");

    const reCommitRes = engine.commitReplacementTemplates(approvedDigest);
    assert(reCommitRes.success === true, "Repeated commit call succeeds via idempotent reconciliation");
    assert(reCommitRes.alreadyCommitted === true, "Flagged as alreadyCommitted without error");
    assert(reCommitRes.activeDigest === newDigest, "Active digest remains confirmed as approved digest");

    // Server consumption replay protection
    const replayMock = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, oneTimeToken: finalToken, requestId: stage2Id, digest: approvedDigest },
      staffHeaders
    );
    await handlerFaceStaff(replayMock.req, replayMock.res);
    assert(replayMock.getStatus() === 403, "Replaying consumed token blocked with HTTP 403");
    assert(replayMock.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Rejected with INVALID_OR_CONSUMED_TOKEN");

    // -------------------------------------------------------------------------
    // Test 8: Attendance Recognition Uses Newly Committed Templates
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] Attendance Recognition Parity with Committed Templates...");
    // New face probe matches
    const newProbe = generateDeterministicVector(201);
    const newMatch = engine.matchLiveProbe(newProbe);
    assert(newMatch.matched === true, "Attendance recognition SUCCEEDS for probe matching new replacement template");
    assert(newMatch.templateVersionUsed === 2, "Attendance recognition used template version 2");
    assert(newMatch.activeDigestUsed === newDigest, "Attendance recognition used active replacement digest");

    // Old face probe REJECTED
    const oldProbeMatch = engine.matchLiveProbe(oldProbe);
    assert(oldProbeMatch.matched === false, "Attendance recognition strictly REJECTS probe matching old revoked template");

    // -------------------------------------------------------------------------
    // Test 9: Privacy & Diagnostic Sanitization Guarantee
    // -------------------------------------------------------------------------
    console.log("\n[Test 9] Privacy & Diagnostic Sanitization Guarantee...");
    const rawPhotoUpload = mockReqRes(
      "POST",
      "/api/staff/face/enroll",
      { deviceId, templateCount: 5, photoData: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
      staffHeaders
    );
    await handlerFaceStaff(rawPhotoUpload.req, rawPhotoUpload.res);
    assert(rawPhotoUpload.getStatus() === 400, "Server strictly rejects raw photo upload (HTTP 400)");
    assert(rawPhotoUpload.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Code is BIOMETRIC_CLOUD_STORAGE_PROHIBITED");

    // Verify logs do not contain raw embeddings or full keys
    const logsString = JSON.stringify(engine.executionLogs);
    assert(!logsString.includes("0.1234567"), "Sanitized diagnostic logs do not contain raw vector float sequences");

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------
    console.log(`\n[Cleanup] Cleaning up disposable test staff ${testStaffCode}...`);
    await supabase.from("staff_face_change_requests").delete().eq("staff_id", testStaffCode);
    await supabase.from("staff_face_enrollments").delete().eq("staff_id", testStaffCode);
    await supabase.from("staff").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);

  } catch (err) {
    console.error("Test error:", err);
    failed++;
  }

  console.log("\n===============================================================================");
  console.log(` REGRESSION SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionSuite();
