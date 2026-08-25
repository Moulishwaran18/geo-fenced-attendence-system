/**
 * Database Seed Script — CampusAttend (512-D ArcFace Pipeline)
 *
 * 1. Creates exactly 3 initial test staff records: PERSON_001, PERSON_002, PERSON_003.
 * 2. Scans existing project reference photos in `public/staff-photos/person-00X/`.
 * 3. Enforces single-face presence validation on every image.
 * 4. Aligns face to 112x112 using 5-point facial landmark similarity transformation.
 * 5. Extracts 512-dimensional biometric embeddings using InsightFace MobileFaceNet ArcFace (w600k_mbf.onnx).
 * 6. Deletes obsolete 128-d embeddings and stores the new 512-d embeddings linked to staff records.
 *
 * Usage:
 *   npm run db:seed
 */

import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import * as ort from "onnxruntime-web";
import faceapi from "face-api.js";
import pg from "pg";

const { Pool } = pg;

const INITIAL_TEST_STAFF = [
  {
    staff_code: "PERSON_001",
    name: "Test Person 1",
    email: "test.person1@sonatech.ac.in",
    department: "Computer Science & Engineering",
    designation: "Associate Professor",
    photoDir: "public/staff-photos/person-001",
    urlPrefix: "/staff-photos/person-001",
    verifiedPhotos: ["reference_01.jpg", "reference_02.jpg"],
  },
  {
    staff_code: "PERSON_002",
    name: "Test Person 2",
    email: "test.person2@sonatech.ac.in",
    department: "Information Technology",
    designation: "Assistant Professor",
    photoDir: "public/staff-photos/person-002",
    urlPrefix: "/staff-photos/person-002",
    verifiedPhotos: ["reference_01.jpg", "reference_05.jpg"],
  },
  {
    staff_code: "PERSON_003",
    name: "Test Person 3",
    email: "test.person3@sonatech.ac.in",
    department: "Electronics & Communication",
    designation: "Professor",
    photoDir: "public/staff-photos/person-003",
    urlPrefix: "/staff-photos/person-003",
    verifiedPhotos: ["reference_02.jpg", "reference_03.jpg"],
  },
];

const LOCAL_STORE_PATH = path.resolve("data", "staff-db.json");

function readLocalStore() {
  if (!fs.existsSync(path.dirname(LOCAL_STORE_PATH))) {
    fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  }
  if (fs.existsSync(LOCAL_STORE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
    } catch {
      // ignore
    }
  }
  return { staff: [], face_embeddings: [] };
}

function writeLocalStore(data) {
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// -----------------------------------------------------------------------------
// Face Alignment & ArcFace Similarity Transform
// -----------------------------------------------------------------------------

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose tip
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0,
    srcMeanY = 0,
    dstMeanX = 0,
    dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0];
    srcMeanY += src[i][1];
    dstMeanX += dst[i][0];
    dstMeanY += dst[i][1];
  }
  srcMeanX /= n;
  srcMeanY /= n;
  dstMeanX /= n;
  dstMeanY /= n;

  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - srcMeanX;
    const dy = src[i][1] - srcMeanY;
    srcVar += dx * dx + dy * dy;
  }
  srcVar /= n;
  if (srcVar === 0) srcVar = 1e-6;

  let sxx = 0,
    sxy = 0,
    syx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    sxx += dx * sx;
    sxy += dx * sy;
    syx += dy * sx;
    syy += dy * sy;
  }
  sxx /= n;
  sxy /= n;
  syx /= n;
  syy /= n;

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
    M: [
      [a, -b, tx],
      [b, a, ty],
    ],
    invM: [
      [invA, -invB, invTx],
      [invB, invA, invTy],
    ],
  };
}

