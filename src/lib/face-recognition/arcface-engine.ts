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

/**
 * Warp and align input image to 112x112 planar float tensor [1, 3, 112, 112].
 */
export function alignFaceToTensor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData | Uint8Array,
  width: number,
  height: number,
  landmarks: { positions: { x: number; y: number }[] },
): Float32Array {
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
    }
  }

  return floatPlanar;
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
  const session = await initArcFaceSession();

  const alignedTensorData = alignFaceToTensor(source, width, height, landmarks);
  const inputTensor = new ort.Tensor("float32", alignedTensorData, [1, 3, 112, 112]);

  const inputName = session.inputNames[0] || "input.1";
  const outputName = session.outputNames[0] || "516";

  const feeds: Record<string, ort.Tensor> = {};
  feeds[inputName] = inputTensor;

  const results = await session.run(feeds);
  const outputData = results[outputName]?.data as Float32Array;

  if (!outputData || outputData.length !== 512) {
    throw new Error(
      `Unexpected ArcFace output dimension: expected 512, received ${outputData?.length ?? 0}`,
    );
  }

  // L2 unit normalization: ||v|| = 1
  let norm = 0;
  for (let i = 0; i < 512; i++) {
    norm += outputData[i]! * outputData[i]!;
  }
  norm = Math.sqrt(norm) || 1e-6;

  const normalized = new Array<number>(512);
  for (let i = 0; i < 512; i++) {
    normalized[i] = outputData[i]! / norm;
  }

  return normalized;
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
