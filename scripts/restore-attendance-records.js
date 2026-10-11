import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function computeHash(data) {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function restoreAttendance(backupFilePath) {
  if (!backupFilePath) {
    // Look for latest in backups directory
    const backupDir = path.resolve(process.cwd(), "backups");
    const files = fs.readdirSync(backupDir).filter((f) => f.startsWith("attendance_backup_") && f.endsWith(".json"));
    if (files.length === 0) {
      throw new Error("No attendance backup file specified and none found in backups/ directory.");
    }
    files.sort().reverse();
    backupFilePath = path.join(backupDir, files[0]);
  }

  console.log("================================================================================");
  console.log("     CAMPUSATTEND ATTENDANCE SYSTEM: RESTORATION UTILITY");
  console.log("================================================================================\n");
  console.log(`Loading backup file: ${backupFilePath}`);

  const content = fs.readFileSync(backupFilePath, "utf-8");
  const parsed = JSON.parse(content);

  const records = parsed.attendance_records;
  if (!Array.isArray(records) || records.length === 0) {
    console.log("Backup file contains 0 attendance records. Nothing to restore.");
    return;
  }

  const expectedHash = parsed.metadata?.recordsSha256;
  const actualHash = computeHash(records);

  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch! Backup file may be corrupted. Expected: ${expectedHash}, Actual: ${actualHash}`);
  }

  console.log(`✓ Backup verified. Found ${records.length} records to restore.`);
  console.log(`✓ Records Checksum: ${actualHash}\n`);

  // Insert records back into Supabase attendance_records
  console.log("Restoring records to public.attendance_records...");
  const { data: inserted, error } = await supabase
    .from("attendance_records")
    .upsert(records, { onConflict: "id" })
    .select();

  if (error) {
    throw new Error(`Failed to restore attendance records: ${error.message}`);
  }

  console.log(`✓ Successfully restored ${inserted?.length || records.length} records.`);
  
  // Verify final count
  const { count } = await supabase.from("attendance_records").select("*", { count: "exact", head: true });
  console.log(`✓ Current attendance_records total count in database: ${count}\n`);
}

const targetFile = process.argv[2];
restoreAttendance(targetFile).catch((err) => {
  console.error("RESTORATION FAILED:", err);
  process.exit(1);
});
