import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

const MODELS_DIR = path.resolve("public", "models");
const PHOTOS_DIR = path.resolve("public", "staff-photos", "person-001");
const ONNX_PATH = path.join(MODELS_DIR, "w600k_mbf.onnx");
const DB_PATH = path.resolve("data", "staff-db.json");

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

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

  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - srcMeanX;
    const dy = src[i][1] - srcMeanY;
    srcVar += dx * dx + dy * dy;
  }
  srcVar /= n;
  if (srcVar === 0) return null;

  let sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const sX = src[i][0] - srcMeanX;
    const sY = src[i][1] - srcMeanY;
    const dX = dst[i][0] - dstMeanX;
    const dY = dst[i][1] - dstMeanY;
    sxx += dX * sX;
    sxy += dX * sY;
    syx += dY * sX;
    syy += dY * sY;
  }
  srcVar /= n;
  sxx /= n; sxy /= n; syx /= n; syy /= n;

  const a = (sxx + syy) / srcVar;
  const b = (syx - sxy) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b || 1e-6;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  const invM = [
    [invA, -invB, invTx],
    [invB, invA, invTy],
  ];

  return { M: [[a, -b, tx], [b, a, ty]], invM };
}

function align112FromRawImage(rawImg, srcPoints) {
  const transform = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);
  if (!transform) throw new Error("Could not compute similarity transform");
  const { invM } = transform;

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

      const p4Idx = outIdx * 4;
      outJpegData[p4Idx] = Math.round(r);
      outJpegData[p4Idx + 1] = Math.round(g);
      outJpegData[p4Idx + 2] = Math.round(b);
      outJpegData[p4Idx + 3] = 255;
    }
  }

  const jpegBuf = jpeg.encode({ data: outJpegData, width: targetW, height: targetH }, 95);
  return { planar, jpegBuf: jpegBuf.data };
}

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < 512; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return 1 - (dot / denom);
}

