/**
 * CampusAttend — Live Production End-to-End Verification
 * Target: https://geo-fenced-attendence-system.vercel.app
 */

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "https://geo-fenced-attendence-system.vercel.app";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runLiveVerification() {
  console.log("===============================================================================");
  console.log(" CAMPUSATTEND: LIVE VERCEL PRODUCTION VERIFICATION SUITE");
  console.log(` Target: ${BASE_URL}`);
  console.log("===============================================================================\n");

  const testSuffix = Math.floor(1000 + Math.random() * 9000);
  const testStaffCode = `STF-LIVE-${testSuffix}`;
  const testStaffPass = `ProdPass@${testSuffix}`;
  let staffToken = null;
  let adminToken = null;
  let activeRequestId = null;
  let oneTimeToken = null;

  try {
    // 1. Staff Registration
    console.log(`[1] Registering test staff ${testStaffCode} on production...`);
    const regRes = await fetch(`${BASE_URL}/api/staff/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: testStaffCode,
        name: `Live Test Staff ${testSuffix}`,
        email: `live.test.${testSuffix}@sonatech.ac.in`,
        department: "Computer Science & Engineering",
        password: testStaffPass,
        confirmPassword: testStaffPass,
        registrationCode: "staff@123",
      }),
    });
    const regData = await regRes.json();
    console.log(`    Status: ${regRes.status}, Success: ${regData.success}`);
    if (regRes.status !== 201) throw new Error(`Registration failed: ${JSON.stringify(regData)}`);

    // 2. Staff Login
    console.log(`[2] Authenticating test staff ${testStaffCode}...`);
    const loginRes = await fetch(`${BASE_URL}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: testStaffCode,
        password: testStaffPass,
      }),
    });
    const loginData = await loginRes.json();
    staffToken = loginData.token;
    console.log(`    Status: ${loginRes.status}, Token: ${Boolean(staffToken)}`);
    if (!staffToken) throw new Error(`Staff login failed: ${JSON.stringify(loginData)}`);

    const staffHeaders = {
      Authorization: `Bearer ${staffToken}`,
      "Content-Type": "application/json",
    };

    // 3. Initial Baseline Enrollment
    console.log(`[3] Enrolling initial face profile on production...`);
    const initRes = await fetch(`${BASE_URL}/api/staff/face/enroll`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        deviceId: "android-hw-live-device-01",
        templateCount: 3,
      }),
    });
    const initData = await initRes.json();
    console.log(`    Status: ${initRes.status}, isLocked: ${initData.isLocked}`);
    if (initRes.status !== 201) throw new Error(`Initial enroll failed: ${JSON.stringify(initData)}`);

    // 4. Submit Face Change Request (The button action being fixed!)
    console.log(`[4] Submitting face change request from staff to administrator...`);
    const reqRes = await fetch(`${BASE_URL}/api/staff/face/request-change`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        reason: "New glasses and hairstyle require updated face biometric reference",
        deviceId: "android-hw-live-device-01",
        sampleCount: 3,
      }),
    });
    const reqData = await reqRes.json();
    activeRequestId = reqData.requestId;
    console.log(`    Status: ${reqRes.status}, RequestId: ${activeRequestId}, Success: ${reqData.success}`);
    if (reqRes.status !== 201 || !activeRequestId) throw new Error(`Change request failed: ${JSON.stringify(reqData)}`);

    // 5. Verify Pending Status on Staff Side
    console.log(`[5] Verifying staff status reflects pending request...`);
    const stPendingRes = await fetch(`${BASE_URL}/api/staff/face/status`, {
      headers: staffHeaders,
    });
    const stPendingData = await stPendingRes.json();
    console.log(`    EnrollmentStatus: ${stPendingData.enrollmentStatus}, hasPending: ${stPendingData.hasPendingRequest}`);
    if (!stPendingData.hasPendingRequest) throw new Error("Staff status does not show pending request");

    // 6. Administrator Login
    console.log(`[6] Authenticating administrator 'moulish' on production...`);
    const adminLoginRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "moulish",
        password: "moulish@123",
      }),
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.token;
    console.log(`    Status: ${adminLoginRes.status}, AdminToken: ${Boolean(adminToken)}`);
    if (!adminToken) throw new Error(`Admin login failed: ${JSON.stringify(adminLoginData)}`);

    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    };

    // 7. Administrator Review List
    console.log(`[7] Administrator querying pending face requests...`);
    const adminListRes = await fetch(`${BASE_URL}/api/admin/face-requests`, {
      headers: adminHeaders,
    });
    const adminListData = await adminListRes.json();
    const foundReq = (adminListData.requests || []).find((r) => r.id === activeRequestId);
    console.log(`    Total: ${adminListData.count}, Found Test Request: ${Boolean(foundReq)}, Status: ${foundReq?.status}`);
    if (!foundReq) throw new Error(`Test request ${activeRequestId} not found in admin list`);

    // 8. Administrator Approval & Token Minting
    console.log(`[8] Administrator approving request ${activeRequestId}...`);
    const approveRes = await fetch(`${BASE_URL}/api/admin/face-requests/${activeRequestId}/approve`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        adminNotes: "Identity and reason verified by administrator. Approved for replacement.",
      }),
    });
    const approveData = await approveRes.json();
    oneTimeToken = approveData.oneTimeToken;
    console.log(`    Status: ${approveRes.status}, Token: ${oneTimeToken}`);
    if (approveRes.status !== 200 || !oneTimeToken) throw new Error(`Approval failed: ${JSON.stringify(approveData)}`);

    // 9. Staff Polls & Detects Approval
    console.log(`[9] Staff polling status to detect administrator approval...`);
    const stApprovedRes = await fetch(`${BASE_URL}/api/staff/face/status`, {
      headers: staffHeaders,
    });
    const stApprovedData = await stApprovedRes.json();
    console.log(`    canSaveReplacement: ${stApprovedData.canSaveReplacement}, Token delivered: ${stApprovedData.oneTimeToken === oneTimeToken}`);
    if (!stApprovedData.canSaveReplacement || stApprovedData.oneTimeToken !== oneTimeToken) {
      throw new Error("Staff status does not show approval token");
    }

    // 10. Staff Executes Replacement Enrollment with One-Time Token
    console.log(`[10] Staff submitting replacement enrollment with single-use token...`);
    const replaceRes = await fetch(`${BASE_URL}/api/staff/face/enroll`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        deviceId: "android-hw-live-device-01",
        templateCount: 3,
        oneTimeToken: oneTimeToken,
      }),
    });
    const replaceData = await replaceRes.json();
    console.log(`    Status: ${replaceRes.status}, isLocked: ${replaceData.isLocked}, Message: ${replaceData.message}`);
    if (replaceRes.status !== 200 || !replaceData.isLocked) throw new Error(`Replacement enrollment failed: ${JSON.stringify(replaceData)}`);

    // 11. Verify Profile Re-locked & Token Consumed
    console.log(`[11] Verifying profile is permanently re-locked and token is consumed...`);
    const finalStRes = await fetch(`${BASE_URL}/api/staff/face/status`, {
      headers: staffHeaders,
    });
    const finalStData = await finalStRes.json();
    console.log(`    isLocked: ${finalStData.isLocked}, canSaveReplacement: ${finalStData.canSaveReplacement}, Token cleared: ${!finalStData.oneTimeToken}`);
    if (!finalStData.isLocked || finalStData.canSaveReplacement || finalStData.oneTimeToken) {
      throw new Error("Profile not re-locked or token not cleared after consumption");
    }

    // 12. Token Reuse Strictly Rejected
    console.log(`[12] Verifying consumed token cannot be reused...`);
    const reuseRes = await fetch(`${BASE_URL}/api/staff/face/enroll`, {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        deviceId: "android-hw-live-device-01",
        templateCount: 3,
        oneTimeToken: oneTimeToken,
      }),
    });
    const reuseData = await reuseRes.json();
    console.log(`    Status: ${reuseRes.status}, Code: ${reuseData.code}`);
    if (reuseRes.status !== 403 || reuseData.code !== "INVALID_OR_CONSUMED_TOKEN") {
      throw new Error("Consumed token reuse was not rejected with 403 INVALID_OR_CONSUMED_TOKEN");
    }

    console.log("\n===============================================================================");
    console.log(" SUCCESS: ALL 12 LIVE PRODUCTION WORKFLOW STEPS PASSED PERFECTLY!");
    console.log("===============================================================================\n");

  } catch (err) {
    console.error("\nFATAL ERROR DURING LIVE VERIFICATION:", err);
    process.exit(1);
  } finally {
    console.log(`[Cleanup] Cleaning up test records for ${testStaffCode}...`);
    await supabase.from("security_events").delete().eq("staff", testStaffCode);
    await supabase.from("staff").delete().eq("staff_code", testStaffCode);
    console.log("    Done.");
  }
}

runLiveVerification();
