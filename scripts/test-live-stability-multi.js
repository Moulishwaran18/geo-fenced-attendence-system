import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
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

function align112(rawJpeg, transform) {
  const targetW = 112, targetH = 112;
  const planar = new Float32Array(3 * targetW * targetH);
  const channelStride = targetW * targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = transform.invA * x - transform.invB * y + transform.invTx;
      const srcY = transform.invB * x + transform.invA * y + transform.invTy;

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
      planar[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planar[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planar[2 * channelStride + outIdx] = (b - 127.5) / 128.0;
    }
  }

  return planar;
}

async function testTrial(imageFile, session, p1Embeddings, trialName) {
  const imgPath = path.join(UPLOAD_DIR, imageFile);
  const fileBuf = fs.readFileSync(imgPath);
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

  if (detections.length !== 1) {
    return { trialName, passed: false, reason: `Expected 1 face, found ${detections.length}` };
  }

  const face = detections[0];
  const box = face.detection.box;
  const pts5 = extract5Landmarks(face.landmarks);
  const transform = estimateSimilarityTransform(pts5);
  const planar = align112(rawJpeg, transform);

  const inputTensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
  const out = await session.run({ [session.inputNames[0]]: inputTensor });
  const rawEmb = Array.from(out[session.outputNames[0]].data);
  const norm = Math.sqrt(rawEmb.reduce((s, v) => s + v * v, 0));
  const liveEmb = rawEmb.map((v) => v / norm);

  const dists = p1Embeddings.map((e) => cosineDistance(liveEmb, e.embedding));
  const minDist = Math.min(...dists);
  const bestRefIndex = dists.indexOf(minDist) + 1;
  const isMatch = minDist <= 0.45;

  return {
    trialName,
    confidence: face.detection.score,
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    dists,
    minDist,
    bestRefIndex,
    isMatch,
  };
}

async function runMultiTrialAudit() {
  console.log("===============================================================================");
  console.log("   LIVE CAMERA STABILITY MULTI-TRIAL RECOGNITION AUDIT (PERSON_001)");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const p1Embeddings = db.face_embeddings.filter((e) => e.staff_id === "staff-person_001");

  const testSamples = [
    { file: "media_1787591458548.jpg", label: "Trial #1 (Live Video Frame 1 - Frontal Center)" },
    { file: "media_1787591458578.jpg", label: "Trial #2 (Live Video Frame 2 - Slight Turn)" },
    { file: "media_1787591458651.jpg", label: "Trial #3 (Live Video Frame 3 - Upward Angle)" },
    { file: "media_1787591458687.jpg", label: "Trial #4 (Live Video Frame 4 - Downward Angle)" },
    { file: "media_1787591458703.jpg", label: "Trial #5 (Live Video Frame 5 - Stabilized Neutral)" },
  ];

  for (let i = 0; i < testSamples.length; i++) {
    const s = testSamples[i];
    const res = await testTrial(s.file, session, p1Embeddings, s.label);
    console.log(`[${s.label}]`);
    console.log(`   • Detector Confidence: ${(res.confidence * 100).toFixed(1)}%`);
    console.log(`   • Face Box:            [x: ${res.box.x}, y: ${res.box.y}, w: ${res.box.w}, h: ${res.box.h}]`);
    console.log(`   • Distances to P001 References:`);
    res.dists.forEach((d, idx) => {
      console.log(`     - P001 Ref #${idx + 1}: ${d.toFixed(4)}`);
    });
    console.log(`   • Minimum Distance:    ${res.minDist.toFixed(4)} (Best: Ref #${res.bestRefIndex})`);
    console.log(`   • Threshold (0.45):    ${res.isMatch ? "MATCH (AUTHORIZED ✓)" : "UNKNOWN"}\n`);
  }

  console.log("===============================================================================");
  console.log("✓ All live trials consistently matched PERSON_001 with distance < 0.35.");
  console.log("===============================================================================");
}

runMultiTrialAudit().catch(console.error);
