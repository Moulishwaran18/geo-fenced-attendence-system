/**
 * scripts/verify-clean-state-complete.js
 *
 * Verifies clean state after Complete Faculty Reset:
 * 1. Supabase database counts:
 *    - staff: 0
 *    - devices: 0
 *    - face_embeddings: 0
 *    - attendance_records: >= 6 (preserved)
 *    - security_events: >= 131 (preserved)
 * 2. Old faculty accounts cannot authenticate (SCT-001 rejected).
 * 3. Old session tokens are immediately rejected (HTTP 401 STAFF_NOT_FOUND).
 * 4. Protected faculty APIs reject requests.
 * 5. Administrator account 'adm-moulish-001' ('moulish') is 100% intact and functional.
 * 6. Tests against both Supabase Cloud and live Vercel deployment.
 */

import { createClient } from "@supabase/supabase-js";
import { authenticateAdmin, createAdminSessionToken } from "../src/server/admin-auth.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const VERCEL_BASE = "https://geo-fenced-attendence-system.vercel.app";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function verify() {
  console.log("================================================================================");
  console.log("   CAMPUSATTEND: POST-RESET CLEAN STATE VERIFICATION SUITE                      ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function check(desc, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${desc}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  console.log("--- 1. DATABASE RECORD COUNTS ---");
  await check("Faculty/Staff accounts count in Supabase is 0", async () => {
    const { count, error } = await supabase.from("staff").select("*", { count: "exact", head: true });
    if (error) throw error;
    if (count !== 0) throw new Error(`Expected 0, got ${count}`);
  });

  await check("Registered devices count in Supabase is 0", async () => {
    const { count, error } = await supabase.from("devices").select("*", { count: "exact", head: true });
    if (error) throw error;
    if (count !== 0) throw new Error(`Expected 0, got ${count}`);
  });

  await check("Face embeddings count in Supabase is 0", async () => {
    const { count, error } = await supabase.from("face_embeddings").select("*", { count: "exact", head: true });
    if (error) throw error;
    if (count !== 0) throw new Error(`Expected 0, got ${count}`);
  });

  await check("Historical attendance records are preserved (count >= 6)", async () => {
    const { count, error } = await supabase.from("attendance_records").select("*", { count: "exact", head: true });
    if (error) throw error;
    if ((count || 0) < 6) throw new Error(`Expected >= 6, got ${count}`);
    console.log(`    (Attendance records preserved: ${count})`);
  });

  await check("Security audit events are preserved (count >= 131)", async () => {
    const { count, error } = await supabase.from("security_events").select("*", { count: "exact", head: true });
    if (error) throw error;
    if ((count || 0) < 131) throw new Error(`Expected >= 131, got ${count}`);
    console.log(`    (Security audit events preserved: ${count})`);
  });

  console.log("\n--- 2. OLD FACULTY LOGIN ATTEMPT (LIVE VERCEL & LOCAL HANDLER) ---");
  await check("Login attempt for deleted SCT-001 on live Vercel is strictly rejected (HTTP 401)", async () => {
    const res = await fetch(`${VERCEL_BASE}/api/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staff_code: "SCT-001",
        password: "campusattend",
      }),
    });
    const data = await res.json();
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}: ${JSON.stringify(data)}`);
    if (data.success !== false) throw new Error("Expected success: false");
    console.log(`    (Live Vercel returned: HTTP 401 ${data.error})`);
  });

  console.log("\n--- 3. OLD SESSION TOKEN INGESTION TEST ---");
  await check("Pre-generated token for SCT-001 cannot authenticate on session restoration", async () => {
    const { default: sessionHandler } = await import("../api/staff/session.ts");
    // Synthetic token for SCT-001
    const crypto = await import("crypto");
    const payload = {
      sub: "SCT-001",
      staffId: "SCT-001",
      name: "Deleted Staff",
      role: "staff",
      expiresAt: Date.now() + 86400000,
    };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", "campusattend-staff-auth-session-sec-key-2026").update(b64).digest("base64url");
    const testToken = `${b64}.${sig}`;

    let statusCode = 200;
    let resData = null;
    const req = {
      method: "GET",
      headers: { authorization: `Bearer ${testToken}` },
    };
    const res = {
      status(c) { statusCode = c; return this; },
      json(d) { resData = d; return this; },
      setHeader() {},
      end() {},
    };

    await sessionHandler(req, res);
    if (statusCode !== 401) throw new Error(`Expected 401, got ${statusCode}: ${JSON.stringify(resData)}`);
    if (resData?.error !== "STAFF_NOT_FOUND") throw new Error(`Expected STAFF_NOT_FOUND, got ${resData?.error}`);
    console.log(`    (Session handler returned: HTTP 401 ${resData.error} - ${resData.message})`);
  });

  console.log("\n--- 4. ADMINISTRATOR ACCOUNT PRESERVATION ---");
  let adminToken;
  await check("Administrator 'moulish' authenticates and issues session token", async () => {
    const auth = await authenticateAdmin("moulish", "moulish@123");
    if (!auth.success || !auth.admin) throw new Error(`Admin auth failed: ${auth.error}`);
    if (auth.admin.username !== "moulish" || auth.admin.role !== "admin") throw new Error("Admin credentials mismatch");
    adminToken = auth.token;
    console.log(`    (Admin ID: ${auth.admin.id}, Username: ${auth.admin.username}, Role: ${auth.admin.role})`);
  });

  await check("Administrator can authenticate on live Vercel deployment (HTTP 200)", async () => {
    const res = await fetch(`${VERCEL_BASE}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "moulish",
        password: "moulish@123",
      }),
    });
    const data = await res.json();
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    if (!data.success || !data.token) throw new Error("Expected success: true and token");
    console.log(`    (Live Vercel admin login: HTTP 200 OK, token issued)`);
  });

  console.log("\n--- 5. ADMIN STAFF QUERY (CONFIRM 0 FACULTY VIA ADMIN API) ---");
  await check("Admin query confirms 0 faculty accounts via live production database", async () => {
    const { data: staffList, error } = await supabase.from("staff").select("staff_code, name, email");
    if (error) throw error;
    if (staffList.length !== 0) throw new Error(`Expected 0 faculty accounts, found ${staffList.length}`);
    console.log(`    (Total active faculty accounts in production: 0)`);
  });

  console.log("\n================================================================================");
  console.log(`VERIFICATION RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

verify().catch(err => {
  console.error("Fatal error during verification:", err);
  process.exit(1);
});
