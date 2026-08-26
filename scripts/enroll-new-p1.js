import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const TARGET_DIR = path.resolve("public", "staff-photos", "person-001");
const DB_PATH = path.resolve("data", "staff-db.json");

const PHOTO_MAPPING = [
  {
    slot: "Photo 1",
    pose: "Straight / Front",
    sourceFile: "media_1787592112498.jpg",
    targetFile: "reference_01.jpg",
    relPath: "/staff-photos/person-001/reference_01.jpg",
  },
  {
    slot: "Photo 2",
    pose: "Slight Right",
    sourceFile: "media_1787592112465.jpg",
    targetFile: "reference_02.jpg",
    relPath: "/staff-photos/person-001/reference_02.jpg",
  },
  {
    slot: "Photo 3",
    pose: "Slight Left",
    sourceFile: "media_1787592112583.jpg",
    targetFile: "reference_03.jpg",
    relPath: "/staff-photos/person-001/reference_03.jpg",
  },
  {
    slot: "Photo 4",
    pose: "Slight Up",
    sourceFile: "media_1787592112623.jpg",
    targetFile: "reference_04.jpg",
    relPath: "/staff-photos/person-001/reference_04.jpg",
  },
  {
    slot: "Photo 5",
    pose: "Slight Down",
    sourceFile: "media_1787592112664.jpg",
    targetFile: "reference_05.jpg",
    relPath: "/staff-photos/person-001/reference_05.jpg",
  },
];

// Cosine Distance Helper
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

// 5-Point Reference Targets for ArcFace
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
  const b = (syx - sxy) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b || 1e-6;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  const invM = [
    [invA, -invB, invTx],
    [invB, invA, invTy],
  ];

  return { M: [[a, -b, tx], [b, a, ty]], invM };
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

