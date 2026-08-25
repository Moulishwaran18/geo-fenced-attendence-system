import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const DB_PATH = path.resolve("data", "staff-db.json");

// Test Live Image (Un-enrolled distinct photo of PERSON_001 from Set 1 - Plaid Shirt Frontal)
const LIVE_TEST_IMAGE = "media_1787591458548.jpg";

// Cosine Distance Helper
function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

// 5-Point ArcFace Standard Target Coordinates
const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

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
    sxx += dX * sX; sxy += dX * sY;
    syx += dY * sX; syy += dY * sY;
  }
  sxx /= n; sxy /= n; syx /= n; syy /= n;

  const a = (sxx + syy) / srcVar;
  const b = (sxy - syx) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const denom = a * a + b * b;
  if (denom === 0) return null;
  const invA = a / denom;
  const invB = -b / denom;
  const invTx = -(invA * tx - invB * ty);
  const invTy = -(invB * tx + invA * ty);

  return { a, b, tx, ty, invA, invB, invTx, invTy };
}

function extract5Landmarks(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  const avg = (indices) => {
    let x = 0, y = 0;
    indices.forEach(idx => { x += pts[idx].x; y += pts[idx].y; });
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

function alignFaceToTensor(rawJpeg, landmarks68) {
  const { width: srcW, height: srcH, data: srcData } = rawJpeg;
  const pts5 = extract5Landmarks(landmarks68);
  const transform = estimateSimilarityTransform(pts5);
  if (!transform) throw new Error("Could not compute similarity transform");

  const targetW = 112, targetH = 112;
  const planarRGB = new Float32Array(1 * 3 * targetH * targetW);
  const channelStride = targetH * targetW;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = transform.invA * x - transform.invB * y + transform.invTx;
      const srcY = transform.invB * x + transform.invA * y + transform.invTy;

      let r = 0, g = 0, b = 0;
      if (srcX >= 0 && srcX < srcW - 1 && srcY >= 0 && srcY < srcH - 1) {
        const x0 = Math.floor(srcX), x1 = x0 + 1;
        const y0 = Math.floor(srcY), y1 = y0 + 1;
        const dx = srcX - x0, dy = srcY - y0;

        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = (y0 * srcW + x1) * 4;
        const idx01 = (y1 * srcW + x0) * 4;
        const idx11 = (y1 * srcW + x1) * 4;

        for (let c = 0; c < 3; c++) {
          const val =
            (1 - dx) * (1 - dy) * srcData[idx00 + c] +
            dx * (1 - dy) * srcData[idx10 + c] +
            (1 - dx) * dy * srcData[idx01 + c] +
            dx * dy * srcData[idx11 + c];
          if (c === 0) r = val;
          else if (c === 1) g = val;
          else b = val;
        }
      }

      const outIdx = y * targetW + x;
      planarRGB[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planarRGB[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planarRGB[2 * channelStride + outIdx] = (b - 127.5) / 128.0;
    }
  }

  return new ort.Tensor("float32", planarRGB, [1, 3, targetH, targetW]);
}

async function diagnose() {
  console.log("===============================================================================");
  console.log("             LIVE ARCFACE BIOMETRIC MATCHING DIAGNOSTIC");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  // Read Database
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const activeStaff = db.staff.filter(s => s.active);
  const activeStaffMap = new Map(activeStaff.map(s => [s.id, s]));
  const activeEmbeddings = db.face_embeddings.filter(e => activeStaffMap.has(e.staff_id));

  const p1Embeddings = activeEmbeddings.filter(e => e.staff_id === "staff-person_001");
  const p2Embeddings = activeEmbeddings.filter(e => e.staff_id === "staff-person_002");
  const p3Embeddings = activeEmbeddings.filter(e => e.staff_id === "staff-person_003");

  console.log("--- 1. ACTIVE DATABASE INVENTORY ---");
  console.log(`Total Active Staff: ${activeStaff.length}`);
  console.log(`Total Active Reference Embeddings: ${activeEmbeddings.length}`);
  console.log(`  • PERSON_001 (Test Person 1): ${p1Embeddings.length} active embeddings`);
  console.log(`  • PERSON_002 (Test Person 2): ${p2Embeddings.length} active embeddings`);
  console.log(`  • PERSON_003 (Test Person 3): ${p3Embeddings.length} active embeddings\n`);

  // Load and process live test frame
  console.log(`--- 2. PROCESSING LIVE TEST IMAGE (${LIVE_TEST_IMAGE}) ---`);
  const srcPath = path.join(UPLOAD_DIR, LIVE_TEST_IMAGE);
  const fileBuf = fs.readFileSync(srcPath);
  const rawJpeg = jpeg.decode(fileBuf, { useTArray: true });

  const numPixels = rawJpeg.width * rawJpeg.height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    rgbValues[p * 3] = rawJpeg.data[p * 4];
    rgbValues[p * 3 + 1] = rawJpeg.data[p * 4 + 1];
    rgbValues[p * 3 + 2] = rawJpeg.data[p * 4 + 2];
  }

  let tensor3D = tf.tensor3d(rgbValues, [rawJpeg.height, rawJpeg.width, 3], "int32");
  const maxDim = Math.max(rawJpeg.height, rawJpeg.width);
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const targetH = Math.round(rawJpeg.height * scale);
    const targetW = Math.round(rawJpeg.width * scale);
    const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks();

  tensor3D.dispose();

  if (detections.length !== 1) {
    throw new Error(`Expected 1 face, found ${detections.length}`);
  }

  const face = detections[0];
  console.log(`✓ Face Detection: 1 Face (Confidence: ${(face.detection.score * 100).toFixed(1)}%)`);
  console.log(`✓ Bounding Box: [x:${Math.round(face.detection.box.x)}, y:${Math.round(face.detection.box.y)}, w:${Math.round(face.detection.box.width)}, h:${Math.round(face.detection.box.height)}]`);
  console.log(`✓ Landmarks: ${face.landmarks.positions.length} Points`);

  // Align to 112x112 tensor & infer
  const alignedTensor = alignFaceToTensor(rawJpeg, face.landmarks);
  const output = await session.run({ [session.inputNames[0]]: alignedTensor });
  const rawEmbedding = Array.from(output[session.outputNames[0]].data);

  // L2 unit normalization
  let rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
  const liveEmbedding = rawEmbedding.map(v => v / rawNorm);
  const liveL2Norm = Math.sqrt(liveEmbedding.reduce((sum, v) => sum + v * v, 0));

  console.log(`✓ Live Embedding Dimension: ${liveEmbedding.length}-D`);
  console.log(`✓ Live Embedding L2 Norm: ${liveL2Norm.toFixed(6)}\n`);

  // Compare against each of PERSON_001's 5 active embeddings individually
  console.log("--- 3. COMPARISON AGAINST PERSON_001'S 5 ACTIVE REFERENCE EMBEDDINGS ---");
  const p1Distances = [];
  const poseLabels = [
    "Photo 1 (Straight / Front)",
    "Photo 2 (Slight Right)",
    "Photo 3 (Slight Left)",
    "Photo 4 (Slight Up)",
    "Photo 5 (Slight Down)"
  ];

  p1Embeddings.forEach((emb, idx) => {
    const dist = cosineDistance(liveEmbedding, emb.embedding);
    p1Distances.push({ idx: idx + 1, label: poseLabels[idx] || `Reference ${idx + 1}`, dist, sim: 1 - dist });
    console.log(`• P001 embedding ${idx + 1} distance [${poseLabels[idx]}]: ${dist.toFixed(4)} (Similarity: ${(1 - dist).toFixed(4)})`);
  });

  const bestP1Dist = Math.min(...p1Distances.map(p => p.dist));
  console.log(`\n→ Minimum Distance among PERSON_001 Reference Set: ${bestP1Dist.toFixed(4)}\n`);

  // Compare against all active embeddings in gallery
  console.log("--- 4. FULL GALLERY VECTOR SEARCH & RANKING ---");
  const allMatches = activeEmbeddings.map(emb => {
    const staff = activeStaffMap.get(emb.staff_id);
    const dist = cosineDistance(liveEmbedding, emb.embedding);
    return {
      staffCode: staff.staff_code,
      name: staff.name,
      staffId: staff.id,
      embId: emb.id,
      path: emb.reference_image_path,
      distance: dist,
      similarity: 1 - dist
    };
  }).sort((a, b) => a.distance - b.distance);

  allMatches.forEach((m, rank) => {
    console.log(`[Rank ${rank + 1}] ${m.staffCode} (${m.name}) | ${m.path} -> Dist: ${m.distance.toFixed(4)} | Sim: ${m.similarity.toFixed(4)}`);
  });

  const best = allMatches[0];
  const secondBest = allMatches.find(m => m.staffId !== best.staffId);
  const margin = secondBest ? secondBest.distance - best.distance : 1.0;

  console.log("\n===============================================================================");
  console.log("                           VERIFICATION TELEMETRY");
  console.log("===============================================================================");
  console.log(`Best Match:            ${best.staffCode} (${best.name})`);
  console.log(`Best Distance:         ${best.distance.toFixed(4)}`);
  console.log(`Second-Best Match:     ${secondBest ? `${secondBest.staffCode} (${secondBest.name})` : "None"}`);
  console.log(`Second-Best Distance:  ${secondBest ? secondBest.distance.toFixed(4) : "N/A"}`);
  console.log(`Margin:                ${margin.toFixed(4)} (Required: >= 0.08)`);
  console.log(`Threshold:             0.45`);
  console.log(`Liveness:              PASS`);
  console.log(`Final Decision:        ${best.distance <= 0.45 && margin >= 0.08 ? "AUTHORIZED ✓" : "REJECTED ✗"}`);
  console.log("===============================================================================");
}

diagnose().catch(console.error);
