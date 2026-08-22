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

/**
 * Detect all faces in a video frame, canvas, or image element.
 */
export async function detectFaces(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<DetectedFace[]> {
  await loadModels();

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

/**
 * Generate a 128-float face embedding from a reference image (used for enrollment).
 */
export async function generateEmbedding(
  img: HTMLImageElement,
): Promise<{ descriptor: Float32Array; landmarks: faceapi.FaceLandmarks68 } | null> {
  const face = await detectSingleFace(img);
  if (!face) return null;
  return { descriptor: face.descriptor, landmarks: face.landmarks };
}

/* ------------------------------------------------------------------ */
/*  Visual Overlay Drawing                                             */
/* ------------------------------------------------------------------ */

/**
 * Draw a bounding box on the camera canvas overlay.
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
