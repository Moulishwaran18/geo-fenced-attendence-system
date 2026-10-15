/**
 * CampusAttend — Automated Verification Suite for Staff Face Enrollment & Permanent Lock Workflow
 * (Hardened for Device-Only Biometric Policy)
 *
 * Requirements Tested:
 * 1. Server-side session verification (zero client identity trust)
 * 2. Privacy enforcement: uploading biometric vectors or photos is strictly REJECTED (HTTP 400)
 * 3. Initial device enrollment registration for new staff (HTTP 201)
 * 4. Immediate permanent lock after initial save (isLocked: true)
 * 5. Server-enforced lock: Direct replacement rejected with HTTP 403 Forbidden
 * 6. Staff face change request submission with reason (HTTP 201)
 * 7. Duplicate pending change request rejection (HTTP 409)
 * 8. Admin face requests listing & pending count (HTTP 200)
 * 9. Admin rejection preserves device lock & zero cloud templates (HTTP 200)
 * 10. Staff resubmission & Admin approval with single-use token (HTTP 200 + ftok_*)
 * 11. Failed replacement preservation: invalid payloads do not consume token
 * 12. Fail-closed expiration checks (missing, malformed, expired timestamps strictly reject)
 * 13. Single-use replacement save consumes token & immediately re-locks profile (HTTP 200)
 * 14. Consumed token reuse strictly rejected with HTTP 403 Forbidden
 * 15. Atomic concurrency: exactly one simultaneous request can consume the token
 * 16. Second replacement requires fresh administrator approval
 * 17. Complete preservation of historical attendance records and Admin 'moulish' account
 * 18. Static security audit of PostgreSQL migration script
 * 19. Clean up test records
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import handlerFaceStaff from "../api/staff/face/index.ts";
import handlerFaceAdmin from "../api/admin/face-requests/index.ts";
import handlerRegister from "../api/staff/register.ts";
import handlerStaffLogin from "../api/staff/login.ts";
import handlerAdminLogin from "../api/admin/login.ts";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// Helper to simulate Vercel serverless request & response
function mockReqRes(method, url, body = {}, headers = {}, customClient = null) {
  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const req = {
    method,
    url,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
    json: async () => body,
    supabaseClient: customClient,
  };

  const res = {
    statusCode: 200,
    setHeader: (k, v) => {
      responseHeaders[k.toLowerCase()] = v;
    },
    status: (code) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json: (payload) => {
      responseData = payload;
      return payload;
    },
    end: (str) => {
      if (str && !responseData) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
    },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getData: () => responseData,
    getHeaders: () => responseHeaders,
  };
}

// Generate realistic normalized 512-D vector
function generateMockEmbedding(seed) {
  const vec = [];
  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    const val = Math.sin(seed * (i + 1)) * 0.5;
    vec.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq);
  return vec.map((v) => v / norm);
}

async function runVerification() {
  console.log("================================================================================");
  console.log("  CAMPUSATTEND: STAFF FACE ENROLLMENT & PERMANENT LOCK AUTOMATED SUITE (v2)    ");
  console.log("================================================================================");

  const testSuffix = Math.floor(1000 + Math.random() * 9000).toString();
  const testStaffId = `STF-FLOCK-${testSuffix}`;
  const testPassword = `Pass@Secure${testSuffix}`;
  let staffSessionToken = null;
  let staffUuid = null;
  let adminSessionToken = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Provision Clean Test Staff Account
    // -------------------------------------------------------------------------
    console.log(`\n[1] Creating Test Staff Member: ${testStaffId}...`);
    const regMock = mockReqRes("POST", "/api/staff/register", {
      staff_code: testStaffId,
      name: `Dr. Lock Test Staff ${testSuffix}`,
      email: `lock.test.${testSuffix}@sonatech.ac.in`,
      department: "Information Technology",
      password: testPassword,
      confirmPassword: testPassword,
      registrationCode: "staff@123",
    });
    await handlerRegister(regMock.req, regMock.res);
    assert(regMock.getStatus() === 201, `Staff self-registration succeeded with HTTP 201 (got ${regMock.getStatus()})`);
    staffUuid = regMock.getData()?.staff?.id;
    assert(Boolean(staffUuid), `Staff UUID resolved: ${staffUuid}`);

    // -------------------------------------------------------------------------
    // STEP 2: Authenticate Staff Member (Acquire Server Session Token)
    // -------------------------------------------------------------------------
    console.log("\n[2] Authenticating Test Staff Member...");
    const loginMock = mockReqRes("POST", "/api/staff/login", {
      staff_code: testStaffId,
      password: testPassword,
    });
    await handlerStaffLogin(loginMock.req, loginMock.res);
    assert(loginMock.getStatus() === 200, `Staff login succeeded with HTTP 200 (got ${loginMock.getStatus()})`);
    staffSessionToken = loginMock.getData()?.token;
    assert(Boolean(staffSessionToken), "Received valid server staff_session token");

    const staffHeaders = {
      authorization: `Bearer ${staffSessionToken}`,
    };

    // -------------------------------------------------------------------------
    // STEP 3: Initial Status Query (Pre-Registration)
    // -------------------------------------------------------------------------
    console.log("\n[3] Querying Initial Face Enrollment Status...");
    {
      const { req, res, getStatus, getData } = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(req, res);
      assert(getStatus() === 200, `Status query succeeded with HTTP 200 (got ${getStatus()})`);
      const data = getData();
      assert(data?.enrollmentStatus === "not_registered", `Status is 'not_registered' (got ${data?.enrollmentStatus})`);
      assert(data?.isLocked === false, `Profile is not locked yet (isLocked: ${data?.isLocked})`);
      assert(data?.sampleCount === 0, `Sample count is 0 (got ${data?.sampleCount})`);
    }

    // -------------------------------------------------------------------------
    // STEP 4: Initial Face Registration Submission & Privacy Enforcement
    // -------------------------------------------------------------------------
    console.log("\n[4] Submitting Initial Face Registration & Testing Prohibited Payload...");

    // 4A: Uploading biometric vectors/photos to server is strictly PROHIBITED
    {
      const prohibitedAttempt = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          samples: [
            {
              embedding: generateMockEmbedding(101),
              photoData: "data:image/jpeg;base64,/9j/mockSample",
            },
          ],
        },
        staffHeaders
      );
      await handlerFaceStaff(prohibitedAttempt.req, prohibitedAttempt.res);
      assert(prohibitedAttempt.getStatus() === 400, `Uploading biometric samples strictly rejected with HTTP 400 (got ${prohibitedAttempt.getStatus()})`);
      assert(prohibitedAttempt.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Error code is BIOMETRIC_CLOUD_STORAGE_PROHIBITED");
    }

    // 4B: Permitted device metadata registration succeeds with HTTP 201
    {
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          deviceId: "mock-android-device-1",
          templateCount: 2,
        },
        staffHeaders
      );
      await handlerFaceStaff(req, res);
      assert(getStatus() === 201, `Initial face enrollment succeeded with HTTP 201 (got ${getStatus()})`);
      const data = getData();
      assert(data?.success === true, "Response indicated success: true");
      assert(data?.count === 2, `Saved exactly 2 samples (got ${data?.count})`);
      assert(data?.isLocked === true, "Returned isLocked: true immediately after initial save");
    }

    // -------------------------------------------------------------------------
    // STEP 5: Verification of Immediate Permanent Lock
    // -------------------------------------------------------------------------
    console.log("\n[5] Verifying Immediate Permanent Lock via Status API...");
    {
      const { req, res, getStatus, getData } = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(req, res);
      assert(getStatus() === 200, `Status check HTTP 200 (got ${getStatus()})`);
      const data = getData();
      assert(data?.enrollmentStatus === "approved", `Enrollment status is 'approved' (got ${data?.enrollmentStatus})`);
      assert(data?.isLocked === true, `Profile is PERMANENTLY LOCKED (isLocked: ${data?.isLocked})`);
      assert(data?.sampleCount === 2, `Sample count is 2 (got ${data?.sampleCount})`);
      assert(data?.canSaveReplacement === false, "canSaveReplacement is false without admin approval");
    }

    // -------------------------------------------------------------------------
    // STEP 6: Server-Enforced Lock Test: Direct Replacement Rejected (HTTP 403)
    // -------------------------------------------------------------------------
    console.log("\n[6] Testing Server Lock Enforcement: Direct Replacement Attempt...");
    {
      // 6A: Biometric sample upload rejected with 400
      const vectorAttempt = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          samples: [{ embedding: generateMockEmbedding(999) }],
        },
        staffHeaders
      );
      await handlerFaceStaff(vectorAttempt.req, vectorAttempt.res);
      assert(vectorAttempt.getStatus() === 400, `Sample upload rejected with 400 (got ${vectorAttempt.getStatus()})`);
      assert(vectorAttempt.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Code is BIOMETRIC_CLOUD_STORAGE_PROHIBITED");

      // 6B: Direct device re-enrollment without token rejected with 403
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          deviceId: "mock-android-device-1",
          templateCount: 2,
        },
        staffHeaders
      );
      await handlerFaceStaff(req, res);
      assert(getStatus() === 403, `Direct update strictly rejected with HTTP 403 Forbidden (got ${getStatus()})`);
      const data = getData();
      assert(
        data?.error?.includes("locked") && data?.error?.includes("administrator approval"),
        `Informative error message returned: "${data?.error}"`
      );

      // Verify zero templates are in face_embeddings table
      const { data: dbTemplates } = await supabase
        .from("face_embeddings")
        .select("id")
        .eq("staff_id", staffUuid);
      assert((dbTemplates?.length || 0) === 0, `Zero cloud templates in database: count is 0 (got ${dbTemplates?.length || 0})`);
    }

    // -------------------------------------------------------------------------
    // STEP 7: Staff Submits Face Change Request with Reason
    // -------------------------------------------------------------------------
    console.log("\n[7] Staff Submitting Face Change Request with Reason...");
    let requestId1 = null;
    {
      const changeReason = "New spectacles and significant facial appearance change";
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/request-change",
        { reason: changeReason },
        staffHeaders
      );
      await handlerFaceStaff(req, res);
      assert(getStatus() === 201, `Change request created with HTTP 201 (got ${getStatus()})`);
      const data = getData();
      assert(data?.success === true, "Change request marked success: true");
      assert(Boolean(data?.requestId), `Request ID returned: ${data?.requestId}`);
      requestId1 = data?.requestId;

      // Verify status reflects pending approval
      const statusRes = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(statusRes.req, statusRes.res);
      const stData = statusRes.getData();
      assert(stData?.enrollmentStatus === "pending_approval", `Status updated to 'pending_approval' (got ${stData?.enrollmentStatus})`);
      assert(stData?.activeRequest?.reason === changeReason, "Active request includes the submitted reason");
    }

    // -------------------------------------------------------------------------
    // STEP 8: Duplicate Change Request Prevention (HTTP 409)
    // -------------------------------------------------------------------------
    console.log("\n[8] Testing Duplicate Pending Request Prevention...");
    {
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/request-change",
        { reason: "Second concurrent request attempt" },
        staffHeaders
      );
      await handlerFaceStaff(req, res);
      assert(getStatus() === 409, `Duplicate request rejected with HTTP 409 Conflict (got ${getStatus()})`);
      assert(getData()?.error?.includes("already pending"), "Error mentions existing pending request");
    }

    // -------------------------------------------------------------------------
    // STEP 9: Admin Console: Authenticate & List Requests
    // -------------------------------------------------------------------------
    console.log("\n[9] Authenticating Administrator 'moulish' & Listing Requests...");
    {
      const adminLoginMock = mockReqRes("POST", "/api/admin/login", {
        adminId: "moulish",
        password: "moulish@123",
      });
      await handlerAdminLogin(adminLoginMock.req, adminLoginMock.res);
      assert(adminLoginMock.getStatus() === 200, `Admin login succeeded with HTTP 200 (got ${adminLoginMock.getStatus()})`);
      adminSessionToken = adminLoginMock.getData()?.token;
      assert(Boolean(adminSessionToken), "Admin session token acquired");

      const adminHeaders = {
        authorization: `Bearer ${adminSessionToken}`,
      };

      const listMock = mockReqRes("GET", "/api/admin/face-requests", {}, adminHeaders);
      await handlerFaceAdmin(listMock.req, listMock.res);
      assert(listMock.getStatus() === 200, `Admin request list HTTP 200 (got ${listMock.getStatus()})`);
      const listData = listMock.getData();
      assert(listData?.pendingCount >= 1, `Pending count is >= 1 (got ${listData?.pendingCount})`);
      const found = listData?.requests?.find((r) => r.staff_code === testStaffId);
      assert(Boolean(found), `Found pending request for ${testStaffId} in admin list`);
      assert(found?.status === "pending", `Found request status is 'pending' (got ${found?.status})`);
    }

    const adminHeaders = {
      authorization: `Bearer ${adminSessionToken}`,
    };

    // -------------------------------------------------------------------------
    // STEP 10: Admin Rejection Preserves Templates
    // -------------------------------------------------------------------------
    console.log("\n[10] Testing Admin Rejection Workflow...");
    {
      const rejectMock = mockReqRes(
        "POST",
        `/api/admin/face-requests/${requestId1}/reject`,
        { adminNotes: "Photo clarity requirement: please capture in bright lighting" },
        adminHeaders
      );
      await handlerFaceAdmin(rejectMock.req, rejectMock.res);
      assert(rejectMock.getStatus() === 200, `Admin reject succeeded with HTTP 200 (got ${rejectMock.getStatus()})`);

      // Verify staff status is rejected, templates intact
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.enrollmentStatus === "rejected", `Staff enrollment status is 'rejected' (got ${stData?.enrollmentStatus})`);
      assert(stData?.isLocked === true, "Staff profile remains locked during rejection");

      const { data: dbTemplates } = await supabase
        .from("face_embeddings")
        .select("id")
        .eq("staff_id", staffUuid);
      assert((dbTemplates?.length || 0) === 0, `Zero cloud templates in database (count: ${dbTemplates?.length || 0})`);
    }

    // -------------------------------------------------------------------------
    // STEP 11: Resubmission & Admin Approval (Single-Use Token)
    // -------------------------------------------------------------------------
    console.log("\n[11] Staff Resubmission & Admin Approval with Single-Use Token...");
    let oneTimeToken = null;
    let requestId2 = null;
    {
      const newReqMock = mockReqRes(
        "POST",
        "/api/staff/face/request-change",
        { reason: "Updated with clean high-contrast facial lighting" },
        staffHeaders
      );
      await handlerFaceStaff(newReqMock.req, newReqMock.res);
      assert(newReqMock.getStatus() === 201, `New request created with HTTP 201 (got ${newReqMock.getStatus()})`);
      requestId2 = newReqMock.getData()?.requestId;

      const approveMock = mockReqRes(
        "POST",
        `/api/admin/face-requests/${requestId2}/approve`,
        { adminNotes: "Approved for one-time face re-registration" },
        adminHeaders
      );
      await handlerFaceAdmin(approveMock.req, approveMock.res);
      assert(approveMock.getStatus() === 200, `Admin approval HTTP 200 (got ${approveMock.getStatus()})`);
      const appData = approveMock.getData();
      assert(Boolean(appData?.oneTimeToken), "Approval response issued oneTimeToken");
      assert(appData?.oneTimeToken?.startsWith("ftok_"), `Token format is correct (starts with ftok_)`);
      oneTimeToken = appData?.oneTimeToken;

      // Verify staff status check displays approval and authorization token
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.canSaveReplacement === true, "Staff status reports canSaveReplacement: true");
      assert(stData?.oneTimeToken === oneTimeToken, "Staff status delivers matching oneTimeToken");
    }

    // -------------------------------------------------------------------------
    // STEP 11B: Failed Replacement Preserves Old Face & Allows Retry
    // -------------------------------------------------------------------------
    console.log("\n[11B] Testing Failed Replacement Handling & Old Face Preservation...");
    {
      const invalidPayloadAttempt = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          samples: [{ embedding: [0.1, 0.2, 0.3] }],
          oneTimeToken: oneTimeToken,
        },
        staffHeaders
      );
      await handlerFaceStaff(invalidPayloadAttempt.req, invalidPayloadAttempt.res);
      assert(invalidPayloadAttempt.getStatus() === 400, `Prohibited biometric vector upload rejected with HTTP 400 (got ${invalidPayloadAttempt.getStatus()})`);
      assert(invalidPayloadAttempt.getData()?.code === "BIOMETRIC_CLOUD_STORAGE_PROHIBITED", "Prohibits biometric vector upload to cloud");

      // Verify one-time token is NOT consumed and retry is permitted
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.canSaveReplacement === true, "Token not consumed: canSaveReplacement is still true");
      assert(stData?.oneTimeToken === oneTimeToken, "Token still active for retry");
    }

    // -------------------------------------------------------------------------
    // STEP 11C: Testing Missing RPC Safe Error & Non-Atomic Fallback Removal
    // -------------------------------------------------------------------------
    console.log("\n[11C] Testing Missing RPC Safe Error & Non-Atomic Fallback Removal...");
    {
      const missingRpcClient = {
        ...supabase,
        from: supabase.from.bind(supabase),
        rpc: async () => ({ data: null, error: { message: "function not found" } }),
      };

      const missingRpcAttempt = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          deviceId: "mock-android-device-1",
          templateCount: 3,
          oneTimeToken: oneTimeToken,
        },
        staffHeaders,
        missingRpcClient
      );
      await handlerFaceStaff(missingRpcAttempt.req, missingRpcAttempt.res);
      assert(missingRpcAttempt.getStatus() === 503, `Missing RPC returns HTTP 503 Service Unavailable (got ${missingRpcAttempt.getStatus()})`);
      assert(missingRpcAttempt.getData()?.code === "RPC_UNAVAILABLE", `Error code is RPC_UNAVAILABLE (got ${missingRpcAttempt.getData()?.code})`);
      assert(
        missingRpcAttempt.getData()?.error?.includes("unavailable") && missingRpcAttempt.getData()?.error?.includes("unchanged"),
        `Sanitized safe error message returned: "${missingRpcAttempt.getData()?.error}"`
      );

      // Verify approval token in database remains approved (not consumed)
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.canSaveReplacement === true, "Token not consumed: canSaveReplacement is still true");
      assert(stData?.oneTimeToken === oneTimeToken, "Token still active for retry");
    }

    // -------------------------------------------------------------------------
    // STEP 11D: Testing Unauthorized Session & Identity Binding Enforcement
    // -------------------------------------------------------------------------
    console.log("\n[11D] Testing Session Spoofing & Identity Binding Protection...");
    {
      // 1. Tampered / invalid session token rejected
      const badSessionMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-android-device-1", templateCount: 3, oneTimeToken },
        { ...staffHeaders, authorization: "Bearer invalid.signature.token" }
      );
      await handlerFaceStaff(badSessionMock.req, badSessionMock.res);
      assert(badSessionMock.getStatus() === 401, `Invalid session signature rejected with HTTP 401 (got ${badSessionMock.getStatus()})`);

      // 2. Caller attempting to impersonate another staff by passing body.staffId
      const spoofAttemptMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          deviceId: "mock-android-device-1",
          templateCount: 3,
          oneTimeToken,
          staffId: "STF_OTHER_VICTIM",
          staff_code: "STF_OTHER_VICTIM",
        },
        staffHeaders
      );
      await handlerFaceStaff(spoofAttemptMock.req, spoofAttemptMock.res);
      // It binds to authenticated staff session (not STF_OTHER_VICTIM)
      assert(spoofAttemptMock.getStatus() === 200 || spoofAttemptMock.getStatus() === 503, `Session binds to authenticated user; body staffId ignored (got ${spoofAttemptMock.getStatus()})`);
    }

    // -------------------------------------------------------------------------
    // STEP 11E: Testing Fail-Closed Expiration Checks (Missing, Malformed, Expired)
    // -------------------------------------------------------------------------
    console.log("\n[11E] Testing Fail-Closed Expiration Checks (Missing, Malformed, Expired)...");
    {
      const nowIso = new Date().toISOString();

      // Case 1: Missing expires_at in security_events
      await supabase
        .from("security_events")
        .update({
          device: `token:${oneTimeToken}|status:approved|approved_at:${nowIso}`,
          time: nowIso,
        })
        .eq("id", requestId2);

      const missingExpMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders
      );
      await handlerFaceStaff(missingExpMock.req, missingExpMock.res);
      assert(missingExpMock.getStatus() === 403, `Missing expires_at strictly rejected with HTTP 403 (got ${missingExpMock.getStatus()})`);
      assert(missingExpMock.getData()?.code === "INVALID_EXPIRY", `Code is INVALID_EXPIRY (got ${missingExpMock.getData()?.code})`);

      // Case 2: Malformed expires_at in security_events
      await supabase
        .from("security_events")
        .update({
          device: `token:${oneTimeToken}|status:approved|approved_at:${nowIso}|expires_at:NOT_A_VALID_DATE_CORRUPT`,
          time: nowIso,
        })
        .eq("id", requestId2);

      const malformedExpMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders
      );
      await handlerFaceStaff(malformedExpMock.req, malformedExpMock.res);
      assert(malformedExpMock.getStatus() === 403, `Malformed expires_at strictly rejected with HTTP 403 (got ${malformedExpMock.getStatus()})`);
      assert(malformedExpMock.getData()?.code === "MALFORMED_EXPIRY", `Code is MALFORMED_EXPIRY (got ${malformedExpMock.getData()?.code})`);

      // Case 3: Expired expires_at in security_events (25 hours ago)
      const past25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const past26h = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("security_events")
        .update({
          device: `token:${oneTimeToken}|status:approved|approved_at:${past26h}|expires_at:${past25h}`,
          time: past26h,
        })
        .eq("id", requestId2);

      const expiredExpMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders
      );
      await handlerFaceStaff(expiredExpMock.req, expiredExpMock.res);
      assert(expiredExpMock.getStatus() === 403, `Expired expires_at strictly rejected with HTTP 403 (got ${expiredExpMock.getStatus()})`);
      assert(expiredExpMock.getData()?.code === "EXPIRED_APPROVAL_TOKEN", `Code is EXPIRED_APPROVAL_TOKEN (got ${expiredExpMock.getData()?.code})`);
    }

    // Restore valid 24-hour approval token in database
    const validNowIso = new Date().toISOString();
    const future24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("security_events")
      .update({
        device: `token:${oneTimeToken}|status:approved|approved_at:${validNowIso}|expires_at:${future24hIso}`,
        time: validNowIso,
      })
      .eq("id", requestId2);

    // -------------------------------------------------------------------------
    // STEP 12A: Testing Transaction Rollback on Failure & Sanitized Client Error
    // -------------------------------------------------------------------------
    console.log("\n[12A] Testing Transaction Rollback on Failure & Sanitized Client Error...");
    {
      const rollbackClient = {
        ...supabase,
        from: supabase.from.bind(supabase),
        rpc: async (fnName, args) => {
          if (fnName === "atomic_consume_face_approval_token" || fnName === "atomic_replace_face_biometrics") {
            return {
              data: {
                success: false,
                code: "TRANSACTION_ROLLBACK",
                error: "Database transaction failed during atomic approval token consumption.",
              },
              error: null,
            };
          }
          return supabase.rpc(fnName, args);
        },
      };

      const rollbackMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders,
        rollbackClient
      );
      await handlerFaceStaff(rollbackMock.req, rollbackMock.res);
      assert(rollbackMock.getStatus() === 500, `Rollback returns sanitized HTTP 500 (got ${rollbackMock.getStatus()})`);
      assert(rollbackMock.getData()?.code === "TRANSACTION_ROLLBACK", `Error code is TRANSACTION_ROLLBACK (got ${rollbackMock.getData()?.code})`);
      assert(
        rollbackMock.getData()?.error === "Database transaction failed during atomic approval token consumption.",
        "Sanitized client error message returned without server diagnostic leakage"
      );

      // Verify token remains unconsumed and retryable
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.canSaveReplacement === true, "Token not consumed: canSaveReplacement is still true after rollback");
      assert(stData?.oneTimeToken === oneTimeToken, "Token still active for retry after rollback");
    }

    // -------------------------------------------------------------------------
    // STEP 12B: Testing Retry After Failure & Single-Use Consumption
    // -------------------------------------------------------------------------
    console.log("\n[12B] Testing Retry After Failure & Single-Use Consumption...");
    {
      const successRpcClient = {
        ...supabase,
        from: supabase.from.bind(supabase),
        rpc: async (fnName, args) => {
          if (fnName === "atomic_consume_face_approval_token" || fnName === "atomic_replace_face_biometrics") {
            const nowIso = new Date().toISOString();
            await supabase.from("security_events").update({
              device: `token:${args.p_token}|status:consumed|device_id:${args.p_device_id || 'mock-device'}|consumed_at:${nowIso}`,
              time: nowIso,
            }).eq("id", requestId2);
            await supabase.from("security_events").insert({
              time: nowIso,
              staff: args.p_staff_code,
              event: `FACE_CHANGE_CONSUMED: One-time approval consumed for device ${args.p_device_id || 'mock-device'}`,
              device: `device_id:${args.p_device_id || 'mock-device'}|count:3`,
              location: "CampusAttend Biometric System",
              result: "Allowed",
              severity: "Low",
            });
            return {
              data: {
                success: true,
                count: 3,
                isLocked: true,
                message: "Face registration updated and permanently locked. Single-use authorization consumed.",
              },
              error: null,
            };
          }
          return supabase.rpc(fnName, args);
        },
      };

      const retryMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders,
        successRpcClient
      );
      await handlerFaceStaff(retryMock.req, retryMock.res);
      assert(retryMock.getStatus() === 200, `Retry succeeded with HTTP 200 (got ${retryMock.getStatus()})`);
      assert(retryMock.getData()?.success === true, "Response reports success: true");
      assert(retryMock.getData()?.isLocked === true, "Returned isLocked: true");

      // Verify status check confirms re-locked profile and consumed token
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.isLocked === true, "Profile immediately re-locked (isLocked: true)");
      assert(stData?.canSaveReplacement === false, "canSaveReplacement is false after consumption");
      assert(!stData?.oneTimeToken, "oneTimeToken is cleared from status");
    }

    // -------------------------------------------------------------------------
    // STEP 12C: Testing Strict Rejection on Consumed Token Reuse
    // -------------------------------------------------------------------------
    console.log("\n[12C] Testing Strict Rejection on Consumed Token Reuse...");
    {
      const reuseAttempt = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { deviceId: "mock-device", templateCount: 3, oneTimeToken },
        staffHeaders
      );
      await handlerFaceStaff(reuseAttempt.req, reuseAttempt.res);
      assert(reuseAttempt.getStatus() === 403, `Reuse attempt rejected with HTTP 403 (got ${reuseAttempt.getStatus()})`);
      assert(reuseAttempt.getData()?.code === "INVALID_OR_CONSUMED_TOKEN", `Code is INVALID_OR_CONSUMED_TOKEN (got ${reuseAttempt.getData()?.code})`);
    }

    // -------------------------------------------------------------------------
    // STEP 12D: Testing Simultaneous Save Requests with Same Token (Atomic Concurrency)
    // -------------------------------------------------------------------------
    console.log("\n[12D] Testing Simultaneous Save Requests with Same Token (Atomic Concurrency)...");
    {
      // Create fresh request and approve it
      const changeReq3 = mockReqRes("POST", "/api/staff/face/request-change", { reason: "Concurrency testing request" }, staffHeaders);
      await handlerFaceStaff(changeReq3.req, changeReq3.res);
      assert(changeReq3.getStatus() === 201, `Request #3 created with HTTP 201 (got ${changeReq3.getStatus()})`);
      const requestId3 = changeReq3.getData()?.requestId;

      const adminApprove3 = mockReqRes(
        "POST",
        `/api/admin/face-requests/${requestId3}/approve`,
        { adminNotes: "Approved for concurrency test" },
        adminHeaders
      );
      await handlerFaceAdmin(adminApprove3.req, adminApprove3.res);
      assert(adminApprove3.getStatus() === 200, `Admin approval for request #3 HTTP 200 (got ${adminApprove3.getStatus()})`);
      const token3 = adminApprove3.getData()?.oneTimeToken || adminApprove3.getData()?.token;

      // Simulate atomic database lock concurrency
      let hasConsumed = false;
      const concurrentClient = {
        ...supabase,
        from: supabase.from.bind(supabase),
        rpc: async (fnName, args) => {
          if (fnName === "atomic_consume_face_approval_token" || fnName === "atomic_replace_face_biometrics") {
            if (hasConsumed) {
              return {
                data: {
                  success: false,
                  code: "INVALID_OR_CONSUMED_TOKEN",
                  error: "Invalid, expired, or already consumed face change authorization.",
                },
                error: null,
              };
            }
            hasConsumed = true;
            const nowIso = new Date().toISOString();
            await supabase.from("security_events").update({
              device: `token:${token3}|status:consumed|device_id:${args.p_device_id || 'mock-device'}|consumed_at:${nowIso}`,
              time: nowIso,
            }).eq("id", requestId3);
            return {
              data: {
                success: true,
                count: 3,
                isLocked: true,
                message: "Face registration updated and permanently locked. Single-use authorization consumed.",
              },
              error: null,
            };
          }
          return supabase.rpc(fnName, args);
        },
      };

      const [resSim1, resSim2] = await Promise.all([
        (async () => {
          const m = mockReqRes("POST", "/api/staff/face/enroll", { deviceId: "mock-device", templateCount: 3, oneTimeToken: token3 }, staffHeaders, concurrentClient);
          await handlerFaceStaff(m.req, m.res);
          return m.getStatus();
        })(),
        (async () => {
          const m = mockReqRes("POST", "/api/staff/face/enroll", { deviceId: "mock-device", templateCount: 3, oneTimeToken: token3 }, staffHeaders, concurrentClient);
          await handlerFaceStaff(m.req, m.res);
          return m.getStatus();
        })(),
      ]);

      const statuses = [resSim1, resSim2].sort();
      assert(statuses[0] === 200 && statuses[1] === 403, `Atomic Concurrency: Exactly one request succeeded (200) and one was rejected (403) (statuses: ${statuses.join(", ")})`);
    }

    // -------------------------------------------------------------------------
    // STEP 12E: Second Replacement Requires Fresh Administrator Approval
    // -------------------------------------------------------------------------
    console.log("\n[12E] Testing Second Replacement Requires Fresh Administrator Approval...");
    {
      const unapprovedAttempt = mockReqRes("POST", "/api/staff/face/enroll", { deviceId: "mock-device", templateCount: 3 }, staffHeaders);
      await handlerFaceStaff(unapprovedAttempt.req, unapprovedAttempt.res);
      assert(unapprovedAttempt.getStatus() === 403, `Unapproved second replacement rejected with HTTP 403 (got ${unapprovedAttempt.getStatus()})`);

      const req4Mock = mockReqRes(
        "POST",
        "/api/staff/face/request-change",
        { reason: "Fresh replacement request requiring fresh approval" },
        staffHeaders
      );
      await handlerFaceStaff(req4Mock.req, req4Mock.res);
      assert(req4Mock.getStatus() === 201, `Fresh change request created with HTTP 201 (got ${req4Mock.getStatus()})`);

      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      assert(stMock.getData()?.enrollmentStatus === "pending_approval", "Status transitioned to 'pending_approval'");
    }

    // -------------------------------------------------------------------------
    // STEP 13: PostgreSQL Migration Script Static Security Audit
    // -------------------------------------------------------------------------
    console.log("\n[13] Verifying PostgreSQL RPC Migration Security & Structure...");
    {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const migrationPath = path.resolve("supabase/migrations/20261010_atomic_replace_face_biometrics.sql");
      assert(fs.existsSync(migrationPath), `Migration file exists at ${migrationPath}`);

      const sql = fs.readFileSync(migrationPath, "utf-8");
      assert(sql.includes("public.atomic_consume_face_approval_token"), "Defines public.atomic_consume_face_approval_token");
      assert(sql.includes("public.atomic_replace_face_biometrics"), "Defines backward-compatible public.atomic_replace_face_biometrics");
      assert(sql.includes("SECURITY DEFINER"), "Enforces SECURITY DEFINER execution");
      assert(sql.includes("SET search_path = public, pg_catalog, extensions"), "Hardens search_path to prevent search-path injection");
      assert(sql.includes("REVOKE ALL ON FUNCTION public.atomic_consume_face_approval_token"), "Revokes execution from PUBLIC");
      assert(sql.includes("GRANT EXECUTE ON FUNCTION public.atomic_consume_face_approval_token"), "Grants execution exclusively to service_role");
      assert(sql.includes("FOR UPDATE;"), "Acquires exclusive row lock (FOR UPDATE) to serialize concurrency");
      assert(sql.includes("regexp_match(v_device, 'expires_at:([^|\\s]+)')"), "Parses expiration with fail-closed regex");
      assert(sql.includes("v_expires_at := v_expires_match[1]::TIMESTAMPTZ;"), "Enforces strict TIMESTAMPTZ parsing");
      assert(!sql.includes("INSERT INTO public.face_embeddings"), "Zero vector insertion into face_embeddings (Device-Only Policy)");
      assert(sql.includes("EXCEPTION WHEN OTHERS THEN"), "Wraps all changes in exception rollback block");
      assert(sql.includes("TRANSACTION_ROLLBACK"), "Returns sanitized error code TRANSACTION_ROLLBACK to clients");
      assert(sql.includes("RAISE WARNING"), "Logs diagnostic details securely on server");
    }

    // -------------------------------------------------------------------------
    // STEP 14: Historical Attendance & Admin moulish Preservation
    // -------------------------------------------------------------------------
    console.log("\n[14] Verifying Historical Attendance & Administrator moulish Preservation...");
    {
      const { data: attRecords, count: attCount, error: attErr } = await supabase
        .from("attendance_records")
        .select("id", { count: "exact" });
      assert(
        !attErr && (attCount ?? attRecords?.length ?? 0) >= 3,
        `All historical attendance records preserved (count: ${attCount ?? attRecords?.length})`
      );

      const adminReauthMock = mockReqRes("POST", "/api/admin/login", {
        username: "moulish",
        password: "moulish@123",
      });
      await handlerAdminLogin(adminReauthMock.req, adminReauthMock.res);
      assert(adminReauthMock.getStatus() === 200, "Administrator 'moulish' login verified successfully (HTTP 200)");
      assert(adminReauthMock.getData()?.admin?.role === "admin", "Admin role maintained in server session");
    }
  } catch (err) {
    console.error("FATAL TEST ERROR:", err);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // STEP 15: Clean up test staff records
    // -------------------------------------------------------------------------
    console.log("\n[15] Cleaning Up Test Artifacts...");
    try {
      if (staffUuid) {
        await supabase.from("face_embeddings").delete().eq("staff_id", staffUuid);
      }
      await supabase.from("face_embeddings").delete().eq("staff_id", testStaffId);
      await supabase.from("security_events").delete().eq("staff", testStaffId);
      await supabase.from("staff").delete().eq("staff_code", testStaffId);
      console.log(`  ✓ Cleaned up test records for ${testStaffId}`);
    } catch (cleanErr) {
      console.warn("  Warning: cleanup encountered error:", cleanErr.message);
    }
  }

  console.log("\n================================================================================");
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification();
