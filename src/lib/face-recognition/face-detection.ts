/**
 * Module: faceDetection
 *
 * Encapsulates face-api.js neural network models:
 * - SSD MobileNet V1 (Face Detection)
 * - 68-Point Face Landmark Model (Face Landmarks)
 * - ResNet-34 Face Recognition Model (128-float Descriptors)
 */

import * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DetectedFace {
  /** 128-float face descriptor (biometric embedding). */
  descriptor: Float32Array;
  /** 68-point face landmarks. */
  landmarks: faceapi.FaceLandmarks68;
  /** Detection confidence score 0..1. */
  confidence: number;
  /** Bounding box in the source frame. */
  box: faceapi.Box;
}

export type FaceCountValidation =
  | { valid: true; face: DetectedFace }
  | { valid: false; reason: "no-face" | "multi-face"; count: number };

/* ------------------------------------------------------------------ */
/*  Model Loading                                                      */
/* ------------------------------------------------------------------ */

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

/**
 * Loads face-api.js models once. Subsequent calls resolve immediately.
 */
export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const url = FACE_CONFIG.MODELS_URL;
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(url),
      faceapi.nets.faceLandmark68Net.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url),
    ]);
    modelsLoaded = true;
  })();

  return loadingPromise;
}

/** Check whether models are ready in memory. */
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

/* ------------------------------------------------------------------ */
/*  Detection Methods                                                  */
/* ------------------------------------------------------------------ */

// Pre-configured SSD MobileNet V1 options to avoid garbage-collection overhead
let ssdOptionsInstance: faceapi.SsdMobilenetv1Options | null = null;
function getSsdOptions(): faceapi.SsdMobilenetv1Options {
  if (!ssdOptionsInstance) {
    ssdOptionsInstance = new faceapi.SsdMobilenetv1Options({
      minConfidence: FACE_CONFIG.MIN_FACE_CONFIDENCE,
    });
  }
  return ssdOptionsInstance;
}

/**
 * Detect all faces with landmarks (optimized for real-time tracking).
 * Does not compute expensive ResNet descriptors on every frame.
 */
