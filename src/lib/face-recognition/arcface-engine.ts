/**
 * InsightFace MobileFaceNet ArcFace 512-D Neural Network Engine
 *
 * Model: MobileFaceNet ArcFace (w600k_mbf.onnx, trained on MS1M-w600k)
 * Input: [1, 3, 112, 112] RGB face crop normalized with (x - 127.5) / 128.0
 * Output: 512-dimensional L2-normalized biometric embedding vector (Float32Array[512])
 *
 * Distance Metric:
 * - Cosine Similarity: v1 · v2
 * - Cosine Distance: 1 - (v1 · v2)
 */

import * as ort from "onnxruntime-web";
import { FACE_CONFIG } from "./face-config";

let arcFaceSession: ort.InferenceSession | null = null;
let sessionLoadingPromise: Promise<ort.InferenceSession> | null = null;

export const ARCFACE_CONFIG = {
  MODEL_PATH: "/models/w600k_mbf.onnx",
  EMBEDDING_DIM: 512,
  INPUT_SIZE: 112,
  /**
   * Calibrated ArcFace Cosine Distance threshold:
   * - dist <= 0.45: SAME PERSON (Cosine Similarity >= 0.55)
   * - dist > 0.45: DIFFERENT / UNKNOWN PERSON
   */
  COSINE_DISTANCE_THRESHOLD: 0.45,
  /**
   * Minimum separation margin between best candidate and second-best candidate.
   */
  MIN_MATCH_MARGIN: 0.08,
};

/**
 * Standard ArcFace 5-Point Alignment Coordinates in 112x112 target space.
 */
const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose tip
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];

/**
 * Compute 2D Similarity Transform Matrix using Umeyama algorithm.
 */
export function estimateSimilarityTransform(
  src: number[][],
  dst: number[][] = ARCFACE_REFERENCE_POINTS,
): { M: number[][]; invM: number[][] } {
  let srcMeanX = 0,
    srcMeanY = 0,
    dstMeanX = 0,
    dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i]![0]!;
    srcMeanY += src[i]![1]!;
    dstMeanX += dst[i]![0]!;
    dstMeanY += dst[i]![1]!;
  }
  srcMeanX /= n;
  srcMeanY /= n;
  dstMeanX /= n;
  dstMeanY /= n;

  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i]![0]! - srcMeanX;
    const dy = src[i]![1]! - srcMeanY;
    srcVar += dx * dx + dy * dy;
  }
  srcVar /= n;
  if (srcVar === 0) srcVar = 1e-6;

  let sxx = 0,
    sxy = 0,
    syx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i]![0]! - srcMeanX;
    const sy = src[i]![1]! - srcMeanY;
    const dx = dst[i]![0]! - dstMeanX;
    const dy = dst[i]![1]! - dstMeanY;
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
  const b = (syx - sxy) / srcVar;
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

/**
 * Extract standard 5 key landmark points from face landmarks.
 */
export function extract5Landmarks(landmarks: {
  positions: { x: number; y: number }[];
}): number[][] {
  const pts = landmarks.positions;

  // Left eye center (points 36..41)
  const leftEye = [
    (pts[36]!.x + pts[37]!.x + pts[38]!.x + pts[39]!.x + pts[40]!.x + pts[41]!.x) / 6,
    (pts[36]!.y + pts[37]!.y + pts[38]!.y + pts[39]!.y + pts[40]!.y + pts[41]!.y) / 6,
  ];

  // Right eye center (points 42..47)
  const rightEye = [
    (pts[42]!.x + pts[43]!.x + pts[44]!.x + pts[45]!.x + pts[46]!.x + pts[47]!.x) / 6,
    (pts[42]!.y + pts[43]!.y + pts[44]!.y + pts[45]!.y + pts[46]!.y + pts[47]!.y) / 6,
  ];

  // Nose tip (point 30)
  const nose = [pts[30]!.x, pts[30]!.y];

  // Left mouth corner (point 48)
  const leftMouth = [pts[48]!.x, pts[48]!.y];

  // Right mouth corner (point 54)
  const rightMouth = [pts[54]!.x, pts[54]!.y];

  return [leftEye, rightEye, nose, leftMouth, rightMouth];
}

/**
 * Initialize and cache the ArcFace ONNX Inference Session.
 */
