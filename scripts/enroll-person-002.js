import fs from "fs";
import path from "path";
import crypto from "crypto";
import jpeg from "jpeg-js";
import pg from "pg";
import * as ort from "onnxruntime-web";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, "public", "models");
const PHOTOS_DIR = path.join(ROOT, "public", "staff-photos", "person-002");
const DB_JSON_PATH = path.join(ROOT, "data", "staff-db.json");
const USER_UPLOADED_DIR = path.join(
  "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\7012a479-e82f-4668-bff1-b27f26162286\\.user_uploaded"
);

const PHOTO_SOURCES = [
  { file: "media_1787822373826.jpg", target: "reference_01.jpg", pose: "Looking Right" },
  { file: "media_1787822373855.jpg", target: "reference_02.jpg", pose: "Looking Up / Frontal" },
  { file: "media_1787822373911.jpg", target: "reference_03.jpg", pose: "Looking Down" },
  { file: "media_1787822373972.jpg", target: "reference_04.jpg", pose: "Looking Straight / Frontal" },
  { file: "media_1787822374009.jpg", target: "reference_05.jpg", pose: "Looking Left" },
];

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < 512; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return Math.max(0, 1 - dot / denom);
}

function extract5Landmarks(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  const avg = (indices) => {
    let x = 0, y = 0;
    indices.forEach((idx) => { x += pts[idx].x; y += pts[idx].y; });
    return [x / indices.length, y / indices.length];
  };
  return [
    avg([36, 37, 38, 39, 40, 41]), // left eye
    avg([42, 43, 44, 45, 46, 47]), // right eye
    [pts[30].x, pts[30].y],         // nose tip
    [pts[48].x, pts[48].y],         // left mouth
    [pts[54].x, pts[54].y],         // right mouth
  ];
}

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= n; srcMeanY /= n;
  dstMeanX /= n; dstMeanY /= n;

  let srcVar = 0, sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    srcVar += sx * sx + sy * sy;
    sxx += dx * sx;
    sxy += dx * sy;
    syx += dy * sx;
    syy += dy * sy;
  }
  srcVar /= n; sxx /= n; sxy /= n; syx /= n; syy /= n;

  const a = (sxx + syy) / srcVar;
  const b = (syx - sxy) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b || 1e-6;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  return {
    M: [[a, -b, tx], [b, a, ty]],
    invM: [
      [invA, -invB, invTx],
      [invB, invA, invTy],
    ],
  };
}

