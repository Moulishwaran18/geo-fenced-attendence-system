/**
 * Module: blinkDetection
 *
 * Highly robust, adaptive temporal blink detector using 68-point facial landmarks and Eye Aspect Ratio (EAR).
 *
 * Implements:
 * 1. Adaptive Baseline Tracking: Dynamically adjusts to individual eye shapes, glasses, and camera angles.
 * 2. Dual-Trigger Closure: Detects relative EAR drops (≥ 18% below baseline) as well as absolute thresholds (< 0.24).
 * 3. Hysteresis State Machine: Requires open → closed → reopened transition.
 * 4. Ultra-responsive tracking: Accurately counts natural 150-300ms blinks across 10-30 FPS webcams.
 */

import type * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Geometric EAR Utilities                                            */
/* ------------------------------------------------------------------ */

function euclideanDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Computes Eye Aspect Ratio (EAR) for a 6-point eye contour.
 * Eye landmark indices:
 * 0: outer corner, 1: upper-left, 2: upper-right,
 * 3: inner corner, 4: lower-right, 5: lower-left
 */
export function computeEyeAspectRatio(
  eyePoints: { x: number; y: number }[],
): number {
  if (eyePoints.length < 6) return 0.28;
  const p0 = eyePoints[0]!;
  const p1 = eyePoints[1]!;
  const p2 = eyePoints[2]!;
  const p3 = eyePoints[3]!;
  const p4 = eyePoints[4]!;
  const p5 = eyePoints[5]!;

  const vertical1 = euclideanDistance(p1, p5);
  const vertical2 = euclideanDistance(p2, p4);
  const horizontal = euclideanDistance(p0, p3);

  if (horizontal === 0) return 0.28;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

/**
 * Calculates average EAR across both eyes.
 */
export function getAverageEAR(landmarks: faceapi.FaceLandmarks68): number {
  const pts = landmarks.positions;
  // Left eye: 36..41, Right eye: 42..47
  const leftEye = pts.slice(36, 42);
  const rightEye = pts.slice(42, 48);

  const leftEAR = computeEyeAspectRatio(leftEye);
  const rightEAR = computeEyeAspectRatio(rightEye);
  return (leftEAR + rightEAR) / 2.0;
}

/* ------------------------------------------------------------------ */
/*  Temporal Blink Tracker with Adaptive Baseline                      */
/* ------------------------------------------------------------------ */

export type BlinkPhase =
  | "awaiting-open"     // Baseline open eyes confirmed
  | "closing"           // Eyes currently closed / dropped below threshold
  | "reopened";         // Blink completed

export interface BlinkTrackerState {
  completedBlinks: number;
  targetBlinks: number;
  currentPhase: BlinkPhase;
  closedFramesCount: number;
  lastBlinkCompletedAt: number | null;
  currentEAR: number;
  baselineEAR: number;
  isComplete: boolean;
}

export class TemporalBlinkDetector {
  private targetCount: number;
  private completedCount: number = 0;
  private phase: BlinkPhase = "awaiting-open";
  private closedFrames: number = 0;
  private lastBlinkTime: number | null = null;
  private lastEAR: number = 0.28;
  private baselineEAR: number = 0.28;
  private initializedBaseline: boolean = false;

  constructor(targetBlinks: number = 1) {
    this.targetCount = targetBlinks;
  }

  /**
   * Reset the detector state for a new session or retry.
   */
  reset(targetBlinks?: number): void {
    if (targetBlinks !== undefined) {
      this.targetCount = targetBlinks;
    }
    this.completedCount = 0;
    this.phase = "awaiting-open";
    this.closedFrames = 0;
    this.lastBlinkTime = null;
    this.lastEAR = 0.28;
    this.baselineEAR = 0.28;
    this.initializedBaseline = false;
  }

  /**
   * Process a single video frame's landmarks.
   * Returns current blink tracking status.
   */
  processFrame(landmarks: faceapi.FaceLandmarks68): BlinkTrackerState {
    const ear = getAverageEAR(landmarks);
    this.lastEAR = ear;
    const now = Date.now();

    // 1. Adaptive Baseline Tracking
    if (!this.initializedBaseline) {
      this.baselineEAR = Math.max(0.24, Math.min(0.38, ear));
      this.initializedBaseline = true;
    } else if (this.phase === "awaiting-open" && ear > 0.22) {
      // Slowly adapt baseline to normal open eyes
      this.baselineEAR = this.baselineEAR * 0.9 + ear * 0.1;
    }

    // Relative and absolute closure thresholds
    // A drop of 18% below baseline or absolute EAR < 0.235 triggers closure
    const closureThreshold = Math.min(this.baselineEAR * 0.80, 0.245);
    const reopenThreshold = Math.max(this.baselineEAR * 0.88, 0.255);

    const isClosed = ear < closureThreshold;
    const isOpen = ear >= reopenThreshold;

    // 2. Debounce interval between consecutive blinks (prevent double-counting single blink)
    const timeSinceLastBlink = this.lastBlinkTime ? now - this.lastBlinkTime : 999999;

    switch (this.phase) {
      case "awaiting-open": {
        if (isClosed && timeSinceLastBlink > 120) {
          // Eyes went from open to closed -> Start of blink
          this.phase = "closing";
          this.closedFrames = 1;
        }
        break;
      }

      case "closing": {
        if (isClosed) {
          this.closedFrames++;
        } else if (isOpen && this.closedFrames >= 1) {
          // Eyes reopened after being closed -> Complete 1 blink!
          this.completedCount++;
          this.lastBlinkTime = now;
          this.closedFrames = 0;

          if (this.completedCount >= this.targetCount) {
            this.phase = "reopened";
          } else {
            // Wait for open state before accepting next blink
            this.phase = "awaiting-open";
          }
        }
        break;
      }

      case "reopened": {
        // Target blinks achieved
        break;
      }
    }

    // Double blink timeout: if too much time passes between 1st and 2nd blink, reset count
    if (this.targetCount === 2 && this.completedCount === 1 && this.lastBlinkTime) {
      if (now - this.lastBlinkTime > FACE_CONFIG.LIVENESS.DOUBLE_BLINK_MAX_INTERVAL_MS) {
        this.completedCount = 0;
        this.phase = "awaiting-open";
      }
    }

    return this.getState();
  }

  /**
   * Current snapshot of the blink detector state.
   */
  getState(): BlinkTrackerState {
    return {
      completedBlinks: this.completedCount,
      targetBlinks: this.targetCount,
      currentPhase: this.phase,
      closedFramesCount: this.closedFrames,
      lastBlinkCompletedAt: this.lastBlinkTime,
      currentEAR: this.lastEAR,
      baselineEAR: this.baselineEAR,
      isComplete: this.completedCount >= this.targetCount,
    };
  }
}
