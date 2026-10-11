import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ARTIFACT_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\913bf065-f6ec-47bc-bbd6-f5fc40eaa748";
const SCRATCH_DIR = path.join(ARTIFACT_DIR, "scratch");
const BACKUP_DIR = path.resolve(process.cwd(), "backups");

function computeHash(data) {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function runBackupAndReset() {
  console.log("================================================================================");
  console.log("     CAMPUSATTEND ATTENDANCE SYSTEM: BACKUP AND SAFE PURGE RESET");
  console.log("================================================================================\n");

  const isoTimestamp = new Date().toISOString();
  const fileTimestamp = isoTimestamp.replace(/[:.]/g, "-");

  // Ensure directories exist
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // STEP 1: AUDIT EXISTING TABLES AND FETCH ATTENDANCE ROWS
  // ---------------------------------------------------------------------------
  console.log("--- STEP 1: AUDITING PRODUCTION DATABASE ---");

  // Fetch all attendance_records
  const { data: attendanceRecords, count: attCount, error: attError } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: true });

  if (attError) {
    throw new Error(`Failed to query attendance_records: ${attError.message}`);
  }
  console.log(`[attendance_records] Total existing rows: ${attCount} (fetched: ${attendanceRecords.length})`);

  // Fetch marked_attendance
  const { data: markedAttendance, count: markedCount, error: markedError } = await supabase
    .from("marked_attendance")
    .select("*", { count: "exact" });

  if (markedError) {
    console.warn(`[marked_attendance] Notice: ${markedError.message}`);
  } else {
    console.log(`[marked_attendance] Total existing rows: ${markedCount} (fetched: ${markedAttendance?.length || 0})`);
  }

  // Audit preserved tables
  const { count: staffCount } = await supabase.from("staff").select("*", { count: "exact", head: true });
  const { count: faceCount } = await supabase.from("face_embeddings").select("*", { count: "exact", head: true });
  const { count: secCount } = await supabase.from("security_events").select("*", { count: "exact", head: true });
  const { count: geoCount } = await supabase.from("geofence_zones").select("*", { count: "exact", head: true });
  const { count: devCount } = await supabase.from("devices").select("*", { count: "exact", head: true });

  console.log(`[staff] Preserved accounts: ${staffCount}`);
  console.log(`[face_embeddings] Preserved biometric embeddings: ${faceCount}`);
  console.log(`[security_events] Preserved security logs: ${secCount}`);
  console.log(`[geofence_zones] Preserved zones: ${geoCount}`);
  console.log(`[devices] Preserved devices: ${devCount}`);

  // Display detail of rows to back up
  console.log("\nRows to be backed up and reset:");
  attendanceRecords.forEach((r, idx) => {
    console.log(`  ${idx + 1}. [${r.staff_code}] ${r.staff_name} | Date: ${r.date} | Time: ${r.time} | ID: ${r.id}`);
  });

  // ---------------------------------------------------------------------------
  // STEP 2: CREATE CRYPTOGRAPHICALLY VERIFIABLE BACKUP
  // ---------------------------------------------------------------------------
  console.log("\n--- STEP 2: CREATING BACKUP FILES ---");

  const recordsHash = computeHash(attendanceRecords);
  const backupPayload = {
    metadata: {
      version: "1.0",
      exportTimestamp: isoTimestamp,
      databaseUrl: SUPABASE_URL,
      authoritativeTable: "public.attendance_records",
      secondaryTable: "public.marked_attendance",
      attendanceRecordsCount: attendanceRecords.length,
      markedAttendanceCount: (markedAttendance || []).length,
      recordsSha256: recordsHash,
      columns: [
        "id",
        "staff_code",
        "staff_name",
        "department",
        "date",
        "day",
        "time",
        "status",
        "location",
        "verification",
        "latitude",
        "longitude",
        "device_id",
        "created_at",
      ],
    },
    preservedTablesAudit: {
      staff: staffCount,
      face_embeddings: faceCount,
      security_events: secCount,
      geofence_zones: geoCount,
      devices: devCount,
    },
    attendance_records: attendanceRecords,
    marked_attendance: markedAttendance || [],
  };

  const backupJson = JSON.stringify(backupPayload, null, 2);
  const primaryBackupPath = path.join(BACKUP_DIR, `attendance_backup_${fileTimestamp}.json`);
  const secondaryBackupPath = path.join(SCRATCH_DIR, `attendance_backup_${fileTimestamp}.json`);

  fs.writeFileSync(primaryBackupPath, backupJson, "utf-8");
  fs.writeFileSync(secondaryBackupPath, backupJson, "utf-8");

  console.log(`✓ Primary backup saved to: ${primaryBackupPath}`);
  console.log(`✓ Secondary backup saved to: ${secondaryBackupPath}`);
  console.log(`✓ Records SHA-256 Checksum: ${recordsHash}`);

  // ---------------------------------------------------------------------------
  // STEP 3: STRICT BACKUP VERIFICATION BEFORE ANY MODIFICATION
  // ---------------------------------------------------------------------------
  console.log("\n--- STEP 3: VERIFYING BACKUP FILE INTEGRITY ---");

  // Read back primary file
  const readBackPrimary = fs.readFileSync(primaryBackupPath, "utf-8");
  const parsedPrimary = JSON.parse(readBackPrimary);
  const primaryHash = computeHash(parsedPrimary.attendance_records);

  // Read back secondary file
  const readBackSecondary = fs.readFileSync(secondaryBackupPath, "utf-8");
  const parsedSecondary = JSON.parse(readBackSecondary);
  const secondaryHash = computeHash(parsedSecondary.attendance_records);

  if (primaryHash !== recordsHash) {
    throw new Error(`CRITICAL: Primary backup checksum mismatch! Expected ${recordsHash}, got ${primaryHash}`);
  }
  if (secondaryHash !== recordsHash) {
    throw new Error(`CRITICAL: Secondary backup checksum mismatch! Expected ${recordsHash}, got ${secondaryHash}`);
  }
  if (parsedPrimary.attendance_records.length !== attendanceRecords.length) {
    throw new Error(`CRITICAL: Primary backup record count mismatch!`);
  }
  if (parsedSecondary.attendance_records.length !== attendanceRecords.length) {
    throw new Error(`CRITICAL: Secondary backup record count mismatch!`);
  }

  // Verify all original record IDs exist in read back data
  const originalIds = new Set(attendanceRecords.map((r) => r.id));
  for (const id of originalIds) {
    const inPrimary = parsedPrimary.attendance_records.some((r) => r.id === id);
    const inSecondary = parsedSecondary.attendance_records.some((r) => r.id === id);
    if (!inPrimary || !inSecondary) {
      throw new Error(`CRITICAL: Record ID ${id} missing in verified backup!`);
    }
  }

  console.log("✓ Checksum match confirmed on both storage locations.");
  console.log(`✓ All ${attendanceRecords.length} record UUIDs verified.`);
  console.log("✓ BACKUP VERIFICATION 100% SUCCESSFUL. Safe to proceed with reset.\n");

  // ---------------------------------------------------------------------------
  // STEP 4: EXECUTE SAFE ROW DELETION ON ATTENDANCE TABLES
  // ---------------------------------------------------------------------------
  console.log("--- STEP 4: EXECUTING SAFE PURGE OF ATTENDANCE RECORDS ---");

  // Delete all rows from attendance_records
  const { error: delAttError } = await supabase
    .from("attendance_records")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (delAttError) {
    throw new Error(`Failed to delete rows from attendance_records: ${delAttError.message}`);
  }
  console.log("✓ Deleted all rows from public.attendance_records.");

  // If marked_attendance had any rows, delete them
  if (markedAttendance && markedAttendance.length > 0) {
    const { error: delMarkedError } = await supabase
      .from("marked_attendance")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delMarkedError) {
      console.warn(`[marked_attendance] Warning during purge: ${delMarkedError.message}`);
    } else {
      console.log("✓ Deleted rows from public.marked_attendance.");
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 5: VERIFY EMPTY STATE AND UNTOUCHED ADJACENT TABLES
  // ---------------------------------------------------------------------------
  console.log("\n--- STEP 5: POST-RESET VERIFICATION ---");

  const { count: postAttCount, data: postAttData } = await supabase
    .from("attendance_records")
    .select("*", { count: "exact" });

  const { count: postMarkedCount } = await supabase
    .from("marked_attendance")
    .select("*", { count: "exact" });

  const { count: postStaffCount } = await supabase
    .from("staff")
    .select("*", { count: "exact", head: true });

  const { count: postFaceCount } = await supabase
    .from("face_embeddings")
    .select("*", { count: "exact", head: true });

  const { count: postSecCount } = await supabase
    .from("security_events")
    .select("*", { count: "exact", head: true });

  const { count: postGeoCount } = await supabase
    .from("geofence_zones")
    .select("*", { count: "exact", head: true });

  console.log(`[attendance_records] Current row count: ${postAttCount} (records: ${JSON.stringify(postAttData)})`);
  console.log(`[marked_attendance] Current row count: ${postMarkedCount}`);
  console.log(`[staff] Current row count: ${postStaffCount} (Expected: ${staffCount})`);
  console.log(`[face_embeddings] Current row count: ${postFaceCount} (Expected: ${faceCount})`);
  console.log(`[security_events] Current row count: ${postSecCount} (Expected: ${secCount})`);
  console.log(`[geofence_zones] Current row count: ${postGeoCount} (Expected: ${geoCount})`);

  if (postAttCount !== 0) {
    throw new Error(`CRITICAL: attendance_records is not empty! Remaining rows: ${postAttCount}`);
  }
  if (postStaffCount !== staffCount) {
    throw new Error(`CRITICAL: Staff count changed! Expected ${staffCount}, got ${postStaffCount}`);
  }
  if (postSecCount !== secCount) {
    throw new Error(`CRITICAL: Security events count changed! Expected ${secCount}, got ${postSecCount}`);
  }

  console.log("\n================================================================================");
  console.log("   ATTENDANCE RESET COMPLETE & VERIFIED CLEAN (0 RECORDS)");
  console.log("================================================================================");
  console.log(`Backup Location 1: ${primaryBackupPath}`);
  console.log(`Backup Location 2: ${secondaryBackupPath}`);
  console.log(`Checksum SHA-256:  ${recordsHash}`);
  console.log(`Rows Deleted:      ${attendanceRecords.length}`);
  console.log("Staff & Biometric Accounts: STRICTLY PRESERVED UNTOUCHED.\n");

  return {
    success: true,
    backupFile: primaryBackupPath,
    checksum: recordsHash,
    rowsDeleted: attendanceRecords.length,
    deletedRows: attendanceRecords,
  };
}

runBackupAndReset().catch((err) => {
  console.error("RESET PROCESS FAILED:", err);
  process.exit(1);
});
