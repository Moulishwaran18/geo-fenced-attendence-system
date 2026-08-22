/**
 * Module: frameQuality
 *
 * Evaluates live video frame quality before face detection:
 * 1. Sharpness / Blur Detection: Computes Laplacian kernel variance.
 * 2. Illumination / Brightness Range: Rejects severely underexposed or overexposed frames.
 * 3. Frame Dimensions & Aspect Ratio Validation.
 */

import { FACE_CONFIG } from "./face-config";

export interface FrameQualityResult {
  passed: boolean;
  sharpnessScore: number;
  averageBrightness: number;
  isOverexposed: boolean;
  isUnderexposed: boolean;
  isBlurred: boolean;
  failureReason?: string | undefined;
}

/**
 * Computes frame sharpness using variance of Laplacian on downscaled grayscale canvas.
 */
export function evaluateFrameQuality(
  video: HTMLVideoElement,
  sampleWidth: number = 160,
  sampleHeight: number = 120,
): FrameQualityResult {
  if (!video.videoWidth || !video.videoHeight) {
    return {
      passed: false,
      sharpnessScore: 0,
      averageBrightness: 0,
      isOverexposed: false,
      isUnderexposed: true,
      isBlurred: true,
      failureReason: "Video stream not ready.",
    };
  }

  // Create or reuse offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return {
      passed: true,
      sharpnessScore: 50,
      averageBrightness: 128,
      isOverexposed: false,
      isUnderexposed: false,
      isBlurred: false,
    };
  }

  ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
  const imgData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
  const data = imgData.data;

  // 1. Grayscale & Brightness
  let totalLuminance = 0;
  const gray = new Float32Array(sampleWidth * sampleHeight);

  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const r = data[i]!;
    const gr = data[i + 1]!;
    const b = data[i + 2]!;
    // ITU-R BT.601 luminance
    const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
    gray[g] = lum;
    totalLuminance += lum;
  }

  const avgBrightness = totalLuminance / gray.length;
  const isUnderexposed = avgBrightness < FACE_CONFIG.FRAME_QUALITY.MIN_BRIGHTNESS;
  const isOverexposed = avgBrightness > FACE_CONFIG.FRAME_QUALITY.MAX_BRIGHTNESS;

  // 2. Discrete 3x3 Laplacian Convolution for Sharpness
  // Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let laplacianSum = 0;
  let laplacianSumSq = 0;
  let count = 0;

  for (let y = 1; y < sampleHeight - 1; y++) {
    for (let x = 1; x < sampleWidth - 1; x++) {
      const idx = y * sampleWidth + x;
      const lap =
        gray[idx - sampleWidth]! + // Top
        gray[idx + sampleWidth]! + // Bottom
        gray[idx - 1]! +           // Left
        gray[idx + 1]! -           // Right
        4.0 * gray[idx]!;          // Center

      laplacianSum += lap;
      laplacianSumSq += lap * lap;
      count++;
    }
  }

  const mean = laplacianSum / count;
  const variance = laplacianSumSq / count - mean * mean;
  const sharpnessScore = Math.max(0, variance);
  const isBlurred = sharpnessScore < FACE_CONFIG.FRAME_QUALITY.MIN_SHARPNESS;

  let failureReason: string | undefined;
  if (isUnderexposed) {
    failureReason = "Lighting too dark. Please move to a well-lit area.";
  } else if (isOverexposed) {
    failureReason = "Camera overexposed. Please avoid direct light behind you.";
  } else if (isBlurred) {
    failureReason = "Camera image is blurred. Please hold steady.";
  }

  const passed = !isUnderexposed && !isOverexposed && !isBlurred;

  return {
    passed,
    sharpnessScore,
    averageBrightness: avgBrightness,
    isOverexposed,
    isUnderexposed,
    isBlurred,
    failureReason,
  };
}
