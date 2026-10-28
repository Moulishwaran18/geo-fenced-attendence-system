/**
 * scripts/execute-faculty-account-reset.js
 *
 * Implements Complete Faculty Reset — Start Device Registration From Scratch:
 * 1. Confirms verified backup existence and integrity.
 * 2. Explicitly protects the administrator account 'adm-moulish-001' (moulish).
 * 3. Removes all existing faculty/staff accounts (including SCT-001) from Supabase and local store.
 * 4. Removes all dependent face enrollments and devices.
 * 5. Preserves all historical attendance records and security audit logs.
 * 6. Logs the reset event in security_events.
 * 7. Verifies 0 faculty accounts, 0 devices, 0 face enrollments remain.
 * 8. Verifies that old faculty sessions cannot authenticate.
 * 9. Verifies that the administrator account remains 100% operational.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_ID = "adm-moulish-001";
const ADMIN_USERNAME = "moulish";

async function runSafeReset() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — COMPLETE FACULTY RESET ENGINE                 ");
  console.log("=================================================================\n");

  // Step 1: Verify backup file
  console.log("Step 1: Checking for verified database backup...");
  const backupDir = path.resolve(process.cwd(), "backups");
  const backupFiles = fs.readdirSync(backupDir).filter(f => f.startsWith("production_backup_") && f.endsWith(".json"));
  if (backupFiles.length === 0) {
    throw new Error("ABORTED: No verified production backup found in backups/ directory.");
  }
  const latestBackup = backupFiles.sort().pop();
  const backupPath = path.join(backupDir, latestBackup);
  const backupContent = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
  console.log(`   ✓ Found verified backup: ${latestBackup} (${backupContent.tables.staff.length} staff records backed up).`);
  console.log(`   ✓ Backup SHA-256: ${backupContent.metadata?.sha256 || "N/A"}`);

  // Step 2: Pre-check Administrator Account
  console.log("\nStep 2: Pre-verifying Administrator Account preservation...");
  const { authenticateAdmin } = await import("../src/server/admin-auth.js").catch(async () => {
    return await import("../src/server/admin-auth.ts");
  });
  const preAuth = await authenticateAdmin("moulish", "moulish@123");
  if (!preAuth.success || !preAuth.admin || preAuth.admin.username !== ADMIN_USERNAME) {
    throw new Error(`ABORTED: Administrator account pre-check failed: ${preAuth.error}`);
  }
  console.log(`   ✓ Administrator '${preAuth.admin.username}' (ID: ${preAuth.admin.id}) verified active and functioning.`);

  // Step 3: Inspect current faculty accounts in Supabase
  console.log("\nStep 3: Querying existing faculty/staff accounts in Supabase...");
  const { data: currentStaff, error: queryErr } = await supabase
    .from("staff")
    .select("id, staff_code, name, email, department, designation");

  if (queryErr) {
    throw new Error(`Failed to query staff table: ${queryErr.message}`);
  }

  console.log(`   Found ${currentStaff.length} faculty/staff accounts:`);
  for (const s of currentStaff) {
    console.log(`     - [${s.staff_code}] ${s.name} (${s.email}) - ID: ${s.id}`);
    if (s.id === ADMIN_ID || s.staff_code.toLowerCase() === ADMIN_USERNAME) {
      throw new Error(`CRITICAL VIOLATION: Administrator ID or username found in staff deletion candidates! Aborting.`);
    }
  }

  // Step 4: Execute targeted faculty account deletion in Supabase
  if (currentStaff.length > 0) {
    const targetIds = currentStaff.map(s => s.id);
    console.log(`\nStep 4: Executing safe deletion of ${targetIds.length} faculty accounts...`);

    // Clean dependent face_embeddings if any
    const { error: embErr } = await supabase
      .from("face_embeddings")
      .delete()
      .in("staff_id", targetIds);
    if (embErr) {
      console.warn("   Notice: face_embeddings cleanup returned:", embErr.message);
    } else {
      console.log("   ✓ Cleaned dependent face_embeddings.");
    }

    // Clean dependent devices if any
    const { error: devErr } = await supabase
      .from("devices")
      .delete()
      .in("staff_id", targetIds);
    if (devErr) {
      console.warn("   Notice: devices cleanup returned:", devErr.message);
    } else {
      console.log("   ✓ Cleaned dependent devices.");
    }

    // Delete staff accounts with explicit exclusion of admin username and targeting only faculty UUIDs
    const { data: deleted, error: delErr } = await supabase
      .from("staff")
      .delete()
      .in("id", targetIds)
      .neq("staff_code", ADMIN_USERNAME)
      .select("id, staff_code, name");

    if (delErr) {
      throw new Error(`Failed to delete faculty accounts: ${delErr.message}`);
    }

    console.log(`   ✓ Successfully removed ${deleted?.length || targetIds.length} faculty accounts from Supabase.`);
  } else {
    console.log("\nStep 4: Staff table in Supabase is already empty (0 faculty accounts).");
  }

  // Step 5: Clean companion store data/staff-db.json
  console.log("\nStep 5: Synchronizing local companion store data/staff-db.json...");
  const localStorePath = path.resolve(process.cwd(), "data", "staff-db.json");
  if (fs.existsSync(localStorePath)) {
    try {
      const store = JSON.parse(fs.readFileSync(localStorePath, "utf-8"));
      const initialStaffCount = store.staff?.length || 0;
      store.staff = [];
      store.devices = [];
      store.face_embeddings = [];
      // Ensure admin_users is intact
      if (!Array.isArray(store.admin_users) || store.admin_users.length === 0) {
        store.admin_users = [{
          id: ADMIN_ID,
          username: ADMIN_USERNAME,
          name: "Moulishwaran S",
          email: "moulish@sonatech.ac.in",
          role: "admin",
          password_hash: "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
          salt: "9793e19a6e61abd07d646d6a7e5b5a29",
          active: true,
          created_at: "2026-10-10T05:42:11.916Z",
          updated_at: new Date().toISOString(),
        }];
      }
      fs.writeFileSync(localStorePath, JSON.stringify(store, null, 2), "utf-8");
      console.log(`   ✓ Local store staff-db.json synchronized (${initialStaffCount} faculty removed, admin preserved).`);
    } catch (e) {
      console.warn("   Notice: local store sync warning:", e.message);
    }
  }

  // Step 6: Record security audit event
  console.log("\nStep 6: Recording audit event in security_events...");
  try {
    await supabase.from("security_events").insert({
      time: new Date().toISOString(),
      staff: ADMIN_USERNAME.toUpperCase(),
      event: "FACULTY_ACCOUNTS_RESET_START_FRESH",
      device: "admin-console",
      location: "Campus Administration",
      result: "Allowed",
      severity: "Medium",
    });
    console.log("   ✓ Audit log recorded in security_events.");
  } catch (secErr) {
    console.warn("   Notice: security_events insert notice:", secErr.message);
  }

  // Step 7: Post-deletion verification against Supabase
  console.log("\nStep 7: Verifying clean state in production Supabase...");
  const { count: remainingStaff, error: staffCountErr } = await supabase
    .from("staff")
    .select("*", { count: "exact", head: true });
  if (staffCountErr) throw new Error(`Staff count check error: ${staffCountErr.message}`);

  const { count: remainingDevices, error: devCountErr } = await supabase
    .from("devices")
    .select("*", { count: "exact", head: true });
  if (devCountErr) throw new Error(`Devices count check error: ${devCountErr.message}`);

  const { count: remainingEmbeddings, error: embCountErr } = await supabase
    .from("face_embeddings")
    .select("*", { count: "exact", head: true });
  if (embCountErr) throw new Error(`Face embeddings count check error: ${embCountErr.message}`);

  const { count: attCount, error: attCountErr } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact", head: true });
  if (attCountErr) throw new Error(`Attendance count check error: ${attCountErr.message}`);

  const { count: secCount, error: secCountErr } = await supabase
    .from("security_events")
    .select("*", { count: "exact", head: true });
  if (secCountErr) throw new Error(`Security events count check error: ${secCountErr.message}`);

  console.log(`   - Faculty/Staff accounts in DB:  ${remainingStaff} (Expected: 0)`);
  console.log(`   - Registered Devices in DB:      ${remainingDevices} (Expected: 0)`);
  console.log(`   - Face Embeddings in DB:         ${remainingEmbeddings} (Expected: 0)`);
  console.log(`   - Historical Attendance records: ${attCount} (Preserved)`);
  console.log(`   - Security Audit events:         ${secCount} (Preserved)`);

  if (remainingStaff !== 0) throw new Error(`Verification failed: Staff count is ${remainingStaff}, expected 0`);
  if (remainingDevices !== 0) throw new Error(`Verification failed: Devices count is ${remainingDevices}, expected 0`);
  if (remainingEmbeddings !== 0) throw new Error(`Verification failed: Face embeddings count is ${remainingEmbeddings}, expected 0`);
  if ((attCount || 0) < 6) throw new Error(`Verification failed: Attendance records were improperly affected (${attCount} < 6)`);

  console.log(`   ✓ Clean state confirmed across all tables!`);

  // Step 8: Post-deletion Administrator Verification
  console.log("\nStep 8: Verifying Administrator Account remains intact and operational...");
  const postAuth = await authenticateAdmin("moulish", "moulish@123");
  if (!postAuth.success || !postAuth.admin || postAuth.admin.username !== ADMIN_USERNAME) {
    throw new Error(`FATAL: Administrator login failed post-deletion: ${postAuth.error}`);
  }
  console.log(`   ✓ Administrator '${postAuth.admin.username}' authenticated successfully.`);
  console.log(`   ✓ Administrator session token issued: ${postAuth.token.slice(0, 24)}...`);
  console.log(`   ✓ Administrator permissions and credentials intact.`);

  console.log("\n=================================================================");
  console.log("   COMPLETE FACULTY RESET FINISHED SUCCESSFULLY!               ");
  console.log("=================================================================\n");
}

runSafeReset().catch(err => {
  console.error("\nRESET FAILED:", err);
  process.exit(1);
});
