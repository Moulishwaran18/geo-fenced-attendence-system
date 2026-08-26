import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { Pool } from "pg";
import * as ort from "onnxruntime-web";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

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

function computeFloat32Checksum(arr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    const str = val.toFixed(6);
    for (let c = 0; c < str.length; c++) {
      h ^= str.charCodeAt(c);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
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
  const b = (sxy - syx) / srcVar;
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

async function auditFrame(frameId) {
  const frameDir = path.resolve("public", "debug-frames", `frame-${frameId}`);
  if (!fs.existsSync(frameDir)) {
    console.error(`Frame directory not found: ${frameDir}`);
    return;
  }

  const metaPath = path.join(frameDir, "metadata.json");
  const origPath = path.join(frameDir, "original_camera_frame.jpg");
  const alignedPath = path.join(frameDir, "aligned_112x112_image.jpg");

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const origBuf = fs.readFileSync(origPath);
  const origImg = jpeg.decode(origBuf);

  const alignedBuf = fs.readFileSync(alignedPath);
  const alignedImg = jpeg.decode(alignedBuf);

  console.log(`===============================================================================`);
  console.log(`         FORENSIC MOBILE EMBEDDING PIPELINE AUDIT: FRAME ${frameId}`);
  console.log(`===============================================================================\n`);

  // 1. Image and Geometry
  console.log("1. MOBILE CAPTURE GEOMETRY & LANDMARKS:");
  console.log(`   - Original Camera Resolution: ${origImg.width} x ${origImg.height}`);
  console.log(`   - Face Bounding Box: [x: ${meta.faceBox?.x}, y: ${meta.faceBox?.y}, w: ${meta.faceBox?.width}, h: ${meta.faceBox?.height}]`);
  console.log(`   - Detector Confidence: ${((meta.confidence || 0) * 100).toFixed(2)}%`);
  console.log(`   - 5 Facial Landmarks (Mobile Canvas space):`);
  meta.landmarks5.forEach((pt, i) => console.log(`       pt[${i}]: [${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}]`));

  // 2. Tensor Extraction from Aligned Image
  const planar = new Float32Array(3 * 112 * 112);
  let minV = Infinity, maxV = -Infinity, sumV = 0;
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const idx = (y * alignedImg.width + x) * 4;
      const r = alignedImg.data[idx];
      const g = alignedImg.data[idx + 1];
      const b = alignedImg.data[idx + 2];
      const pIdx = y * 112 + x;
      const fR = (r - 127.5) / 128.0;
      const fG = (g - 127.5) / 128.0;
      const fB = (b - 127.5) / 128.0;
      planar[0 * 112 * 112 + pIdx] = fR;
      planar[1 * 112 * 112 + pIdx] = fG;
      planar[2 * 112 * 112 + pIdx] = fB;

      [fR, fG, fB].forEach((v) => {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        sumV += v;
      });
    }
  }

  const meanV = sumV / planar.length;
  const tensorChecksum = computeFloat32Checksum(planar);

  console.log("\n2. FLOAT32 TENSOR PROPERTIES:");
  console.log(`   - Tensor Shape: [1, 3, 112, 112] (Float32 Planar CHW)`);
  console.log(`   - Channel Order: Channel 0=Red, Channel 1=Green, Channel 2=Blue`);
  console.log(`   - Value Range: [${minV.toFixed(4)}, ${maxV.toFixed(4)}]`);
  console.log(`   - Mean Value:  ${meanV.toFixed(4)}`);
  console.log(`   - Tensor Checksum: ${tensorChecksum} (Client: ${meta.tensorChecksum})`);
  console.log(`   - First 10 Tensor Values: [${Array.from(planar.slice(0, 10)).map(v => v.toFixed(4)).join(", ")}]`);

  // 3. ONNX Inference
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), { executionProviders: ["wasm"] });
  const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
  const inputName = session.inputNames[0] || "input.1";
  const outputName = session.outputNames[0] || "516";
  const out = await session.run({ [inputName]: tensor });
  const rawVec = Array.from(out[outputName].data);
  const rawNorm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0)) || 1e-6;
  const backendEmb = rawVec.map((v) => v / rawNorm);
  const embChecksum = computeFloat32Checksum(backendEmb);

  console.log("\n3. EMBEDDING GENERATION (BACKEND RE-INFERENCE):");
  console.log(`   - Output Dimension: ${backendEmb.length}`);
  console.log(`   - Raw Vector Norm:  ${rawNorm.toFixed(6)}`);
  console.log(`   - Normalized Norm:  ${Math.sqrt(backendEmb.reduce((s, v) => s + v * v, 0)).toFixed(6)}`);
  console.log(`   - Embedding Checksum: ${embChecksum} (Client: ${meta.embeddingChecksum})`);
  console.log(`   - First 10 Values: [${backendEmb.slice(0, 10).map(v => v.toFixed(4)).join(", ")}]`);

  // 4. Query PostgreSQL
  const dbRes = await pool.query(`
    SELECT f.id, f.reference_image_path, f.embedding::text, s.staff_code, s.name
    FROM face_embeddings f
    JOIN staff s ON s.id = f.staff_id
    ORDER BY s.staff_code, f.reference_image_path
  `);

  console.log("\n4. POSTGRESQL PGVECTOR DATABASE SEARCH DISTANCES:");
  const distances = [];
  dbRes.rows.forEach((r) => {
    const vec = JSON.parse(r.embedding);
    const d = cosineDistance(backendEmb, vec);
    distances.push({ staffCode: r.staff_code, name: r.name, path: r.reference_image_path, dist: d });
    if (r.staff_code === "PERSON_001") {
      console.log(`   - ${path.basename(r.reference_image_path)}: Cosine Distance = ${d.toFixed(6)}`);
    }
  });

  distances.sort((a, b) => a.dist - b.dist);
  const best = distances[0];
  const secondBest = distances.find(d => d.staffCode !== best.staffCode) || distances[1];
  const margin = secondBest ? secondBest.dist - best.dist : 1.0;

  console.log("\n5. MATCHING DECISION METRICS:");
  console.log(`   - Best Match:        ${best.staffCode} (${best.name})`);
  console.log(`   - Best Distance:     ${best.dist.toFixed(6)}`);
  console.log(`   - Second Best Match: ${secondBest ? secondBest.staffCode : 'N/A'} (Distance: ${secondBest ? secondBest.dist.toFixed(6) : 'N/A'})`);
  console.log(`   - Margin:            ${margin.toFixed(6)} (Required: >= 0.08)`);
  console.log(`   - Threshold:         0.45`);
  console.log(`   - Final Decision:    ${best.dist <= 0.45 && margin >= 0.08 ? `MATCH (${best.staffCode}) ✓` : `UNKNOWN (REJECT) ✗`}`);

  await pool.end();
}

const latestFrameId = process.argv[2] || "30650";
auditFrame(latestFrameId).catch(console.error);
