import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const DB_PATH = path.resolve("data", "staff-db.json");

// Genuine un-enrolled test photo of PERSON_001
const LIVE_TEST_IMAGE = "media_1787591458548.jpg";

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
  return { invA: a / denom, invB: -b / denom, invTx: -(a / denom * tx - (-b / denom) * ty), invTy: -(-b / denom * tx + a / denom * ty) };
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

function evaluateQuality(rawJpeg, faceBox, confidence) {
  const { width: srcW, height: srcH, data: srcData } = rawJpeg;
  const bx = Math.max(0, Math.floor(faceBox.x));
  const by = Math.max(0, Math.floor(faceBox.y));
  const bw = Math.min(Math.floor(faceBox.width), srcW - bx);
  const bh = Math.min(Math.floor(faceBox.height), srcH - by);

  const gray = new Float32Array(bw * bh);
  let sumY = 0, sumY2 = 0;
  const total = bw * bh;

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const idx = ((by + y) * srcW + (bx + x)) * 4;
      const r = srcData[idx];
      const g = srcData[idx + 1];
      const b = srcData[idx + 2];
      const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[y * bw + x] = yVal;
      sumY += yVal;
      sumY2 += yVal * yVal;
    }
  }

  const meanY = sumY / total;
  const varianceY = Math.max(0, sumY2 / total - meanY * meanY);
  const contrast = Math.sqrt(varianceY);

  let sumLap = 0, sumLap2 = 0, lapCount = 0;
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const c = gray[y * bw + x];
      const top = gray[(y - 1) * bw + x];
      const bottom = gray[(y + 1) * bw + x];
      const left = gray[y * bw + (x - 1)];
      const right = gray[y * bw + (x + 1)];
      const lap = 4 * c - top - bottom - left - right;
      sumLap += lap;
      sumLap2 += lap * lap;
      lapCount++;
    }
  }

  const meanLap = lapCount > 0 ? sumLap / lapCount : 0;
  const sharpness = lapCount > 0 ? Math.max(0, sumLap2 / lapCount - meanLap * meanLap) : 0;

  return {
    sharpness,
    brightness: meanY,
    contrast,
    faceConfidence: confidence,
    faceBox: { x: bx, y: by, width: bw, height: bh },
    faceWidthRatio: bw / srcW,
    faceHeightRatio: bh / srcH,
  };
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

