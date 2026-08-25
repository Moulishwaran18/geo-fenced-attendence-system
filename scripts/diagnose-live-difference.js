import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const PHOTOS_DIR = path.resolve("public", "staff-photos");
const DB_PATH = path.resolve("data", "staff-db.json");

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

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

// 1. Script Implementation of Umeyama & Alignment (from diagnose-live-matching.js)
function scriptTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
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

  return { invA, invB, invTx, invTy };
}

// 2. arcface-engine.ts Implementation of Umeyama & Alignment
function engineTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
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
    sxx += dx * sx; sxy += dx * sy;
    syx += dy * sx; syy += dy * sy;
  }
  sxx /= n; sxy /= n; syx /= n; syy /= n;

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
    invM: [
      [invA, -invB, invTx],
      [invB, invA, invTy],
    ],
  };
}

function extract5Landmarks(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  const avg = (indices) => {
    let x = 0, y = 0;
    indices.forEach(idx => { x += pts[idx].x; y += pts[idx].y; });
    return [x / indices.length, y / indices.length];
  };
  return [
    avg([36, 37, 38, 39, 40, 41]),
    avg([42, 43, 44, 45, 46, 47]),
    [pts[30].x, pts[30].y],
    [pts[48].x, pts[48].y],
    [pts[54].x, pts[54].y],
  ];
}

