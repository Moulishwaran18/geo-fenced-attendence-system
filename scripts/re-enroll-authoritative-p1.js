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
const PHOTOS_DIR = path.join(ROOT, "public", "staff-photos", "person-001");
const DB_JSON_PATH = path.join(ROOT, "data", "staff-db.json");

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
  const b = (syx - sxy) / srcVar; // TRUE UMEYAMA SIGN
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

async function run() {
  console.log("===============================================================================");
  console.log("     AUTHORITATIVE RE-ENROLLMENT OF PERSON_001 (POSTGRESQL + PGVECTOR)");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(path.join(MODELS_DIR, "w600k_mbf.onnx"), { executionProviders: ["wasm"] });

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

    if (detections.length !== 1) {
      throw new Error(`Expected 1 face in ${fileName}, found ${detections.length}`);
    }

    const face = detections[0];
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

    console.log(`[Photo ${i}/5] ${fileName}:`);
    console.log(`  - Dimensions: ${origW}x${origH} | Face Confidence: ${(face.detection.score * 100).toFixed(1)}%`);
    console.log(`  - 5 Corrected Landmarks: [${corrected5.map(p => `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).join(", ")}]`);
    console.log(`  - Raw Norm: ${rawNorm.toFixed(4)} | L2 Unit Norm: ${Math.sqrt(normalizedVec.reduce((s, v) => s + v * v, 0)).toFixed(6)}`);

    enrolledEmbeddings.push({
      id: crypto.randomUUID(),
      reference_image_path: `/staff-photos/person-001/${fileName}`,
      embedding: normalizedVec,
      rawNorm,
    });
  }

  // Update PostgreSQL
  console.log("\n===============================================================================");
  console.log("             UPDATING POSTGRESQL CAMPUS_BIOMETRICS DATABASE");
  console.log("===============================================================================\n");

  const staffRes = await pool.query("SELECT id FROM staff WHERE staff_code = 'PERSON_001'");
  if (staffRes.rows.length === 0) throw new Error("PERSON_001 not found in PostgreSQL staff table");
  const staffId = staffRes.rows[0].id;

  await pool.query("DELETE FROM face_embeddings WHERE staff_id = $1", [staffId]);

  for (const emb of enrolledEmbeddings) {
    const vecStr = `[${emb.embedding.join(",")}]`;
    await pool.query(
      `INSERT INTO face_embeddings (id, staff_id, reference_image_path, embedding, created_at)
       VALUES ($1, $2, $3, $4::vector, NOW())`,
      [emb.id, staffId, emb.reference_image_path, vecStr],
    );
  }

  console.log("✓ PostgreSQL face_embeddings table updated with 5 authoritatively calibrated PERSON_001 records.");

  // Sync staff-db.json backup
  if (fs.existsSync(DB_JSON_PATH)) {
    const dbData = JSON.parse(fs.readFileSync(DB_JSON_PATH, "utf8"));
    dbData.face_embeddings = dbData.face_embeddings.filter((e) => e.staff_code !== "PERSON_001");
    enrolledEmbeddings.forEach((e) => {
      dbData.face_embeddings.push({
        id: e.id,
        staff_id: staffId,
        staff_code: "PERSON_001",
        reference_image_path: e.reference_image_path,
        embedding: e.embedding,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
    fs.writeFileSync(DB_JSON_PATH, JSON.stringify(dbData, null, 2), "utf8");
    console.log("✓ Synchronized backup data/staff-db.json.");
  }

  // Verification Against Frame 30650
  console.log("\n===============================================================================");
  console.log("         TESTING LIVE PHONE FRAME 30650 AGAINST NEW POSTGRESQL EMBEDDINGS");
  console.log("===============================================================================\n");

  const f30650Path = path.join(ROOT, "public", "debug-frames", "frame-30650", "original_camera_frame.jpg");
  const f30650Buf = fs.readFileSync(f30650Path);
  const f30650Img = jpeg.decode(f30650Buf);

  const numPixelsF = f30650Img.width * f30650Img.height;
  const rgbValuesF = new Uint8Array(numPixelsF * 3);
  for (let p = 0; p < numPixelsF; p++) {
    rgbValuesF[p * 3] = f30650Img.data[p * 4];
    rgbValuesF[p * 3 + 1] = f30650Img.data[p * 4 + 1];
    rgbValuesF[p * 3 + 2] = f30650Img.data[p * 4 + 2];
  }

  let tensorF = tf.tensor3d(rgbValuesF, [f30650Img.height, f30650Img.width, 3], "int32");
  const maxDimF = Math.max(f30650Img.height, f30650Img.width);
  let scaleXF = 1.0, scaleYF = 1.0;
  if (maxDimF > 640) {
    const scale = 640 / maxDimF;
    const targetH = Math.round(f30650Img.height * scale);
    const targetW = Math.round(f30650Img.width * scale);
    scaleXF = targetW / f30650Img.width;
    scaleYF = targetH / f30650Img.height;
    const resized = tf.image.resizeBilinear(tensorF, [targetH, targetW]);
    tensorF.dispose();
    tensorF = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detectionsF = await faceapi
    .detectAllFaces(tensorF, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
    .withFaceLandmarks();
  tensorF.dispose();

  const faceF = detectionsF[0];
  const detected5F = extract5Landmarks(faceF.landmarks);
  const corrected5F = detected5F.map(([x, y]) => [x / scaleXF, y / scaleYF]);

  const { planar: planarF } = align112FromRawImage(f30650Img, corrected5F);
  const outF = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", planarF, [1, 3, 112, 112]) });
  const rawVecF = Array.from(outF[session.outputNames[0]].data);
  const normF = Math.sqrt(rawVecF.reduce((s, v) => s + v * v, 0));
  const embF = rawVecF.map((v) => v / normF);

  console.log(`Phone Frame 30650:`);
  console.log(`  - Face Confidence: ${(faceF.detection.score * 100).toFixed(1)}%`);
  console.log(`  - Raw Norm: ${normF.toFixed(4)}`);

  const distances = enrolledEmbeddings.map((e, idx) => {
    const d = cosineDistance(embF, e.embedding);
    console.log(`  - Distance to P001-${idx + 1} (${path.basename(e.reference_image_path)}): ${d.toFixed(6)}`);
    return d;
  });

  const minDist = Math.min(...distances);
  console.log(`\n=> Minimum Distance to PERSON_001: ${minDist.toFixed(6)}`);
  console.log(`=> Match Threshold: 0.45`);
  console.log(`=> Decision: ${minDist <= 0.45 ? "MATCH (PERSON_001) ✓" : "REJECT ✗"}`);

  await pool.end();
}

run().catch(console.error);
