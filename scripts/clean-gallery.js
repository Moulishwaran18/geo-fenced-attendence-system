import fs from "fs";
import path from "path";

const dbPath = path.resolve("data", "staff-db.json");
const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));

// Accepted reference photos as defined by user specification:
const ACCEPTED_GALLERY = {
  "staff-person_001": [
    "/staff-photos/person-001/reference_01.jpg",
    "/staff-photos/person-001/reference_02.jpg",
  ],
  "staff-person_002": [
    "/staff-photos/person-002/reference_01.jpg",
    "/staff-photos/person-002/reference_05.jpg",
  ],
  "staff-person_003": [
    "/staff-photos/person-003/reference_02.jpg",
    "/staff-photos/person-003/reference_03.jpg",
  ],
};

const allAcceptedPaths = new Set(Object.values(ACCEPTED_GALLERY).flat());

// Filter existing embeddings to keep only verified genuine ones
const cleanEmbeddings = db.face_embeddings.filter(emb => {
  const allowed = ACCEPTED_GALLERY[emb.staff_id];
  return allowed && allowed.includes(emb.reference_image_path);
});

const rejectedEmbeddings = db.face_embeddings.filter(emb => {
  return !allAcceptedPaths.has(emb.reference_image_path);
});

console.log(`Original Embeddings Count: ${db.face_embeddings.length}`);
console.log(`Retained Verified Embeddings: ${cleanEmbeddings.length}`);
console.log(`Rejected Contaminated Embeddings: ${rejectedEmbeddings.length}`);

// Backup old database
const backupPath = path.resolve("data", "staff-db.backup.json");
fs.writeFileSync(backupPath, JSON.stringify(db, null, 2), "utf-8");
console.log(`✓ Backup written to ${backupPath}`);

// Write clean database
const cleanDb = {
  staff: db.staff,
  face_embeddings: cleanEmbeddings,
  rejected_gallery_audit: rejectedEmbeddings.map(r => ({
    id: r.id,
    staff_id: r.staff_id,
    reference_image_path: r.reference_image_path,
    rejection_reason: "Cross-identity contamination / Disparate person placeholder detected during calibration",
    removed_at: new Date().toISOString()
  }))
};

fs.writeFileSync(dbPath, JSON.stringify(cleanDb, null, 2), "utf-8");
console.log(`✓ Clean database successfully written to ${dbPath}`);
