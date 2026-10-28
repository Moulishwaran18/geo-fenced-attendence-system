import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://gcpuuvhydtgmcpiumpfa.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function inspectTables() {
  console.log("=== Inspecting Supabase Tables ===");
  console.log("Supabase URL:", SUPABASE_URL);

  const tablesToCheck = [
    "attendance_records",
    "marked_attendance",
    "staff",
    "admin_users",
    "face_embeddings",
    "devices",
    "security_events",
    "geofence_zones",
  ];

  for (const table of tablesToCheck) {
    try {
      const { data, count, error } = await supabase
        .from(table)
        .select("*", { count: "exact" });

      if (error) {
        console.log(`- ${table}: Error / Does not exist -> ${error.message} (code: ${error.code})`);
      } else {
        console.log(`- ${table}: EXISTS, total rows = ${count}`);
        if (table === "attendance_records" || table === "marked_attendance") {
          console.log(`  Sample data for ${table}:`, JSON.stringify(data, null, 2));
        }
      }
    } catch (e) {
      console.log(`- ${table}: Exception ->`, e.message);
    }
  }
}

inspectTables();