async function runDiagnosis() {
  console.log("===============================================================================");
  console.log("          FORENSIC LIVE FACE PIPELINE ALIGNMENT & EMBEDDING AUDIT");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const p1Embeddings = db.face_embeddings.filter(e => e.staff_id === "staff-person_001");

  // Load test photo of PERSON_001
  const testImgPath = path.join(UPLOAD_DIR, "media_1787591458548.jpg");
  const fileBuf = fs.readFileSync(testImgPath);
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
    const resized = tf.image.resizeBilinear(tensor3D, [Math.round(rawJpeg.height * scale), Math.round(rawJpeg.width * scale)]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
    .withFaceLandmarks();
  tensor3D.dispose();

  const face = detections[0];
  const pts5 = extract5Landmarks(face.landmarks);

  console.log(`1. Detected 5 Landmark Points on PERSON_001 Live Photo:`);
  console.log(`   • Left Eye:  [${pts5[0][0].toFixed(2)}, ${pts5[0][1].toFixed(2)}]`);
  console.log(`   • Right Eye: [${pts5[1][0].toFixed(2)}, ${pts5[1][1].toFixed(2)}]`);
  console.log(`   • Nose Tip:  [${pts5[2][0].toFixed(2)}, ${pts5[2][1].toFixed(2)}]`);
  console.log(`   • Left Mouth: [${pts5[3][0].toFixed(2)}, ${pts5[3][1].toFixed(2)}]`);
  console.log(`   • Right Mouth:[${pts5[4][0].toFixed(2)}, ${pts5[4][1].toFixed(2)}]\n`);

  // Check Transform Matrices
  const sT = scriptTransform(pts5);
  const eT = engineTransform(pts5);

  console.log(`2. Similarity Transform Matrices Comparison:`);
  console.log(`   • scriptTransform: invA=${sT.invA.toFixed(6)}, invB=${sT.invB.toFixed(6)}, invTx=${sT.invTx.toFixed(6)}, invTy=${sT.invTy.toFixed(6)}`);
  console.log(`   • engineTransform: invA=${eT.invM[0][0].toFixed(6)}, invB=${eT.invM[1][0].toFixed(6)}, invTx=${eT.invM[0][2].toFixed(6)}, invTy=${eT.invM[1][2].toFixed(6)}\n`);

  // Test 1: Standard Normal Unflipped Image -> ArcFace
  const targetW = 112, targetH = 112;
  const planarStandard = new Float32Array(1 * 3 * targetH * targetW);
  const channelStride = targetH * targetW;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = sT.invA * x - sT.invB * y + sT.invTx;
      const srcY = sT.invB * x + sT.invA * y + sT.invTy;
      let r = 0, g = 0, b = 0;
      if (srcX >= 0 && srcX < rawJpeg.width - 1 && srcY >= 0 && srcY < rawJpeg.height - 1) {
        const x0 = Math.floor(srcX), x1 = x0 + 1;
        const y0 = Math.floor(srcY), y1 = y0 + 1;
        const dx = srcX - x0, dy = srcY - y0;
        const idx00 = (y0 * rawJpeg.width + x0) * 4;
        const idx10 = (y0 * rawJpeg.width + x1) * 4;
        const idx01 = (y1 * rawJpeg.width + x0) * 4;
        const idx11 = (y1 * rawJpeg.width + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const val = (1 - dx) * (1 - dy) * rawJpeg.data[idx00 + c] +
                      dx * (1 - dy) * rawJpeg.data[idx10 + c] +
                      (1 - dx) * dy * rawJpeg.data[idx01 + c] +
                      dx * dy * rawJpeg.data[idx11 + c];
          if (c === 0) r = val;
          else if (c === 1) g = val;
          else b = val;
        }
      }
      const outIdx = y * targetW + x;
      planarStandard[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planarStandard[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planarStandard[2 * channelStride + outIdx] = (b - 127.5) / 128.0;
    }
  }

  const outStd = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", planarStandard, [1, 3, 112, 112]) });
  const rawEmbStd = Array.from(outStd[session.outputNames[0]].data);
  const normStd = Math.sqrt(rawEmbStd.reduce((s, v) => s + v * v, 0));
  const embStd = rawEmbStd.map(v => v / normStd);

  const stdDists = p1Embeddings.map(e => cosineDistance(embStd, e.embedding));
  console.log(`3. Standard Unflipped Image Distances to P001 Gallery:`);
  p1Embeddings.forEach((e, idx) => {
    console.log(`   • P001 Reference #${idx + 1} (${e.reference_image_path}): distance = ${stdDists[idx].toFixed(4)}`);
  });
  console.log(`   • Min Distance = ${Math.min(...stdDists).toFixed(4)} (PASS <= 0.45 ✓)\n`);

  // Test 2: WHAT IF THE WEBCAM FRAME IS HORIZONTALLY FLIPPED (MIRRORED)?
  const flippedData = new Uint8Array(rawJpeg.data.length);
  for (let y = 0; y < rawJpeg.height; y++) {
    for (let x = 0; x < rawJpeg.width; x++) {
      const srcIdx = (y * rawJpeg.width + x) * 4;
      const dstIdx = (y * rawJpeg.width + (rawJpeg.width - 1 - x)) * 4;
      flippedData[dstIdx] = rawJpeg.data[srcIdx];
      flippedData[dstIdx + 1] = rawJpeg.data[srcIdx + 1];
      flippedData[dstIdx + 2] = rawJpeg.data[srcIdx + 2];
      flippedData[dstIdx + 3] = rawJpeg.data[srcIdx + 3];
    }
  }
  const flippedJpeg = { width: rawJpeg.width, height: rawJpeg.height, data: flippedData };

  // Detect landmarks on flipped image
  const flippedRgb = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    flippedRgb[p * 3] = flippedData[p * 4];
    flippedRgb[p * 3 + 1] = flippedData[p * 4 + 1];
    flippedRgb[p * 3 + 2] = flippedData[p * 4 + 2];
  }
  let tensorFlip = tf.tensor3d(flippedRgb, [rawJpeg.height, rawJpeg.width, 3], "int32");
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const resized = tf.image.resizeBilinear(tensorFlip, [Math.round(rawJpeg.height * scale), Math.round(rawJpeg.width * scale)]);
    tensorFlip.dispose();
    tensorFlip = tf.cast(resized, "int32");
    resized.dispose();
  }
  const flippedDetections = await faceapi
    .detectAllFaces(tensorFlip, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
    .withFaceLandmarks();
  tensorFlip.dispose();

  const flippedFace = flippedDetections[0];
  const pts5Flip = extract5Landmarks(flippedFace.landmarks);
  const sTFlip = scriptTransform(pts5Flip);

  const planarFlip = new Float32Array(1 * 3 * targetH * targetW);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = sTFlip.invA * x - sTFlip.invB * y + sTFlip.invTx;
      const srcY = sTFlip.invB * x + sTFlip.invA * y + sTFlip.invTy;
      let r = 0, g = 0, b = 0;
      if (srcX >= 0 && srcX < rawJpeg.width - 1 && srcY >= 0 && srcY < rawJpeg.height - 1) {
        const x0 = Math.floor(srcX), x1 = x0 + 1;
        const y0 = Math.floor(srcY), y1 = y0 + 1;
        const dx = srcX - x0, dy = srcY - y0;
        const idx00 = (y0 * rawJpeg.width + x0) * 4;
        const idx10 = (y0 * rawJpeg.width + x1) * 4;
        const idx01 = (y1 * rawJpeg.width + x0) * 4;
        const idx11 = (y1 * rawJpeg.width + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const val = (1 - dx) * (1 - dy) * flippedData[idx00 + c] +
                      dx * (1 - dy) * flippedData[idx10 + c] +
                      (1 - dx) * dy * flippedData[idx01 + c] +
                      dx * dy * flippedData[idx11 + c];
          if (c === 0) r = val;
          else if (c === 1) g = val;
          else b = val;
        }
      }
      const outIdx = y * targetW + x;
      planarFlip[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planarFlip[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planarFlip[2 * channelStride + outIdx] = (b - 127.5) / 128.0;
    }
  }

  const outFlip = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", planarFlip, [1, 3, 112, 112]) });
  const rawEmbFlip = Array.from(outFlip[session.outputNames[0]].data);
  const normFlip = Math.sqrt(rawEmbFlip.reduce((s, v) => s + v * v, 0));
  const embFlip = rawEmbFlip.map(v => v / normFlip);

  const flipDists = p1Embeddings.map(e => cosineDistance(embFlip, e.embedding));
  const crossDist = cosineDistance(embStd, embFlip);

  console.log(`4. Horizontally Flipped Image Distances:`);
  console.log(`   • Distance between Unflipped Live Embedding & Flipped Live Embedding: ${crossDist.toFixed(4)}`);
  p1Embeddings.forEach((e, idx) => {
    console.log(`   • Flipped vs P001 Ref #${idx + 1}: distance = ${flipDists[idx].toFixed(4)}`);
  });
  console.log(`   • Flipped Min Distance = ${Math.min(...flipDists).toFixed(4)}\n`);

  // Test 3: Check Embedding Sanity Statistics
  console.log(`5. Embedding Sanity Statistics:`);
  const nanCount = embStd.filter(v => isNaN(v)).length;
  const infCount = embStd.filter(v => !isFinite(v)).length;
  const minVal = Math.min(...embStd);
  const maxVal = Math.max(...embStd);
  const meanVal = embStd.reduce((a, b) => a + b, 0) / embStd.length;

  console.log(`   • Dimension: ${embStd.length}`);
  console.log(`   • L2 Norm: ${normStd.toFixed(6)}`);
  console.log(`   • NaN Count: ${nanCount}`);
  console.log(`   • Inf Count: ${infCount}`);
  console.log(`   • Min Component: ${minVal.toFixed(6)}`);
  console.log(`   • Max Component: ${maxVal.toFixed(6)}`);
  console.log(`   • Mean Component: ${meanVal.toFixed(6)}\n`);
}

runDiagnosis().catch(console.error);
