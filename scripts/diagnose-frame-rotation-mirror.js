import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { Pool } from "pg";
import * as ort from "onnxruntime-web";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

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

function align112FromRawImage(rawImg, pts5) {
  const transform = estimateSimilarityTransform(pts5);
  if (!transform) throw new Error("Could not compute similarity transform");
  const { invM } = transform;

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

function transformRawImage(rawImg, mode) {
  const { width: W, height: H, data } = rawImg;
  if (mode === "identity") {
    return { width: W, height: H, data: new Uint8Array(data) };
  }
  if (mode === "hflip") {
    const outData = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstIdx = (y * W + (W - 1 - x)) * 4;
        outData[dstIdx] = data[srcIdx];
        outData[dstIdx + 1] = data[srcIdx + 1];
        outData[dstIdx + 2] = data[srcIdx + 2];
        outData[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    return { width: W, height: H, data: outData };
  }
  if (mode === "rot90cw") {
    // New W = H, New H = W
    const outData = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstX = H - 1 - y;
        const dstY = x;
        const dstIdx = (dstY * H + dstX) * 4;
        outData[dstIdx] = data[srcIdx];
        outData[dstIdx + 1] = data[srcIdx + 1];
        outData[dstIdx + 2] = data[srcIdx + 2];
        outData[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    return { width: H, height: W, data: outData };
  }
  if (mode === "rot270cw") {
    const outData = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstX = y;
        const dstY = W - 1 - x;
        const dstIdx = (dstY * H + dstX) * 4;
        outData[dstIdx] = data[srcIdx];
        outData[dstIdx + 1] = data[srcIdx + 1];
        outData[dstIdx + 2] = data[srcIdx + 2];
        outData[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    return { width: H, height: W, data: outData };
  }
  if (mode === "rot180") {
    const outData = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const srcIdx = (y * W + x) * 4;
        const dstIdx = ((H - 1 - y) * W + (W - 1 - x)) * 4;
        outData[dstIdx] = data[srcIdx];
        outData[dstIdx + 1] = data[srcIdx + 1];
        outData[dstIdx + 2] = data[srcIdx + 2];
        outData[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    return { width: W, height: H, data: outData };
  }
  throw new Error("Unknown mode: " + mode);
}

async function run() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), { executionProviders: ["wasm"] });

  const dbRes = await pool.query(`
    SELECT f.reference_image_path, f.embedding::text, s.staff_code
    FROM face_embeddings f
    JOIN staff s ON s.id = f.staff_id
    WHERE s.staff_code = 'PERSON_001'
    ORDER BY f.reference_image_path
  `);
  const p001Embeddings = dbRes.rows.map((r) => ({ path: r.reference_image_path, vec: JSON.parse(r.embedding) }));

  const frameId = process.argv[2] || "30650";
  const origPath = path.resolve("public", "debug-frames", `frame-${frameId}`, "original_camera_frame.jpg");
  const rawBuf = fs.readFileSync(origPath);
  const baseImg = jpeg.decode(rawBuf);

  console.log(`Analyzing frame-${frameId} (${baseImg.width} x ${baseImg.height}) under all geometric orientations:\n`);

  const modes = ["identity", "hflip", "rot90cw", "rot270cw", "rot180"];

  for (const mode of modes) {
    const transformed = transformRawImage(baseImg, mode);
    const numPixels = transformed.width * transformed.height;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = transformed.data[p * 4];
      rgbValues[p * 3 + 1] = transformed.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = transformed.data[p * 4 + 2];
    }

    let tensor3D = tf.tensor3d(rgbValues, [transformed.height, transformed.width, 3], "int32");
    const maxDim = Math.max(transformed.height, transformed.width);
    let scaleX = 1.0, scaleY = 1.0;
    if (maxDim > 640) {
      const scale = 640 / maxDim;
      const targetH = Math.round(transformed.height * scale);
      const targetW = Math.round(transformed.width * scale);
      scaleX = targetW / transformed.width;
      scaleY = targetH / transformed.height;
      const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks();
    tensor3D.dispose();

    if (detections.length === 0) {
      console.log(`[Mode: ${mode.padEnd(9)}] No face detected.`);
      continue;
    }

    const face = detections[0];
    const detected5 = extract5Landmarks(face.landmarks);
    const corrected5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);

    const planar = align112FromRawImage(transformed, corrected5);
    const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: tensor });
    const rawVec = Array.from(out[outputName].data);
    const rawNorm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0));
    const emb = rawVec.map((v) => v / rawNorm);

    const dists = p001Embeddings.map((e) => cosineDistance(emb, e.vec));
    const minDist = Math.min(...dists);

    console.log(`[Mode: ${mode.padEnd(9)}] Face Conf: ${(face.detection.score * 100).toFixed(1)}% | Raw Norm: ${rawNorm.toFixed(2)} | Min Dist to PERSON_001: ${minDist.toFixed(6)} | All: [${dists.map(d => d.toFixed(4)).join(", ")}]`);
  }

  await pool.end();
}

run().catch(console.error);
