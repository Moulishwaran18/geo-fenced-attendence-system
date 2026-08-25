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

const PHOTO_INPUTS = [
  {
    targetPose: "Straight (Frontal)",
    sourceFile: "media_1787591458548.jpg",
    targetFile: "reference_01.jpg",
    relPath: "/staff-photos/person-001/reference_01.jpg",
  },
  {
    targetPose: "Looking Right",
    sourceFile: "media_1787591458578.jpg",
    targetFile: "reference_02.jpg",
    relPath: "/staff-photos/person-001/reference_02.jpg",
  },
  {
    targetPose: "Looking Down",
    sourceFile: "media_1787591458651.jpg",
    targetFile: "reference_03.jpg",
    relPath: "/staff-photos/person-001/reference_03.jpg",
  },
  {
    targetPose: "Looking Up",
    sourceFile: "media_1787591458687.jpg",
    targetFile: "reference_04.jpg",
    relPath: "/staff-photos/person-001/reference_04.jpg",
  },
  {
    targetPose: "Looking Left",
    sourceFile: "media_1787591458703.jpg",
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

// 5-Point ArcFace Standard Target Coordinates
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

function estimatePose(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  // Left eye center & right eye center
  let leX = 0, leY = 0, reX = 0, reY = 0;
  [36, 37, 38, 39, 40, 41].forEach(i => { leX += pts[i].x; leY += pts[i].y; });
  [42, 43, 44, 45, 46, 47].forEach(i => { reX += pts[i].x; reY += pts[i].y; });
  leX /= 6; leY /= 6; reX /= 6; reY /= 6;

  const noseX = pts[30].x;
  const noseY = pts[30].y;
  const mouthX = (pts[48].x + pts[54].x) / 2;
  const mouthY = (pts[48].y + pts[54].y) / 2;

  const eyeDist = Math.hypot(reX - leX, reY - leY) || 1;
  const eyeMidX = (leX + reX) / 2;
  const eyeMidY = (leY + reY) / 2;

  // Yaw: horizontal deviation of nose tip relative to midpoint between eyes
  const yawRatio = (noseX - eyeMidX) / (eyeDist / 2);
  const yawDeg = Math.round(yawRatio * 45); // approximated in degrees

  // Pitch: vertical position of nose tip between eye midpoint and mouth midpoint
  const faceHeight = Math.hypot(mouthX - eyeMidX, mouthY - eyeMidY) || 1;
  const expectedNoseY = eyeMidY + faceHeight * 0.55;
  const pitchRatio = (noseY - expectedNoseY) / faceHeight;
  const pitchDeg = Math.round(pitchRatio * -60); // approximated in degrees

  return { yawDeg, pitchDeg };
}

function analyzeQuality(rawJpeg) {
  const { width, height, data } = rawJpeg;
  const pixelCount = width * height;
  let totalLuma = 0, totalLumaSq = 0;
  const gray = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = luma;
    totalLuma += luma;
    totalLumaSq += luma * luma;
  }

  const brightness = totalLuma / pixelCount;
  const variance = (totalLumaSq / pixelCount) - (brightness * brightness);
  const contrast = Math.sqrt(Math.max(0, variance));

  // Sharpness via discrete Laplacian variance
  let lapSum = 0, lapSumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const lapMean = lapSum / count;
  const sharpness = Math.sqrt(Math.max(0, (lapSumSq / count) - (lapMean * lapMean)));

  return { width, height, brightness, contrast, sharpness };
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

async function run() {
  console.log("===============================================================================");
  console.log("             PERSON_001 VALIDATION & ENROLLMENT PIPELINE");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  const validationResults = [];
  const enrolledEmbeddings = [];

  for (let i = 0; i < PHOTO_INPUTS.length; i++) {
    const item = PHOTO_INPUTS[i];
    const srcPath = path.join(UPLOAD_DIR, item.sourceFile);
    const fileBuf = fs.readFileSync(srcPath);
    const rawJpeg = jpeg.decode(fileBuf, { useTArray: true });
    const quality = analyzeQuality(rawJpeg);

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
      const targetH = Math.round(rawJpeg.height * scale);
      const targetW = Math.round(rawJpeg.width * scale);
      const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks();

    tensor3D.dispose();

    const faceCount = detections.length;
    let poseEst = { yawDeg: 0, pitchDeg: 0 };
    let isValid = false;
    let poseStatus = "VALID";

    if (faceCount === 1) {
      const face = detections[0];
      poseEst = estimatePose(face.landmarks);
      isValid = true;

      // Check preferred range: yaw in [-30, +30], pitch in [-15, +15]
      const yawExtreme = Math.abs(poseEst.yawDeg) > 30;
      const pitchExtreme = Math.abs(poseEst.pitchDeg) > 20;

      if (yawExtreme || pitchExtreme) {
        poseStatus = "OPTIONAL / EXTREME POSE";
      } else {
        poseStatus = "ACTIVE / PREFERRED";
      }

      // Generate ArcFace embedding
      const alignedTensor = alignFaceToTensor(rawJpeg, face.landmarks);
      const output = await session.run({ [session.inputNames[0]]: alignedTensor });
      const rawEmbedding = Array.from(output[session.outputNames[0]].data);

      const rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
      const normalizedEmbedding = rawEmbedding.map(v => v / rawNorm);
      const finalNorm = Math.sqrt(normalizedEmbedding.reduce((sum, v) => sum + v * v, 0));

      // Save file to destination
      const targetPath = path.join(TARGET_DIR, item.targetFile);
      fs.copyFileSync(srcPath, targetPath);

      enrolledEmbeddings.push({
        id: `emb-p1-${i + 1}`,
        pose: item.targetPose,
        file: item.targetFile,
        relPath: item.relPath,
        embedding: normalizedEmbedding,
        dim: normalizedEmbedding.length,
        norm: finalNorm,
        yaw: poseEst.yawDeg,
        pitch: poseEst.pitchDeg,
        status: poseStatus,
      });
    }

    validationResults.push({
      photo: `Photo ${i + 1}`,
      targetPose: item.targetPose,
      file: item.targetFile,
      faceCount,
      brightness: quality.brightness.toFixed(1),
      contrast: quality.contrast.toFixed(1),
      sharpness: quality.sharpness.toFixed(1),
      yaw: `${poseEst.yawDeg > 0 ? "+" : ""}${poseEst.yawDeg}°`,
      pitch: `${poseEst.pitchDeg > 0 ? "+" : ""}${poseEst.pitchDeg}°`,
      poseStatus,
      valid: isValid,
    });
  }

  // Update Database with the clean gallery
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const otherEmbeddings = db.face_embeddings.filter(e => e.staff_id !== "staff-person_001");
  const oldP1Embeddings = db.face_embeddings.filter(e => e.staff_id === "staff-person_001");

  const newRecords = enrolledEmbeddings.map(e => ({
    id: e.id,
    staff_id: "staff-person_001",
    embedding: e.embedding,
    reference_image_path: e.relPath,
    created_at: new Date().toISOString(),
  }));

  db.face_embeddings = [...otherEmbeddings, ...newRecords];
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");

  // Compute 10 pairwise distances
  const pairwise = [];
  for (let i = 0; i < enrolledEmbeddings.length; i++) {
    for (let j = i + 1; j < enrolledEmbeddings.length; j++) {
      const eA = enrolledEmbeddings[i];
      const eB = enrolledEmbeddings[j];
      const dist = cosineDistance(eA.embedding, eB.embedding);
      pairwise.push({
        pair: `[Photo ${i + 1} vs Photo ${j + 1}] ${eA.pose} vs ${eB.pose}`,
        dist,
        sim: 1 - dist
      });
    }
  }

  const sorted = [...pairwise.map(p => p.dist)].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  const median = (sorted[4] + sorted[5]) / 2;

  console.log("STEP 1: VALIDATION REPORT");
  console.log(JSON.stringify(validationResults, null, 2));

  console.log("\nSTEP 2: ENROLLMENT REPORT");
  console.log({
    oldRemoved: oldP1Embeddings.length,
    newAdded: newRecords.length,
    activeTotal: newRecords.length,
    dim: 512,
    l2Validation: enrolledEmbeddings.every(e => Math.abs(e.norm - 1.0) < 1e-5) ? "PASS" : "FAIL"
  });

  console.log("\nSTEP 3: PAIRWISE DISTANCES (10 UNIQUE COMBINATIONS)");
  pairwise.forEach(p => console.log(`${p.pair} -> Dist: ${p.dist.toFixed(4)} | Sim: ${p.sim.toFixed(4)}`));
  console.log(`Min: ${min.toFixed(4)}, Max: ${max.toFixed(4)}, Mean: ${mean.toFixed(4)}, Median: ${median.toFixed(4)}`);
}

run().catch(console.error);
