/**
 * Sync Staff Reference Photos directly into PostgreSQL / Database
 * 
 * 1. Reads every physical photo from public/staff-photos/person-00X/
 * 2. Encodes each image to Base64 (data:image/jpeg;base64,...)
 * 3. Connects to PostgreSQL if DATABASE_URL / PG* is configured, applies schema,
 *    and inserts staff and face_embeddings records with 512-D vectors and photo_data.
 * 4. Also updates data/staff-db.json with photo_data for seamless local/production parity.
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

const DB_PATH = path.resolve('data', 'staff-db.json');
const SCHEMA_PATH = path.resolve('src', 'server', 'db', 'schema.sql');

async function syncPhotos() {
  console.log('==================================================');
  console.log('CampusAttend — Sync Sample Photos to PostgreSQL');
  console.log('==================================================');

  const dbUrl = process.env.DATABASE_URL;
  let pool = null;

  if (dbUrl || (process.env.PGHOST && process.env.PGDATABASE)) {
    console.log('Connecting to PostgreSQL database...');
    pool = new Pool({
      connectionString: dbUrl || undefined,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });

    try {
      const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      console.log('Applying PostgreSQL schema with photo_data and vector(512)...');
      await pool.query(schemaSql);
      console.log('✓ PostgreSQL schema verified/updated successfully.');
    } catch (err) {
      console.warn('PostgreSQL connection/migration warning:', err.message);
    }
  } else {
    console.log('No live DATABASE_URL provided. Operating on local database store.');
  }

  // Read local store
  if (!fs.existsSync(DB_PATH)) {
    console.error('Local database store data/staff-db.json not found.');
    process.exit(1);
  }

  const store = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  console.log(`Loaded ${store.staff.length} staff records and ${store.face_embeddings.length} embeddings.`);

  let updatedPhotosCount = 0;

  for (const emb of store.face_embeddings) {
    if (emb.reference_image_path) {
      const cleanRelPath = emb.reference_image_path.startsWith('/') 
        ? emb.reference_image_path.slice(1) 
        : emb.reference_image_path;
      const fullPath = path.resolve('public', cleanRelPath);

      if (fs.existsSync(fullPath)) {
        const fileBuffer = fs.readFileSync(fullPath);
        const base64Data = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;
        emb.photo_data = base64Data;
        updatedPhotosCount++;
        console.log(`  ✓ Encoded sample photo: ${emb.reference_image_path} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
      } else {
        console.log(`  ⚠ Photo file missing on disk: ${fullPath}`);
      }
    }
  }

  // Save back to local store
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf-8');
  console.log(`\n✓ Successfully attached photo_data base64 to ${updatedPhotosCount} embedding records in data/staff-db.json.`);

  // If PostgreSQL pool is available, sync all staff and embeddings to PostgreSQL
  if (pool) {
    console.log('\nInserting/Updating records in PostgreSQL...');
    for (const s of store.staff) {
      await pool.query(`
        INSERT INTO staff (id, staff_code, name, email, department, designation, active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (staff_code) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email, department = EXCLUDED.department, designation = EXCLUDED.designation, active = EXCLUDED.active, updated_at = NOW();
      `, [s.id, s.staff_code, s.name, s.email, s.department, s.designation, s.active, s.created_at, s.updated_at]);
    }

    for (const emb of store.face_embeddings) {
      const vecStr = `[${emb.embedding.join(',')}]`;
      await pool.query(`
        INSERT INTO face_embeddings (id, staff_id, embedding, reference_image_path, photo_data, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET embedding = EXCLUDED.embedding, reference_image_path = EXCLUDED.reference_image_path, photo_data = EXCLUDED.photo_data;
      `, [emb.id, emb.staff_id, vecStr, emb.reference_image_path, emb.photo_data || null, emb.created_at]);
    }
    console.log('✓ All staff records and sample photos synced to PostgreSQL successfully.');
    await pool.end();
  }

  console.log('\n==================================================');
  console.log('Sync Complete: Sample photos are now stored directly in the database.');
  console.log('==================================================');
}

syncPhotos().catch(console.error);
