import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-web";

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

function getEmbeddingFrom112Jpeg(buf, session) {
  const img = jpeg.decode(buf);
  const planar = new Float32Array(3 * 112 * 112);
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const idx = (y * 112 + x) * 4;
      const pIdx = y * 112 + x;
      planar[0 * 112 * 112 + pIdx] = (img.data[idx] - 127.5) / 128.0;
      planar[1 * 112 * 112 + pIdx] = (img.data[idx + 1] - 127.5) / 128.0;
      planar[2 * 112 * 112 + pIdx] = (img.data[idx + 2] - 127.5) / 128.0;
    }
  }
  return session.run({ [session.inputNames[0]]: new ort.Tensor("float32", planar, [1, 3, 112, 112]) }).then((out) => {
    const raw = Array.from(out[session.outputNames[0]].data);
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
    return { embedding: raw.map((v) => v / norm), rawNorm: norm };
  });
}

async function run() {
  const session = await ort.InferenceSession.create(path.resolve("public/models/w600k_mbf.onnx"), { executionProviders: ["wasm"] });

  const ref1Buf = fs.readFileSync(path.resolve("public/staff-photos/person-001/aligned_corrected_01.jpg"));
  const ref1 = await getEmbeddingFrom112Jpeg(ref1Buf, session);

  const ref2Buf = fs.readFileSync(path.resolve("public/staff-photos/person-001/aligned_corrected_02.jpg"));
  const ref2 = await getEmbeddingFrom112Jpeg(ref2Buf, session);

  const frame30650Buf = fs.readFileSync(path.resolve("public/debug-frames/frame-30650/aligned_112x112_image.jpg"));
  const f30650 = await getEmbeddingFrom112Jpeg(frame30650Buf, session);

  console.log("Ref 1 Raw Norm: " + ref1.rawNorm.toFixed(4));
  console.log("Ref 2 Raw Norm: " + ref2.rawNorm.toFixed(4));
  console.log("Frame 30650 Raw Norm: " + f30650.rawNorm.toFixed(4));

  console.log("Ref 1 vs Ref 2 Cosine Distance: " + cosineDistance(ref1.embedding, ref2.embedding).toFixed(6));
  console.log("Frame 30650 vs Ref 1 Cosine Distance: " + cosineDistance(f30650.embedding, ref1.embedding).toFixed(6));
  console.log("Frame 30650 vs Ref 2 Cosine Distance: " + cosineDistance(f30650.embedding, ref2.embedding).toFixed(6));
}

run().catch(console.error);
