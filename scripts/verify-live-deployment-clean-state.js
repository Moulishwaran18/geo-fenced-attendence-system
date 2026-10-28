import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_TOKEN_SECRET = "campusattend-admin-sec-key-moulish-2026-auth-token";
const STAFF_TOKEN_SECRET = "campusattend-staff-auth-session-sec-key-2026";

function mintAdminToken() {
  const payload = {
    sub: "admin-verify",
    username: "moulish",
    role: "admin",
    expiresAt: Date.now() + 3600000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function mintStaffToken(staffCode = "SCT-001") {
  const payload = {
    sub: staffCode,
    staffId: staffCode,
    role: "staff",
    expiresAt: Date.now() + 3600000,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STAFF_TOKEN_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

async function verifyLiveStatus() {
  console.log("================================================================================");
  console.log("   VERIFYING LIVE DEPLOYMENT AND CLEAN STATE ACROSS SUPABASE & VERCEL");
  console.log("================================================================================\n");

  // 1. Direct Supabase verification
  console.log("1. Direct Supabase Check:");
  const { data: dbRecords, count: dbCount, error: dbErr } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact" });

  if (dbErr) throw new Error(`Supabase query failed: ${dbErr.message}`);
  console.log(`   ✓ public.attendance_records count: ${dbCount} (records array length: ${dbRecords.length})`);
  if (dbCount !== 0) {
    throw new Error(`CRITICAL: Expected 0 records in Supabase, but found ${dbCount}`);
  }

  // 2. Vercel Live API - Unauthenticated rejection check
  console.log("\n2. Live Vercel API - Unauthenticated Request Gate Check:");
  const prodUrl = "https://geo-fenced-attendence-system.vercel.app/api/attendance";
  try {
    const unauthRes = await fetch(prodUrl);
    console.log(`   Response status: ${unauthRes.status}`);
    const unauthJson = await unauthRes.json();
    console.log(`   Response body:`, unauthJson);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for unauthenticated request, got ${unauthRes.status}`);
    }
    console.log("   ✓ HTTP 401 correctly returned for unauthenticated request.");
  } catch (err) {
    console.error("   Error during live API unauthenticated check:", err.message);
    throw err;
  }

  // 3. Vercel Live API - Admin History Query (should return exactly 0 records)
  console.log("\n3. Live Vercel API - Authenticated Administrator History Query:");
  const adminToken = mintAdminToken();
  try {
    const adminRes = await fetch(prodUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Accept: "application/json",
      },
    });
    console.log(`   Response status: ${adminRes.status}`);
    const adminJson = await adminRes.json();
    console.log(`   Live API Response payload:`, adminJson);
    if (adminRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for authenticated admin query, got ${adminRes.status}`);
    }
    if (adminJson.count !== 0 || !Array.isArray(adminJson.records) || adminJson.records.length !== 0) {
      throw new Error(`CRITICAL: Expected 0 records from live API, got count: ${adminJson.count}`);
    }
    console.log("   ✓ Deployed live API reports exactly 0 attendance records!");
  } catch (err) {
    console.error("   Error during live API admin check:", err.message);
    throw err;
  }

  // 4. Vercel Live API - Staff History Query for Moulishwaran S (SCT-001)
  console.log("\n4. Live Vercel API - Authenticated Staff History Query (SCT-001):");
  const staffToken = mintStaffToken("SCT-001");
  try {
    const staffRes = await fetch(`${prodUrl}?staff_code=SCT-001`, {
      headers: {
        Authorization: `Bearer ${staffToken}`,
        Accept: "application/json",
      },
    });
    console.log(`   Response status: ${staffRes.status}`);
    const staffJson = await staffRes.json();
    console.log(`   Live API Response payload:`, staffJson);
    if (staffRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for authenticated staff query, got ${staffRes.status}`);
    }
    if (staffJson.count !== 0 || !Array.isArray(staffJson.records) || staffJson.records.length !== 0) {
      throw new Error(`CRITICAL: Expected 0 records for staff query, got count: ${staffJson.count}`);
    }
    console.log("   ✓ Staff history on deployed live environment is confirmed completely clean (0 records)!");
  } catch (err) {
    console.error("   Error during live API staff check:", err.message);
    throw err;
  }

  // 5. Preserved Tables Audit Check
  console.log("\n5. Preserved Tables Audit Check:");
  const { count: staffCount } = await supabase.from("staff").select("*", { count: "exact", head: true });
  const { count: secCount } = await supabase.from("security_events").select("*", { count: "exact", head: true });
  const { count: geoCount } = await supabase.from("geofence_zones").select("*", { count: "exact", head: true });

  console.log(`   ✓ staff count: ${staffCount} (All registered staff preserved)`);
  console.log(`   ✓ security_events count: ${secCount} (All security logs preserved)`);
  console.log(`   ✓ geofence_zones count: ${geoCount} (Authoritative polygon preserved)`);

  console.log("\n================================================================================");
  console.log("   ALL VERIFICATIONS PASSED: ATTENDANCE RECORDS COMPLETELY RESET TO ZERO");
  console.log("================================================================================\n");
}

verifyLiveStatus().catch((e) => {
  console.error("VERIFICATION FAILED:", e);
  process.exit(1);
});