function alignFaceToTensor(rawJpeg, landmarks68, scaleX = 1.0, scaleY = 1.0) {
  const { width: srcW, height: srcH, data: srcData } = rawJpeg;
  const detected5 = extract5Landmarks(landmarks68);
  const pts5 = detected5.map(([x, y]) => [x / scaleX, y / scaleY]);
  const transform = estimateSimilarityTransform(pts5);
  if (!transform) throw new Error("Could not compute Umeyama similarity transform");
  const { invM } = transform;

  const targetW = 112, targetH = 112;
  const planarRGB = new Float32Array(1 * 3 * targetH * targetW);
  const channelStride = targetH * targetW;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = invM[0][0] * x + invM[0][1] * y + invM[0][2];
      const srcY = invM[1][0] * x + invM[1][1] * y + invM[1][2];

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

async function main() {
  console.log("===============================================================================");
  console.log("             ENROLLING 5 VALIDATED PHOTOS FOR PERSON_001");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const enrolled = [];

  for (let i = 0; i < PHOTO_MAPPING.length; i++) {
    const item = PHOTO_MAPPING[i];
    const srcPath = path.join(UPLOAD_DIR, item.sourceFile);
    console.log(`[${i + 1}/5] Processing: ${item.slot} — ${item.pose} (${item.sourceFile})`);

    const fileBuf = fs.readFileSync(srcPath);
    const rawJpeg = jpeg.decode(fileBuf, { useTArray: true });

    const numPixels = rawJpeg.width * rawJpeg.height;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = rawJpeg.data[p * 4];
      rgbValues[p * 3 + 1] = rawJpeg.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = rawJpeg.data[p * 4 + 2];
    }

    let scaleX = 1.0, scaleY = 1.0;
    let tensor3D = tf.tensor3d(rgbValues, [rawJpeg.height, rawJpeg.width, 3], "int32");
    const maxDim = Math.max(rawJpeg.height, rawJpeg.width);
    if (maxDim > 640) {
      const scale = 640 / maxDim;
      const targetH = Math.round(rawJpeg.height * scale);
      const targetW = Math.round(rawJpeg.width * scale);
      scaleX = targetW / rawJpeg.width;
      scaleY = targetH / rawJpeg.height;
      const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
      .withFaceLandmarks();

    tensor3D.dispose();

    if (detections.length !== 1) {
      throw new Error(`Expected exactly 1 face in ${item.sourceFile}, found ${detections.length}`);
    }

    const face = detections[0];
    console.log(`  ✓ Exactly 1 face detected (Confidence: ${(face.detection.score * 100).toFixed(1)}%)`);

    // Umeyama 5-point alignment & 112x112 preprocessing
    const alignedTensor = alignFaceToTensor(rawJpeg, face.landmarks, scaleX, scaleY);

    // ArcFace Inference
    const output = await session.run({ [session.inputNames[0]]: alignedTensor });
    const rawEmbedding = Array.from(output[session.outputNames[0]].data);

    // L2 Normalization
    const rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
    const normalizedEmbedding = rawEmbedding.map(v => v / rawNorm);
    const finalNorm = Math.sqrt(normalizedEmbedding.reduce((sum, v) => sum + v * v, 0));

    console.log(`  ✓ 512-D ArcFace embedding generated (L2 Norm: ${finalNorm.toFixed(6)})`);

    // Copy to public target directory
    const targetPath = path.join(TARGET_DIR, item.targetFile);
    fs.copyFileSync(srcPath, targetPath);
    console.log(`  ✓ Saved reference photo: ${targetPath}\n`);

    enrolled.push({
      slot: item.slot,
      pose: item.pose,
      file: item.targetFile,
      relPath: item.relPath,
      embedding: normalizedEmbedding,
      norm: finalNorm,
      dim: normalizedEmbedding.length,
    });
  }

  // Update Database
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const otherEmbeddings = db.face_embeddings.filter(e => e.staff_id !== "staff-person_001");
  const oldActiveP1 = db.face_embeddings.filter(e => e.staff_id === "staff-person_001");

  const newRecords = enrolled.map((e, idx) => ({
    id: `emb-p1-v2-${idx + 1}`,
    staff_id: "staff-person_001",
    embedding: e.embedding,
    reference_image_path: e.relPath,
    created_at: new Date().toISOString(),
  }));

  db.face_embeddings = [...otherEmbeddings, ...newRecords];

  if (!db.inactive_embeddings_history) db.inactive_embeddings_history = [];
  db.inactive_embeddings_history.push(...oldActiveP1.map(o => ({
    ...o,
    deactivated_at: new Date().toISOString(),
    reason: "Replaced with optimal pose reference gallery (straight, slight right, slight left, slight up, slight down)"
  })));

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  console.log(`✓ Database written successfully to ${DB_PATH}\n`);

  // Calculate 10 Unique Pairwise Cosine Distances
  console.log("===============================================================================");
  console.log("       PERSON_001 ALL 10 UNIQUE PAIRWISE COSINE DISTANCES (5 NEW EMBEDDINGS)");
  console.log("===============================================================================\n");

  const pairs = [];
  for (let i = 0; i < enrolled.length; i++) {
    for (let j = i + 1; j < enrolled.length; j++) {
      const eA = enrolled[i];
      const eB = enrolled[j];
      const dist = cosineDistance(eA.embedding, eB.embedding);
      pairs.push({
        label: `${eA.slot} vs ${eB.slot}`,
        name: `${eA.slot} (${eA.pose}) vs ${eB.slot} (${eB.pose})`,
        dist,
        sim: 1 - dist,
      });
      console.log(`• ${eA.slot} vs ${eB.slot} [${eA.pose} vs ${eB.pose}] -> Cosine Dist: ${dist.toFixed(4)} | Similarity: ${(1 - dist).toFixed(4)}`);
    }
  }

  const sortedDists = [...pairs.map(p => p.dist)].sort((a, b) => a - b);
  const min = sortedDists[0];
  const max = sortedDists[sortedDists.length - 1];
  const sum = sortedDists.reduce((acc, v) => acc + v, 0);
  const mean = sum / sortedDists.length;
  const median = (sortedDists[4] + sortedDists[5]) / 2;

  console.log("\n-------------------------------------------------------------------------------");
  console.log(`PAIRWISE DISTANCE SUMMARY STATISTICS:`);
  console.log(`• Minimum Distance: ${min.toFixed(4)} (Similarity: ${(1 - min).toFixed(4)})`);
  console.log(`• Maximum Distance: ${max.toFixed(4)} (Similarity: ${(1 - max).toFixed(4)})`);
  console.log(`• Mean Distance:    ${mean.toFixed(4)} (Similarity: ${(1 - mean).toFixed(4)})`);
  console.log(`• Median Distance:  ${median.toFixed(4)} (Similarity: ${(1 - median).toFixed(4)})`);
  console.log("-------------------------------------------------------------------------------");
}

main().catch(console.error);