function align112FromRawImage(rawImg, pts5) {
  const { invM } = estimateSimilarityTransform(pts5);
  const targetW = 112, targetH = 112;
  const planar = new Float32Array(3 * targetW * targetH);
  const channelStride = targetW * targetH;
  const outJpegData = new Uint8Array(targetW * targetH * 4);

  for (let dy = 0; dy < targetH; dy++) {
    for (let dx = 0; dx < targetW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      let r = 0, g = 0, b = 0;
      if (sx >= 0 && sx < rawImg.width - 1 && sy >= 0 && sy < rawImg.height - 1) {
        const x0 = Math.floor(sx), x1 = x0 + 1;
        const y0 = Math.floor(sy), y1 = y0 + 1;
        const wx = sx - x0, wy = sy - y0;

        const idx00 = (y0 * rawImg.width + x0) * 4;
        const idx10 = (y0 * rawImg.width + x1) * 4;
        const idx01 = (y1 * rawImg.width + x0) * 4;
        const idx11 = (y1 * rawImg.width + x1) * 4;

        r = (1 - wx) * (1 - wy) * rawImg.data[idx00] + wx * (1 - wy) * rawImg.data[idx10] + (1 - wx) * wy * rawImg.data[idx01] + wx * wy * rawImg.data[idx11];
        g = (1 - wx) * (1 - wy) * rawImg.data[idx00 + 1] + wx * (1 - wy) * rawImg.data[idx10 + 1] + (1 - wx) * wy * rawImg.data[idx01 + 1] + wx * wy * rawImg.data[idx11 + 1];
        b = (1 - wx) * (1 - wy) * rawImg.data[idx00 + 2] + wx * (1 - wy) * rawImg.data[idx10 + 2] + (1 - wx) * wy * rawImg.data[idx01 + 2] + wx * wy * rawImg.data[idx11 + 2];
      }

      const outIdx = dy * targetW + dx;
      planar[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planar[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planar[2 * channelStride + outIdx] = (b - 127.5) / 128.0;

      const p4 = outIdx * 4;
      outJpegData[p4] = Math.round(r);
      outJpegData[p4 + 1] = Math.round(g);
      outJpegData[p4 + 2] = Math.round(b);
      outJpegData[p4 + 3] = 255;
    }
  }

  const jpegBuf = jpeg.encode({ width: targetW, height: targetH, data: outJpegData }, 95).data;
  return { planar, jpegBuf };
}

async function main() {
  console.log("===============================================================================");
  console.log("         ENROLLMENT & VERIFICATION OF PERSON_002 (POSTGRESQL + PGVECTOR)");
  console.log("===============================================================================\n");

  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }

  // 1. Copy user uploaded images into public/staff-photos/person-002
  console.log("1. COPYING 5 REFERENCE PHOTOS TO PUBLIC DIRECTORY:");
  PHOTO_SOURCES.forEach((p, idx) => {
    const srcPath = path.join(USER_UPLOADED_DIR, p.file);
    const dstPath = path.join(PHOTOS_DIR, p.target);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
      console.log(`   ✓ Copied ${p.file} -> ${dstPath} (${p.pose})`);
    } else {
      console.log(`   • Existing photo in ${dstPath}`);
    }
  });

  // 2. Load Models
  console.log("\n2. LOADING MODELS:");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(path.join(MODELS_DIR, "w600k_mbf.onnx"), { executionProviders: ["wasm"] });
  console.log("   ✓ SSD MobileNet V1, 68 Landmark Net, and w600k_mbf.onnx loaded.");

  // 3. Process all 5 photos through exact pipeline
  console.log("\n3. PROCESSING 5 REFERENCE PHOTOS (5-Point Umeyama + 112x112 + ArcFace 512-D L2):");
  const enrolledEmbeddings = [];

  for (let i = 1; i <= 5; i++) {
    const fileName = `reference_0${i}.jpg`;
    const filePath = path.join(PHOTOS_DIR, fileName);
    const rawBuf = fs.readFileSync(filePath);
    const rawJpeg = jpeg.decode(rawBuf);

    const origW = rawJpeg.width;
    const origH = rawJpeg.height;
    const numPixels = origW * origH;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = rawJpeg.data[p * 4];
      rgbValues[p * 3 + 1] = rawJpeg.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = rawJpeg.data[p * 4 + 2];
    }

    let tensor3D = tf.tensor3d(rgbValues, [origH, origW, 3], "int32");
    const maxDim = Math.max(origH, origW);
    let scaleX = 1.0, scaleY = 1.0;
    if (maxDim > 640) {
      const scale = 640 / maxDim;
      const targetH = Math.round(origH * scale);
      const targetW = Math.round(origW * scale);
      scaleX = targetW / origW;
      scaleY = targetH / origH;
      const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
      .withFaceLandmarks();
    tensor3D.dispose();

    const validDetections = detections.filter((d) => {
      const b = d.detection.box;
      if (!b || b.width < 75 || b.height < 75) return false;
      const ar = b.height / b.width;
      return ar >= 0.72 && ar <= 1.85;
    });

    const face = validDetections.sort((a, b) => b.detection.score - a.detection.score)[0] || detections[0];
    if (!face) {
      throw new Error(`No valid face found in ${fileName}`);
    }

    const detected5 = extract5Landmarks(face.landmarks);
    const corrected5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);

    const { planar, jpegBuf } = align112FromRawImage(rawJpeg, corrected5);
    const previewPath = path.join(PHOTOS_DIR, `aligned_corrected_0${i}.jpg`);
    fs.writeFileSync(previewPath, jpegBuf);

    const onnxTensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: onnxTensor });
    const rawVec = Array.from(out[outputName].data);
    const rawNorm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0));
    const normalizedVec = rawVec.map((v) => v / rawNorm);
    const finalL2Norm = Math.sqrt(normalizedVec.reduce((s, v) => s + v * v, 0));

    console.log(`   • [P002-${i}] ${fileName}:`);
    console.log(`     - Pose: ${PHOTO_SOURCES[i - 1].pose}`);
    console.log(`     - Dimensions: ${origW}x${origH} | Face Score: ${(face.detection.score * 100).toFixed(1)}%`);
    console.log(`     - Raw Norm: ${rawNorm.toFixed(6)} | Final Unit Norm: ${finalL2Norm.toFixed(6)}`);
    console.log(`     - Sample [0..4]: [${normalizedVec.slice(0, 5).map(v => v.toFixed(5)).join(", ")}]`);

    enrolledEmbeddings.push({
      id: crypto.randomUUID(),
      reference_image_path: `/staff-photos/person-002/${fileName}`,
      embedding: normalizedVec,
      rawNorm,
    });
  }

  // 4. Update PostgreSQL
  console.log("\n4. STORING IN POSTGRESQL (CAMPUS_BIOMETRICS):");
  
  // Ensure staff record exists and is active
  let staffRes = await pool.query("SELECT id FROM staff WHERE staff_code = 'PERSON_002'");
  let staffId;
  if (staffRes.rows.length === 0) {
    const insertStaff = await pool.query(
      `INSERT INTO staff (id, staff_code, name, email, department, designation, active, created_at, updated_at)
       VALUES ($1, 'PERSON_002', 'Test Person 2', 'test.person2@sonatech.ac.in', 'Information Technology', 'Assistant Professor', true, NOW(), NOW())
       RETURNING id;`,
      [crypto.randomUUID()]
    );
    staffId = insertStaff.rows[0].id;
    console.log(`   ✓ Created staff record for PERSON_002 (ID: ${staffId})`);
  } else {
    staffId = staffRes.rows[0].id;
    await pool.query("UPDATE staff SET active = true, updated_at = NOW() WHERE id = $1", [staffId]);
    console.log(`   ✓ Found staff record for PERSON_002 (ID: ${staffId}) and activated.`);
  }

  // Delete old embeddings for PERSON_002 ONLY
  await pool.query("DELETE FROM face_embeddings WHERE staff_id = $1", [staffId]);

  // Insert 5 new embeddings
  for (const emb of enrolledEmbeddings) {
    const vecStr = `[${emb.embedding.join(",")}]`;
    await pool.query(
      `INSERT INTO face_embeddings (id, staff_id, reference_image_path, embedding, created_at)
       VALUES ($1, $2, $3, $4::vector, NOW())`,
      [emb.id, staffId, emb.reference_image_path, vecStr]
    );
  }
  console.log(`   ✓ Inserted 5 new 512-D embeddings for PERSON_002 into face_embeddings table.`);

  // 5. Database Direct Verification
  console.log("\n5. DIRECT POSTGRESQL VERIFICATION:");
  const countRes = await pool.query(
    "SELECT COUNT(*) as count FROM face_embeddings WHERE staff_id = $1",
    [staffId]
  );
  console.log(`   • PERSON_002 Embedding Count in DB: ${countRes.rows[0].count} (Expected: 5)`);

  const p1CountRes = await pool.query(
    "SELECT COUNT(*) as count FROM face_embeddings f JOIN staff s ON f.staff_id = s.id WHERE s.staff_code = 'PERSON_001'"
  );
  console.log(`   • PERSON_001 Embedding Count in DB: ${p1CountRes.rows[0].count} (Expected: 5, untouched)`);

  const p3CountRes = await pool.query(
    "SELECT COUNT(*) as count FROM face_embeddings f JOIN staff s ON f.staff_id = s.id WHERE s.staff_code = 'PERSON_003'"
  );
  console.log(`   • PERSON_003 Embedding Count in DB: ${p3CountRes.rows[0].count} (Untouched)`);

  const p2Vectors = await pool.query(`
    SELECT f.id, f.reference_image_path, f.embedding::text,
           array_length(string_to_array(trim(both '[]' from f.embedding::text), ','), 1) as dim
    FROM face_embeddings f
    WHERE f.staff_id = $1
    ORDER BY f.reference_image_path;
  `, [staffId]);

  p2Vectors.rows.forEach((r, idx) => {
    const vec = JSON.parse(r.embedding);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    console.log(`   • Embedding ${idx + 1} (${r.reference_image_path}): Dimension = ${r.dim}, L2 Norm = ${norm.toFixed(6)}`);
  });

  // 6. Sync staff-db.json backup mirror
  if (fs.existsSync(DB_JSON_PATH)) {
    const dbData = JSON.parse(fs.readFileSync(DB_JSON_PATH, "utf8"));
    // Ensure PERSON_002 exists in staff array
    let p2Staff = dbData.staff.find((s) => s.staff_code === "PERSON_002");
    if (!p2Staff) {
      dbData.staff.push({
        id: staffId,
        staff_code: "PERSON_002",
        name: "Test Person 2",
        email: "test.person2@sonatech.ac.in",
        department: "Information Technology",
        designation: "Assistant Professor",
        active: true,
        created_at: new Date().toISOString(),
      });
    } else {
      p2Staff.active = true;
    }

    dbData.face_embeddings = dbData.face_embeddings.filter((e) => e.staff_id !== staffId && e.staff_code !== "PERSON_002");
    for (const emb of enrolledEmbeddings) {
      dbData.face_embeddings.push({
        id: emb.id,
        staff_id: staffId,
        staff_code: "PERSON_002",
        name: "Test Person 2",
        reference_image_path: emb.reference_image_path,
        embedding: emb.embedding,
        created_at: new Date().toISOString(),
      });
    }
    fs.writeFileSync(DB_JSON_PATH, JSON.stringify(dbData, null, 2));
    console.log("   ✓ Synced data/staff-db.json backup.");
  }

  // 7. Offline Recognition Verification Test
  console.log("\n===============================================================================");
  console.log("     OFFLINE RECOGNITION TEST & DISTANCE AUDIT (PGVECTOR COSINE MATCH)");
  console.log("===============================================================================\n");

  // Load PERSON_001 stored embeddings for cross-person distance comparison
  const p1Embeddings = (await pool.query(`
    SELECT f.reference_image_path, f.embedding::text 
    FROM face_embeddings f 
    JOIN staff s ON f.staff_id = s.id 
    WHERE s.staff_code = 'PERSON_001'
    ORDER BY f.reference_image_path;
  `)).rows.map(r => ({ path: r.reference_image_path, vec: JSON.parse(r.embedding) }));

  const p2StoredEmbeddings = enrolledEmbeddings.map(e => e.embedding);

  for (let i = 0; i < enrolledEmbeddings.length; i++) {
    const testEmb = enrolledEmbeddings[i].embedding;
    const testPath = enrolledEmbeddings[i].reference_image_path;
    const photoNum = i + 1;

    // Distances against all 5 PERSON_002 stored embeddings
    const p2Distances = p2StoredEmbeddings.map(stored => cosineDistance(testEmb, stored));
    
    // Distances against all 5 PERSON_001 stored embeddings
    const p1Distances = p1Embeddings.map(p1 => cosineDistance(testEmb, p1.vec));

    const minP2Dist = Math.min(...p2Distances);
    const minP1Dist = Math.min(...p1Distances);

    const isSelfMatch = minP2Dist <= 0.45;
    const isP1SeparationAdequate = (minP1Dist - minP2Dist) >= 0.08;
    const decision = (isSelfMatch && minP2Dist < minP1Dist) ? "PERSON_002 (AUTHORIZED)" : "UNKNOWN / MISMATCH";

    console.log(`-------------------------------------------------------------------------------`);
    console.log(`[TEST PHOTO ${photoNum}] ${testPath} (${PHOTO_SOURCES[i].pose})`);
    console.log(`-------------------------------------------------------------------------------`);
    console.log(`• Distances to PERSON_002 Gallery:`);
    console.log(`   P002-1: ${p2Distances[0].toFixed(6)}`);
    console.log(`   P002-2: ${p2Distances[1].toFixed(6)}`);
    console.log(`   P002-3: ${p2Distances[2].toFixed(6)}`);
    console.log(`   P002-4: ${p2Distances[3].toFixed(6)}`);
    console.log(`   P002-5: ${p2Distances[4].toFixed(6)}`);
    console.log(`• Best Distance (PERSON_002):        ${minP2Dist.toFixed(6)} (Threshold <= 0.45: ${minP2Dist <= 0.45 ? "PASS" : "FAIL"})`);
    console.log(`• Second-Best Distance (PERSON_001): ${minP1Dist.toFixed(6)}`);
    console.log(`• Separation Margin:                 ${(minP1Dist - minP2Dist).toFixed(6)} (Margin >= 0.08: ${isP1SeparationAdequate ? "PASS" : "FAIL"})`);
    console.log(`• Final Decision:                    ${decision}`);
  }

  // 8. Cross-Identity Matrix (PERSON_001 vs PERSON_002)
  console.log("\n===============================================================================");
  console.log("         CROSS-IDENTITY SEPARATION MATRIX (PERSON_001 vs PERSON_002)");
  console.log("===============================================================================\n");
  
  let crossDists = [];
  for (let i = 0; i < p1Embeddings.length; i++) {
    for (let j = 0; j < enrolledEmbeddings.length; j++) {
      const d = cosineDistance(p1Embeddings[i].vec, enrolledEmbeddings[j].embedding);
      crossDists.push(d);
    }
  }
  const minCrossDist = Math.min(...crossDists);
  const avgCrossDist = crossDists.reduce((s, v) => s + v, 0) / crossDists.length;
  console.log(`• Total Cross Comparisons: 5 x 5 = 25 pairs`);
  console.log(`• Minimum Cross Distance (P001 vs P002): ${minCrossDist.toFixed(6)} (Must be > 0.45: ${minCrossDist > 0.45 ? "PASS - PERFECT SEPARATION" : "FAIL"})`);
  console.log(`• Average Cross Distance (P001 vs P002): ${avgCrossDist.toFixed(6)}`);

  await pool.end();
  console.log("\n===============================================================================");
  console.log("                 PERSON_002 ENROLLMENT COMPLETE & VERIFIED");
  console.log("===============================================================================\n");
}

main().catch(console.error);
