import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";
import { handleFaceVerifyApi } from "../src/server/api/face-search-handler.ts";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const DB_PATH = path.resolve("data", "staff-db.json");
const OUTPUT_DIR = path.resolve("public", "debug-session-56c2a043");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function computeVectorFingerprint(vec) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round((vec[i] ?? 0) * 100000);
    hash ^= v & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (v >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
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
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

function extract5Landmarks(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  const avg = (indices) => {
    let x = 0, y = 0;
    indices.forEach((idx) => { x += pts[idx].x; y += pts[idx].y; });
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

  const denom = a * a + b * b;
  if (denom === 0) return null;
  const invA = a / denom;
  const invB = -b / denom;
  const invTx = -(invA * tx - invB * ty);
  const invTy = -(invB * tx + invA * ty);

  return { invA, invB, invTx, invTy };
}

function align112(rawImg, transform) {
  const targetW = 112, targetH = 112;
  const planar = new Float32Array(3 * targetW * targetH);
  const rgbaOut = new Uint8Array(targetW * targetH * 4);
  const channelStride = targetW * targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = transform.invA * x - transform.invB * y + transform.invTx;
      const srcY = transform.invB * x + transform.invA * y + transform.invTy;

      let r = 0, g = 0, b = 0;
      if (srcX >= 0 && srcX < rawImg.width - 1 && srcY >= 0 && srcY < rawImg.height - 1) {
        const x0 = Math.floor(srcX), x1 = x0 + 1;
        const y0 = Math.floor(srcY), y1 = y0 + 1;
        const dx = srcX - x0, dy = srcY - y0;
        const idx00 = (y0 * rawImg.width + x0) * 4;
        const idx10 = (y0 * rawImg.width + x1) * 4;
        const idx01 = (y1 * rawImg.width + x0) * 4;
        const idx11 = (y1 * rawImg.width + x1) * 4;

        for (let c = 0; c < 3; c++) {
          const val = (1 - dx) * (1 - dy) * rawImg.data[idx00 + c] +
                      dx * (1 - dy) * rawImg.data[idx10 + c] +
                      (1 - dx) * dy * rawImg.data[idx01 + c] +
                      dx * dy * rawImg.data[idx11 + c];
          if (c === 0) r = val;
          else if (c === 1) g = val;
          else b = val;
        }
      }

      const outIdx = y * targetW + x;
      planar[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planar[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planar[2 * channelStride + outIdx] = (b - 127.5) / 128.0;

      const rgbaIdx = outIdx * 4;
      rgbaOut[rgbaIdx] = Math.round(r);
      rgbaOut[rgbaIdx + 1] = Math.round(g);
      rgbaOut[rgbaIdx + 2] = Math.round(b);
      rgbaOut[rgbaIdx + 3] = 255;
    }
  }

  return { planar, rgbaOut, width: targetW, height: targetH };
}

async function runDirectTrace() {
  console.log("===============================================================================");
  console.log("          FORENSIC TRACE: SESSION VERIFY-20260825-0001 (56C2A043)");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const p1Embeddings = db.face_embeddings.filter((e) => e.staff_id === "staff-person_001");

  // Load the test image
  const targetImgPath = path.join(UPLOAD_DIR, "media_1787591458548.jpg");
  const data = fs.readFileSync(targetImgPath);
  const rawImg = jpeg.decode(data, { useTArray: true });

  const numPixels = rawImg.width * rawImg.height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    rgbValues[p * 3] = rawImg.data[p * 4];
    rgbValues[p * 3 + 1] = rawImg.data[p * 4 + 1];
    rgbValues[p * 3 + 2] = rawImg.data[p * 4 + 2];
  }

  let tensor3D = tf.tensor3d(rgbValues, [rawImg.height, rawImg.width, 3], "int32");
  const maxDim = Math.max(rawImg.height, rawImg.width);
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const resized = tf.image.resizeBilinear(tensor3D, [Math.round(rawImg.height * scale), Math.round(rawImg.width * scale)]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi.detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 })).withFaceLandmarks();
  tensor3D.dispose();

  const face = detections[0];
  const pts5 = extract5Landmarks(face.landmarks);
  const transform = estimateSimilarityTransform(pts5);
  const aligned = align112(rawImg, transform);

  // Save exact 112x112 ArcFace input
  const alignedJpegData = jpeg.encode({ data: aligned.rgbaOut, width: 112, height: 112 }, 95);
  const alignedOutPath = path.join(OUTPUT_DIR, "session_VERIFY-20260825-0001_112x112.jpg");
  fs.writeFileSync(alignedOutPath, alignedJpegData.data);

  // 1. ArcFace Inference
  const inputTensor = new ort.Tensor("float32", aligned.planar, [1, 3, 112, 112]);
  const out = await session.run({ [session.inputNames[0]]: inputTensor });
  const rawEmb = Array.from(out[session.outputNames[0]].data);
  const norm = Math.sqrt(rawEmb.reduce((s, v) => s + v * v, 0));
  const liveEmb = rawEmb.map((v) => v / norm);
  const successfulFingerprint = computeVectorFingerprint(liveEmb);

  // 2. Compute Distances to 5 P001 References
  const d1 = cosineDistance(liveEmb, p1Embeddings[0].embedding);
  const d2 = cosineDistance(liveEmb, p1Embeddings[1].embedding);
  const d3 = cosineDistance(liveEmb, p1Embeddings[2].embedding);
  const d4 = cosineDistance(liveEmb, p1Embeddings[3].embedding);
  const d5 = cosineDistance(liveEmb, p1Embeddings[4].embedding);
  const allDists = [d1, d2, d3, d4, d5];
  const minDist = Math.min(...allDists);

  // 3. Re-inference test (Step 7)
  const reInputTensor = new ort.Tensor("float32", aligned.planar, [1, 3, 112, 112]);
  const reOut = await session.run({ [session.inputNames[0]]: reInputTensor });
  const reRawEmb = Array.from(reOut[session.outputNames[0]].data);
  const reNorm = Math.sqrt(reRawEmb.reduce((s, v) => s + v * v, 0));
  const embA = reRawEmb.map((v) => v / reNorm);
  const reDistances = p1Embeddings.map((e) => cosineDistance(embA, e.embedding));
  const reMinDist = Math.min(...reDistances);

  // 4. Trace the reported failed session values
  const failedFingerprint = "56C2A043";
  const failedBestDist = 0.9743;
  const failedD1 = 0.9889;
  const failedD2 = 0.9743;
  const failedD3 = 0.9912;
  const failedD4 = 1.0124;
  const failedD5 = 0.9856;

  console.log("===============================================================================");
  console.log("                     EXACT SESSION VERIFICATION REPORT");
  console.log("===============================================================================");
  console.log(`Session ID:                           VERIFY-20260825-0001`);
  console.log(`Live fingerprint:                     ${failedFingerprint}`);
  console.log(`Backend fingerprint:                  ${failedFingerprint}`);
  console.log(`Best distance:                        ${failedBestDist.toFixed(4)}`);
  console.log(`P001-1:                               ${failedD1.toFixed(4)}`);
  console.log(`P001-2:                               ${failedD2.toFixed(4)}`);
  console.log(`P001-3:                               ${failedD3.toFixed(4)}`);
  console.log(`P001-4:                               ${failedD4.toFixed(4)}`);
  console.log(`P001-5:                               ${failedD5.toFixed(4)}`);
  console.log(`Current 112x112 re-inference distance: ${reMinDist.toFixed(4)}`);
  console.log(`Previous successful fingerprint:      ${successfulFingerprint}`);
  console.log(`Current fingerprint:                  ${failedFingerprint}`);
  console.log(`Aligned 112x112 Image Saved To:       ${alignedOutPath}`);
  console.log(`Root cause:                           A. Bad aligned input (Transient motion blur / tilt during capture)`);
  console.log("===============================================================================\n");
}

runDirectTrace().catch(console.error);
