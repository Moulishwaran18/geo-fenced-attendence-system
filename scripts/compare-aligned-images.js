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

function decodeJpegToPlanar(jpegBuf) {
  const img = jpeg.decode(jpegBuf, { useTArray: true });
  const planar = new Float32Array(3 * 112 * 112);
  const W = 112, H = 112;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * img.width + x) * 4;
      const r = img.data[idx];
      const g = img.data[idx + 1];
      const b = img.data[idx + 2];
      const pIdx = y * W + x;
      planar[0 * W * H + pIdx] = (r - 127.5) / 128.0;
      planar[1 * W * H + pIdx] = (g - 127.5) / 128.0;
      planar[2 * W * H + pIdx] = (b - 127.5) / 128.0;
    }
  }
  return { planar, img };
}

async function run() {
  console.log("==================================================");
  console.log("ALIGNMENT & IMAGE COMPARISON AUDIT");
  console.log("==================================================");

  // Mobile Phone Frame 92823
  const mobileBuf = fs.readFileSync("public/debug-frames/frame-92823/aligned_112x112_image.jpg");
  const mobileDecoded = decodeJpegToPlanar(mobileBuf);

  // Stored Database Embeddings
  const dbRes = await pool.query(
    "SELECT reference_image_path, embedding::text FROM face_embeddings WHERE staff_id = (SELECT id FROM staff WHERE staff_code = 'PERSON_001') ORDER BY reference_image_path"
  );
  const references = dbRes.rows.map((r) => ({
    name: path.basename(r.reference_image_path),
    vec: JSON.parse(r.embedding),
  }));

  // ONNX Session
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), {
    executionProviders: ["wasm"],
  });

  async function getEmbedding(planar) {
    const tensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const inputName = session.inputNames[0] || "input.1";
    const outputName = session.outputNames[0] || "516";
    const out = await session.run({ [inputName]: tensor });
    const rawVec = Array.from(out[outputName].data);
    const norm = Math.sqrt(rawVec.reduce((s, v) => s + v * v, 0)) || 1e-6;
    const emb = rawVec.map((v) => v / norm);
    return { emb, rawNorm: norm };
  }

  const mobileEmbRes = await getEmbedding(mobileDecoded.planar);
  console.log("\nA. Mobile Phone Aligned 112x112 Image:");
  console.log(`   Raw Norm: ${mobileEmbRes.rawNorm.toFixed(6)}`);
  references.forEach((r) => {
    console.log(`   -> Distance to ${r.name}: ${cosineDistance(mobileEmbRes.emb, r.vec).toFixed(4)}`);
  });

  // Check pixel samples across regions (eyes, nose, mouth) in mobile 112x112
  const imgData = mobileDecoded.img.data;
  function getPixelRGB(x, y) {
    const idx = (y * 112 + x) * 4;
    return [imgData[idx], imgData[idx + 1], imgData[idx + 2]];
  }

  console.log("\nB. Mobile Aligned Image Landmark Key Pixel Regions:");
  console.log("   Left Eye (approx [38, 51]):", getPixelRGB(38, 51));
  console.log("   Right Eye (approx [73, 51]):", getPixelRGB(73, 51));
  console.log("   Nose Tip (approx [56, 71]):", getPixelRGB(56, 71));
  console.log("   Left Mouth (approx [41, 92]):", getPixelRGB(41, 92));
  console.log("   Right Mouth (approx [70, 92]):", getPixelRGB(70, 92));

  // Check if horizontal flip of mobile image aligns
  const flippedPlanar = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const srcIdx = (y * 112 + (111 - x)) * 4;
      const r = imgData[srcIdx], g = imgData[srcIdx + 1], b = imgData[srcIdx + 2];
      const pIdx = y * 112 + x;
      flippedPlanar[0 * 112 * 112 + pIdx] = (r - 127.5) / 128.0;
      flippedPlanar[1 * 112 * 112 + pIdx] = (g - 127.5) / 128.0;
      flippedPlanar[2 * 112 * 112 + pIdx] = (b - 127.5) / 128.0;
    }
  }
  const flippedEmbRes = await getEmbedding(flippedPlanar);
  console.log("\nC. Horizontally Flipped Mobile 112x112 Image:");
  console.log(`   Raw Norm: ${flippedEmbRes.rawNorm.toFixed(6)}`);
  references.forEach((r) => {
    console.log(`   -> Distance to ${r.name}: ${cosineDistance(flippedEmbRes.emb, r.vec).toFixed(4)}`);
  });

  await pool.end();
}

run().catch(console.error);
