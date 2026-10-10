import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const APPROVED_STAFF_IDS = [
  "b312d321-385b-4bf1-868e-b5ff73edafa7", // PERSON_002
  "33e001fb-4e74-4445-a28a-27c1f6e1030b", // PERSON_003
  "caaea7ab-2d36-4dff-87db-e55e480959e4", // SCT-2417
  "aeb5720b-ec72-4653-ba88-61f08c35201d", // SCT-2418
  "664ab7fa-857d-4878-a154-73968837c00a", // PERSON_001
];

async function withRetry(operation, retries = 4, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      console.warn(`   [Attempt ${attempt}/${retries}] Request error: ${err.message}. Retrying in ${delayMs}ms...`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

async function executeSafeReset() {
  console.log("=================================================================");
  console.log("   PHASE 4: EXECUTING SAFE PRODUCTION RESET                     ");
  console.log("=================================================================\n");

  // Step 1: Pre-reset validation
  console.log("Step 1: Checking pre-reset attendance records count...");
  const { data: preAtt, count: preAttCount } = await withRetry(async () => {
    const res = await supabase
      .from("attendance_records")
      .select("id, staff_code, date", { count: "exact" });
    if (res.error) throw new Error(res.error.message);
    return res;
  });

  console.log(`   ✓ Found ${preAttCount} attendance records before deletion.`);

  // Step 2: Delete cloud face templates & enrollment samples
  console.log("\nStep 2: Deleting cloud face_embeddings for approved staff...");
  const { data: delEmbs } = await withRetry(async () => {
    const res = await supabase
      .from("face_embeddings")
      .delete()
      .in("staff_id", APPROVED_STAFF_IDS)
      .select("id, staff_id");
    if (res.error) throw new Error(res.error.message);
    return res;
  });

  console.log(`   ✓ Successfully deleted ${delEmbs ? delEmbs.length : 0} face embedding records.`);

  // Step 3: Delete approved staff records
  console.log("\nStep 3: Deleting approved staff records from 'staff' table...");
  const { data: delStaff } = await withRetry(async () => {
    const res = await supabase
      .from("staff")
      .delete()
      .in("id", APPROVED_STAFF_IDS)
      .select("id, staff_code, name");
    if (res.error) throw new Error(res.error.message);
    return res;
  });

  console.log(`   ✓ Successfully deleted ${delStaff ? delStaff.length : 0} staff records:`);
  (delStaff || []).forEach(s => {
    console.log(`     - [${s.staff_code}] ${s.name} (${s.id})`);
  });

  // Step 4: Attendance preservation verification
  console.log("\nStep 4: Verifying attendance records were strictly PRESERVED...");
  const { data: postAtt, count: postAttCount } = await withRetry(async () => {
    const res = await supabase
      .from("attendance_records")
      .select("id, staff_code, date", { count: "exact" });
    if (res.error) throw new Error(res.error.message);
    return res;
  });

  console.log(`   ✓ Found ${postAttCount} attendance records after deletion.`);
  if (postAttCount !== preAttCount) {
    throw new Error(`CRITICAL INTEGRITY FAILURE: Attendance count changed from ${preAttCount} to ${postAttCount}!`);
  }
  console.log("   ✓ ZERO CASCADE CONFIRMED: All historical attendance records intact.");

  // Step 5: Clean local offline fallback store (data/staff-db.json)
  console.log("\nStep 5: Updating local fallback store (data/staff-db.json)...");
  const localJsonPath = path.resolve(process.cwd(), "data", "staff-db.json");
  if (fs.existsSync(localJsonPath)) {
    try {
      const localData = JSON.parse(fs.readFileSync(localJsonPath, "utf-8"));
      localData.staff = [];
      localData.face_embeddings = [];
      // Keep admin_users
      if (!Array.isArray(localData.admin_users) || localData.admin_users.length === 0) {
        localData.admin_users = [{
          id: "adm-moulish-001",
          username: "moulish",
          name: "Moulishwaran S",
          email: "moulish@sonatech.ac.in",
          role: "admin",
          password_hash: "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
          salt: "9793e19a6e61abd07d646d6a7e5b5a29",
          active: true,
          created_at: "2026-10-10T05:42:11.916Z",
          updated_at: "2026-10-10T05:42:11.916Z"
        }];
      }
      fs.writeFileSync(localJsonPath, JSON.stringify(localData, null, 2), "utf-8");
      console.log("   ✓ Local data/staff-db.json staff and face_embeddings reset to []. Admin account preserved.");
    } catch (err) {
      console.warn("   Notice: Could not write data/staff-db.json:", err.message);
    }
  }

  console.log("\n=================================================================");
  console.log("   SAFE RESET EXECUTION COMPLETE!                               ");
  console.log("=================================================================\n");
}

executeSafeReset().catch(err => {
  console.error("\nFATAL ERROR DURING SAFE RESET:", err);
  process.exit(1);
});
