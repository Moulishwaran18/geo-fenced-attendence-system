import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { Pool } from "pg";
import * as ort from "onnxruntime-web";

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i]; const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics",
});

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function estimateSimilarityTransform(src, dst) {
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

function alignImageFromPoints(rawImg, srcPoints) {
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);
  const outW = 112, outH = 112;
  const planar = new Float32Array(3 * outW * outH);
  const outJpegData = new Uint8Array(outW * outH * 4);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
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

      const pixelIdx = dy * outW + dx;
      planar[0 * outW * outH + pixelIdx] = (r - 127.5) / 128.0;
      planar[1 * outW * outH + pixelIdx] = (g - 127.5) / 128.0;
      planar[2 * outW * outH + pixelIdx] = (b - 127.5) / 128.0;

      const outIdx = pixelIdx * 4;
      outJpegData[outIdx] = Math.round(r);
      outJpegData[outIdx + 1] = Math.round(g);
      outJpegData[outIdx + 2] = Math.round(b);
      outJpegData[outIdx + 3] = 255;
    }
  }

  const jpegBuf = jpeg.encode({ data: outJpegData, width: outW, height: outH }, 95);
  return { planar, jpegBuf: jpegBuf.data };
}

async function runAudit() {
  const frameDir = path.resolve("public/debug-frames/frame-92823");
  const meta = JSON.parse(fs.readFileSync(path.join(frameDir, "metadata.json"), "utf8"));
  const origBuf = fs.readFileSync(path.join(frameDir, "original_camera_frame.jpg"));
  const origImg = jpeg.decode(origBuf);

  const alignedBuf = fs.readFileSync(path.join(frameDir, "aligned_112x112_image.jpg"));
  const alignedImg = jpeg.decode(alignedBuf);

  console.log("==================================================");
  console.log("MOBILE FRAME 92823 DETAILED DIAGNOSTIC AUDIT");
  console.log("==================================================");
  console.log(`Original Frame Dimensions: ${origImg.width} x ${origImg.height}`);
  console.log(`Detected Face Box: x=${meta.faceBox?.x}, y=${meta.faceBox?.y}, w=${meta.faceBox?.width}, h=${meta.faceBox?.height}`);
  console.log(`Confidence: ${(meta.confidence * 100).toFixed(1)}%`);
  console.log("5 Landmarks from Client (Frame coordinates):");
  meta.landmarks5.forEach((pt, i) => console.log(`  pt[${i}]: [${pt[0].toFixed(2)}, ${pt[1].toFixed(2)}]`));

  // Get Reference embeddings
  const dbRes = await pool.query(
    "SELECT reference_image_path, embedding::text FROM face_embeddings WHERE staff_id = (SELECT id FROM staff WHERE staff_code = 'PERSON_001') ORDER BY reference_image_path"
  );
  const references = dbRes.rows.map((r) => ({
    name: path.basename(r.reference_image_path),
    vec: JSON.parse(r.embedding),
  }));

  // Load ONNX Model
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), {
    executionProviders: ["wasm"],
  });

  async function evaluatePlanar(planar, title) {
    let minVal = Infinity, maxVal = -Infinity, sum = 0;
    for (let i = 0; i < planar.length; i++) {
      const v = planar[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      sum += v;
    }
    const mean = sum / planar.length;
    let variance = 0;
    for (let i = 0; i < planar.length; i++) {
      const diff = planar[i] - mean;
      variance += diff * diff;
    }
    const std = Math.sqrt(variance / planar.length);

    const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: tensor });
    const rawVec = Array.from(out[outputName].data);
    const norm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0)) || 1e-6;
    const emb = rawVec.map((v) => v / norm);

    console.log(`\n--------------------------------------------------`);
    console.log(`EVALUATION: ${title}`);
    console.log(`Tensor Stats: min=${minVal.toFixed(4)}, max=${maxVal.toFixed(4)}, mean=${mean.toFixed(4)}, std=${std.toFixed(4)}`);
    console.log(`Embedding Norm: ${norm.toFixed(6)}, First 5 values: [${emb.slice(0, 5).map((x) => x.toFixed(5)).join(", ")}]`);
    console.log(`Distances to PERSON_001 references:`);
    let minD = 1.0, bestRef = "";
    references.forEach((ref) => {
      const d = cosineDistance(emb, ref.vec);
      console.log(`  ${ref.name}: ${d.toFixed(4)}`);
      if (d < minD) { minD = d; bestRef = ref.name; }
    });
    console.log(`=> Minimum Distance: ${minD.toFixed(4)} (${bestRef}) | Threshold: 0.45 | Decision: ${minD <= 0.45 ? "MATCH" : "REJECT"}`);
    return { minD, emb, bestRef };
  }

  // 1. Live saved aligned image
  const alignedPlanar = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const idx = (y * alignedImg.width + x) * 4;
      const r = alignedImg.data[idx];
      const g = alignedImg.data[idx + 1];
      const b = alignedImg.data[idx + 2];
      const pIdx = y * 112 + x;
      alignedPlanar[0 * 112 * 112 + pIdx] = (r - 127.5) / 128.0;
      alignedPlanar[1 * 112 * 112 + pIdx] = (g - 127.5) / 128.0;
      alignedPlanar[2 * 112 * 112 + pIdx] = (b - 127.5) / 128.0;
    }
  }
  await evaluatePlanar(alignedPlanar, "1. Live Aligned 112x112 Image (Direct As Saved)");

  // 2. Re-alignment directly from original_camera_frame.jpg using client landmarks
  const realign1 = alignImageFromPoints(origImg, meta.landmarks5);
  await evaluatePlanar(realign1.planar, "2. Re-alignment from Original Frame (Client Landmarks)");

  // 3. What if landmark points 0 and 1 are swapped? (Left eye vs right eye)
  const swappedEyeLandmarks = [
    meta.landmarks5[1],
    meta.landmarks5[0],
    meta.landmarks5[2],
    meta.landmarks5[4],
    meta.landmarks5[3],
  ];
  const realignSwapped = alignImageFromPoints(origImg, swappedEyeLandmarks);
  await evaluatePlanar(realignSwapped.planar, "3. Swapped Left/Right Eye & Mouth Landmarks");

  // 4. Horizontally flipped original frame
  const flippedOrigData = new Uint8Array(origImg.width * origImg.height * 4);
  for (let y = 0; y < origImg.height; y++) {
    for (let x = 0; x < origImg.width; x++) {
      const srcIdx = (y * origImg.width + (origImg.width - 1 - x)) * 4;
      const dstIdx = (y * origImg.width + x) * 4;
      flippedOrigData[dstIdx] = origImg.data[srcIdx];
      flippedOrigData[dstIdx + 1] = origImg.data[srcIdx + 1];
      flippedOrigData[dstIdx + 2] = origImg.data[srcIdx + 2];
      flippedOrigData[dstIdx + 3] = origImg.data[srcIdx + 3];
    }
  }
  const flippedImg = { data: flippedOrigData, width: origImg.width, height: origImg.height };
  const flippedLandmarks = meta.landmarks5.map((pt) => [origImg.width - 1 - pt[0], pt[1]]);
  const realignFlipped = alignImageFromPoints(flippedImg, flippedLandmarks);
  await evaluatePlanar(realignFlipped.planar, "4. Horizontally Flipped Frame (Mirrored)");

  // 5. Compare with Known Successful Reference 1 vs Reference 2
  const ref1Buf = fs.readFileSync("public/staff-photos/person-001/reference_01.jpg");
  const ref1Img = jpeg.decode(ref1Buf);
  console.log(`\nKnown Reference Image 1 Dimensions: ${ref1Img.width} x ${ref1Img.height}`);

  await pool.end();
}

runAudit().catch(console.error);
