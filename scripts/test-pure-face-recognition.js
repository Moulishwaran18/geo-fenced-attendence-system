import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";
const PHOTOS_DIR = path.resolve("public", "staff-photos");
const DB_PATH = path.resolve("data", "staff-db.json");

const MATCH_THRESHOLD = 0.45;
const MIN_MATCH_MARGIN = 0.08;

// 5-Point ArcFace Standard Target Coordinates (112x112)
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
    indices.forEach((idx) => { x += pts[idx].x; y += pts[idx].y; });
    return [x / indices.length, y / indices.length];
  };
  return [
    avg([36, 37, 38, 39, 40, 41]), // Left eye center
    avg([42, 43, 44, 45, 46, 47]), // Right eye center
    [pts[30].x, pts[30].y],         // Nose tip
    [pts[48].x, pts[48].y],         // Mouth left corner
    [pts[54].x, pts[54].y],         // Mouth right corner
  ];
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

async function runFacePipeline(rawJpeg, session, activeStaff, activeEmbeddings) {
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
    const resized = tf.image.resizeBilinear(tensor3D, [
      Math.round(rawJpeg.height * scale),
      Math.round(rawJpeg.width * scale),
    ]);
    tensor3D.dispose();
    tensor3D = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25 }))
    .withFaceLandmarks();
  tensor3D.dispose();

  // 1. Face Detection Gate
  if (detections.length === 0) {
    return {
      status: "NO_FACE",
      faceCount: 0,
      confidence: 0,
      boundingBox: null,
      message: "No face detected",
      finalResult: "NO FACE",
    };
  }

  if (detections.length > 1) {
    return {
      status: "MULTIPLE_FACES",
      faceCount: detections.length,
      confidence: detections[0].detection.score,
      boundingBox: detections[0].detection.box,
      message: "Multiple faces detected. Only one person should be visible.",
      finalResult: "MULTIPLE FACES → REJECT",
    };
  }

  // Exactly 1 face
  const face = detections[0];
  const confidence = face.detection.score;
  const boundingBox = {
    x: Math.round(face.detection.box.x),
    y: Math.round(face.detection.box.y),
    width: Math.round(face.detection.box.width),
    height: Math.round(face.detection.box.height),
  };

  // 2. Alignment & 3. ArcFace Embedding
  const alignedTensor = alignFaceToTensor(rawJpeg, face.landmarks);
  const output = await session.run({ [session.inputNames[0]]: alignedTensor });
  const rawEmbedding = Array.from(output[session.outputNames[0]].data);

  const rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
  const liveEmbedding = rawEmbedding.map((v) => v / rawNorm);
  const liveNorm = Math.sqrt(liveEmbedding.reduce((sum, v) => sum + v * v, 0));

  // 4. Database Search & 5. Person-Level Matching
  const staffMap = new Map();
  activeStaff.forEach((s) => {
    staffMap.set(s.id, {
      staffId: s.id,
      staffCode: s.staff_code,
      name: s.name,
      distances: [],
      embeddings: [],
    });
  });

  for (const emb of activeEmbeddings) {
    const s = staffMap.get(emb.staff_id);
    if (!s) continue;
    const dist = cosineDistance(liveEmbedding, emb.embedding);
    s.distances.push(dist);
    s.embeddings.push({ id: emb.id, path: emb.reference_image_path, dist });
  }

  const personResults = Array.from(staffMap.values())
    .map((p) => ({
      staffCode: p.staffCode,
      name: p.name,
      minDistance: Math.min(...p.distances),
      allDistances: p.distances,
      embeddings: p.embeddings,
      count: p.distances.length,
    }))
    .sort((a, b) => a.minDistance - b.minDistance);

  const bestPerson = personResults[0];
  const secondBestPerson = personResults.length > 1 ? personResults[1] : null;

  const bestDistance = bestPerson.minDistance;
  const secondBestDistance = secondBestPerson ? secondBestPerson.minDistance : 1.0;
  const margin = secondBestDistance - bestDistance;

  // 6. Final Recognition Rule
  const withinThreshold = bestDistance <= MATCH_THRESHOLD;
  const adequateMargin = margin >= MIN_MATCH_MARGIN;
  const matched = withinThreshold && adequateMargin;
  const finalResult = matched ? bestPerson.staffCode : "UNKNOWN";

  return {
    status: "EXACTLY_ONE_FACE",
    faceCount: 1,
    confidence,
    boundingBox,
    embeddingDim: liveEmbedding.length,
    liveNorm,
    searchedEmbeddingsCount: activeEmbeddings.length,
    personResults,
    bestMatch: bestPerson,
    secondBestMatch: secondBestPerson,
    bestDistance,
    secondBestDistance,
    margin,
    threshold: MATCH_THRESHOLD,
    requiredMargin: MIN_MATCH_MARGIN,
    finalResult,
    reason: !matched
      ? !withinThreshold
        ? `Best distance (${bestDistance.toFixed(4)}) > threshold (${MATCH_THRESHOLD})`
        : `Margin (${margin.toFixed(4)}) < required margin (${MIN_MATCH_MARGIN})`
      : null,
  };
}

