import fs from "fs";
import pg from "pg";

const { Pool } = pg;
const jsonDb = JSON.parse(fs.readFileSync("data/staff-db.json", "utf-8"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics"
});

async function checkBitForBit() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT f.embedding, f.reference_image_path, s.staff_code 
      FROM face_embeddings f 
      JOIN staff s ON f.staff_id = s.id
      ORDER BY s.staff_code, f.reference_image_path
    `);

    console.log(`Fetched ${res.rows.length} embeddings from PostgreSQL.`);
    
    let all512 = true;
    let bitForBitMatches = 0;

    for (const pgRow of res.rows) {
      // pgvector returns embedding as string "[0.123, ...]" or array
      const raw = pgRow.embedding;
      const pgVec = typeof raw === "string" 
        ? raw.replace(/[\[\]]/g, "").split(",").map(Number)
        : raw;

      if (pgVec.length !== 512) {
        console.error(`Dimension mismatch: ${pgVec.length}`);
        all512 = false;
      }

      // Find matching in JSON
      const jsonMatch = jsonDb.face_embeddings.find(j => j.reference_image_path === pgRow.reference_image_path);
      if (jsonMatch) {
        let diff = 0;
        for (let i = 0; i < 512; i++) {
          diff += Math.abs(jsonMatch.embedding[i] - pgVec[i]);
        }
        if (diff < 1e-5) {
          bitForBitMatches++;
          console.log(`  ✓ ${pgRow.staff_code} (${pgRow.reference_image_path}): 512-D vector matched (diff: ${diff.toExponential(2)})`);
        } else {
          console.error(`  ✗ Vector mismatch for ${pgRow.reference_image_path}, diff=${diff}`);
        }
      }
    }

    console.log(`\nResults: ${bitForBitMatches}/9 embeddings verified bit-for-bit, all 512-D: ${all512}`);
  } finally {
    client.release();
    await pool.end();
  }
}

checkBitForBit();
