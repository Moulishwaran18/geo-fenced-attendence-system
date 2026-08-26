import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';
import * as tf from '@tensorflow/tfjs-core';
import faceapi from 'face-api.js';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics' });

const ARCFACE_REF = [
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
    avg([36, 37, 38, 39, 40, 41]),
    avg([42, 43, 44, 45, 46, 47]),
    [pts[30].x, pts[30].y],
    [pts[48].x, pts[48].y],
    [pts[54].x, pts[54].y],
  ];
}

function estimateSimilarityTransform(src, dst = ARCFACE_REF) {
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

function align112FromRawImage(rawImg, pts5) {
  const { invM } = estimateSimilarityTransform(pts5);
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

async function test() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk('public/models');
  await faceapi.nets.faceLandmark68Net.loadFromDisk('public/models');
  const session = await ort.InferenceSession.create('public/models/w600k_mbf.onnx', { executionProviders: ['wasm'] });

  const dbRes = await pool.query("SELECT s.staff_code, f.reference_image_path, f.embedding::text FROM face_embeddings f JOIN staff s ON s.id = f.staff_id ORDER BY s.staff_code, f.reference_image_path");
  const dbEmbeddings = dbRes.rows.map(r => ({ staffCode: r.staff_code, path: r.reference_image_path, vec: JSON.parse(r.embedding) }));

  for (const frameId of ['89877', '66602', '58140', '30650']) {
    const origPath = path.resolve('public/debug-frames/frame-' + frameId + '/original_camera_frame.jpg');
    if (!fs.existsSync(origPath)) continue;
    const rawImg = jpeg.decode(fs.readFileSync(origPath));
    const numPixels = rawImg.width * rawImg.height;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = rawImg.data[p * 4];
      rgbValues[p * 3 + 1] = rawImg.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = rawImg.data[p * 4 + 2];
    }
    let tensor3D = tf.tensor3d(rgbValues, [rawImg.height, rawImg.width, 3], 'int32');
    const scale = 640 / Math.max(rawImg.height, rawImg.width);
    const targetH = Math.round(rawImg.height * scale);
    const targetW = Math.round(rawImg.width * scale);
    const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, 'int32');
    resized.dispose();

    const detections = await faceapi.detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 })).withFaceLandmarks();
    tensor3D.dispose();
    if (detections.length === 0) continue;

    const detected5 = extract5Landmarks(detections[0].landmarks);
    const scaleX = targetW / rawImg.width;
    const scaleY = targetH / rawImg.height;
    const corrected5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);

    const planar = align112FromRawImage(rawImg, corrected5);
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', planar, [1, 3, 112, 112]) });
    const rawVec = Array.from(out[session.outputNames[0]].data);
    const norm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0));
    const emb = rawVec.map(v => v / norm);

    const dists = dbEmbeddings.map(e => ({ staffCode: e.staffCode, path: e.path, dist: cosineDistance(emb, e.vec) })).sort((a, b) => a.dist - b.dist);
    const best = dists[0];
    const secondBest = dists.find(d => d.staffCode !== best.staffCode) || dists[1];
    const margin = secondBest ? secondBest.dist - best.dist : 1.0;

    console.log('Frame ' + frameId + ': Best=' + best.staffCode + ' (' + path.basename(best.path) + ') Dist=' + best.dist.toFixed(6) + ' | 2nd=' + (secondBest ? secondBest.staffCode : 'N/A') + ' Dist=' + (secondBest ? secondBest.dist.toFixed(6) : 'N/A') + ' | Margin=' + margin.toFixed(6) + ' | Decision=' + (best.dist <= 0.45 && margin >= 0.08 ? 'MATCH ✓' : 'REJECT ✗'));
  }
  await pool.end();
}

test().catch(console.error);
