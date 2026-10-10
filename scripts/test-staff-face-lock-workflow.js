/**
 * CampusAttend — Automated Verification Suite for Staff Face Enrollment & Permanent Lock Workflow
 *
 * Requirements Tested:
 * 1. Server-side session verification (zero client identity trust)
 * 2. Initial face enrollment for new staff (HTTP 201)
 * 3. Immediate permanent lock after initial save (isLocked: true)
 * 4. Server-enforced lock: Direct replacement rejected with HTTP 403 Forbidden
 * 5. Staff face change request submission with reason (HTTP 201)
 * 6. Duplicate pending change request rejection (HTTP 409)
 * 7. Admin face requests listing & pending count (HTTP 200)
 * 8. Admin rejection preserves approved embeddings (HTTP 200)
 * 9. Staff resubmission & Admin approval with single-use token (HTTP 200 + ftok_*)
 * 10. Single-use replacement save consumes token & immediately re-locks profile (HTTP 201)
 * 11. Consumed token reuse strictly rejected with HTTP 403 Forbidden
 * 12. Complete preservation of historical attendance records and Admin 'moulish' account
 * 13. Clean up test records
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
function mockReqRes(method, url, body = {}, headers = {}) {
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
    const val = Math.sin(seed * (i + 1)) * Math.cos((seed + 3) * (i + 2));
    vec.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

async function runVerification() {
  console.log("================================================================================");
  console.log("CAMPUSATTEND: STAFF FACE ENROLLMENT, PERMANENT LOCK & APPROVAL TEST SUITE");
  console.log("================================================================================");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffId = `STF-FLOCK-${testSuffix}`;
  const testPassword = `Pass#Lock${testSuffix}!`;
  let staffSessionToken = null;
  let adminSessionToken = null;
  let staffUuid = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Unauthenticated request rejection
    // -------------------------------------------------------------------------
    console.log("\n[1] Testing Server Session Verification & Identity Binding...");
    {
      const { req, res, getStatus, getData } = mockReqRes("GET", "/api/staff/face/status");
      await handlerFaceStaff(req, res);
      assert(getStatus() === 401, `Unauthenticated face status rejected with HTTP 401 (got ${getStatus()})`);
      assert(getData()?.error?.includes("session"), "Error correctly identifies missing session");
    }

    // -------------------------------------------------------------------------
    // STEP 2: Create test staff account & login
    // -------------------------------------------------------------------------
    console.log("\n[2] Creating Test Staff Account & Authenticating...");
    {
      const regMock = mockReqRes("POST", "/api/staff/register", {
        staffId: testStaffId,
        name: `Test Staff Lock ${testSuffix}`,
        department: "Computer Science",
        password: testPassword,
        confirmPassword: testPassword,
        sharedCreationPassword: "staff@123",
      });
      await handlerRegister(regMock.req, regMock.res);
      assert(regMock.getStatus() === 201, `Staff self-registration succeeded with HTTP 201 (got ${regMock.getStatus()})`);

      const loginMock = mockReqRes("POST", "/api/staff/login", {
        staffId: testStaffId,
        password: testPassword,
      });
      await handlerStaffLogin(loginMock.req, loginMock.res);
      assert(loginMock.getStatus() === 200, `Staff login succeeded with HTTP 200 (got ${loginMock.getStatus()})`);
      staffSessionToken = loginMock.getData()?.token;
      assert(Boolean(staffSessionToken), "Received valid server staff_session token");

      const { data: sRecord } = await supabase
        .from("staff")
        .select("id")
        .eq("staff_code", testStaffId)
        .single();
      staffUuid = sRecord?.id;
    }

    const staffHeaders = {
      authorization: `Bearer ${staffSessionToken}`,
    };

    // -------------------------------------------------------------------------
    // STEP 3: Initial status check (Not Registered)
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
    // STEP 4: Initial Face Registration Submission
    // -------------------------------------------------------------------------
    console.log("\n[4] Submitting Initial Face Registration (2 Samples)...");
    const initialEmbeddings = [
      {
        embedding: generateMockEmbedding(101),
        descriptor: generateMockEmbedding(101),
        photoData: "data:image/jpeg;base64,/9j/mockInitialSample1",
      },
      {
        embedding: generateMockEmbedding(102),
        descriptor: generateMockEmbedding(102),
        photoData: "data:image/jpeg;base64,/9j/mockInitialSample2",
      },
    ];

    {
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { samples: initialEmbeddings },
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
      const replacementAttempt = [
        {
          embedding: generateMockEmbedding(999),
          photoData: "data:image/jpeg;base64,/9j/mockTamperedSample",
        },
      ];
      const { req, res, getStatus, getData } = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        { samples: replacementAttempt },
        staffHeaders
      );
      await handlerFaceStaff(req, res);
      assert(getStatus() === 403, `Direct update strictly rejected with HTTP 403 Forbidden (got ${getStatus()})`);
      const data = getData();
      assert(
        data?.error?.includes("locked") && data?.error?.includes("administrator approval"),
        `Informative error message returned: "${data?.error}"`
      );

      // Verify database still has original 2 templates
      const { data: dbTemplates } = await supabase
        .from("face_embeddings")
        .select("id")
        .eq("staff_id", staffUuid);
      assert(dbTemplates?.length === 2, `Database templates untouched: exactly 2 exist (got ${dbTemplates?.length})`);
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
    // STEP 10: Admin Rejection preserves templates
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
      assert(dbTemplates?.length === 2, `Existing approved templates 100% intact after rejection (count: ${dbTemplates?.length})`);
    }

    // -------------------------------------------------------------------------
    // STEP 11: Resubmission & Admin Approval (Single-Use Token)
    // -------------------------------------------------------------------------
    console.log("\n[11] Staff Resubmission & Admin Approval with Single-Use Token...");
    let oneTimeToken = null;
    {
      const newReqMock = mockReqRes(
        "POST",
        "/api/staff/face/request-change",
        { reason: "Updated with clean high-contrast facial lighting" },
        staffHeaders
      );
      await handlerFaceStaff(newReqMock.req, newReqMock.res);
      assert(newReqMock.getStatus() === 201, `New request created with HTTP 201 (got ${newReqMock.getStatus()})`);
      const requestId2 = newReqMock.getData()?.requestId;

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
    // STEP 12: Single-Use Replacement Save Consumes Token & Re-locks
    // -------------------------------------------------------------------------
    console.log("\n[12] Saving Replacement Face with One-Time Token...");
    const replacementSamples = [
      {
        embedding: generateMockEmbedding(201),
        descriptor: generateMockEmbedding(201),
        photoData: "data:image/jpeg;base64,/9j/mockApprovedReplacement1",
      },
      {
        embedding: generateMockEmbedding(202),
        descriptor: generateMockEmbedding(202),
        photoData: "data:image/jpeg;base64,/9j/mockApprovedReplacement2",
      },
      {
        embedding: generateMockEmbedding(203),
        descriptor: generateMockEmbedding(203),
        photoData: "data:image/jpeg;base64,/9j/mockApprovedReplacement3",
      },
    ];

    {
      const enrollMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          samples: replacementSamples,
          oneTimeToken: oneTimeToken,
        },
        staffHeaders
      );
      await handlerFaceStaff(enrollMock.req, enrollMock.res);
      assert(
        enrollMock.getStatus() === 200 || enrollMock.getStatus() === 201,
        `Replacement save succeeded with HTTP 200/201 (got ${enrollMock.getStatus()})`
      );
      const repData = enrollMock.getData();
      assert(repData?.success === true, "Replacement save indicated success: true");
      assert(repData?.count === 3, `Saved exactly 3 replacement samples (got ${repData?.count})`);
      assert(repData?.isLocked === true, "Profile immediately re-locked (isLocked: true)");

      // Check database: old 2 embeddings replaced by new 3
      const { data: dbTemplates } = await supabase
        .from("face_embeddings")
        .select("id")
        .eq("staff_id", staffUuid);
      assert(dbTemplates?.length === 3, `Database now holds exactly 3 updated embeddings (got ${dbTemplates?.length})`);

      // Verify status check shows locked and canSaveReplacement false
      const stMock = mockReqRes("GET", "/api/staff/face/status", {}, staffHeaders);
      await handlerFaceStaff(stMock.req, stMock.res);
      const stData = stMock.getData();
      assert(stData?.isLocked === true, "Status reports isLocked: true");
      assert(stData?.canSaveReplacement === false, "canSaveReplacement is false");
      assert(!stData?.oneTimeToken, "oneTimeToken is no longer present");
    }

    // -------------------------------------------------------------------------
    // STEP 13: Attempt to Reuse Consumed Token (Strict Rejection HTTP 403)
    // -------------------------------------------------------------------------
    console.log("\n[13] Testing Strict Rejection on Consumed Token Reuse...");
    {
      const reattemptMock = mockReqRes(
        "POST",
        "/api/staff/face/enroll",
        {
          samples: replacementSamples,
          oneTimeToken: oneTimeToken,
        },
        staffHeaders
      );
      await handlerFaceStaff(reattemptMock.req, reattemptMock.res);
      assert(reattemptMock.getStatus() === 403, `Reuse attempt rejected with HTTP 403 (got ${reattemptMock.getStatus()})`);
      const err = reattemptMock.getData()?.error;
      assert(
        err?.includes("consumed") || err?.includes("expired") || err?.includes("locked"),
        `Informative token rejection error: "${err}"`
      );
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
        !attErr && (attCount ?? attRecords?.length ?? 0) === 3,
        `All 3 historical attendance records preserved (count: ${attCount ?? attRecords?.length})`
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
