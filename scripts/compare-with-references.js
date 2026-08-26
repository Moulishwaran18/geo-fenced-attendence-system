import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { Pool } from "pg";
import * as ort from "onnxruntime-web";

const pool = new Pool({
  connectionString: "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const numPts = src.length;
  for (let i = 0; i < numPts; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= numPts; srcMeanY /= numPts;
  dstMeanX /= numPts; dstMeanY /= numPts;

  let srcVar = 0, sxx = 0, syy = 0, sxy = 0, syx = 0;
  for (let i = 0; i < numPts; i++) {
    const sX = src[i][0] - srcMeanX, sY = src[i][1] - srcMeanY;
    const dX = dst[i][0] - dstMeanX, dY = dst[i][1] - dstMeanY;
    srcVar += sX * sX + sY * sY;
    sxx += sX * dX; syy += sY * dY;
    sxy += sX * dY; syx += sY * dX;
  }
  srcVar /= numPts;
  sxx /= numPts; syy /= numPts; sxy /= numPts; syx /= numPts;

  const a = (sxx + syy) / (srcVar || 1e-6);
  const b = (sxy - syx) / (srcVar || 1e-6);
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const denom = a * a + b * b || 1e-6;
  const invA = a / denom;
  const invB = -b / denom;
  const invTx = -(invA * tx - invB * ty);
  const invTy = -(invB * tx + invA * ty);

  return {
    M: [[a, -b, tx], [b, a, ty]],
    invM: [[invA, -invB, invTx], [invB, invA, invTy]],
  };
}

function align112FromRaw(rawImg, srcPoints) {
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);
  const targetW = 112, targetH = 112;
  const planar = new Float32Array(3 * targetW * targetH);
  const channelStride = targetW * targetH;

  for (let dy = 0; dy < targetH; dy++) {
    for (let dx = 0; dx < targetW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, rawImg.width - 1);
      const y1 = Math.min(y0 + 1, rawImg.height - 1);

      const wx = sx - x0;
      const wy = sy - y0;

      let r = 0, g = 0, b = 0;
      if (x0 >= 0 && x0 < rawImg.width && y0 >= 0 && y0 < rawImg.height) {
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

async function run() {
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), {
    executionProviders: ["wasm"],
  });

  const dbRes = await pool.query(
    "SELECT reference_image_path, embedding::text FROM face_embeddings WHERE staff_id = (SELECT id FROM staff WHERE staff_code = 'PERSON_001') ORDER BY reference_image_path"
  );
  const dbEmbeddings = dbRes.rows.map((r) => ({
    name: path.basename(r.reference_image_path),
    vec: JSON.parse(r.embedding),
  }));

  async function getEmbedding(planar) {
    const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: tensor });
    const rawVec = Array.from(out[outputName].data);
    const norm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0)) || 1e-6;
    const emb = rawVec.map((v) => v / norm);
    return { emb, rawNorm: norm, rawVec };
  }

  // Evaluate Reference 1
  const ref1Buf = fs.readFileSync("public/staff-photos/person-001/reference_01.jpg");
  const ref1Img = jpeg.decode(ref1Buf, { useTArray: true });
  console.log("Reference 1 Size:", ref1Img.width, "x", ref1Img.height);

  // Reference 1 known face landmarks from enrollment:
  // In staff-photos/person-001/reference_01.jpg (768 x 1024), face is centered around:
  // Left eye ~ [284, 436], Right eye ~ [482, 434], Nose ~ [383, 560], Left Mouth ~ [302, 696], Right Mouth ~ [468, 694]
  const ref1Landmarks = [
    [284.5, 436.2],
    [482.1, 434.8],
    [383.0, 560.4],
    [302.2, 696.1],
    [468.4, 694.0],
  ];

  const ref1Planar = align112FromRaw(ref1Img, ref1Landmarks);
  const ref1EmbRes = await getEmbedding(ref1Planar);
  console.log("Reference 1 Aligned Inference:");
  console.log("  Raw Norm:", ref1EmbRes.rawNorm.toFixed(6));
  dbEmbeddings.forEach((dbE) => {
    console.log(`  Distance to DB ${dbE.name}: ${cosineDistance(ref1EmbRes.emb, dbE.vec).toFixed(4)}`);
  });

  // Now inspect Mobile Frame 92823 Aligned vs Reference 1 Aligned pixel stats:
  const mobileAlignedBuf = fs.readFileSync("public/debug-frames/frame-92823/aligned_112x112_image.jpg");
  const mobileAlignedImg = jpeg.decode(mobileAlignedBuf);

  let absDiffSum = 0;
  let sqDiffSum = 0;
  const numPix = 112 * 112 * 3;

  for (let i = 0; i < 112 * 112; i++) {
    const mR = mobileAlignedImg.data[i * 4];
    const mG = mobileAlignedImg.data[i * 4 + 1];
    const mB = mobileAlignedImg.data[i * 4 + 2];

    const rR = Math.round(ref1Planar[0 * 112 * 112 + i] * 128.0 + 127.5);
    const rG = Math.round(ref1Planar[1 * 112 * 112 + i] * 128.0 + 127.5);
    const rB = Math.round(ref1Planar[2 * 112 * 112 + i] * 128.0 + 127.5);

    absDiffSum += Math.abs(mR - rR) + Math.abs(mG - rG) + Math.abs(mB - rB);
    sqDiffSum += (mR - rR) ** 2 + (mG - rG) ** 2 + (mB - rB) ** 2;
  }

  const meanAbsDiff = absDiffSum / numPix;
  const rmsDiff = Math.sqrt(sqDiffSum / numPix);

  console.log("\nPixel Difference between Reference 1 and Mobile Frame 92823 (112x112):");
  console.log(`  Mean Absolute Pixel Difference: ${meanAbsDiff.toFixed(2)} / 255`);
  console.log(`  RMS Pixel Difference: ${rmsDiff.toFixed(2)} / 255`);

  await pool.end();
}

run().catch(console.error);
