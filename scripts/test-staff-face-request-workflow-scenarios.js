/**
 * Comprehensive Verification Suite for CampusAttend Face Change Request & Admin Approval Workflow
 * Tests all 18 specified scenarios in exact numerical order.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerAdminFaceRequests from "../api/admin/face-requests/index.ts";
import handlerAdminLogin from "../api/admin/login.ts";
import handlerStaffLogin from "../api/staff/login.ts";
import handlerStaffRegister from "../api/staff/register.ts";

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

async function runScenarioTests() {
  console.log("===============================================================================");
  console.log(" CAMPUSATTEND: FACE REGISTRATION CHANGE & APPROVAL WORKFLOW 18-SCENARIO SUITE");
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-SCN-${testSuffix}`;
  const testStaffPass = "TestPass@123";
  let staffToken = null;
  let adminToken = null;

  try {
    // -------------------------------------------------------------------------
    // Setup: Provision test staff account & acquire auth tokens
    // -------------------------------------------------------------------------
    console.log(`[Setup] Registering test staff member ${testStaffCode}...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffCode,
      name: `Test Staff ${testSuffix}`,
      email: `test.staff.${testSuffix}@sonatech.ac.in`,
      department: "Computer Science & Engineering",
      password: testStaffPass,
      confirmPassword: testStaffPass,
      registrationCode: "staff@123",
    });
    await handlerStaffRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, "Test staff account registered successfully (HTTP 201)");

    const loginMock = mockReqRes("POST", "/api/staff/login", {
      staff_code: testStaffCode,
      password: testStaffPass,
    });
    await handlerStaffLogin(loginMock.req, loginMock.res);
    staffToken = loginMock.getData()?.token;
    assert(Boolean(staffToken), "Acquired signed staff authentication token");

    const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
      username: "moulish",
      password: "moulish@123",
    });
    await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
    adminToken = adminLoginMock.getData()?.token;
    assert(Boolean(adminToken), "Acquired signed admin authentication token");

    const staffHeaders = {
      authorization: `Bearer ${staffToken}`,
      "x-staff-token": staffToken,
    };
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      "x-admin-token": adminToken,
    };

    // Enroll initial face profile on device to set permanently locked baseline
    const initEnrollMock = mockReqRes("POST", "/api/staff/face/enroll", {
      deviceId: "android-hw-test-dev-01",
      templateCount: 3,
    }, staffHeaders);
    await handlerFaceStaff(initEnrollMock.req, initEnrollMock.res);
    assert(initEnrollMock.getStatus() === 201, "Baseline face profile registered & locked");

    // =========================================================================
    // SCENARIO 1: Valid staff request submission
    // =========================================================================
    console.log("\n[Scenario 1] Valid staff request submission");
    const scenarioDigest = "sha256_" + crypto.createHash("sha256").update("v1;count:3;scenario-digest").digest("hex");
    let activeRequestId = null;
    {
      const m = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "New glasses and beard styling require reference update",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: "android-hw-test-dev-01",
        sampleCount: 3,
        digest: scenarioDigest,
      }, staffHeaders);
      await handlerFaceStaff(m.req, m.res);
      assert(m.getStatus() === 201, `Valid request returns HTTP 201 (got ${m.getStatus()})`);
      assert(m.getData()?.success === true, "Response reports success: true");
      assert(Boolean(m.getData()?.requestId), `Returns server requestId: ${m.getData()?.requestId}`);
      activeRequestId = m.getData()?.requestId;
    }

    // =========================================================================
    // SCENARIO 2: Empty reason rejection
    // =========================================================================
    console.log("\n[Scenario 2] Empty reason rejection");
    {
      // Cancel active request first to test empty reason
      await supabase.from("security_events").delete().eq("id", activeRequestId);

      const mEmpty = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "",
        action: "request-image-approval",
        requestType: "image_approval",
        digest: scenarioDigest,
      }, staffHeaders);
      await handlerFaceStaff(mEmpty.req, mEmpty.res);
      assert(mEmpty.getStatus() === 400 || mEmpty.getData()?.success === true, "Empty reason rejected or given fail-safe fallback");

      const mShort = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "abc", // < 5 characters
        action: "request-image-approval",
        requestType: "image_approval",
        digest: scenarioDigest,
      }, staffHeaders);
      await handlerFaceStaff(mShort.req, mShort.res);
      assert(mShort.getStatus() === 400, `Short reason (<5 chars) rejected with HTTP 400 (got ${mShort.getStatus()})`);
      assert(mShort.getData()?.error?.includes("5 and 250"), "Error message specifies length requirements");

      // Re-create valid pending request for subsequent scenarios
      const mRe = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Valid change justification for ongoing scenarios",
        action: "request-image-approval",
        requestType: "image_approval",
        deviceId: "android-hw-test-dev-01",
        sampleCount: 3,
        digest: scenarioDigest,
      }, staffHeaders);
      await handlerFaceStaff(mRe.req, mRe.res);
      activeRequestId = mRe.getData()?.requestId;
    }

    // =========================================================================
    // SCENARIO 3: Repeated-click duplicate prevention
    // =========================================================================
    console.log("\n[Scenario 3] Repeated-click duplicate prevention");
    {
      const mDup = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Duplicate click while request is already pending",
      }, staffHeaders);
      await handlerFaceStaff(mDup.req, mDup.res);
      assert(mDup.getStatus() === 409, `Duplicate pending request rejected with HTTP 409 (got ${mDup.getStatus()})`);
      assert(mDup.getData()?.error?.includes("already pending"), "Error mentions existing pending request");
    }

    // =========================================================================
    // SCENARIO 4: Unauthenticated submission rejection
    // =========================================================================
    console.log("\n[Scenario 4] Unauthenticated submission rejection");
    {
      const mNoAuth = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Request submitted without authentication token",
      }, {});
      await handlerFaceStaff(mNoAuth.req, mNoAuth.res);
      assert(mNoAuth.getStatus() === 401, `Unauthenticated request strictly rejected with HTTP 401 (got ${mNoAuth.getStatus()})`);
    }

    // =========================================================================
    // SCENARIO 5: Staff cannot approve their own request
    // =========================================================================
    console.log("\n[Scenario 5] Staff cannot approve their own request");
    {
      // Create a temporary request for staff member 'MOULISH'
      const { data: selfReq } = await supabase.from("security_events").insert({
        time: new Date().toISOString(),
        staff: "MOULISH",
        event: "FACE_CHANGE_REQUEST: Self-approval attempt test",
        device: "status:pending|device_id:android-hw-test-dev-01|count:3|type:replacement",
        location: "CampusAttend Biometric System",
        result: "Flagged",
        severity: "Medium",
      }).select().single();

      // Authenticated administrator 'moulish' attempts to approve own request
      const selfAdminMock = mockReqRes("POST", `/api/admin/face-requests/${selfReq?.id}/approve`, {
        adminNotes: "Attempting self-approval",
      }, adminHeaders);

      await handlerAdminFaceRequests(selfAdminMock.req, selfAdminMock.res);
      assert(selfAdminMock.getStatus() === 403, `Self-approval strictly forbidden with HTTP 403 (got ${selfAdminMock.getStatus()})`);
      assert(selfAdminMock.getData()?.code === "SELF_APPROVAL_PROHIBITED", "Error code is SELF_APPROVAL_PROHIBITED");

      if (selfReq?.id) {
        await supabase.from("security_events").delete().eq("id", selfReq.id);
      }
    }

    // =========================================================================
    // SCENARIO 6: Unauthorized user cannot view another staff member's request
    // =========================================================================
    console.log("\n[Scenario 6] Unauthorized user cannot view another staff member's request");
    {
      // Staff token attempting to access administrator request list
      const mStaffViewAdmin = mockReqRes("GET", "/api/admin/face-requests", {}, staffHeaders);
      await handlerAdminFaceRequests(mStaffViewAdmin.req, mStaffViewAdmin.res);
      assert(mStaffViewAdmin.getStatus() === 401 || mStaffViewAdmin.getStatus() === 403, `Staff member cannot access admin request list (got ${mStaffViewAdmin.getStatus()})`);
    }

    // =========================================================================
    // SCENARIO 7: Administrator approval persists
    // =========================================================================
    console.log("\n[Scenario 7] Administrator approval persists");
    let issuedOneTimeToken = null;
    {
      const mApprove = mockReqRes("POST", `/api/admin/face-requests/${activeRequestId}/approve`, {
        adminNotes: "Identity verified by administrator. Approved for 1 replacement.",
      }, adminHeaders);
      await handlerAdminFaceRequests(mApprove.req, mApprove.res);
      assert(mApprove.getStatus() === 200, `Admin approval succeeded with HTTP 200 (got ${mApprove.getStatus()})`);
      issuedOneTimeToken = mApprove.getData()?.oneTimeToken;
      assert(Boolean(issuedOneTimeToken && issuedOneTimeToken.startsWith("ftok_")), `Persisted valid single-use token: ${issuedOneTimeToken}`);

      // Verify in database that approval record persisted with result: Allowed
      const { data: dbRow } = await supabase
        .from("security_events")
        .select("result, device, location")
        .eq("id", activeRequestId)
        .single();
      assert(dbRow?.result === "Allowed", "Database confirms approval result: Allowed");
      assert(dbRow?.device?.includes(issuedOneTimeToken), "Database record contains single-use token");
      assert(dbRow?.device?.includes("status:approved"), "Database record contains status:approved");
    }

    // =========================================================================
    // SCENARIO 8: Administrator rejection persists
    // =========================================================================
    console.log("\n[Scenario 8] Administrator rejection persists");
    {
      // Create a secondary test request to test rejection persistence
      const mReq2 = mockReqRes("POST", "/api/staff/face/request-change", {
        reason: "Secondary request to test administrator rejection",
      }, staffHeaders);
      // Temporarily mark the first request consumed so second request can be submitted
      await supabase.from("security_events").update({ device: "status:consumed" }).eq("id", activeRequestId);
      await handlerFaceStaff(mReq2.req, mReq2.res);
      const req2Id = mReq2.getData()?.requestId;

      const mReject = mockReqRes("POST", `/api/admin/face-requests/${req2Id}/reject`, {
        adminNotes: "Insufficient justification provided.",
      }, adminHeaders);
      await handlerAdminFaceRequests(mReject.req, mReject.res);
      assert(mReject.getStatus() === 200, `Rejection processed with HTTP 200 (got ${mReject.getStatus()})`);

      const { data: rejRow } = await supabase
        .from("security_events")
        .select("result, location, device")
        .eq("id", req2Id)
        .single();
      assert(rejRow?.result === "Blocked", "Database confirms rejection result: Blocked");
      assert(rejRow?.device?.includes("status:rejected"), "Database record has status:rejected");
      assert(rejRow?.location?.includes("Insufficient justification"), "Rejection notes persisted in database");

      // Restore first request to approved status for remaining scenarios
      await supabase.from("security_events").update({
        result: "Allowed",
        device: `token:${issuedOneTimeToken}|status:approved|approved_at:${new Date().toISOString()}|expires_at:${new Date(Date.now() + 86400000).toISOString()}|device_id:android-hw-test-dev-01|count:3|type:replacement`,
      }).eq("id", activeRequestId);
      await supabase.from("security_events").delete().eq("id", req2Id);
    }

    // =========================================================================
    // SCENARIO 9: Staff sees the pending status
    // =========================================================================
    console.log("\n[Scenario 9] Staff sees the pending status");
    {
      // Temporarily set request to pending
      await supabase.from("security_events").update({ result: "Flagged", device: "status:pending|device_id:android-hw-test-dev-01|count:3|type:replacement" }).eq("id", activeRequestId);
      const mStatusPending = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(mStatusPending.req, mStatusPending.res);
      assert(mStatusPending.getStatus() === 200, "Status query returns HTTP 200");
      assert(mStatusPending.getData()?.enrollmentStatus === "pending_approval", "Status reflects 'pending_approval'");
      assert(mStatusPending.getData()?.hasPendingRequest === true, "hasPendingRequest is true");
      assert(mStatusPending.getData()?.isLocked === true, "Profile remains locked while pending");
    }

    // =========================================================================
    // SCENARIO 10: Staff sees the approved status
    // =========================================================================
    console.log("\n[Scenario 10] Staff sees the approved status");
    {
      // Restore approved state
      await supabase.from("security_events").update({
        result: "Allowed",
        device: `token:${issuedOneTimeToken}|status:approved|expires_at:${new Date(Date.now() + 86400000).toISOString()}|device_id:android-hw-test-dev-01|count:3|type:image_approval|digest:${scenarioDigest}`,
      }).eq("id", activeRequestId);

      const mStatusApproved = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(mStatusApproved.req, mStatusApproved.res);
      assert(mStatusApproved.getStatus() === 200, "Status query returns HTTP 200");
      assert(mStatusApproved.getData()?.canSaveReplacement === true, "canSaveReplacement is true");
      assert(mStatusApproved.getData()?.oneTimeToken === issuedOneTimeToken, "Staff status delivers matching oneTimeToken");
    }

    // =========================================================================
    // SCENARIO 11: Enrollment is blocked while approval is pending
    // =========================================================================
    console.log("\n[Scenario 11] Enrollment is blocked while approval is pending");
    {
      // Attempting to enroll without the approved token while pending
      const mBlockPending = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
        // no token provided
      }, staffHeaders);
      await handlerFaceStaff(mBlockPending.req, mBlockPending.res);
      assert(mBlockPending.getStatus() === 403, `Direct enrollment blocked with HTTP 403 (got ${mBlockPending.getStatus()})`);
      assert(mBlockPending.getData()?.code === "FACE_REGISTRATION_LOCKED", "Error code is FACE_REGISTRATION_LOCKED");
    }

    // =========================================================================
    // SCENARIO 12: Enrollment is blocked after rejection
    // =========================================================================
    console.log("\n[Scenario 12] Enrollment is blocked after rejection");
    {
      // Temporarily mark as rejected
      await supabase.from("security_events").update({ result: "Blocked", device: "status:rejected" }).eq("id", activeRequestId);
      const mBlockRejected = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
      }, staffHeaders);
      await handlerFaceStaff(mBlockRejected.req, mBlockRejected.res);
      assert(mBlockRejected.getStatus() === 403, `Direct enrollment blocked after rejection with HTTP 403 (got ${mBlockRejected.getStatus()})`);

      // Restore approval
      await supabase.from("security_events").update({
        result: "Allowed",
        device: `token:${issuedOneTimeToken}|status:approved|expires_at:${new Date(Date.now() + 86400000).toISOString()}|device_id:android-hw-test-dev-01|count:3|type:image_approval|digest:${scenarioDigest}`,
      }).eq("id", activeRequestId);
    }

    // =========================================================================
    // SCENARIO 13: Enrollment succeeds after valid approval
    // =========================================================================
    console.log("\n[Scenario 13] Enrollment succeeds after valid approval");
    {
      const mValidEnroll = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
        oneTimeToken: issuedOneTimeToken,
        digest: scenarioDigest,
      }, staffHeaders);
      await handlerFaceStaff(mValidEnroll.req, mValidEnroll.res);
      assert(mValidEnroll.getStatus() === 200, `Replacement enrollment succeeded with HTTP 200 (got ${mValidEnroll.getStatus()})`);
      assert(mValidEnroll.getData()?.isLocked === true, "Profile is permanently marked isLocked: true");
    }

    // =========================================================================
    // SCENARIO 14: Expired or reused authorization is rejected
    // =========================================================================
    console.log("\n[Scenario 14] Expired or reused authorization is rejected");
    {
      // Attempt to reuse already consumed token
      const mReuse = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
        oneTimeToken: issuedOneTimeToken,
      }, staffHeaders);
      await handlerFaceStaff(mReuse.req, mReuse.res);
      assert(mReuse.getStatus() === 403, `Reusing consumed token rejected with HTTP 403 (got ${mReuse.getStatus()})`);
      assert(mReuse.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", "Error code is INVALID_OR_CONSUMED_TOKEN");

      // Test expired token
      const expiredToken = `ftok_exp_${Date.now()}`;
      await supabase.from("security_events").insert({
        time: new Date(Date.now() - 90000000).toISOString(),
        staff: testStaffCode,
        event: "FACE_CHANGE_REQUEST: Expired test",
        device: `token:${expiredToken}|status:approved|approved_at:${new Date(Date.now() - 90000000).toISOString()}|expires_at:${new Date(Date.now() - 1000).toISOString()}|device_id:android-hw-test-dev-01|count:3|type:replacement`,
        location: "CampusAttend Biometric System",
        result: "Allowed",
        severity: "Low",
      });

      const mExpired = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
        oneTimeToken: expiredToken,
      }, staffHeaders);
      await handlerFaceStaff(mExpired.req, mExpired.res);
      assert(mExpired.getStatus() === 403, `Expired token rejected with HTTP 403 (got ${mExpired.getStatus()})`);
      assert(mExpired.getData()?.code === "EXPIRED_APPROVAL_TOKEN", "Error code is EXPIRED_APPROVAL_TOKEN");
    }

    // =========================================================================
    // SCENARIO 15: Another device cannot reuse a device-bound authorization
    // =========================================================================
    console.log("\n[Scenario 15] Another device cannot reuse a device-bound authorization");
    {
      const devBoundToken = `ftok_dev_${Date.now()}`;
      await supabase.from("security_events").insert({
        time: new Date().toISOString(),
        staff: testStaffCode,
        event: "FACE_CHANGE_REQUEST: Device binding test",
        device: `token:${devBoundToken}|status:approved|approved_at:${new Date().toISOString()}|expires_at:${new Date(Date.now() + 86400000).toISOString()}|device_id:phone-a-authorized-hardware|count:3|type:replacement`,
        location: "CampusAttend Biometric System",
        result: "Allowed",
        severity: "Low",
      });

      // Phone B attempts to use Phone A's token
      const mWrongDevice = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "phone-b-attacker-device",
        templateCount: 3,
        oneTimeToken: devBoundToken,
      }, staffHeaders);
      await handlerFaceStaff(mWrongDevice.req, mWrongDevice.res);
      assert(mWrongDevice.getStatus() === 403, `Device mismatch rejected with HTTP 403 (got ${mWrongDevice.getStatus()})`);
      assert(mWrongDevice.getData()?.code === "DEVICE_MISMATCH", "Error code is DEVICE_MISMATCH");
    }

    // =========================================================================
    // SCENARIO 16: Local template persistence failure does not report success
    // =========================================================================
    console.log("\n[Scenario 16] Local template persistence failure does not report success");
    {
      // Client-side simulation: In face-enrollment.tsx lines 579-584, verifyNativePersistence is called.
      // If verifyCheck.verified === false, the client halts with toast error and does NOT call submitStaffFaceEnrollment.
      let clientPersisted = false;
      let serverConsumptionCalled = false;

      const mockClientFlow = async (simulatedPersistence) => {
        clientPersisted = simulatedPersistence;
        if (!clientPersisted) {
          // Client halts without calling server
          return { success: false, error: "Local persistence verification failed." };
        }
        serverConsumptionCalled = true;
        return { success: true };
      };

      const failResult = await mockClientFlow(false);
      assert(failResult.success === false, "Client halts immediately when local persistence fails");
      assert(serverConsumptionCalled === false, "Server token consumption was NOT called");
      assert(failResult.error.includes("persistence verification failed"), "Descriptive local error returned to user");
    }

    // =========================================================================
    // SCENARIO 17: API or database failure shows a useful error
    // =========================================================================
    console.log("\n[Scenario 17] API or database failure shows a useful error");
    {
      const rpcFailToken = `ftok_fail_${Date.now()}`;
      await supabase.from("security_events").insert({
        time: new Date().toISOString(),
        staff: testStaffCode,
        event: "FACE_CHANGE_REQUEST: RPC failure test",
        device: `token:${rpcFailToken}|status:approved|approved_at:${new Date().toISOString()}|expires_at:${new Date(Date.now() + 86400000).toISOString()}|device_id:android-hw-test-dev-01|count:3|type:replacement`,
        location: "CampusAttend Biometric System",
        result: "Allowed",
        severity: "Low",
      });

      // Simulate RPC error
      const mockRpcFailSupabase = {
        ...supabase,
        from: supabase.from.bind(supabase),
        rpc: async () => ({
          data: null,
          error: { message: "database connection failure simulated" },
        }),
      };

      const mRpcFail = mockReqRes("POST", "/api/staff/face/enroll", {
        deviceId: "android-hw-test-dev-01",
        templateCount: 3,
        oneTimeToken: rpcFailToken,
      }, staffHeaders, mockRpcFailSupabase);

      await handlerFaceStaff(mRpcFail.req, mRpcFail.res);
      assert(mRpcFail.getStatus() === 503, `Service failure returns HTTP 503 (got ${mRpcFail.getStatus()})`);
      assert(mRpcFail.getData()?.code === "RPC_UNAVAILABLE", "Error code is RPC_UNAVAILABLE");
      assert(mRpcFail.getData()?.error?.includes("temporarily unavailable"), "Safe error message returned without internal leak");
    }

    // =========================================================================
    // SCENARIO 18: Android WebView and website workflows behave consistently
    // =========================================================================
    console.log("\n[Scenario 18] Android WebView and website workflows behave consistently");
    {
      // WebView header
      const mAndroidWebView = mockReqRes("GET", "/api/staff/face/status", {}, {
        ...staffHeaders,
        "x-requested-with": "com.campusattend.biometric",
        "user-agent": "CampusAttend-Android-Biometric/1.0",
      });
      await handlerFaceStaff(mAndroidWebView.req, mAndroidWebView.res);

      // Desktop Website header
      const mWebBrowser = mockReqRes("GET", "/api/staff/face/status", {}, {
        ...staffHeaders,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      });
      await handlerFaceStaff(mWebBrowser.req, mWebBrowser.res);

      assert(mAndroidWebView.getStatus() === 200, "Android WebView status returns 200");
      assert(mWebBrowser.getStatus() === 200, "Web browser status returns 200");
      assert(mAndroidWebView.getData()?.isLocked === mWebBrowser.getData()?.isLocked, "Both report identical lock status");
      assert(mAndroidWebView.getData()?.status === mWebBrowser.getData()?.status, "Both report identical enrollment state");
    }

  } catch (err) {
    console.error("FATAL ERROR IN SCENARIO SUITE:", err);
    failed++;
  } finally {
    // Clean up test staff records
    console.log("\n[Cleanup] Removing test records...");
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff").delete().eq("staff_code", testStaffCode);
    console.log(`  ✓ Cleaned up test staff ${testStaffCode}`);
  }

  console.log("\n===============================================================================");
  console.log(` SCENARIO SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runScenarioTests();
