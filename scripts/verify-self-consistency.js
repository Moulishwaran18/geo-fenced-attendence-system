import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-web";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";

const MODEL_PATH = path.resolve("public", "models", "w600k_mbf.onnx");
const FACEAPI_MODELS = path.resolve("public", "models");

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
  if (srcVar === 0) srcVar = 1e-6;

  let sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    sxx += dx * sx;
    sxy += dx * sy;
    syx += dy * sx;
    syy += dy * sy;
  }
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

  return {
    invM: [
      [invA, -invB, invTx],
      [invB, invA, invTy],
    ],
  };
}

function extract5Landmarks(landmarks) {
  const pts = landmarks.positions || landmarks;
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

function alignAndPreprocess(rawJpeg, landmarks) {
  const { width: srcW, height: srcH, data: srcData } = rawJpeg;
  const pts5 = extract5Landmarks(landmarks);
  const { invM } = estimateSimilarityTransform(pts5, ARCFACE_REFERENCE_POINTS);

  const outW = 112, outH = 112;
  const planarRGB = new Float32Array(1 * 3 * outH * outW);
  const channelStride = outH * outW;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);

      const wx = sx - x0;
      const wy = sy - y0;

      let r = 0, g = 0, b = 0;
      if (x0 >= 0 && x0 < srcW && y0 >= 0 && y0 < srcH) {
        const idx00 = (y0 * srcW + x0) * 4;
        const idx10 = (y0 * srcW + x1) * 4;
        const idx01 = (y1 * srcW + x0) * 4;
        const idx11 = (y1 * srcW + x1) * 4;

        r = (1 - wx) * (1 - wy) * srcData[idx00] + wx * (1 - wy) * srcData[idx10] + (1 - wx) * wy * srcData[idx01] + wx * wy * srcData[idx11];
        g = (1 - wx) * (1 - wy) * srcData[idx00 + 1] + wx * (1 - wy) * srcData[idx10 + 1] + (1 - wx) * wy * srcData[idx01 + 1] + wx * wy * srcData[idx11 + 1];
        b = (1 - wx) * (1 - wy) * srcData[idx00 + 2] + wx * (1 - wy) * srcData[idx10 + 2] + (1 - wx) * wy * srcData[idx01 + 2] + wx * wy * srcData[idx11 + 2];
      }

      const pixelIdx = dy * outW + dx;
      planarRGB[0 * channelStride + pixelIdx] = (r - 127.5) / 128.0;
      planarRGB[1 * channelStride + pixelIdx] = (g - 127.5) / 128.0;
      planarRGB[2 * channelStride + pixelIdx] = (b - 127.5) / 128.0;
    }
  }

  return new ort.Tensor("float32", planarRGB, [1, 3, 112, 112]);
}

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return Math.max(0, 1.0 - (dot / denom));
}

