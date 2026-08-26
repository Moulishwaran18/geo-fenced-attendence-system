import fs from "fs";
import pg from "pg";

const { Pool } = pg;
const jsonDb = JSON.parse(fs.readFileSync("data/staff-db.json", "utf-8"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics"
});

async function testAllSelfDistances() {
  const client = await pool.connect();
  console.log("=== Direct PostgreSQL pgvector Self-Distance Test (All 3 Staff) ===");
  try {
    const codes = ["PERSON_001", "PERSON_002", "PERSON_003"];
    let passCount = 0;

    for (const code of codes) {
      const staff = jsonDb.staff.find(s => s.staff_code === code);
      const emb = jsonDb.face_embeddings.find(e => e.staff_id === staff.id);

      const vecStr = `[${emb.embedding.join(",")}]`;
      const res = await client.query(`
        SELECT s.staff_code, s.name, (f.embedding <=> $1::vector) AS distance
        FROM face_embeddings f
        JOIN staff s ON f.staff_id = s.id
        ORDER BY distance ASC
        LIMIT 1
      `, [vecStr]);

      const top = res.rows[0];
      const dist = parseFloat(top.distance);
      console.log(`\nStaff ${code}:`);
      console.log(`  Top match: ${top.staff_code} (${top.name})`);
      console.log(`  Distance:  ${dist.toFixed(8)}`);

      if (top.staff_code === code && dist < 1e-4) {
        console.log(`  Result:    ✓ PASS (Self-distance is approximately 0)`);
        passCount++;
      } else {
        console.log(`  Result:    ✗ FAIL`);
      }
    }

    console.log(`\nSelf-distance test summary: ${passCount}/3 PASS`);
  } finally {
    client.release();
    await pool.end();
  }
}

testAllSelfDistances();
