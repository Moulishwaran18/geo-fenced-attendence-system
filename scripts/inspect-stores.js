import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspectSupabase() {
  console.log("=================================================================");
  console.log("   PHASE 1: INSPECTING SUPABASE CLOUD PRODUCTION DATABASE        ");
  console.log("   URL:", SUPABASE_URL);
  console.log("=================================================================\n");

  const tables = [
    "staff",
    "face_embeddings",
    "attendance_records",
    "face_detection_logs",
    "security_events",
    "devices",
    "geofence_zones",
    "admin_users"
  ];

  const results = {};

  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select("*", { count: "exact" });

      if (error) {
        results[table] = { status: "ERROR", error: error.message, code: error.code };
      } else {
        results[table] = { status: "OK", count: count !== null ? count : data.length, rows: data };
      }
    } catch (e) {
      results[table] = { status: "EXCEPTION", error: e.message };
    }
  }

  for (const [table, res] of Object.entries(results)) {
    if (res.status === "OK") {
      console.log(`[TABLE] ${table.padEnd(22)}: Count = ${res.count}`);
      if (table === "staff") {
        console.log("   Staff Records:");
        res.rows.forEach(s => {
          console.log(`     - [${s.staff_code}] ${s.name} (${s.department}) | ID: ${s.id} | Active: ${s.active}`);
        });
      }
      if (table === "face_embeddings") {
        console.log("   Face Embeddings breakdown by staff_id:");
        const staffEmbCount = {};
        res.rows.forEach(f => {
          staffEmbCount[f.staff_id] = (staffEmbCount[f.staff_id] || 0) + 1;
        });
        for (const [sId, c] of Object.entries(staffEmbCount)) {
          console.log(`     - Staff ID ${sId}: ${c} embedding(s)`);
        }
      }
      if (table === "admin_users") {
        console.log("   Admin Users:");
        res.rows.forEach(a => {
          console.log(`     - Username: ${a.username} | Name: ${a.name} | Role: ${a.role} | ID: ${a.id}`);
        });
      }
      if (table === "attendance_records") {
        console.log(`   Sample Attendance Records (First 5 of ${res.count}):`);
        res.rows.slice(0, 5).forEach(a => {
          console.log(`     - Date: ${a.date} | Staff: ${a.staff_code} (${a.staff_name}) | Status: ${a.status} | ID: ${a.id}`);
        });
      }
    } else {
      console.log(`[TABLE] ${table.padEnd(22)}: ${res.status} (${res.error})`);
    }
  }

  return results;
}

async function inspectLocalPg() {
  console.log("\n=================================================================");
  console.log("   PHASE 1: INSPECTING LOCAL POSTGRESQL (127.0.0.1:5432)        ");
  console.log("=================================================================\n");

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
    connectionTimeoutMillis: 2000,
  });

  try {
    const client = await pool.connect();
    console.log("✓ Connected to local PostgreSQL!");

    const tables = ["staff", "face_embeddings", "face_detection_logs", "attendance_records", "admin_users"];
    for (const t of tables) {
      try {
        const res = await client.query(`SELECT count(*)::int as count FROM ${t};`);
        console.log(`  - [LOCAL PG] Table '${t}': ${res.rows[0].count} records`);
      } catch (err) {
        console.log(`  - [LOCAL PG] Table '${t}': does not exist (${err.message})`);
      }
    }
    client.release();
  } catch (err) {
    console.log("Local PostgreSQL not reachable / inactive:", err.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

function inspectLocalJson() {
  console.log("\n=================================================================");
  console.log("   PHASE 1: INSPECTING LOCAL JSON STORE (data/staff-db.json)     ");
  console.log("=================================================================\n");

  const jsonPath = path.resolve(process.cwd(), "data", "staff-db.json");
  if (!fs.existsSync(jsonPath)) {
    console.log("data/staff-db.json does not exist.");
    return null;
  }

  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    console.log("data/staff-db.json status: PRESENT");
    console.log("  - Staff count:", parsed.staff?.length || 0);
    if (parsed.staff) {
      parsed.staff.forEach(s => {
        console.log(`     - [${s.staff_code}] ${s.name} | ID: ${s.id}`);
      });
    }
    console.log("  - Face embeddings count:", parsed.face_embeddings?.length || 0);
    console.log("  - Admin users count:", parsed.admin_users?.length || 0);
    if (parsed.admin_users) {
      parsed.admin_users.forEach(a => {
        console.log(`     - [${a.username}] ${a.name} | ID: ${a.id}`);
      });
    }
    return parsed;
  } catch (err) {
    console.error("Error reading data/staff-db.json:", err.message);
    return null;
  }
}

async function run() {
  const sb = await inspectSupabase();
  await inspectLocalPg();
  const json = inspectLocalJson();
}

run().catch(console.error);
