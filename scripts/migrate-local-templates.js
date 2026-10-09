import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function getEnv() {
  const envText = fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : "";
  const env = {};
  for (const line of envText.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0 && !line.trim().startsWith("#")) {
      env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return env;
}

async function migrate() {
  console.log("=================================================================");
  console.log("   MIGRATE LOCAL FACE TEMPLATES TO SUPABASE PRODUCTION DATABASE  ");
  console.log("=================================================================\n");

  const env = getEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "https://qvjcxoznvhoagclbyhad.supabase.co";
  const supabaseKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Fetch Staff from Supabase Cloud
  const { data: staffList, error: staffErr } = await supabase.from("staff").select("id, staff_code, name, active");
  if (staffErr) {
    console.error("Error fetching staff from Supabase:", staffErr);
    process.exit(1);
  }

  console.log("Supabase staff count:", staffList.length);
  const staffByCode = new Map();
  for (const s of staffList) {
    staffByCode.set(s.staff_code, s);
    console.log(`  Staff: ${s.staff_code} (${s.name}) -> UUID: ${s.id}`);
  }

  // 2. Load Local Database
  const localDb = JSON.parse(fs.readFileSync("data/staff-db.json", "utf-8"));
  console.log("\nLocal database face embeddings count:", localDb.face_embeddings.length);

  // 3. Migrate P1 clean embeddings
  const p1 = staffByCode.get("PERSON_001");
  if (!p1) {
    console.error("PERSON_001 not found in Supabase staff table!");
    process.exit(1);
  }

  // Check current embeddings in Supabase
  const { data: existingEmbs, error: exErr } = await supabase
    .from("face_embeddings")
    .select("id, staff_id, reference_image_path")
    .eq("staff_id", p1.id);

  console.log(`Current existing embeddings in Supabase for PERSON_001: ${existingEmbs?.length || 0}`);

  const p1LocalEmbs = localDb.face_embeddings.filter(
    (e) => (e.staff_id === "staff-person_001" || e.staff_code === "PERSON_001") && e.id.startsWith("emb-p1-clean-")
  );

  console.log(`Found ${p1LocalEmbs.length} clean reference embeddings for PERSON_001 in local store.`);

  for (let i = 0; i < p1LocalEmbs.length; i++) {
    const item = p1LocalEmbs[i];
    const imagePath = path.join("public", item.reference_image_path);
    let photoData = null;
    if (fs.existsSync(imagePath)) {
      const buffer = fs.readFileSync(imagePath);
      photoData = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    }

    console.log(`Migrating template ${i + 1}/${p1LocalEmbs.length}: ${item.reference_image_path}...`);
    const { data: inserted, error: insErr } = await supabase
      .from("face_embeddings")
      .insert({
        staff_id: p1.id,
        embedding: item.embedding,
        reference_image_path: item.reference_image_path,
        photo_data: photoData,
      })
      .select()
      .single();

    if (insErr) {
      console.error(`  ✗ Failed to insert ${item.reference_image_path}:`, insErr.message);
    } else {
      console.log(`  ✓ Inserted into Supabase with ID: ${inserted.id}`);
    }
  }

  // 4. Verify count in Supabase
  const { data: finalEmbs, count } = await supabase
    .from("face_embeddings")
    .select("id, staff_id, reference_image_path", { count: "exact" });

  console.log(`\n=================================================================`);
  console.log(`SUPABASE TOTAL EMBEDDINGS COUNT: ${count || finalEmbs?.length || 0}`);
  console.log(`=================================================================`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration fatal error:", err);
    process.exit(1);
  });