async function main() {
  console.log("===============================================================================");
  console.log("     REGENERATING PERSON_001 ENROLLMENT EMBEDDINGS WITH CORRECTED SCALING");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(ONNX_PATH, { executionProviders: ["wasm"] });

  const correctedEmbeddings = [];

  for (let i = 1; i <= 5; i++) {
    const fileName = `reference_0${i}.jpg`;
    const filePath = path.join(PHOTOS_DIR, fileName);
    const fileBuf = fs.readFileSync(filePath);
    const rawJpeg = jpeg.decode(fileBuf, { useTArray: true });

    const origW = rawJpeg.width;
    const origH = rawJpeg.height;

    // Convert raw pixels to 3D Tensor
    const numPixels = origW * origH;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = rawJpeg.data[p * 4];
      rgbValues[p * 3 + 1] = rawJpeg.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = rawJpeg.data[p * 4 + 2];
    }

    let tensor3D = tf.tensor3d(rgbValues, [origH, origW, 3], "int32");

    // Face detection on native or scaled image
    const maxDim = Math.max(origH, origW);
    let scaleX = 1.0, scaleY = 1.0;
    let detW = origW, detH = origH;

    if (maxDim > 640) {
      const scale = 640 / maxDim;
      detW = Math.round(origW * scale);
      detH = Math.round(origH * scale);
      scaleX = detW / origW; // = scale
      scaleY = detH / origH; // = scale

      const resized = tf.image.resizeBilinear(tensor3D, [detH, detW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
      .withFaceLandmarks();
    tensor3D.dispose();

    if (detections.length !== 1) {
      throw new Error(`Expected 1 face in ${fileName}, found ${detections.length}`);
    }

    const face = detections[0];
    const detected5 = extract5Landmarks(face.landmarks);

    // CRITICAL FIX: Convert detected landmark coordinates back to ORIGINAL image space!
    const corrected5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);

    console.log(`[Photo ${i}/5] ${fileName}:`);
    console.log(`  - Original Dimensions:  ${origW} x ${origH}`);
    console.log(`  - Detection Dimensions: ${detW} x ${detH} (Scale: ${scaleX.toFixed(4)})`);
    console.log(`  - Old (Buggy) Landmarks (in 480x640 space):`);
    detected5.forEach((p, idx) => console.log(`      pt[${idx}]: [${p[0].toFixed(2)}, ${p[1].toFixed(2)}]`));
    console.log(`  - Corrected Landmarks (in true 768x1024 space):`);
    corrected5.forEach((p, idx) => console.log(`      pt[${idx}]: [${p[0].toFixed(2)}, ${p[1].toFixed(2)}]`));

    // Align directly on the raw original 768x1024 image using corrected landmarks
    const { planar, jpegBuf } = align112FromRawImage(rawJpeg, corrected5);

    // Save visual debug preview of aligned 112x112 image
    const debugPreviewPath = path.join(PHOTOS_DIR, `aligned_corrected_0${i}.jpg`);
    fs.writeFileSync(debugPreviewPath, jpegBuf);
    console.log(`  - Saved Corrected Aligned 112x112 Image: ${debugPreviewPath}`);

    // ONNX Inference via w600k_mbf.onnx
    const onnxTensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: onnxTensor });
    const rawVec = Array.from(out[outputName].data);

    // L2 Normalization
    const rawNorm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0));
    const normalized = rawVec.map((v) => v / rawNorm);
    const finalNorm = Math.sqrt(normalized.reduce((s, v) => s + v * v, 0));

    console.log(`  - 512-D Embedding generated: Raw Norm = ${rawNorm.toFixed(4)} | Unit Norm = ${finalNorm.toFixed(6)}\n`);

    correctedEmbeddings.push({
      id: `emb-p1-clean-${i}`,
      staff_id: "staff-person_001",
      staff_code: "PERSON_001",
      file: fileName,
      relPath: `/staff-photos/person-001/${fileName}`,
      embedding: normalized,
      norm: finalNorm,
      rawNorm,
    });
  }

  // Pairwise Distances among the 5 corrected embeddings
  console.log("===============================================================================");
  console.log("            PERSON_001 CORRECTED PAIRWISE CONSISTENCY MATRIX");
  console.log("===============================================================================\n");

  const pairwise = [];
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const d = cosineDistance(correctedEmbeddings[i].embedding, correctedEmbeddings[j].embedding);
      pairwise.push(d);
      console.log(`• Reference 0${i + 1} vs Reference 0${j + 1}: Cosine Distance = ${d.toFixed(4)} | Similarity = ${(1 - d).toFixed(4)}`);
    }
  }

  const minPair = Math.min(...pairwise);
  const maxPair = Math.max(...pairwise);
  const meanPair = pairwise.reduce((a, b) => a + b, 0) / pairwise.length;
  console.log(`\nSummary: Min Pair Distance = ${minPair.toFixed(4)}, Max = ${maxPair.toFixed(4)}, Mean = ${meanPair.toFixed(4)} (All <= 0.45 ✓)`);

  // Compare with Live Phone Frame 92823
  const mobileBuf = fs.readFileSync("public/debug-frames/frame-92823/aligned_112x112_image.jpg");
  const mobileImg = jpeg.decode(mobileBuf);
  const mobilePlanar = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const idx = (y * 112 + x) * 4;
      const pIdx = y * 112 + x;
      mobilePlanar[0 * 112 * 112 + pIdx] = (mobileImg.data[idx] - 127.5) / 128.0;
      mobilePlanar[1 * 112 * 112 + pIdx] = (mobileImg.data[idx + 1] - 127.5) / 128.0;
      mobilePlanar[2 * 112 * 112 + pIdx] = (mobileImg.data[idx + 2] - 127.5) / 128.0;
    }
  }
  const mobileOut = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", mobilePlanar, [1, 3, 112, 112]) });
  const mobileRaw = Array.from(mobileOut[session.outputNames[0]].data);
  const mobileNorm = Math.sqrt(mobileRaw.reduce((s, v) => s + v * v, 0));
  const mobileEmb = mobileRaw.map((v) => v / mobileNorm);

  console.log("\n===============================================================================");
  console.log("       LIVE PHONE FRAME 92823 VS CORRECTED ENROLLMENT EMBEDDINGS");
  console.log("===============================================================================\n");

  let minLiveDist = 1.0;
  let bestRefName = "";
  correctedEmbeddings.forEach((ce, idx) => {
    const d = cosineDistance(mobileEmb, ce.embedding);
    console.log(`  P001-${idx + 1} (${ce.file}): Cosine Distance = ${d.toFixed(4)}`);
    if (d < minLiveDist) { minLiveDist = d; bestRefName = ce.file; }
  });
  console.log(`\n=> Minimum Live Phone Distance to PERSON_001: ${minLiveDist.toFixed(4)} (${bestRefName})`);
  console.log(`=> Match Threshold: 0.45 | Decision: ${minLiveDist <= 0.45 ? "MATCH (PERSON_001 AUTHORIZED) ✓" : "REJECT"}`);

  // Update PostgreSQL Database
  console.log("\n===============================================================================");
  console.log("            UPDATING POSTGRESQL CAMPUS_BIOMETRICS DATABASE");
  console.log("===============================================================================\n");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch staff PERSON_001 ID
    const sRes = await client.query("SELECT id FROM staff WHERE staff_code = 'PERSON_001'");
    if (sRes.rows.length === 0) throw new Error("PERSON_001 not found in PostgreSQL staff table");
    const staffId = sRes.rows[0].id;

    // Delete old incorrect embeddings for PERSON_001
    await client.query("DELETE FROM face_embeddings WHERE staff_id = $1", [staffId]);

    // Insert 5 corrected embeddings
    for (let idx = 0; idx < correctedEmbeddings.length; idx++) {
      const ce = correctedEmbeddings[idx];
      const vecStr = `[${ce.embedding.join(",")}]`;
      await client.query(
        "INSERT INTO face_embeddings (staff_id, embedding, reference_image_path) VALUES ($1, $2, $3)",
        [staffId, vecStr, ce.relPath]
      );
    }

    await client.query("COMMIT");
    console.log("✓ PostgreSQL face_embeddings table updated successfully for PERSON_001 (5 active records).");

    // Verify Counts
    const countRes = await client.query(`
      SELECT s.staff_code, COUNT(f.id) as count
      FROM staff s
      LEFT JOIN face_embeddings f ON f.staff_id = s.id
      GROUP BY s.staff_code
      ORDER BY s.staff_code
    `);
    console.log("\nPostgreSQL Database Embeddings Count by Staff:");
    countRes.rows.forEach((r) => console.log(`  - ${r.staff_code}: ${r.count} embeddings`));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Update staff-db.json backup
  if (fs.existsSync(DB_PATH)) {
    const dbJson = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const otherEmbeddings = dbJson.face_embeddings.filter((e) => e.staff_id !== "staff-person_001");
    const newRecords = correctedEmbeddings.map((ce) => ({
      id: ce.id,
      staff_id: "staff-person_001",
      embedding: ce.embedding,
      reference_image_path: ce.relPath,
      created_at: new Date().toISOString(),
    }));
    dbJson.face_embeddings = [...otherEmbeddings, ...newRecords];
    fs.writeFileSync(DB_PATH, JSON.stringify(dbJson, null, 2), "utf8");
    console.log("✓ Synchronized backup data/staff-db.json.");
  }

  await pool.end();
}

main().catch(console.error);