function alignCropFace(imgData, width, height, landmarks) {
  const pts = landmarks.positions;
  const leftEye = [
    (pts[36].x + pts[37].x + pts[38].x + pts[39].x + pts[40].x + pts[41].x) / 6,
    (pts[36].y + pts[37].y + pts[38].y + pts[39].y + pts[40].y + pts[41].y) / 6,
  ];
  const rightEye = [
    (pts[42].x + pts[43].x + pts[44].x + pts[45].x + pts[46].x + pts[47].x) / 6,
    (pts[42].y + pts[43].y + pts[44].y + pts[45].y + pts[46].y + pts[47].y) / 6,
  ];
  const nose = [pts[30].x, pts[30].y];
  const leftMouth = [pts[48].x, pts[48].y];
  const rightMouth = [pts[54].x, pts[54].y];

  const srcPoints = [leftEye, rightEye, nose, leftMouth, rightMouth];
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);

  const outW = 112;
  const outH = 112;
  const floatPlanar = new Float32Array(3 * outW * outH);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const wx = sx - x0;
      const wy = sy - y0;

      let r = 0,
        g = 0,
        b = 0;
      if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
        const idx00 = (y0 * width + x0) * 4;
        const idx10 = (y0 * width + x1) * 4;
        const idx01 = (y1 * width + x0) * 4;
        const idx11 = (y1 * width + x1) * 4;

        r =
          (1 - wx) * (1 - wy) * imgData[idx00] +
          wx * (1 - wy) * imgData[idx10] +
          (1 - wx) * wy * imgData[idx01] +
          wx * wy * imgData[idx11];
        g =
          (1 - wx) * (1 - wy) * imgData[idx00 + 1] +
          wx * (1 - wy) * imgData[idx10 + 1] +
          (1 - wx) * wy * imgData[idx01 + 1] +
          wx * wy * imgData[idx11 + 1];
        b =
          (1 - wx) * (1 - wy) * imgData[idx00 + 2] +
          wx * (1 - wy) * imgData[idx10 + 2] +
          (1 - wx) * wy * imgData[idx01 + 2] +
          wx * wy * imgData[idx11 + 2];
      }

      // Normalization: (RGB - 127.5) / 128.0
      const pixelIdx = dy * outW + dx;
      floatPlanar[0 * outW * outH + pixelIdx] = (r - 127.5) / 128.0;
      floatPlanar[1 * outW * outH + pixelIdx] = (g - 127.5) / 128.0;
      floatPlanar[2 * outW * outH + pixelIdx] = (b - 127.5) / 128.0;
    }
  }

  return floatPlanar;
}

// -----------------------------------------------------------------------------
// Model Loading
// -----------------------------------------------------------------------------

let arcFaceSession = null;

async function loadModels() {
  const modelsPath = path.resolve("public/models");
  console.log(`Loading face detection & landmark models from ${modelsPath}...`);
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);

  const arcFaceModelPath = path.join(modelsPath, "w600k_mbf.onnx");
  console.log(`Loading InsightFace MobileFaceNet ArcFace model from ${arcFaceModelPath}...`);
  arcFaceSession = await ort.InferenceSession.create(arcFaceModelPath);
  console.log("✓ All Neural Network Models Loaded (SSD MobileNet V1, 68 Landmarks, ArcFace 512-D).");
}

async function processImage(filePath) {
  const imgBuffer = fs.readFileSync(filePath);
  const rawData = jpeg.decode(imgBuffer, { useTArray: true });

  const numPixels = rawData.width * rawData.height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let i = 0; i < numPixels; i++) {
    rgbValues[i * 3] = rawData.data[i * 4];
    rgbValues[i * 3 + 1] = rawData.data[i * 4 + 1];
    rgbValues[i * 3 + 2] = rawData.data[i * 4 + 2];
  }

  let tensor = tf.tensor3d(rgbValues, [rawData.height, rawData.width, 3], "int32");

  const maxDim = Math.max(rawData.height, rawData.width);
  if (maxDim > 640) {
    const scale = 640 / maxDim;
    const targetH = Math.round(rawData.height * scale);
    const targetW = Math.round(rawData.width * scale);
    const resized = tf.image.resizeBilinear(tensor, [targetH, targetW]);
    tensor.dispose();
    tensor = tf.cast(resized, "int32");
    resized.dispose();
  }

  const detections = await faceapi
    .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
    .withFaceLandmarks();

  tensor.dispose();

  if (detections.length === 0) {
    return { valid: false, reason: "No face detected in image", count: 0 };
  }
  if (detections.length > 1) {
    return {
      valid: false,
      reason: `Multiple faces detected (${detections.length})`,
      count: detections.length,
    };
  }

  const single = detections[0];

  // Align face and run ArcFace ONNX model
  const aligned = alignCropFace(rawData.data, rawData.width, rawData.height, single.landmarks);
  const inputTensor = new ort.Tensor("float32", aligned, [1, 3, 112, 112]);
  const inputName = arcFaceSession.inputNames[0] || "input.1";
  const outputName = arcFaceSession.outputNames[0] || "516";

  const feeds = { [inputName]: inputTensor };
  const res = await arcFaceSession.run(feeds);
  const out = res[outputName].data;

  // L2 unit normalization
  let norm = 0;
  for (let i = 0; i < 512; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1e-6;
  const descriptor = new Array(512);
  for (let i = 0; i < 512; i++) descriptor[i] = out[i] / norm;

  return {
    valid: true,
    descriptor,
    confidence: single.detection.score,
  };
}

