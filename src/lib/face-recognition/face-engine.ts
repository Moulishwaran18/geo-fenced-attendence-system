/**
 * Face recognition engine — wraps face-api.js.
 *
 * This module is the sole dependency on face-api.js. If you later swap to
 * MediaPipe or TensorFlow.js directly, only this file needs to change.
 */

import * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DetectedFace {
  /** 128-float face descriptor (embedding). */
  descriptor: Float32Array;
  /** 68-point face landmarks. */
  landmarks: faceapi.FaceLandmarks68;
  /** Detection confidence score 0-1. */
  confidence: number;
  /** Bounding box in the source image. */
  box: faceapi.Box;
}

export interface MatchResult {
  staffId: string;
  staffName: string;
  /** Euclidean distance — lower is better. */
  distance: number;
  /** true when distance < MATCH_THRESHOLD. */
  matched: boolean;
}

/* ------------------------------------------------------------------ */
/*  Model loading                                                      */
/* ------------------------------------------------------------------ */

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

/**
 * Load face-api.js models once. Subsequent calls are no-ops.
 * Call this early (e.g. when the enrollment or scan dialog opens).
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

/** Check whether models have been loaded. */
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Detect all faces in a video/canvas/image element.
 * Returns full descriptors + landmarks for each detected face.
 */
export async function detectFaces(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<DetectedFace[]> {
  await loadModels();

  const detections = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.MIN_FACE_CONFIDENCE }))
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
 * Detect the single largest face in the input.
 * Returns null when no face is found.
 */
export async function detectSingleFace(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): Promise<DetectedFace | null> {
  await loadModels();

  const detection = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.MIN_FACE_CONFIDENCE }))
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

/* ------------------------------------------------------------------ */
/*  Embedding generation                                               */
/* ------------------------------------------------------------------ */

/**
 * Generate a 128-float face embedding from an <img> element.
 * Convenience wrapper for enrollment — detects the face, returns descriptor.
 */
export async function generateEmbedding(
  img: HTMLImageElement,
): Promise<{ descriptor: Float32Array; landmarks: faceapi.FaceLandmarks68 } | null> {
  const face = await detectSingleFace(img);
  if (!face) return null;
  return { descriptor: face.descriptor, landmarks: face.landmarks };
}

/* ------------------------------------------------------------------ */
/*  Comparison                                                         */
/* ------------------------------------------------------------------ */

export interface StaffProfile {
  id: string;
  name: string;
  embedding: Float32Array;
}

/**
 * Compare a live face embedding against an array of registered staff embeddings.
 * Returns all matches sorted by distance (best first).
 */
export function compareFaces(
  liveDescriptor: Float32Array,
  staffProfiles: StaffProfile[],
): MatchResult[] {
  return staffProfiles
    .map((staff) => {
      const distance = faceapi.euclideanDistance(
        Array.from(liveDescriptor),
        Array.from(staff.embedding),
      );
      return {
        staffId: staff.id,
        staffName: staff.name,
        distance,
        matched: distance < FACE_CONFIG.MATCH_THRESHOLD,
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Find the single best matching staff member.
 * Returns null when no profile is within the similarity threshold.
 */
export function findBestMatch(
  liveDescriptor: Float32Array,
  staffProfiles: StaffProfile[],
): MatchResult | null {
  if (staffProfiles.length === 0) return null;
  const sorted = compareFaces(liveDescriptor, staffProfiles);
  const best = sorted[0];
  if (!best) return null;
  return best.matched ? best : null;
}

/* ------------------------------------------------------------------ */
/*  Drawing helpers (for the detection overlay)                        */
/* ------------------------------------------------------------------ */

/**
 * Draw a bounding box around a detected face onto a canvas overlay.
 */
export function drawFaceBox(
  canvas: HTMLCanvasElement,
  box: faceapi.Box,
  color: string = "rgba(99, 102, 241, 0.8)",
  lineWidth: number = 3,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
}