export async function initArcFaceSession(
  modelPath: string = ARCFACE_CONFIG.MODEL_PATH,
): Promise<ort.InferenceSession> {
  if (arcFaceSession) return arcFaceSession;
  if (sessionLoadingPromise) return sessionLoadingPromise;

  sessionLoadingPromise = (async () => {
    try {
      // Configure ONNX WebAssembly execution providers
      ort.env.wasm.numThreads = 2;
      ort.env.wasm.proxy = false;

      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      arcFaceSession = session;
      return session;
    } catch (err) {
      sessionLoadingPromise = null;
      throw new Error(`Failed to initialize ArcFace ONNX session: ${String(err)}`);
    }
  })();

  return sessionLoadingPromise;
}

export function isArcFaceLoaded(): boolean {
  return arcFaceSession !== null;
}

export function computeFloat32Checksum(arr: Float32Array | number[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i]!;
    const str = val.toFixed(6);
    for (let c = 0; c < str.length; c++) {
      h ^= str.charCodeAt(c);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/**
 * Warp and align input image to 112x112 planar float tensor [1, 3, 112, 112] with full artifacts.
 */
export function alignFaceDetailed(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData | Uint8Array,
  width: number,
  height: number,
  landmarks: { positions: { x: number; y: number }[] },
): {
  planar: Float32Array;
  dataUrl: string;
  tensorChecksum: string;
  pts5: number[][];
} {
  let imgData: Uint8ClampedArray | Uint8Array;

  if (source instanceof HTMLVideoElement || source instanceof HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create 2d canvas context for face alignment");
    ctx.drawImage(source, 0, 0, width, height);
    imgData = ctx.getImageData(0, 0, width, height).data;
  } else if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    imgData = ctx.getImageData(0, 0, width, height).data;
  } else if (source instanceof ImageData) {
    imgData = source.data;
  } else {
    imgData = source;
  }

  const srcPoints = extract5Landmarks(landmarks);
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);

  const outW = ARCFACE_CONFIG.INPUT_SIZE;
  const outH = ARCFACE_CONFIG.INPUT_SIZE;
  const floatPlanar = new Float32Array(3 * outW * outH); // [3, 112, 112]

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = outW;
  previewCanvas.height = outH;
  const pCtx = previewCanvas.getContext("2d");
  const outImgData = pCtx ? pCtx.createImageData(outW, outH) : null;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0]![0]! * dx + invM[0]![1]! * dy + invM[0]![2]!;
      const sy = invM[1]![0]! * dx + invM[1]![1]! * dy + invM[1]![2]!;

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
          (1 - wx) * (1 - wy) * imgData[idx00]! +
          wx * (1 - wy) * imgData[idx10]! +
          (1 - wx) * wy * imgData[idx01]! +
          wx * wy * imgData[idx11]!;
        g =
          (1 - wx) * (1 - wy) * imgData[idx00 + 1]! +
          wx * (1 - wy) * imgData[idx10 + 1]! +
          (1 - wx) * wy * imgData[idx01 + 1]! +
          wx * wy * imgData[idx11 + 1]!;
        b =
          (1 - wx) * (1 - wy) * imgData[idx00 + 2]! +
          wx * (1 - wy) * imgData[idx10 + 2]! +
          (1 - wx) * wy * imgData[idx01 + 2]! +
          wx * wy * imgData[idx11 + 2]!;
      }

      // Normalization: (RGB - 127.5) / 128.0
      const pixelIdx = dy * outW + dx;
      floatPlanar[0 * outW * outH + pixelIdx] = (r - 127.5) / 128.0;
      floatPlanar[1 * outW * outH + pixelIdx] = (g - 127.5) / 128.0;
      floatPlanar[2 * outW * outH + pixelIdx] = (b - 127.5) / 128.0;

      if (outImgData) {
        const outIdx = pixelIdx * 4;
        outImgData.data[outIdx] = Math.round(r);
        outImgData.data[outIdx + 1] = Math.round(g);
        outImgData.data[outIdx + 2] = Math.round(b);
        outImgData.data[outIdx + 3] = 255;
      }
    }
  }

  let dataUrl = "";
  if (pCtx && outImgData) {
    pCtx.putImageData(outImgData, 0, 0);
    dataUrl = previewCanvas.toDataURL("image/jpeg", 0.95);
  }

  const tensorChecksum = computeFloat32Checksum(floatPlanar);

  return {
    planar: floatPlanar,
    dataUrl,
    tensorChecksum,
    pts5: srcPoints,
  };
}

