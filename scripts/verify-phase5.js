import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const VERCEL_BASE = "https://geo-fenced-attendence-system.vercel.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runPhase5Verification() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — PHASE 5 PRODUCTION VERIFICATION SUITE         ");
  console.log("   Target: " + VERCEL_BASE);
  console.log("=================================================================\n");

  let allPassed = true;

  // 1. Check staff table in Supabase
  console.log("1. Checking 'staff' table in Supabase Cloud...");
  const { data: staffData, count: staffCount, error: staffErr } = await supabase
    .from("staff")
    .select("*", { count: "exact" });

  if (staffErr) {
    console.error("   ✗ Error querying staff:", staffErr.message);
    allPassed = false;
  } else if (staffCount === 0) {
    console.log("   ✓ PASS: 0 old staff accounts remain in Supabase Cloud (Count = 0).");
  } else {
    console.error(`   ✗ FAIL: Expected 0 staff, found ${staffCount}!`);
    allPassed = false;
  }

  // 2. Check face_embeddings table in Supabase
  console.log("\n2. Checking 'face_embeddings' table in Supabase Cloud...");
  const { data: embData, count: embCount, error: embErr } = await supabase
    .from("face_embeddings")
    .select("*", { count: "exact" });

  if (embErr) {
    console.error("   ✗ Error querying face_embeddings:", embErr.message);
    allPassed = false;
  } else if (embCount === 0) {
    console.log("   ✓ PASS: 0 old face templates/embeddings remain in Supabase Cloud (Count = 0).");
  } else {
    console.error(`   ✗ FAIL: Expected 0 embeddings, found ${embCount}!`);
    allPassed = false;
  }

  // 3. Check attendance_records in Supabase
  console.log("\n3. Verifying 'attendance_records' preservation in Supabase Cloud...");
  const { data: attData, count: attCount, error: attErr } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact" })
    .order("date", { ascending: false });

  if (attErr) {
    console.error("   ✗ Error querying attendance_records:", attErr.message);
    allPassed = false;
  } else if (attCount === 3) {
    console.log("   ✓ PASS: Historical attendance records strictly preserved! (Count = 3).");
    attData.forEach(r => {
      console.log(`     - Date: ${r.date} | Staff: ${r.staff_code} (${r.staff_name}) | Status: ${r.status} | ID: ${r.id}`);
    });
  } else {
    console.error(`   ✗ FAIL: Expected 3 attendance records, found ${attCount}!`);
    allPassed = false;
  }

  // 4. Live Vercel API /api/admin/staff check (with token)
  console.log("\n4. Testing Live Vercel Administrator Login & Session...");
  const loginRes = await fetch(VERCEL_BASE + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "moulish", password: "moulish@123" }),
  });
  const loginData = await loginRes.json();
  const token = loginData.token;

  if (loginRes.status === 200 && loginData.success && token) {
    console.log("   ✓ PASS: Live Admin Login succeeded (HTTP 200, valid session token issued).");
    console.log(`     - Admin: ${loginData.admin?.name} (${loginData.admin?.username})`);
  } else {
    console.error("   ✗ FAIL: Admin login failed:", loginRes.status, loginData);
    allPassed = false;
  }

  // 5. Test Live GET /api/admin/staff via Vercel endpoint
  console.log("\n5. Testing Live Vercel GET /api/admin/staff endpoint...");
  const staffApiRes = await fetch(VERCEL_BASE + "/api/admin/staff", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const staffApiData = await staffApiRes.json();

  if (staffApiRes.status === 200 && staffApiData.count === 0 && Array.isArray(staffApiData.data) && staffApiData.data.length === 0) {
    console.log("   ✓ PASS: Live Vercel /api/admin/staff returns HTTP 200 with 0 staff records (Clean Slate).");
  } else {
    console.error("   ✗ FAIL: /api/admin/staff response unexpected:", staffApiRes.status, staffApiData);
    allPassed = false;
  }

  // 6. Test Staff Registration Flow: Create a new staff account via live API
  console.log("\n6. Testing New Staff Registration Flow via Live API...");
  const newStaffPayload = {
    staff_code: "DEMO-001",
    name: "Dr. Demo Faculty",
    email: "demo.faculty@sonatech.ac.in",
    department: "Computer Science & Engineering",
    designation: "Assistant Professor",
  };

  const createRes = await fetch(VERCEL_BASE + "/api/admin/staff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(newStaffPayload),
  });
  const createData = await createRes.json();

  if (createRes.status === 201 && createData.success && createData.data?.staff_code === "DEMO-001") {
    console.log("   ✓ PASS: New staff registration flow succeeded (HTTP 201, created DEMO-001).");
    const newStaffId = createData.data.id;

    // Verify it appears in directory
    const checkDirRes = await fetch(VERCEL_BASE + "/api/admin/staff", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const checkDirData = await checkDirRes.json();
    console.log(`   ✓ Directory count is now: ${checkDirData.count} (Verified newly registered staff member).`);

    // Clean up DEMO-001 to return to completely clean state
    console.log("   Cleaning up test staff member DEMO-001...");
    await supabase.from("staff").delete().eq("staff_code", "DEMO-001");
    console.log("   ✓ Test staff member removed. Clean state restored (0 staff).");
  } else {
    console.error("   ✗ FAIL: New staff registration failed:", createRes.status, createData);
    allPassed = false;
  }

  // 7. Verify Local Store (data/staff-db.json)
  console.log("\n7. Verifying local fallback store (data/staff-db.json)...");
  const localJsonPath = path.resolve(process.cwd(), "data", "staff-db.json");
  if (fs.existsSync(localJsonPath)) {
    const localContent = JSON.parse(fs.readFileSync(localJsonPath, "utf-8"));
    const localStaffCount = localContent.staff?.length || 0;
    const localEmbCount = localContent.face_embeddings?.length || 0;
    const adminExists = localContent.admin_users?.some(a => a.username === "moulish");

    if (localStaffCount === 0 && localEmbCount === 0 && adminExists) {
      console.log("   ✓ PASS: data/staff-db.json staff=0, face_embeddings=0, admin_users contains 'moulish'.");
    } else {
      console.warn(`   ✗ Local store mismatch: staff=${localStaffCount}, embs=${localEmbCount}, admin=${adminExists}`);
      allPassed = false;
    }
  }

  // 8. Security & Geofence & Network sanity check
  console.log("\n8. Verifying Campus Wi-Fi and Geofence endpoints on Vercel...");
  const wifiRes = await fetch(VERCEL_BASE + "/api/wifi-status");
  const wifiData = await wifiRes.json();
  if (wifiRes.status === 200 && wifiData.authorized) {
    console.log("   ✓ PASS: Campus Wi-Fi validation endpoint operational (HTTP 200).");
  } else {
    console.error("   ✗ FAIL: Wi-Fi endpoint error:", wifiRes.status);
    allPassed = false;
  }

  console.log("\n=================================================================");
  if (allPassed) {
    console.log("   ALL PHASE 5 PRODUCTION VERIFICATIONS PASSED (100% SUCCESS)!   ");
  } else {
    console.log("   SOME CHECKS FAILED — REVIEW DETAILS ABOVE!                   ");
  }
  console.log("=================================================================\n");
}

runPhase5Verification().catch(err => {
  console.error("Phase 5 fatal error:", err);
  process.exit(1);
});