export async function detectFacesWithLandmarks(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<{ landmarks: faceapi.FaceLandmarks68; confidence: number; box: faceapi.Box }[]> {
  await loadModels();

  if (input instanceof HTMLVideoElement && (input.videoWidth === 0 || input.readyState < 1)) {
    return [];
  }

  const detections = await faceapi
    .detectAllFaces(input, getSsdOptions())
    .withFaceLandmarks();

  return detections.map((d) => ({
    landmarks: d.landmarks,
    confidence: d.detection.score,
    box: d.detection.box,
  }));
}

/**
 * Detect all faces in a video frame, canvas, or image element (including descriptors).
 */
export async function detectFaces(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<DetectedFace[]> {
  await loadModels();

  if (input instanceof HTMLVideoElement && (input.videoWidth === 0 || input.readyState < 2)) {
    return [];
  }

  const detections = await faceapi
    .detectAllFaces(
      input,
      new faceapi.SsdMobilenetv1Options({
        minConfidence: FACE_CONFIG.MIN_FACE_CONFIDENCE,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections.map((d) => ({
    descriptor: d.descriptor,
    landmarks: d.landmarks,
    confidence: d.detection.score,
    box: d.detection.box,
  }));
}

/**
 * Detect a single face in the input.
 */
export async function detectSingleFace(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<DetectedFace | null> {
  await loadModels();

  if (input instanceof HTMLVideoElement && (input.videoWidth === 0 || input.readyState < 2)) {
    return null;
  }

  const detection = await faceapi
    .detectSingleFace(
      input,
      new faceapi.SsdMobilenetv1Options({
        minConfidence: FACE_CONFIG.MIN_FACE_CONFIDENCE,
      }),
    )
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;

  return {
    descriptor: detection.descriptor,
    landmarks: detection.landmarks,
    confidence: detection.detection.score,
    box: detection.detection.box,
  };
}

/**
 * Validate that exactly ONE face is in view.
 * Returns failure reason if 0 faces or >1 face are detected.
 */
export async function validateSingleFacePresence(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<FaceCountValidation> {
  const faces = await detectFaces(input);
  if (faces.length === 0) {
    return { valid: false, reason: "no-face", count: 0 };
  }
  if (faces.length > 1) {
    return { valid: false, reason: "multi-face", count: faces.length };
  }
  return { valid: true, face: faces[0]! };
}

import { generateArcFaceEmbedding } from "./arcface-engine";

/**
 * Generate a 512-float ArcFace biometric embedding from a reference image (used for enrollment).
 */
export async function generateEmbedding(
  img: HTMLImageElement,
): Promise<{ descriptor: Float32Array; landmarks: faceapi.FaceLandmarks68 } | null> {
  const face = await detectSingleFace(img);
  if (!face) return null;
  const arcVec = await generateArcFaceEmbedding(
    img,
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
    face.landmarks,
  );
  return { descriptor: new Float32Array(arcVec), landmarks: face.landmarks };
}

/* ------------------------------------------------------------------ */
/*  Visual Overlay & Landmark Drawing Helpers                         */
/* ------------------------------------------------------------------ */

/**
 * Check whether facial landmarks originate from within the detected bounding box.
 */
export function validateLandmarksInBox(
  box: faceapi.Box,
  landmarks: faceapi.FaceLandmarks68,
): { valid: boolean; insideCount: number; totalCount: number } {
  const positions = landmarks.positions;
  const margin = Math.max(box.width, box.height) * 0.15; // 15% tolerance for jaw boundary
  const minX = box.x - margin;
  const maxX = box.x + box.width + margin;
  const minY = box.y - margin;
  const maxY = box.y + box.height + margin;

  let insideCount = 0;
  for (const pt of positions) {
    if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
      insideCount++;
    }
  }

  return {
    valid: insideCount >= positions.length * 0.9, // At least 90% landmarks inside
    insideCount,
    totalCount: positions.length,
  };
}

/**
 * Draw complete face overlay: Bounding Box, Corner brackets, Confidence, and 68 Landmarks.
 */
export function drawCompleteFaceOverlay(
  canvas: HTMLCanvasElement,
  face: { box: faceapi.Box; landmarks?: faceapi.FaceLandmarks68; confidence?: number },
  options: {
    boxColor?: string;
    landmarkColor?: string;
    alignmentPointsColor?: string;
    showLandmarks?: boolean;
    showAlignmentPoints?: boolean;
    showLabel?: boolean;
  } = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const {
    boxColor = "rgba(52, 211, 153, 0.9)",
    landmarkColor = "rgba(52, 211, 153, 0.6)",
    alignmentPointsColor = "rgba(56, 189, 248, 1.0)",
    showLandmarks = true,
    showAlignmentPoints = true,
    showLabel = true,
  } = options;

  const { box, landmarks, confidence } = face;

  // 1. Draw sleek futuristic rounded bounding box
  ctx.save();
  ctx.strokeStyle = boxColor;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = boxColor;
  ctx.shadowBlur = 8;

  // Corner bracket accents
  const cornerLen = Math.min(24, box.width * 0.2, box.height * 0.2);
  const r = 8; // radius

  // Main box outline
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  // 2. Draw 68 facial landmarks
  if (showLandmarks && landmarks && landmarks.positions) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = landmarkColor;
    for (const pt of landmarks.positions) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // 3. Highlight 5 ArcFace alignment points (left eye, right eye, nose, left mouth, right mouth)
  if (showAlignmentPoints && landmarks && landmarks.positions) {
    const pts = landmarks.positions;
    const leftEye = {
      x: (pts[36]!.x + pts[37]!.x + pts[38]!.x + pts[39]!.x + pts[40]!.x + pts[41]!.x) / 6,
      y: (pts[36]!.y + pts[37]!.y + pts[38]!.y + pts[39]!.y + pts[40]!.y + pts[41]!.y) / 6,
    };
    const rightEye = {
      x: (pts[42]!.x + pts[43]!.x + pts[44]!.x + pts[45]!.x + pts[46]!.x + pts[47]!.x) / 6,
      y: (pts[42]!.y + pts[43]!.y + pts[44]!.y + pts[45]!.y + pts[46]!.y + pts[47]!.y) / 6,
    };
    const nose = pts[30]!;
    const leftMouth = pts[48]!;
    const rightMouth = pts[54]!;

    ctx.fillStyle = alignmentPointsColor;
    ctx.shadowColor = alignmentPointsColor;
    ctx.shadowBlur = 6;
    for (const p of [leftEye, rightEye, nose, leftMouth, rightMouth]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // 4. Label with confidence & dimensions
  if (showLabel) {
    ctx.shadowBlur = 0;
    const confText = confidence ? `${(confidence * 100).toFixed(0)}%` : "Detected";
    const dimText = `${Math.round(box.width)}x${Math.round(box.height)}px`;
    const label = `Face · ${confText} · ${dimText}`;

    ctx.font = "bold 11px monospace";
    const textWidth = ctx.measureText(label).width;
    const labelX = Math.max(0, box.x);
    const labelY = Math.max(18, box.y - 6);

    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(labelX, labelY - 14, textWidth + 10, 18);
    ctx.fillStyle = "#34d399";
    ctx.fillText(label, labelX + 5, labelY - 1);
  }

  ctx.restore();
}

/**
 * Draw a bounding box on the camera canvas overlay (legacy wrapper).
 */
export function drawFaceBox(
  canvas: HTMLCanvasElement,
  box: faceapi.Box,
  color: string = "rgba(99, 102, 241, 0.85)",
  lineWidth: number = 3,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}
