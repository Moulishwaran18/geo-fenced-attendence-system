import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function restoreBackup(backupFilePath) {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND — PRODUCTION DATA ROLLBACK & RESTORATION        ");
  console.log("=================================================================\n");

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found at: ${backupFilePath}`);
  }

  const raw = fs.readFileSync(backupFilePath, "utf-8");
  const backup = JSON.parse(raw);

  console.log(`Loaded Backup ID: ${backup.metadata.backupId}`);
  console.log(`Backup Timestamp: ${backup.metadata.timestamp}`);
  console.log(`Staff to restore: ${backup.tables.staff.length}`);
  console.log(`Embeddings to restore: ${backup.tables.face_embeddings.length}\n`);

  // 1. Restore staff
  console.log("1. Restoring 'staff' table records...");
  for (const staff of backup.tables.staff) {
    const { error } = await supabase.from("staff").upsert(staff, { onConflict: "id" });
    if (error) {
      console.error(`   ✗ Error restoring staff ${staff.staff_code}:`, error.message);
    } else {
      console.log(`   ✓ Restored staff [${staff.staff_code}] ${staff.name}`);
    }
  }

  // 2. Restore face embeddings
  console.log("\n2. Restoring 'face_embeddings' table records...");
  for (const emb of backup.tables.face_embeddings) {
    const { error } = await supabase.from("face_embeddings").upsert(emb, { onConflict: "id" });
    if (error) {
      console.error(`   ✗ Error restoring embedding ${emb.id}:`, error.message);
    } else {
      console.log(`   ✓ Restored embedding ID: ${emb.id} for staff ID: ${emb.staff_id}`);
    }
  }

  // 3. Restore local JSON store if snapshot exists
  if (backup.localStoreSnapshot) {
    const localJsonPath = path.resolve(process.cwd(), "data", "staff-db.json");
    fs.writeFileSync(localJsonPath, JSON.stringify(backup.localStoreSnapshot, null, 2), "utf-8");
    console.log("\n3. Restored local data/staff-db.json snapshot.");
  }

  console.log("\n=================================================================");
  console.log("   ROLLBACK COMPLETED SUCCESSFULLY!                             ");
  console.log("=================================================================\n");
}

const targetBackup = process.argv[2] || "D:\\project\\geo-fenced-attendence-system\\backups\\production_backup_2026-10-10T06-42-44-240Z.json";
restoreBackup(targetBackup).catch(err => {
  console.error("Restoration failed:", err);
  process.exit(1);
});