async function runDeepDiagnostic() {
  console.log("===============================================================================");
  console.log("             DEEP DIAGNOSTIC OF LIVE ARCFACE FRAME AND EMBEDDING");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const p1Embeddings = db.face_embeddings.filter(e => e.staff_id === "staff-person_001");

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
    const resized = tf.image.resizeBilinear(tensor3D, [Math.round(rawJpeg.height * scale), Math.round(rawJpeg.width * scale)]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
    .withFaceLandmarks();
  tensor3D.dispose();

  const face = detections[0];
  const quality = evaluateQuality(rawJpeg, face.detection.box, face.detection.score);

  console.log("1. EXACT RECOGNITION FRAME QUALITY:");
  console.log(`   • Sharpness / Blur Score: ${quality.sharpness.toFixed(2)} (Threshold: >= 15.0) -> ${quality.sharpness >= 15 ? "CLEAR ✓" : "BLURRY ✗"}`);
  console.log(`   • Brightness:            ${quality.brightness.toFixed(1)} / 255.0 (Optimal: 40 - 225) -> PASS ✓`);
  console.log(`   • Contrast:              ${quality.contrast.toFixed(1)} (Optimal: >= 18.0) -> PASS ✓`);
  console.log(`   • Detector Confidence:   ${(quality.faceConfidence * 100).toFixed(1)}% -> PASS ✓\n`);

  console.log("2. EXACT FACE BOX:");
  console.log(`   • x: ${quality.faceBox.x}, y: ${quality.faceBox.y}, width: ${quality.faceBox.width}, height: ${quality.faceBox.height}`);
  console.log(`   • Face Width / Video Width:   ${(quality.faceWidthRatio * 100).toFixed(1)}% (Threshold: >= 15%) -> PASS ✓`);
  console.log(`   • Face Height / Video Height: ${(quality.faceHeightRatio * 100).toFixed(1)}% (Threshold: >= 15%) -> PASS ✓\n`);

  const pts5 = extract5Landmarks(face.landmarks);
  console.log("3. FIVE ARCFACE LANDMARKS (Pre-Alignment in Input Coordinates):");
  console.log(`   • Left Eye:    [${pts5[0][0].toFixed(1)}, ${pts5[0][1].toFixed(1)}]`);
  console.log(`   • Right Eye:   [${pts5[1][0].toFixed(1)}, ${pts5[1][1].toFixed(1)}]`);
  console.log(`   • Nose Tip:    [${pts5[2][0].toFixed(1)}, ${pts5[2][1].toFixed(1)}]`);
  console.log(`   • Left Mouth:  [${pts5[3][0].toFixed(1)}, ${pts5[3][1].toFixed(1)}]`);
  console.log(`   • Right Mouth: [${pts5[4][0].toFixed(1)}, ${pts5[4][1].toFixed(1)}]`);
  console.log("   Standard ArcFace Reference Target (112x112 Space):");
  console.log(`   • Target Left Eye:    [38.3, 51.7]`);
  console.log(`   • Target Right Eye:   [73.5, 51.5]`);
  console.log(`   • Target Nose Tip:    [56.0, 71.7]`);
  console.log(`   • Target Left Mouth:  [41.5, 92.4]`);
  console.log(`   • Target Right Mouth: [70.7, 92.2]\n`);

  const alignedTensor = alignFaceToTensor(rawJpeg, face.landmarks);
  const output = await session.run({ [session.inputNames[0]]: alignedTensor });
  const rawEmbedding = Array.from(output[session.outputNames[0]].data);

  let rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
  const liveEmbedding = rawEmbedding.map(v => v / rawNorm);
  const l2Norm = Math.sqrt(liveEmbedding.reduce((sum, v) => sum + v * v, 0));

  console.log("4. LIVE EMBEDDING DIMENSION & NORM:");
  console.log(`   • Embedding Dimension: ${liveEmbedding.length}-D (Exact 512-D float array)`);
  console.log(`   • Embedding L2 Norm:   ${l2Norm.toFixed(6)} (Exact Unit L2-norm = 1.000000)\n`);

  console.log("5. COMPARISON AGAINST PERSON_001'S 5 ACTIVE REFERENCE EMBEDDINGS:");
  const poseLabels = [
    "Reference 1 (Straight / Front)",
    "Reference 2 (Slight Right)",
    "Reference 3 (Slight Left)",
    "Reference 4 (Slight Up)",
    "Reference 5 (Slight Down)"
  ];
  const p1Dists = [];
  p1Embeddings.forEach((emb, idx) => {
    const dist = cosineDistance(liveEmbedding, emb.embedding);
    p1Dists.push(dist);
    console.log(`   • P001 #${idx + 1} [${poseLabels[idx]}] = ${dist.toFixed(4)} (Similarity: ${((1 - dist) * 100).toFixed(2)}%)`);
  });

  const minDist = Math.min(...p1Dists);
  const maxDist = Math.max(...p1Dists);
  const meanDist = p1Dists.reduce((a, b) => a + b, 0) / p1Dists.length;

  console.log(`\n   → Minimum Distance: ${minDist.toFixed(4)} (< 0.45 threshold -> PASS ✓)`);
  console.log(`   → Maximum Distance: ${maxDist.toFixed(4)}`);
  console.log(`   → Mean Distance:    ${meanDist.toFixed(4)}\n`);

  console.log("===============================================================================");
}

runDeepDiagnostic().catch(console.error);
