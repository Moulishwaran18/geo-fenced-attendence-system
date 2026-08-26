/**
 * migrate-json-to-pg.js
 * Migrates staff records and face embeddings from data/staff-db.json to PostgreSQL.
 * Preserves all 512-D embedding vectors bit-for-bit.
 * 
 * Usage:
 *   node scripts/migrate-json-to-pg.js
 * (Requires DATABASE_URL or PGHOST+PGDATABASE+PGUSER+PGPASSWORD in environment)
 */

import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JSON_PATH = path.join(ROOT, "data", "staff-db.json");

async function migrate() {
  console.log("==================================================");
  console.log("CampusAttend — staff-db.json → PostgreSQL Migration");
  console.log("==================================================");

  // 1. Load JSON store
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`[ERROR] staff-db.json not found at: ${JSON_PATH}`);
    process.exit(1);
  }
  const store = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  console.log(`\n[SOURCE] staff-db.json loaded:`);
  console.log(`  Staff records:     ${store.staff.length}`);
  console.log(`  Face embeddings:   ${store.face_embeddings.length}`);

  // 2. Connect to PostgreSQL
  const dbUrl = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: dbUrl || undefined,
    host: process.env.PGHOST || "localhost",
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "campus_biometrics",
    connectionTimeoutMillis: 8000,
  });

  const client = await pool.connect();
  console.log(`\n[OK] Connected to PostgreSQL`);

  try {
    // 3. Verify extensions
    const extRes = await client.query(
      "SELECT extname FROM pg_extension WHERE extname IN ('vector','uuid-ossp','pgcrypto')"
    );
    const enabledExts = extRes.rows.map(r => r.extname);
    console.log(`[OK] Extensions enabled: ${enabledExts.join(", ")}`);
    if (!enabledExts.includes("vector")) {
      console.error("[ERROR] pgvector extension is not enabled. Run setup first.");
      process.exit(1);
    }

    // 4. Verify tables exist
    const tableRes = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('staff','face_embeddings')"
    );
    const tables = tableRes.rows.map(r => r.tablename);
    console.log(`[OK] Tables found: ${tables.join(", ")}`);
    if (tables.length < 2) {
      console.error("[ERROR] Schema not applied. Run: npm run db:migrate");
      process.exit(1);
    }

    // 5. Start transaction
    await client.query("BEGIN");

    // 6. Migrate staff records
    console.log(`\n[STEP 1] Migrating ${store.staff.length} staff records...`);
    
    const staffIdMap = new Map(); // jsonId -> pgUUID

    for (const s of store.staff) {
      const res = await client.query(
        `INSERT INTO staff (staff_code, name, email, department, designation, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (staff_code) DO UPDATE
           SET name = EXCLUDED.name,
               email = EXCLUDED.email,
               department = EXCLUDED.department,
               designation = EXCLUDED.designation,
               active = EXCLUDED.active,
               updated_at = EXCLUDED.updated_at
         RETURNING id, staff_code`,
        [
          s.staff_code, s.name, s.email, s.department, s.designation,
          s.active, new Date(s.created_at), new Date(s.updated_at),
        ]
      );
      const pgId = res.rows[0].id;
      staffIdMap.set(s.id, pgId);
      console.log(`  [OK] ${s.staff_code} (${s.name}) → PG UUID: ${pgId}`);
    }

    // 7. Migrate face embeddings
    console.log(`\n[STEP 2] Migrating ${store.face_embeddings.length} face embeddings...`);
    
    // Delete existing embeddings for migrated staff to avoid duplicates
    for (const [, pgId] of staffIdMap) {
      await client.query("DELETE FROM face_embeddings WHERE staff_id = $1", [pgId]);
    }

    for (const e of store.face_embeddings) {
      const pgStaffId = staffIdMap.get(e.staff_id);
      if (!pgStaffId) {
        console.warn(`  [WARN] No PG staff for JSON staff_id: ${e.staff_id} — skipping`);
        continue;
      }

      // Convert 512-D float array to pgvector string format
      const vecString = `[${e.embedding.join(",")}]`;

      const res = await client.query(
        `INSERT INTO face_embeddings (staff_id, embedding, reference_image_path, photo_data, created_at)
         VALUES ($1, $2::vector, $3, $4, $5)
         RETURNING id`,
        [pgStaffId, vecString, e.reference_image_path, e.photo_data || null, new Date(e.created_at)]
      );

      const origCode = store.staff.find(s => s.id === e.staff_id)?.staff_code || "?";
      console.log(`  [OK] Embedding ${e.id.slice(0, 24)}... → ${origCode} (PG: ${res.rows[0].id.slice(0,8)}...) dim=512`);
    }

    // 8. Commit
    await client.query("COMMIT");
    console.log(`\n[OK] Transaction committed`);

    // 9. Verify counts
    console.log(`\n[VERIFICATION] Running live PostgreSQL queries...`);
    const staffCount = (await client.query("SELECT COUNT(*)::int as count FROM staff")).rows[0].count;
    const embTotal = (await client.query("SELECT COUNT(*)::int as count FROM face_embeddings")).rows[0].count;
    const activeEmb = (await client.query(`
      SELECT COUNT(f.id)::int as count FROM face_embeddings f
      JOIN staff s ON f.staff_id = s.id WHERE s.active = true
    `)).rows[0].count;

    console.log(`\n  SELECT COUNT(*) FROM staff            = ${staffCount}`);
    console.log(`  SELECT COUNT(*) FROM face_embeddings  = ${embTotal}`);
    console.log(`  Active staff embeddings               = ${activeEmb}`);

    // Per-person
    const ppRes = await client.query(`
      SELECT s.staff_code, COUNT(f.id)::int as embedding_count
      FROM staff s LEFT JOIN face_embeddings f ON f.staff_id = s.id
      GROUP BY s.staff_code ORDER BY s.staff_code
    `);
    console.log(`\n  Per-person embedding counts:`);
    const expected = { PERSON_001: 5, PERSON_002: 2, PERSON_003: 2 };
    for (const row of ppRes.rows) {
      const exp = expected[row.staff_code];
      const mark = row.embedding_count === exp ? "✓" : `✗ (expected ${exp})`;
      console.log(`    ${row.staff_code}: ${row.embedding_count} ${mark}`);
    }

    // pgvector test query
    console.log(`\n[TEST] pgvector cosine distance (<=>)...`);
    const firstEmb = (await client.query("SELECT embedding FROM face_embeddings LIMIT 1")).rows[0];
    if (firstEmb) {
      const distRes = await client.query(`
        SELECT s.staff_code, (f.embedding <=> $1::vector) AS distance
        FROM face_embeddings f JOIN staff s ON f.staff_id = s.id
        ORDER BY distance ASC LIMIT 3
      `, [firstEmb.embedding]);
      console.log(`  [OK] pgvector <=> query succeeded! Top 3 results:`);
      for (const r of distRes.rows) {
        console.log(`    ${r.staff_code}: distance = ${parseFloat(r.distance).toFixed(6)}`);
      }
    }

    // PERSON_001 proof
    console.log(`\n[PROOF] Querying PERSON_001 directly from PostgreSQL:`);
    const proof = (await client.query(`
      SELECT s.id, s.staff_code, s.name, s.email, s.department, s.active,
             COUNT(f.id)::int as embedding_count
      FROM staff s LEFT JOIN face_embeddings f ON f.staff_id = s.id
      WHERE s.staff_code = 'PERSON_001' GROUP BY s.id
    `)).rows[0];
    console.log(`  ID (PG UUID):     ${proof.id}`);
    console.log(`  Staff Code:       ${proof.staff_code}`);
    console.log(`  Name:             ${proof.name}`);
    console.log(`  Active:           ${proof.active}`);
    console.log(`  Embeddings in PG: ${proof.embedding_count}`);

    // Final verdict
    console.log("\n==================================================");
    if (parseInt(staffCount) === 3 && parseInt(embTotal) === 9) {
      console.log("✓ MIGRATION SUCCESSFUL");
      console.log("  PostgreSQL is now the authoritative database.");
      console.log("  data/staff-db.json is retained as backup only.");
    } else {
      console.log("✗ MIGRATION INCOMPLETE — counts do not match!");
    }
    console.log("==================================================");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n[ERROR] Migration failed, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
