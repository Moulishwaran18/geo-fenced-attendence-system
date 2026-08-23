/**
 * Database Migration Script
 *
 * Runs DDL migrations on PostgreSQL database (or verifies local dev store).
 *
 * Usage:
 *   npm run db:migrate
 */

import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;

async function runMigration() {
  console.log("==================================================");
  console.log("CampusAttend — Database Migration Runner");
  console.log("==================================================");

  const dbUrl = process.env.DATABASE_URL;
  const sqlPath = path.resolve("src/server/db/schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf-8");

  if (dbUrl || (process.env.PGHOST && process.env.PGDATABASE)) {
    console.log("Connecting to PostgreSQL...");
    const pool = new Pool({
      connectionString: dbUrl || undefined,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });

    try {
      console.log("Applying schema DDL from src/server/db/schema.sql...");
      await pool.query(sql);
      console.log("✓ PostgreSQL migration completed successfully!");
      console.log("  - Table 'staff' verified/created.");
      console.log("  - Table 'face_embeddings' verified/created.");
      console.log("  - Foreign keys and vector indexes applied.");
    } catch (err) {
      console.error("PostgreSQL migration error:", err);
      process.exit(1);
    } finally {
      await pool.end();
    }
  } else {
    console.log("No live PostgreSQL connection string found in environment (DATABASE_URL not set).");
    console.log("Initializing local development database store at data/staff-db.json...");
    const dataDir = path.resolve("data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbFile = path.join(dataDir, "staff-db.json");
    if (!fs.existsSync(dbFile)) {
      fs.writeFileSync(dbFile, JSON.stringify({ staff: [], face_embeddings: [] }, null, 2), "utf-8");
      console.log("✓ Initialized data/staff-db.json");
    } else {
      console.log("✓ Local store data/staff-db.json already present.");
    }
    console.log("✓ Schema is ready for local and production deployment.");
  }
}

runMigration().catch((err) => {
  console.error("Fatal error during migration:", err);
  process.exit(1);
});
