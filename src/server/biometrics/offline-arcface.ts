/**
 * Offline ArcFace ONNX Inference Service for Deterministic Parity Audit
 *
 * Runs w600k_mbf.onnx on a 112x112 RGB image in Node.js runtime.
 */

import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-web";

let nodeArcFaceSession: ort.InferenceSession | null = null;
let sessionLoadingPromise: Promise<ort.InferenceSession> | null = null;

const ROOT = process.cwd();
const MODEL_PATH = path.join(ROOT, "public", "models", "w600k_mbf.onnx");

export async function getNodeArcFaceSession(): Promise<ort.InferenceSession> {
  if (nodeArcFaceSession) return nodeArcFaceSession;
  if (sessionLoadingPromise) return sessionLoadingPromise;

  sessionLoadingPromise = (async () => {
    try {
      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(`ArcFace model file not found at ${MODEL_PATH}`);
      }
      const session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      nodeArcFaceSession = session;
      return session;
    } catch (err) {
      sessionLoadingPromise = null;
      throw new Error(`Failed to load Node ArcFace ONNX session: ${String(err)}`);
    }
  })();

  return sessionLoadingPromise;
}

export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

export async function runOfflineArcFaceOn112Image(jpegBufferOrDataUrl: Buffer | string): Promise<{
  embedding: number[];
  norm: number;
}> {
  let buffer: Buffer;
  if (typeof jpegBufferOrDataUrl === "string") {
    const base64Data = jpegBufferOrDataUrl.replace(/^data:image\/\w+;base64,/, "");
    buffer = Buffer.from(base64Data, "base64");
  } else {
    buffer = jpegBufferOrDataUrl;
  }

  const raw = jpeg.decode(buffer, { useTArray: true });
  const targetW = 112;
  const targetH = 112;
  const planarRGB = new Float32Array(3 * targetW * targetH);
  const channelStride = targetW * targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = Math.min(x, raw.width - 1);
      const srcY = Math.min(y, raw.height - 1);
      const idx = (srcY * raw.width + srcX) * 4;

      const r = raw.data[idx] ?? 0;
      const g = raw.data[idx + 1] ?? 0;
      const b = raw.data[idx + 2] ?? 0;

      const outIdx = y * targetW + x;
      planarRGB[0 * channelStride + outIdx] = (r - 127.5) / 128.0;
      planarRGB[1 * channelStride + outIdx] = (g - 127.5) / 128.0;
      planarRGB[2 * channelStride + outIdx] = (b - 127.5) / 128.0;
    }
  }

  const session = await getNodeArcFaceSession();
  const inputTensor = new ort.Tensor("float32", planarRGB, [1, 3, targetW, targetH]);
  const inputName = session.inputNames[0] || "input.1";
  const outputName = session.outputNames[0] || "516";

  const results = await session.run({ [inputName]: inputTensor });
  const rawEmbedding = Array.from(results[outputName]?.data as Float32Array);

  const rawNorm = Math.sqrt(rawEmbedding.reduce((sum, v) => sum + v * v, 0));
  const normalized = rawEmbedding.map((v) => v / (rawNorm || 1e-6));

  return {
    embedding: normalized,
    norm: rawNorm,
  };
}