/**
 * Warp and align input image to 112x112 planar float tensor [1, 3, 112, 112].
 */
export function alignFaceToTensor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData | Uint8Array,
  width: number,
  height: number,
  landmarks: { positions: { x: number; y: number }[] },
): Float32Array {
  return alignFaceDetailed(source, width, height, landmarks).planar;
}

/**
 * Run double ArcFace inference on identical planar tensor to verify determinism.
 */
export async function runArcFaceDoubleInference(
  planarTensorData: Float32Array,
): Promise<{
  embeddingA: number[];
  embeddingB: number[];
  doubleInferenceDist: number;
  embeddingChecksumA: string;
  embeddingChecksumB: string;
  l2NormA: number;
  rawNormA?: number;
}> {
  const session = await initArcFaceSession();
  const inputName = session.inputNames[0] || "input.1";
  const outputName = session.outputNames[0] || "516";

  // Inference A
  const inputTensorA = new ort.Tensor("float32", planarTensorData, [1, 3, 112, 112]);
  const resA = await session.run({ [inputName]: inputTensorA });
  const rawA = Array.from(resA[outputName]?.data as Float32Array);
  const normA = Math.sqrt(rawA.reduce((s, v) => s + v * v, 0)) || 1e-6;
  const embeddingA = rawA.map((v) => v / normA);
  const finalNormA = Math.sqrt(embeddingA.reduce((s, v) => s + v * v, 0));
  const checksumA = computeFloat32Checksum(embeddingA);

  // Inference B (using the exact same tensor data)
  const inputTensorB = new ort.Tensor("float32", planarTensorData, [1, 3, 112, 112]);
  const resB = await session.run({ [inputName]: inputTensorB });
  const rawB = Array.from(resB[outputName]?.data as Float32Array);
  const normB = Math.sqrt(rawB.reduce((s, v) => s + v * v, 0)) || 1e-6;
  const embeddingB = rawB.map((v) => v / normB);
  const checksumB = computeFloat32Checksum(embeddingB);

  const doubleInferenceDist = calculateCosineDistance(embeddingA, embeddingB);

  return {
    embeddingA,
    embeddingB,
    doubleInferenceDist,
    embeddingChecksumA: checksumA,
    embeddingChecksumB: checksumB,
    l2NormA: finalNormA,
    rawNormA: normA,
  };
}

/**
 * Generate 512-Dimensional ArcFace embedding vector.
 */
export async function generateArcFaceEmbedding(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData,
  width: number,
  height: number,
  landmarks: { positions: { x: number; y: number }[] },
): Promise<number[]> {
  const aligned = alignFaceDetailed(source, width, height, landmarks);
  const res = await runArcFaceDoubleInference(aligned.planar);
  return res.embeddingA;
}

/**
 * Frame & Face Crop Quality Evaluation Metrics
 */
export interface FrameQualityMetrics {
  sharpness: number;
  brightness: number;
  contrast: number;
  faceConfidence: number;
  faceBox: { x: number; y: number; width: number; height: number };
  faceWidthRatio: number;
  faceHeightRatio: number;
  isQualityAcceptable: boolean;
  rejectReason?: string | undefined;
}

/**
 * Evaluate quality of face crop (sharpness, brightness, contrast, size).
 */