async function main() {
  console.log("===============================================================================");
  console.log("     FACE DETECTION + DATABASE FACE RECOGNITION PIPELINE VERIFICATION");
  console.log("===============================================================================\n");

  // Load Models
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);
  const onnxPath = path.join(MODELS_DIR, "w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(onnxPath, { executionProviders: ["wasm"] });

  // Load Active Database
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  const activeStaff = db.staff.filter((s) => s.active);
  const activeStaffMap = new Map(activeStaff.map((s) => [s.id, s]));
  const activeEmbeddings = db.face_embeddings.filter((e) => activeStaffMap.has(e.staff_id));

  console.log(`Database Status:`);
  console.log(`  • Active Staff: ${activeStaff.length} (${activeStaff.map((s) => s.staff_code).join(", ")})`);
  console.log(`  • Total Active Embeddings: ${activeEmbeddings.length}\n`);

  // Build Test Images for 6 Test Cases:
  // 1. PERSON_001 Live Face
  const p1Buf = fs.readFileSync(path.join(UPLOAD_DIR, "media_1787591458548.jpg"));
  const p1Jpeg = jpeg.decode(p1Buf, { useTArray: true });

  // 2. PERSON_002 Live Face (reference_01.jpg from person-002)
  const p2Buf = fs.readFileSync(path.join(PHOTOS_DIR, "person-002", "reference_01.jpg"));
  const p2Jpeg = jpeg.decode(p2Buf, { useTArray: true });

  // 3. PERSON_003 Live Face (reference_02.jpg from person-003)
  const p3Buf = fs.readFileSync(path.join(PHOTOS_DIR, "person-003", "reference_02.jpg"));
  const p3Jpeg = jpeg.decode(p3Buf, { useTArray: true });

  // 4. Unknown Person (distinct face not registered in database)
  const unkPath = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\4b190114-a549-48a0-910d-a035c57b5102\\unknown_person_test_1787637376775.jpg";
  const unkBuf = fs.readFileSync(unkPath);
  const unkJpeg = jpeg.decode(unkBuf, { useTArray: true });

  // 5. No Face (blank 640x480 black image)
  const blankData = new Uint8Array(640 * 480 * 4);
  const noFaceJpeg = { width: 640, height: 480, data: blankData };

  // 6. Two People (side-by-side composite of p1 and p2)
  const compW = p1Jpeg.width + p2Jpeg.width;
  const compH = Math.max(p1Jpeg.height, p2Jpeg.height);
  const compData = new Uint8Array(compW * compH * 4);
  // Copy p1 to left
  for (let y = 0; y < p1Jpeg.height; y++) {
    for (let x = 0; x < p1Jpeg.width; x++) {
      const srcIdx = (y * p1Jpeg.width + x) * 4;
      const dstIdx = (y * compW + x) * 4;
      compData[dstIdx] = p1Jpeg.data[srcIdx];
      compData[dstIdx + 1] = p1Jpeg.data[srcIdx + 1];
      compData[dstIdx + 2] = p1Jpeg.data[srcIdx + 2];
      compData[dstIdx + 3] = 255;
    }
  }
  // Copy p2 to right
  for (let y = 0; y < p2Jpeg.height; y++) {
    for (let x = 0; x < p2Jpeg.width; x++) {
      const srcIdx = (y * p2Jpeg.width + x) * 4;
      const dstIdx = (y * compW + (p1Jpeg.width + x)) * 4;
      compData[dstIdx] = p2Jpeg.data[srcIdx];
      compData[dstIdx + 1] = p2Jpeg.data[srcIdx + 1];
      compData[dstIdx + 2] = p2Jpeg.data[srcIdx + 2];
      compData[dstIdx + 3] = 255;
    }
  }
  const multiFaceJpeg = { width: compW, height: compH, data: compData };

  const testCases = [
    { id: 1, name: "PERSON_001 live face", jpeg: p1Jpeg, expected: "PERSON_001" },
    { id: 2, name: "PERSON_002 live face", jpeg: p2Jpeg, expected: "PERSON_002" },
    { id: 3, name: "PERSON_003 live face", jpeg: p3Jpeg, expected: "PERSON_003" },
    { id: 4, name: "Unknown live person", jpeg: unkJpeg, expected: "UNKNOWN" },
    { id: 5, name: "No face", jpeg: noFaceJpeg, expected: "NO FACE" },
    { id: 6, name: "Two people", jpeg: multiFaceJpeg, expected: "MULTIPLE FACES → REJECT" },
  ];

  let passedTests = 0;

  for (const tc of testCases) {
    console.log("-------------------------------------------------------------------------------");
    console.log(`TEST CASE ${tc.id}: ${tc.name}`);
    console.log(`Expected Result: ${tc.expected}`);
    console.log("-------------------------------------------------------------------------------");

    const res = await runFacePipeline(tc.jpeg, session, activeStaff, activeEmbeddings);

    if (res.status === "NO_FACE") {
      console.log(`  • Face Detection: 0 Faces`);
      console.log(`  • Final Result: ${res.finalResult}`);
      const passed = res.finalResult === tc.expected;
      console.log(`  • Status: ${passed ? "PASS ✓" : "FAIL ✗"}\n`);
      if (passed) passedTests++;
      continue;
    }

    if (res.status === "MULTIPLE_FACES") {
      console.log(`  • Face Detection: Multiple Faces (${res.faceCount} detected)`);
      console.log(`  • Final Result: ${res.finalResult}`);
      const passed = res.finalResult === tc.expected;
      console.log(`  • Status: ${passed ? "PASS ✓" : "FAIL ✗"}\n`);
      if (passed) passedTests++;
      continue;
    }

    // Single face
    console.log(`  • Face Detection: 1 Face (${(res.confidence * 100).toFixed(1)}% conf)`);
    console.log(`  • Face Box: x:${res.boundingBox.x}, y:${res.boundingBox.y}, w:${res.boundingBox.width}, h:${res.boundingBox.height}`);
    console.log(`  • Embedding Dimension: ${res.embeddingDim}-D`);
    console.log(`  • Live Embedding Norm: ${res.liveNorm.toFixed(6)}`);
    console.log(`  • Active Embeddings Searched: ${res.searchedEmbeddingsCount}`);
    console.log(`  • Person-Level Distances:`);
    res.personResults.forEach((p) => {
      console.log(`      - ${p.staffCode} (${p.name}): min distance = ${p.minDistance.toFixed(4)} (${p.count} embeddings)`);
    });
    console.log(`  • Best Match: ${res.bestMatch.staffCode} (distance: ${res.bestDistance.toFixed(4)})`);
    console.log(`  • Second Best: ${res.secondBestMatch ? res.secondBestMatch.staffCode : "None"} (distance: ${res.secondBestDistance.toFixed(4)})`);
    console.log(`  • Match Margin: ${res.margin.toFixed(4)} (Threshold: 0.45, Required Margin: 0.08)`);
    console.log(`  • Final Result: ${res.finalResult}`);
    if (res.reason) console.log(`  • Rejection Reason: ${res.reason}`);

    const passed = res.finalResult === tc.expected;
    console.log(`  • Status: ${passed ? "PASS ✓" : "FAIL ✗"}`);

    // Section 11 Requirement: For PERSON_001, show individual distances for all 5 references
    if (tc.id === 1) {
      console.log("\n  [DEBUG REQUIREMENT - PERSON_001 ALL 5 REFERENCE EMBEDDINGS BREAKDOWN]:");
      const p1Record = res.personResults.find((p) => p.staffCode === "PERSON_001");
      if (p1Record) {
        p1Record.embeddings.forEach((e, idx) => {
          console.log(`      P001 embedding ${idx + 1} → ${e.dist.toFixed(4)} (${e.path})`);
        });
        console.log(`      P001 minimum distance = ${p1Record.minDistance.toFixed(4)}`);
      }
    }

    console.log("");
    if (passed) passedTests++;
  }

  console.log("===============================================================================");
  console.log(`  TOTAL TEST SUMMARY: ${passedTests} / ${testCases.length} TESTS PASSED`);
  console.log("===============================================================================\n");
}

main().catch(console.error);
