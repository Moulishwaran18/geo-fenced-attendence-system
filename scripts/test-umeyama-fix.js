import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-web";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");

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

function estimateSimilarityTransformCorrect(src, dst = ARCFACE_REFERENCE_POINTS) {
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
  const { invM } = estimateSimilarityTransformCorrect(pts5);
  const targetW = 112, targetH = 112;
  const planar = new Float32Array(3 * targetW * targetH);
  const channelStride = targetW * targetH;

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
    }
  }

  return planar;
}

async function extractEmbedding(imgPath, session) {
  const buf = fs.readFileSync(imgPath);
  const rawImg = jpeg.decode(buf);

  const numPixels = rawImg.width * rawImg.height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    rgbValues[p * 3] = rawImg.data[p * 4];
    rgbValues[p * 3 + 1] = rawImg.data[p * 4 + 1];
    rgbValues[p * 3 + 2] = rawImg.data[p * 4 + 2];
  }

  let tensor3D = tf.tensor3d(rgbValues, [rawImg.height, rawImg.width, 3], "int32");
  const maxDim = Math.max(rawImg.height, rawImg.width);
  let scaleX = 1.0, scaleY = 1.0;
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const targetH = Math.round(rawImg.height * scale);
    const targetW = Math.round(rawImg.width * scale);
    scaleX = targetW / rawImg.width;
    scaleY = targetH / rawImg.height;
    const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
    .withFaceLandmarks();
  tensor3D.dispose();

  if (detections.length === 0) throw new Error("No face in " + imgPath);

  const face = detections[0];
  const detected5 = extract5Landmarks(face.landmarks);
  const corrected5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);

  const planar = align112FromRawImage(rawImg, corrected5);
  const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const rawVec = Array.from(out[session.outputNames[0]].data);
  const norm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0));
  return {
    embedding: rawVec.map((v) => v / norm),
    rawNorm: norm,
  };
}

async function run() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), { executionProviders: ["wasm"] });

  console.log("Generating CORRECT Umeyama embeddings for Reference 01..05:");
  const refEmbeddings = [];
  for (let i = 1; i <= 5; i++) {
    const p = path.resolve(`public/staff-photos/person-001/reference_0${i}.jpg`);
    const res = await extractEmbedding(p, session);
    refEmbeddings.push(res);
    console.log(`Ref 0${i}: Raw Norm = ${res.rawNorm.toFixed(4)}`);
  }

  console.log("\nPairwise distances between Reference Photos:");
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const d = cosineDistance(refEmbeddings[i].embedding, refEmbeddings[j].embedding);
      console.log(`Ref 0${i + 1} vs Ref 0${j + 1}: ${d.toFixed(4)}`);
    }
  }

  console.log("\nTesting Phone Frame 30650:");
  const f30650Path = path.resolve("public/debug-frames/frame-30650/original_camera_frame.jpg");
  const f30650 = await extractEmbedding(f30650Path, session);
  console.log(`Frame 30650 Raw Norm: ${f30650.rawNorm.toFixed(4)}`);

  console.log("\nFrame 30650 vs Corrected References 01..05:");
  refEmbeddings.forEach((r, idx) => {
    const d = cosineDistance(f30650.embedding, r.embedding);
    console.log(`Frame 30650 vs Ref 0${idx + 1}: Distance = ${d.toFixed(6)}`);
  });
}

run().catch(console.error);
