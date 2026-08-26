import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";
import * as ort from "onnxruntime-web";
import pg from "pg";

const { Pool } = pg;
const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, "public", "models");
const ONNX_PATH = path.join(MODELS_DIR, "w600k_mbf.onnx");

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

  return { a, b, tx, ty, invA, invB, invTx, invTy };
}

function extract5Landmarks(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  const avg = (indices) => {
    let x = 0, y = 0;
    indices.forEach(idx => { x += pts[idx].x; y += pts[idx].y; });
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

function alignFaceToTensor(rawJpeg, landmarks68) {
  const { width: srcW, height: srcH, data: srcData } = rawJpeg;
  const pts5 = extract5Landmarks(landmarks68);
  const transform = estimateSimilarityTransform(pts5);
  if (!transform) throw new Error("Could not compute Umeyama similarity transform");

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

async function test() {
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const session = await ort.InferenceSession.create(ONNX_PATH, { executionProviders: ["wasm"] });

  // Test with reference_01.jpg
  const p1Buf = fs.readFileSync("public/staff-photos/person-001/reference_01.jpg");
  const p1Dec = jpeg.decode(p1Buf, { useTArray: true });

  const numPixels = p1Dec.width * p1Dec.height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let p = 0; p < numPixels; p++) {
    rgbValues[p * 3] = p1Dec.data[p * 4];
    rgbValues[p * 3 + 1] = p1Dec.data[p * 4 + 1];
    rgbValues[p * 3 + 2] = p1Dec.data[p * 4 + 2];
  }

  let tensor3D = tf.tensor3d(rgbValues, [p1Dec.height, p1Dec.width, 3], "int32");
  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks();
  tensor3D.dispose();

  const face = detections[0];
  const alignedTensor = alignFaceToTensor(p1Dec, face.landmarks);

  const output = await session.run({ [session.inputNames[0]]: alignedTensor });
  const rawEmbedding = Array.from(output[session.outputNames[0]].data);

  const rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
  const normalizedEmbedding = rawEmbedding.map(v => v / rawNorm);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics"
  });
  const client = await pool.connect();
  try {
    const vecStr = `[${normalizedEmbedding.join(",")}]`;
    const pgRes = await client.query(`
      SELECT 
        f.id,
        f.reference_image_path,
        s.staff_code,
        s.name,
        (f.embedding <=> $1::vector) AS distance
      FROM face_embeddings f
      JOIN staff s ON f.staff_id = s.id
      WHERE s.staff_code = 'PERSON_001'
      ORDER BY f.reference_image_path ASC
    `, [vecStr]);

    console.log("=== PostgreSQL Cosine Distances for PERSON_001 Reference 01 ===");
    for (const r of pgRes.rows) {
      console.log(`  ${r.staff_code} (${path.basename(r.reference_image_path)}): distance = ${parseFloat(r.distance).toFixed(8)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

test().catch(console.error);
