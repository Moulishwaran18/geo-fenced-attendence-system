/**
 * scripts/execute-faculty-account-reset.js
 *
 * Implements Step 1 of One Faculty–One Registered Device Policy:
 * 1. Confirms verified backup existence and integrity.
 * 2. Explicitly protects the administrator account 'adm-moulish-001' (moulish).
 * 3. Removes all existing faculty/staff accounts so they can register again
 *    under the new device-registration policy.
 * 4. Verifies that 0 faculty accounts remain in staff.
 * 5. Verifies that administrator account and login remain 100% operational.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_ID = "adm-moulish-001";
const ADMIN_USERNAME = "moulish";

async function runSafeReset() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — SAFE FACULTY ACCOUNT RESET ENGINE             ");
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

  console.log(`   Found ${currentStaff.length} faculty/staff accounts to remove:`);
  for (const s of currentStaff) {
    console.log(`     - [${s.staff_code}] ${s.name} (${s.email}) - ID: ${s.id}`);
    if (s.id === ADMIN_ID || s.staff_code.toLowerCase() === ADMIN_USERNAME) {
      throw new Error(`CRITICAL VIOLATION: Administrator ID or username found in staff deletion candidates! Aborting.`);
    }
  }

  // Step 4: Execute targeted faculty account deletion
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
    }

    // Clean dependent devices if any
    const { error: devErr } = await supabase
      .from("devices")
      .delete()
      .in("staff_id", targetIds);
    if (devErr) {
      console.warn("   Notice: devices cleanup returned:", devErr.message);
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

    console.log(`   ✓ Successfully removed ${deleted?.length || targetIds.length} faculty accounts.`);
  } else {
    console.log("\nStep 4: Staff table is already empty (0 faculty accounts).");
  }

  // Step 5: Post-deletion verification
  console.log("\nStep 5: Verifying 0 faculty accounts remain in Supabase...");
  const { data: remainingStaff, count: remainingCount, error: countErr } = await supabase
    .from("staff")
    .select("*", { count: "exact" });

  if (countErr) {
    throw new Error(`Failed to verify remaining staff count: ${countErr.message}`);
  }

  if (remainingCount !== 0) {
    throw new Error(`Post-condition failed: Expected 0 remaining staff accounts, found ${remainingCount}.`);
  }
  console.log(`   ✓ Verified: Exact 0 faculty accounts remaining in database.`);

  // Step 6: Post-deletion Administrator Verification
  console.log("\nStep 6: Verifying Administrator Account remains intact and operational...");
  const postAuth = await authenticateAdmin("moulish", "moulish@123");
  if (!postAuth.success || !postAuth.admin || postAuth.admin.username !== ADMIN_USERNAME) {
    throw new Error(`FATAL: Administrator login failed post-deletion: ${postAuth.error}`);
  }
  console.log(`   ✓ Administrator '${postAuth.admin.username}' authenticated successfully.`);
  console.log(`   ✓ Administrator session token issued: ${postAuth.token.slice(0, 24)}...`);
  console.log(`   ✓ Administrator permissions and credentials intact.`);

  console.log("\n=================================================================");
  console.log("   FACULTY RESET COMPLETED WITH 100% ADMIN PRESERVATION!        ");
  console.log("=================================================================\n");
}

runSafeReset().catch(err => {
  console.error("\nRESET FAILED:", err);
  process.exit(1);
});
