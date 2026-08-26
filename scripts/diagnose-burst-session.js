import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const DB_PATH = path.resolve("data", "staff-db.json");

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
  return {
    invA: a / denom,
    invB: -b / denom,
    invTx: -(a / denom * tx - (-b / denom) * ty),
    invTy: -(-b / denom * tx + a / denom * ty),
  };
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

  return { planar, rgbaOut };
}

function calculateEAR(pts) {
  function dist(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
  }
  const leftA = dist(pts[37], pts[41]);
  const leftB = dist(pts[38], pts[40]);
  const leftC = dist(pts[36], pts[39]);
  const leftEAR = (leftA + leftB) / (2.0 * leftC);

  const rightA = dist(pts[43], pts[47]);
  const rightB = dist(pts[44], pts[46]);
  const rightC = dist(pts[42], pts[45]);
  const rightEAR = (rightA + rightB) / (2.0 * rightC);

  return (leftEAR + rightEAR) / 2.0;
}

function calculateSharpnessAndBrightness(rawImg, box) {
  const bx = Math.max(0, Math.floor(box.x));
  const by = Math.max(0, Math.floor(box.y));
  const bw = Math.min(rawImg.width - bx, Math.floor(box.width));
  const bh = Math.min(rawImg.height - by, Math.floor(box.height));

  let totalB = 0;
  const gray = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const idx = ((by + y) * rawImg.width + (bx + x)) * 4;
      const lum = 0.299 * rawImg.data[idx] + 0.587 * rawImg.data[idx + 1] + 0.114 * rawImg.data[idx + 2];
      gray[y * bw + x] = lum;
      totalB += lum;
    }
  }
  const brightness = Math.round(totalB / (bw * bh));

  let lapSum = 0, lapSqSum = 0, count = 0;
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const lap = gray[(y - 1) * bw + x] + gray[(y + 1) * bw + x] + gray[y * bw + x - 1] + gray[y * bw + x + 1] - 4 * gray[y * bw + x];
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }
  const meanLap = lapSum / count;
  const sharpness = Math.round((lapSqSum / count - meanLap * meanLap) * 10) / 10;

  return { brightness, sharpness };
}

async function processImageFile(filePath, session) {
  const data = fs.readFileSync(filePath);
  const rawImg = jpeg.decode(data, { useTArray: true });
  const numPixels = rawImg.width * rawImg.height;
  const rgb = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    rgb[p * 3] = rawImg.data[p * 4];
    rgb[p * 3 + 1] = rawImg.data[p * 4 + 1];
    rgb[p * 3 + 2] = rawImg.data[p * 4 + 2];
  }
  let tensor = tf.tensor3d(rgb, [rawImg.height, rawImg.width, 3], "int32");
  const maxDim = Math.max(rawImg.height, rawImg.width);
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const resized = tf.image.resizeBilinear(tensor, [Math.round(rawImg.height * scale), Math.round(rawImg.width * scale)]);
    tensor.dispose();
    tensor = tf.cast(resized, "int32");
    resized.dispose();
  }
  const detections = await faceapi.detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 })).withFaceLandmarks();
  tensor.dispose();

  if (detections.length !== 1) return null;

  const face = detections[0];
  const ear = calculateEAR(face.landmarks.positions);
  const { brightness, sharpness } = calculateSharpnessAndBrightness(rawImg, face.detection.box);
  const pts5 = extract5Landmarks(face.landmarks);
  const transform = estimateSimilarityTransform(pts5);
  const aligned = align112(rawImg, transform);
  const inputTensor = new ort.Tensor("float32", aligned.planar, [1, 3, 112, 112]);
  const out = await session.run({ [session.inputNames[0]]: inputTensor });
  const rawEmb = Array.from(out[session.outputNames[0]].data);
  const norm = Math.sqrt(rawEmb.reduce((s, v) => s + v * v, 0));
  const liveEmb = rawEmb.map((v) => v / norm);
  const fp = computeVectorFingerprint(liveEmb);

  return {
    filePath,
    box: face.detection.box,
    score: face.detection.score,
    sharpness,
    brightness,
    ear,
    liveEmb,
    fingerprint: fp,
  };
}

async function main() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const p1Embeddings = db.face_embeddings.filter((e) => e.staff_id === "staff-person_001");

  console.log("Database active PERSON_001 embeddings count:", p1Embeddings.length);

  const burstDir = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\5566e32b-0d18-412b-88b2-0efcf06070d6\\.user_uploaded";
  const burstFiles = [
    "media_1787590198818.jpg",
    "media_1787590198847.jpg",
    "media_1787590198905.jpg",
    "media_1787590198944.jpg",
    "media_1787590198959.jpg",
    "media_1787590568727.jpg",
  ];

  // Also check all files in burstDir
  const allDirFiles = fs.readdirSync(burstDir).filter((f) => f.endsWith(".jpg"));

  const results = [];
  for (const f of allDirFiles) {
    const fullPath = path.join(burstDir, f);
    const r = await processImageFile(fullPath, session);
    if (r) {
      const dists = p1Embeddings.map((e) => cosineDistance(r.liveEmb, e.embedding));
      const minDist = Math.min(...dists);
      results.push({ ...r, fileName: f, dists, minDist });
      console.log(
        `File: ${f} | Box: ${Math.round(r.box.width)}x${Math.round(r.box.height)} | Conf: ${(r.score * 100).toFixed(1)}% | Blur: ${r.sharpness} | Bright: ${r.brightness} | EAR: ${r.ear.toFixed(3)} | FP: ${r.fingerprint} | MinDist: ${minDist.toFixed(4)} | Dist1-5: [${dists.map(d => d.toFixed(4)).join(", ")}]`
      );
    }
  }

  // Cross similarity matrix
  console.log("\n=== PAIRWISE COSINE DISTANCES BETWEEN ALL CAPTURED LIVE FRAMES ===");
  for (let i = 0; i < Math.min(6, results.length); i++) {
    for (let j = i + 1; j < Math.min(6, results.length); j++) {
      const d = cosineDistance(results[i].liveEmb, results[j].liveEmb);
      console.log(`Frame ${i + 1} (${results[i].fingerprint}) <-> Frame ${j + 1} (${results[j].fingerprint}): Cosine Dist = ${d.toFixed(4)}`);
    }
  }
}

main().catch(console.error);
