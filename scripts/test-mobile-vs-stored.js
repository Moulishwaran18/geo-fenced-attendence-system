import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics" });
const MODELS_DIR = path.resolve("public", "models");

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
  srcVar /= n;
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

async function run() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(path.join(MODELS_DIR, "w600k_mbf.onnx"), { executionProviders: ["wasm"] });

  // Get stored DB embeddings
  const dbRes = await pool.query("SELECT reference_image_path, embedding::text FROM face_embeddings WHERE staff_id = (SELECT id FROM staff WHERE staff_code = 'PERSON_001') ORDER BY reference_image_path");
  const stored = dbRes.rows.map(r => ({ path: r.reference_image_path, vec: JSON.parse(r.embedding) }));

  // Load mobile frame 92823
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

  const outMobile = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", mobilePlanar, [1, 3, 112, 112]) });
  const rawMobile = Array.from(outMobile[session.outputNames[0]].data);
  const normMobile = Math.sqrt(rawMobile.reduce((s, v) => s + v * v, 0));
  const embMobile = rawMobile.map(v => v / normMobile);

  console.log("================================================================");
  console.log("MOBILE FRAME 92823 VS STORED ENROLLMENT EMBEDDINGS");
  console.log("================================================================");
  console.log("Mobile Raw Norm:", normMobile.toFixed(6));
  stored.forEach((st, i) => {
    const d = cosineDistance(embMobile, st.vec);
    console.log(`  Distance to Stored DB Reference ${i + 1} (${path.basename(st.path)}): ${d.toFixed(4)}`);
  });

  await pool.end();
}

run().catch(console.error);