export function evaluateFaceCropQuality(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData,
  srcWidth: number,
  srcHeight: number,
  faceBox: { x: number; y: number; width: number; height: number },
  confidence: number,
  minConfidence: number = FACE_CONFIG.FRAME_QUALITY?.MIN_CONFIDENCE ?? FACE_CONFIG.MIN_FACE_CONFIDENCE ?? 0.25,
): FrameQualityMetrics {
  let imgData: Uint8ClampedArray | Uint8Array;

  if (source instanceof HTMLVideoElement || source instanceof HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = srcWidth;
    canvas.height = srcHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create 2d canvas context for quality check");
    ctx.drawImage(source, 0, 0, srcWidth, srcHeight);
    imgData = ctx.getImageData(0, 0, srcWidth, srcHeight).data;
  } else if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    imgData = ctx.getImageData(0, 0, srcWidth, srcHeight).data;
  } else {
    imgData = source.data;
  }

  const bx = Math.max(0, Math.floor(faceBox.x));
  const by = Math.max(0, Math.floor(faceBox.y));
  const bw = Math.min(Math.floor(faceBox.width), srcWidth - bx);
  const bh = Math.min(Math.floor(faceBox.height), srcHeight - by);

  if (bw <= 10 || bh <= 10) {
    return {
      sharpness: 0,
      brightness: 0,
      contrast: 0,
      faceConfidence: confidence,
      faceBox: { x: bx, y: by, width: bw, height: bh },
      faceWidthRatio: bw / srcWidth,
      faceHeightRatio: bh / srcHeight,
      isQualityAcceptable: false,
      rejectReason: "Face box is too small or outside frame bounds.",
    };
  }

  // 1. Compute grayscale values on cropped face
  const gray = new Float32Array(bw * bh);
  let sumY = 0;
  let sumY2 = 0;
  const totalPixels = bw * bh;

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const idx = ((by + y) * srcWidth + (bx + x)) * 4;
      const r = imgData[idx] ?? 0;
      const g = imgData[idx + 1] ?? 0;
      const b = imgData[idx + 2] ?? 0;
      const yVal = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[y * bw + x] = yVal;
      sumY += yVal;
      sumY2 += yVal * yVal;
    }
  }

  const meanY = sumY / totalPixels;
  const varianceY = Math.max(0, sumY2 / totalPixels - meanY * meanY);
  const contrast = Math.sqrt(varianceY);

  // 2. Compute Laplacian variance for blur/sharpness estimation
  let sumLap = 0;
  let sumLap2 = 0;
  let lapCount = 0;

  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      const c = gray[y * bw + x]!;
      const top = gray[(y - 1) * bw + x]!;
      const bottom = gray[(y + 1) * bw + x]!;
      const left = gray[y * bw + (x - 1)]!;
      const right = gray[y * bw + (x + 1)]!;
      const lap = 4 * c - top - bottom - left - right;
      sumLap += lap;
      sumLap2 += lap * lap;
      lapCount++;
    }
  }

  const meanLap = lapCount > 0 ? sumLap / lapCount : 0;
  const sharpness = lapCount > 0 ? Math.max(0, sumLap2 / lapCount - meanLap * meanLap) : 0;

  const faceWidthRatio = bw / srcWidth;
  const faceHeightRatio = bh / srcHeight;

  const minBrightness = FACE_CONFIG.FRAME_QUALITY?.MIN_BRIGHTNESS ?? 25;
  const maxBrightness = FACE_CONFIG.FRAME_QUALITY?.MAX_BRIGHTNESS ?? 235;
  const minSharpness = FACE_CONFIG.FRAME_QUALITY?.MIN_SHARPNESS ?? 10.0;

  let rejectReason: string | undefined;
  if (faceWidthRatio < 0.15 || faceHeightRatio < 0.15 || bw < 80 || bh < 80) {
    rejectReason = `Face too far from camera (${Math.round(faceWidthRatio * 100)}% width). Move closer.`;
  } else if (meanY < minBrightness) {
    rejectReason = `Lighting too dark (Brightness: ${Math.round(meanY)}/255 < ${minBrightness}). Please improve lighting.`;
  } else if (meanY > maxBrightness) {
    rejectReason = `Lighting overexposed (Brightness: ${Math.round(meanY)}/255 > ${maxBrightness}). Avoid strong glare.`;
  } else if (sharpness < minSharpness) {
    rejectReason = `Camera image is blurred (Sharpness: ${sharpness.toFixed(1)} < ${minSharpness.toFixed(1)}). Hold steady.`;
  } else if (confidence < minConfidence) {
    rejectReason = `Face detection confidence too low (${Math.round(confidence * 100)}% < ${Math.round(minConfidence * 100)}%). Face the camera directly.`;
  }

  return {
    sharpness,
    brightness: meanY,
    contrast,
    faceConfidence: confidence,
    faceBox: { x: bx, y: by, width: bw, height: bh },
    faceWidthRatio,
    faceHeightRatio,
    isQualityAcceptable: !rejectReason,
    rejectReason,
  };
}

