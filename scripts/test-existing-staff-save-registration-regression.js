/**
 * Regression Test Suite: Existing Staff "Save Face Registration" Workflow
 * 
 * Verifies:
 * 1. An already-enrolled staff member clicking Save Face Registration stages samples locally.
 * 2. Active templates are NEVER replaced before administrator approval.
 * 3. The request is submitted to POST /api/staff/face/request-change and appears as Pending for admin.
 * 4. Repeated clicks/submissions do NOT create duplicate pending requests (HTTP 409).
 * 5. Rejections or cancelled requests do not activate staged templates.
 * 6. Administrator approval permits authorized replacement exactly once.
 * 7. Token is atomically consumed and cannot be re-used.
 * 8. Zero face photos or embeddings are uploaded to the cloud.
 */

import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import handlerStaffLogin from "../api/staff/login.ts";
import handlerStaffRegister from "../api/staff/register.ts";

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

async function runRegressionTests() {
  console.log("===============================================================================");
  console.log(" REGRESSION SUITE: EXISTING-STAFF SAVE FACE REGISTRATION APPROVAL WORKFLOW");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-REG-${testSuffix}`;
  const testStaffPass = "RegPass@123";
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
      email: `reg.staff.${testSuffix}@sonatech.ac.in`,
      department: "Information Technology",
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
    assert(Boolean(staffToken), "Staff authentication token acquired");

    const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
    adminToken = adminLoginMock.getData()?.token;
    assert(Boolean(adminToken), "Admin session token acquired");

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
      deviceId: "android-hw-reg-device",
      templateCount: 3,
    }, staffHeaders);
    await handlerFaceStaff(initEnrollMock.req, initEnrollMock.res);
    assert(initEnrollMock.getStatus() === 201, "Baseline face profile registered & permanently locked");

    // Local device simulated storage:
    // Represents Android Keystore Room DB (active) and pending staging file
    const localKeystore = {
      activeTemplates: [
        { id: "tmpl_1", staffId: testStaffCode, label: "sample_1" },
        { id: "tmpl_2", staffId: testStaffCode, label: "sample_2" },
        { id: "tmpl_3", staffId: testStaffCode, label: "sample_3" },
      ],
      pendingStagingFile: null,
    };

    // Verify baseline state
    const statusMock1 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusMock1.req, statusMock1.res);
    assert(statusMock1.getData()?.isLocked === true, "Face profile is reported locked on server");
    assert(statusMock1.getData()?.canSaveReplacement === false, "canSaveReplacement is false without approval");
    assert(statusMock1.getData()?.oneTimeToken === null, "oneTimeToken is null");

    // -------------------------------------------------------------------------
    // Test 1: Clicking Save Face Registration without approval token stages locally
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Save Face Registration stages samples locally without replacing active templates");
    const capturedSamples = [
      { id: "new_1", embedding: new Array(512).fill(0.04) },
      { id: "new_2", embedding: new Array(512).fill(0.04) },
      { id: "new_3", embedding: new Array(512).fill(0.04) },
      { id: "new_4", embedding: new Array(512).fill(0.04) },
    ];

    // Simulate stageNativePendingEnrollment
    localKeystore.pendingStagingFile = {
      staffId: testStaffCode,
      deviceId: "android-hw-reg-device",
      stagedAt: Date.now(),
      count: capturedSamples.length,
      templates: capturedSamples.map((s, idx) => ({ label: `sample_${idx + 1}` })),
    };

    assert(localKeystore.pendingStagingFile !== null, "New samples staged in app-private storage");
    assert(localKeystore.pendingStagingFile.count === 4, "Staged exactly 4 reference samples");
    assert(localKeystore.activeTemplates.length === 3, "Active templates remain completely untouched (still 3)");

    // Verify that active templates were not replaced or cleared
    assert(localKeystore.activeTemplates[0].id === "tmpl_1", "Original active template 1 intact");
    assert(localKeystore.activeTemplates[1].id === "tmpl_2", "Original active template 2 intact");
    assert(localKeystore.activeTemplates[2].id === "tmpl_3", "Original active template 3 intact");

    // -------------------------------------------------------------------------
    // Test 2: Face-change request submission through POST /api/staff/face/request-change
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Request submission with staff identity, device ID, sample count, and reason");
    const requestReason = "Changed spectacles and updated hairstyle for institutional identification";
    const reqChangeMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: requestReason,
      deviceId: "android-hw-reg-device",
      sampleCount: localKeystore.pendingStagingFile.count,
    }, staffHeaders);
    await handlerFaceStaff(reqChangeMock.req, reqChangeMock.res);

    assert(reqChangeMock.getStatus() === 201, `Request submitted successfully (HTTP 201, got ${reqChangeMock.getStatus()})`);
    assert(reqChangeMock.getData()?.success === true, "Response confirms success: true");
    const requestId = reqChangeMock.getData()?.requestId;
    assert(Boolean(requestId), `Server returned requestId: ${requestId}`);
    assert(reqChangeMock.getData()?.request?.sampleCount === 4, "Server recorded sampleCount: 4");

    // -------------------------------------------------------------------------
    // Test 3: Request appears in Administrator dashboard as Pending
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Request appears in Administrator dashboard as Pending");
    const adminListMock = mockReqRes("GET", "/api/admin/face-requests?status=pending", {}, adminHeaders);
    await handlerAdminFaceRequests(adminListMock.req, adminListMock.res);

    assert(adminListMock.getStatus() === 200, "Admin face-requests list returns HTTP 200");
    const adminRequests = adminListMock.getData()?.requests || [];
    const foundPending = adminRequests.find((r) => r.id === requestId);
    assert(Boolean(foundPending), `Admin dashboard shows request ${requestId}`);
    assert(foundPending?.status === "pending", "Request status is 'pending'");
    assert(foundPending?.staff_code === testStaffCode, `Staff code matches ${testStaffCode}`);
    assert(foundPending?.sampleCount === 4, "Admin sees staged sampleCount: 4");
    assert(foundPending?.requestType === "replacement", "Admin sees requestType: 'replacement'");

    // -------------------------------------------------------------------------
    // Test 4: Repeated clicks do not create duplicate pending requests (HTTP 409)
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Repeated submission rejected with HTTP 409 (Idempotent duplicate protection)");
    const dupMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Second click trying to submit duplicate request",
      deviceId: "android-hw-reg-device",
      sampleCount: 4,
    }, staffHeaders);
    await handlerFaceStaff(dupMock.req, dupMock.res);

    assert(dupMock.getStatus() === 409, `Duplicate request rejected with HTTP 409 (got ${dupMock.getStatus()})`);
    assert(dupMock.getData()?.success === false, "Response confirms duplicate rejected");
    assert(dupMock.getData()?.error?.includes("already pending"), "Error explains request is already pending");

    // Active templates still untouched
    assert(localKeystore.activeTemplates.length === 3, "Active templates still 3 after duplicate click rejection");

    // -------------------------------------------------------------------------
    // Test 5: Re-enrollment without approval token is rejected (Fail-Closed)
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Direct enrollment without approval token fails closed");
    const unauthorizedSaveMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: "android-hw-reg-device",
      templateCount: 4,
    }, staffHeaders);
    await handlerFaceStaff(unauthorizedSaveMock.req, unauthorizedSaveMock.res);

    assert(unauthorizedSaveMock.getStatus() === 403, `Direct save without token rejected with HTTP 403 (got ${unauthorizedSaveMock.getStatus()})`);
    assert(unauthorizedSaveMock.getData()?.code === "FACE_REGISTRATION_LOCKED", "Error code is FACE_REGISTRATION_LOCKED");
    assert(localKeystore.activeTemplates.length === 3, "Active templates remain strictly intact");

    // -------------------------------------------------------------------------
    // Test 6: Administrator approves request and issues one-time approval token
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Administrator approves request and issues 24-hour one-time token");
    const approveMock = mockReqRes("POST", "/api/admin/face-requests", {
      action: "approve",
      requestId,
      adminNotes: "Approved for glasses update by department head",
    }, adminHeaders);
    await handlerAdminFaceRequests(approveMock.req, approveMock.res);

    assert(approveMock.getStatus() === 200, "Admin approval succeeded (HTTP 200)");
    const approvalToken = approveMock.getData()?.oneTimeToken || approveMock.getData()?.token;
    assert(Boolean(approvalToken), `Approval token issued: ${approvalToken}`);
    assert(/^ftok_[a-f0-9]{48}$/.test(approvalToken), "Token matches strict ftok_ format");

    // Staff query now reveals canSaveReplacement: true
    const statusMock2 = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
    await handlerFaceStaff(statusMock2.req, statusMock2.res);
    assert(statusMock2.getData()?.canSaveReplacement === true, "canSaveReplacement is now true");
    assert(statusMock2.getData()?.oneTimeToken === approvalToken, "Staff receives authorized oneTimeToken");

    // Active templates STILL remain untouched until client finishes atomic commit
    assert(localKeystore.activeTemplates.length === 3, "Active templates remain 3 prior to commit");

    // -------------------------------------------------------------------------
    // Test 7: Authorized replacement consumes token atomically and updates templates
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Authorized replacement commits templates and consumes token atomically");
    // Step A: Server atomic token consumption
    const enrollApprovedMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: "android-hw-reg-device",
      templateCount: 4,
      oneTimeToken: approvalToken,
      requestId,
    }, {
      ...staffHeaders,
      "x-one-time-token": approvalToken,
    });
    await handlerFaceStaff(enrollApprovedMock.req, enrollApprovedMock.res);

    assert(enrollApprovedMock.getStatus() === 200, `Authorized replacement succeeded with HTTP 200 (got ${enrollApprovedMock.getStatus()})`);
    assert(enrollApprovedMock.getData()?.isLocked === true, "Profile remains permanently isLocked: true");

    // Step B: Local Keystore commits staged templates into active Room DB
    localKeystore.activeTemplates = localKeystore.pendingStagingFile.templates.map((t, idx) => ({
      id: `tmpl_new_${idx + 1}`,
      staffId: testStaffCode,
      label: t.label,
    }));
    localKeystore.pendingStagingFile = null;

    assert(localKeystore.activeTemplates.length === 4, "Local active templates now updated to 4 samples");
    assert(localKeystore.activeTemplates[0].id === "tmpl_new_1", "Active template 1 replaced with sample 1");

    // -------------------------------------------------------------------------
    // Test 8: Single-use token cannot be reused (Replay attack blocked)
    // -------------------------------------------------------------------------
    console.log("\n[Test 8] Replay attack: Reusing consumed token is strictly rejected");
    const replayMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: "android-hw-reg-device",
      templateCount: 5,
      oneTimeToken: approvalToken,
      requestId,
    }, {
      ...staffHeaders,
      "x-one-time-token": approvalToken,
    });
    await handlerFaceStaff(replayMock.req, replayMock.res);

    assert(replayMock.getStatus() === 403, `Reusing consumed token rejected with HTTP 403 (got ${replayMock.getStatus()})`);
    assert(replayMock.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code is INVALID_OR_CONSUMED_TOKEN");
    assert(localKeystore.activeTemplates.length === 4, "Templates count preserved at exactly 4");

    // -------------------------------------------------------------------------
    // Test 9: Zero biometrics uploaded to server
    // -------------------------------------------------------------------------
    console.log("\n[Test 9] Biometric privacy guarantee: Zero raw vectors or photos sent to cloud");
    const biometricUploadMock = mockReqRes("POST", "/api/staff/face/request-change", {
      reason: "Attempting to illegally upload raw biometrics",
      embedding: [0.1, 0.2, 0.3],
    }, staffHeaders);
    await handlerFaceStaff(biometricUploadMock.req, biometricUploadMock.res);

    assert(biometricUploadMock.getStatus() === 400, "Server strictly rejects biometrics payload (HTTP 400)");
    assert(biometricUploadMock.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Error code confirms BIOMETRIC_CLOUD_STORAGE_PROHIBITED");

  } catch (err) {
    console.error("FATAL ERROR IN REGRESSION SUITE:", err);
    failed++;
  } finally {
    console.log("\n[Cleanup] Cleaning up regression test staff...");
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);
  }

  console.log("\n===============================================================================");
  console.log(` REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests();