async function seed() {
  console.log("==================================================");
  console.log("CampusAttend — 512-D ArcFace Database Seed Runner");
  console.log("==================================================");

  await loadModels();

  const dbUrl = process.env.DATABASE_URL;
  let pool = null;

  if (dbUrl || (process.env.PGHOST && process.env.PGDATABASE)) {
    pool = new Pool({
      connectionString: dbUrl || undefined,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    });

    // Make sure table schema is updated to 512-d
    try {
      console.log("Verifying PostgreSQL schema for vector(512)...");
      await pool.query("ALTER TABLE face_embeddings ALTER COLUMN embedding TYPE vector(512);");
      console.log("✓ PostgreSQL face_embeddings.embedding verified as vector(512).");
    } catch {
      // ignore if already vector(512) or fresh table
    }

    // Clean out obsolete 128-d embeddings
    console.log("Clearing obsolete embeddings from PostgreSQL database...");
    await pool.query("TRUNCATE TABLE face_embeddings CASCADE;");
  }

  const localStore = readLocalStore();
  // Clear obsolete embeddings from local store
  localStore.face_embeddings = [];

  const summary = [];

  for (const person of INITIAL_TEST_STAFF) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Processing Staff Member: ${person.staff_code} (${person.name})`);
    console.log(`--------------------------------------------------`);

    let staffId = "";

    // 1. Create or retrieve Staff Record
    if (pool) {
      const q = `
        INSERT INTO staff (staff_code, name, email, department, designation, active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (staff_code) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email, department = EXCLUDED.department, designation = EXCLUDED.designation
        RETURNING id;
      `;
      const res = await pool.query(q, [
        person.staff_code,
        person.name,
        person.email,
        person.department,
        person.designation,
      ]);
      staffId = res.rows[0].id;
    } else {
      const existingIdx = localStore.staff.findIndex((s) => s.staff_code === person.staff_code);
      const now = new Date().toISOString();
      if (existingIdx >= 0) {
        staffId = localStore.staff[existingIdx].id;
        localStore.staff[existingIdx].name = person.name;
        localStore.staff[existingIdx].email = person.email;
        localStore.staff[existingIdx].department = person.department;
        localStore.staff[existingIdx].designation = person.designation;
        localStore.staff[existingIdx].active = true;
        localStore.staff[existingIdx].updated_at = now;
      } else {
        staffId = `staff-${person.staff_code.toLowerCase()}`;
        localStore.staff.push({
          id: staffId,
          staff_code: person.staff_code,
          name: person.name,
          email: person.email,
          department: person.department,
          designation: person.designation,
          active: true,
          created_at: now,
          updated_at: now,
        });
      }
    }

    console.log(`Staff ID for ${person.staff_code}: ${staffId}`);

    // 2. Discover reference photos in workspace
    const fullDir = path.resolve(person.photoDir);
    if (!fs.existsSync(fullDir)) {
      console.warn(`[WARNING] Photo directory not found: ${fullDir}`);
      continue;
    }

    const files = fs
      .readdirSync(fullDir)
      .filter((f) => /\.(jpe?g|png)$/i.test(f) && (!person.verifiedPhotos || person.verifiedPhotos.includes(f)))
      .sort();

    console.log(`Found ${files.length} verified reference image(s) in ${person.photoDir}`);

    let validCount = 0;
    let rejectedCount = 0;

    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const relPath = `${person.urlPrefix}/${file}`;

      console.log(`  Evaluating: ${file}...`);
      const result = await processImage(filePath);

      if (!result.valid) {
        console.log(`    ❌ REJECTED: ${result.reason}`);
        rejectedCount++;
        continue;
      }

      console.log(
        `    ✓ EXACTLY 1 FACE DETECTED (Confidence: ${(result.confidence * 100).toFixed(1)}%)`,
      );
      console.log(
        `    ✓ 512-dimensional ArcFace embedding generated (Length: ${result.descriptor.length}).`,
      );

      // 3. Persist embedding
      if (pool) {
        const vecStr = `[${result.descriptor.join(",")}]`;
        await pool.query(
          "INSERT INTO face_embeddings (staff_id, embedding, reference_image_path) VALUES ($1, $2, $3)",
          [staffId, vecStr, relPath],
        );
        console.log(`    ✓ Persisted to PostgreSQL face_embeddings table.`);
      } else {
        localStore.face_embeddings.push({
          id: `emb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          staff_id: staffId,
          embedding: result.descriptor,
          reference_image_path: relPath,
          created_at: new Date().toISOString(),
        });
        console.log(`    ✓ Persisted to local development database store.`);
      }
      validCount++;
    }

    summary.push({
      staffCode: person.staff_code,
      name: person.name,
      totalPhotos: files.length,
      validEmbeddings: validCount,
      rejectedPhotos: rejectedCount,
      dimension: 512,
    });
  }

  if (!pool) {
    writeLocalStore(localStore);
  } else {
    await pool.end();
  }

  console.log("\n==================================================");
  console.log("512-D ARCFACE SEED SUMMARY");
  console.log("==================================================");
  console.table(summary);
  console.log("✓ All initial staff records and 512-D ArcFace embeddings seeded successfully!");
}

seed().catch((err) => {
  console.error("Fatal error during seeding:", err);
  process.exit(1);
});