/**
 * Generate a visual 112x112 aligned face crop as a base64 JPEG Data URL for developer preview.
 */
export function generateAlignedFacePreview(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData,
  width: number,
  height: number,
  landmarks: { positions: { x: number; y: number }[] },
): string {
  let imgData: Uint8ClampedArray | Uint8Array;

  if (source instanceof HTMLVideoElement || source instanceof HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(source, 0, 0, width, height);
    imgData = ctx.getImageData(0, 0, width, height).data;
  } else if (source instanceof HTMLCanvasElement) {
    const ctx = source.getContext("2d");
    if (!ctx) return "";
    imgData = ctx.getImageData(0, 0, width, height).data;
  } else {
    imgData = source.data;
  }

  const srcPoints = extract5Landmarks(landmarks);
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);

  const outW = ARCFACE_CONFIG.INPUT_SIZE;
  const outH = ARCFACE_CONFIG.INPUT_SIZE;
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = outW;
  previewCanvas.height = outH;
  const pCtx = previewCanvas.getContext("2d");
  if (!pCtx) return "";

  const outImgData = pCtx.createImageData(outW, outH);

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0]![0]! * dx + invM[0]![1]! * dy + invM[0]![2]!;
      const sy = invM[1]![0]! * dx + invM[1]![1]! * dy + invM[1]![2]!;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const wx = sx - x0;
      const wy = sy - y0;

      let r = 0, g = 0, b = 0;
      if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
        const idx00 = (y0 * width + x0) * 4;
        const idx10 = (y0 * width + x1) * 4;
        const idx01 = (y1 * width + x0) * 4;
        const idx11 = (y1 * width + x1) * 4;

        r = (1 - wx) * (1 - wy) * imgData[idx00]! + wx * (1 - wy) * imgData[idx10]! + (1 - wx) * wy * imgData[idx01]! + wx * wy * imgData[idx11]!;
        g = (1 - wx) * (1 - wy) * imgData[idx00 + 1]! + wx * (1 - wy) * imgData[idx10 + 1]! + (1 - wx) * wy * imgData[idx01 + 1]! + wx * wy * imgData[idx11 + 1]!;
        b = (1 - wx) * (1 - wy) * imgData[idx00 + 2]! + wx * (1 - wy) * imgData[idx10 + 2]! + (1 - wx) * wy * imgData[idx01 + 2]! + wx * wy * imgData[idx11 + 2]!;
      }

      const outIdx = (dy * outW + dx) * 4;
      outImgData.data[outIdx] = Math.round(r);
      outImgData.data[outIdx + 1] = Math.round(g);
      outImgData.data[outIdx + 2] = Math.round(b);
      outImgData.data[outIdx + 3] = 255;
    }
  }

  pCtx.putImageData(outImgData, 0, 0);
  return previewCanvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Generate a visual cropped face image Data URL for developer preview.
 */
export function generateCroppedFacePreview(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  srcWidth: number,
  srcHeight: number,
  faceBox: { x: number; y: number; width: number; height: number },
): string {
  const canvas = document.createElement("canvas");
  const bx = Math.max(0, Math.floor(faceBox.x));
  const by = Math.max(0, Math.floor(faceBox.y));
  const bw = Math.min(Math.floor(faceBox.width), srcWidth - bx);
  const bh = Math.min(Math.floor(faceBox.height), srcHeight - by);
  if (bw <= 0 || bh <= 0) return "";
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, bx, by, bw, bh, 0, 0, bw, bh);
  return canvas.toDataURL("image/jpeg", 0.9);
}

/**
 * Calculate Cosine Similarity: v1 · v2 (since vectors are L2-normalized).
 */
export function calculateCosineSimilarity(v1: number[], v2: number[]): number {
  let dot = 0;
  const len = Math.min(v1.length, v2.length);
  for (let i = 0; i < len; i++) {
    dot += v1[i]! * v2[i]!;
  }
  return dot;
}

/**
 * Calculate Cosine Distance: 1 - CosineSimilarity.
 */
export function calculateCosineDistance(v1: number[], v2: number[]): number {
  return 1 - calculateCosineSimilarity(v1, v2);
}