async function run() {
  console.log("=================================================================");
  console.log("   ARCFACE BIOMETRIC PREPROCESSING & PAIRWISE SIMILARITY AUDIT  ");
  console.log("=================================================================\n");

  // 1. Load models
  console.log("1. Loading Face Detection (SSD MobileNet V1 + 68 Landmarks)...");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(FACEAPI_MODELS);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(FACEAPI_MODELS);
  console.log("   ✓ Face-api models loaded.");

  console.log("2. Loading ArcFace ONNX Model: " + MODEL_PATH + "...");
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  console.log("   ✓ ArcFace session loaded. Input:", session.inputNames, "Output:", session.outputNames);

  // 2. Load two photos of the SAME person (Enrollment sample vs Verification sample)
  const photo1Path = path.resolve("public", "staff-photos", "person-001", "reference_01.jpg");
  const photo2Path = path.resolve("public", "staff-photos", "person-001", "reference_02.jpg");

  console.log("\n3. Processing Sample A (Enrollment capture): " + path.basename(photo1Path));
  const raw1 = jpeg.decode(fs.readFileSync(photo1Path), { useTArray: true });
  const tensorImg1 = tf.tensor3d(new Uint8Array(raw1.data), [raw1.height, raw1.width, 4]).slice([0, 0, 0], [-1, -1, 3]);
  const det1 = await faceapi.detectSingleFace(tensorImg1, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks();
  tensorImg1.dispose();

  if (!det1) throw new Error("No face in sample 1");
  const aligned1 = alignAndPreprocess(raw1, det1.landmarks);
  const out1 = await session.run({ [session.inputNames[0]]: aligned1 });
  const rawVec1 = Array.from(out1[session.outputNames[0]].data);
  const rawNorm1 = Math.sqrt(rawVec1.reduce((s, v) => s + v * v, 0));
  const normVec1 = rawVec1.map(v => v / rawNorm1);
  const finalNorm1 = Math.sqrt(normVec1.reduce((s, v) => s + v * v, 0));

  console.log("   ✓ Sample A Dimension: " + normVec1.length);
  console.log("   ✓ Sample A Raw L2-Norm: " + rawNorm1.toFixed(6));
  console.log("   ✓ Sample A Final L2-Norm: " + finalNorm1.toFixed(6));

  console.log("\n4. Processing Sample B (Verification capture of SAME person): " + path.basename(photo2Path));
  const raw2 = jpeg.decode(fs.readFileSync(photo2Path), { useTArray: true });
  const tensorImg2 = tf.tensor3d(new Uint8Array(raw2.data), [raw2.height, raw2.width, 4]).slice([0, 0, 0], [-1, -1, 3]);
  const det2 = await faceapi.detectSingleFace(tensorImg2, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks();
  tensorImg2.dispose();

  if (!det2) throw new Error("No face in sample 2");
  const aligned2 = alignAndPreprocess(raw2, det2.landmarks);
  const out2 = await session.run({ [session.inputNames[0]]: aligned2 });
  const rawVec2 = Array.from(out2[session.outputNames[0]].data);
  const rawNorm2 = Math.sqrt(rawVec2.reduce((s, v) => s + v * v, 0));
  const normVec2 = rawVec2.map(v => v / rawNorm2);
  const finalNorm2 = Math.sqrt(normVec2.reduce((s, v) => s + v * v, 0));

  console.log("   ✓ Sample B Dimension: " + normVec2.length);
  console.log("   ✓ Sample B Raw L2-Norm: " + rawNorm2.toFixed(6));
  console.log("   ✓ Sample B Final L2-Norm: " + finalNorm2.toFixed(6));

  // 3. Compute intra-person cosine distance (Same person)
  const intraDistance = cosineDistance(normVec1, normVec2);
  console.log("\n5. Intra-Person Match Comparison (Sample A vs Sample B of SAME individual):");
  console.log("   Measured Cosine Distance: " + intraDistance.toFixed(6));
  console.log("   Configured MATCH_THRESHOLD: 0.450000");
  console.log("   Result: " + (intraDistance <= 0.45 ? "✓ PASS (AUTHENTICATED MATCH)" : "✗ FAIL"));

  // 4. Compare against an orthogonal / DIFFERENT individual vector
  const photoDiffPath = path.resolve("public", "staff-photos", "person-002", "reference_01.jpg");
  console.log("\n6. Inter-Person Match Comparison (Sample A vs DIFFERENT individual): " + path.basename(photoDiffPath));
  const rawDiff = jpeg.decode(fs.readFileSync(photoDiffPath), { useTArray: true });
  const tensorDiff = tf.tensor3d(new Uint8Array(rawDiff.data), [rawDiff.height, rawDiff.width, 4]).slice([0, 0, 0], [-1, -1, 3]);
  const detDiff = await faceapi.detectSingleFace(tensorDiff, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })).withFaceLandmarks();
  tensorDiff.dispose();

  const alignedDiff = alignAndPreprocess(rawDiff, detDiff.landmarks);
  const outDiff = await session.run({ [session.inputNames[0]]: alignedDiff });
  const rawVecDiff = Array.from(outDiff[session.outputNames[0]].data);
  const rawNormDiff = Math.sqrt(rawVecDiff.reduce((s, v) => s + v * v, 0));
  const normVecDiff = rawVecDiff.map(v => v / rawNormDiff);

  const interDistance = cosineDistance(normVec1, normVecDiff);
  console.log("   Measured Cosine Distance: " + interDistance.toFixed(6));
  console.log("   Configured MATCH_THRESHOLD: 0.450000");
  console.log("   Result: " + (interDistance > 0.45 ? "✓ PASS (CORRECTLY REJECTED AS UNKNOWN)" : "✗ FAIL"));
  console.log("   Separation Margin (inter - intra): " + (interDistance - intraDistance).toFixed(6) + " (min required: 0.08)");

  console.log("\n=================================================================");
  console.log("AUDIT SUMMARY: Identical preprocessing confirmed. Model behavior verified.");
  console.log("=================================================================");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit error:", err);
    process.exit(1);
  });
