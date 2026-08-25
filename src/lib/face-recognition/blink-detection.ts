/**
 * Module: blinkDetection
 *
 * Highly robust, adaptive temporal blink detector using 68-point facial landmarks and Eye Aspect Ratio (EAR).
 *
 * Implements:
 * 1. Dual-Eye Geometry: Calculates Left EAR and Right EAR independently + Mean EAR.
 * 2. Adaptive Baseline Tracking: Dynamically learns individual eye openness geometry (0.22 - 0.40).
 * 3. 4-Stage Temporal State Machine: OPEN -> CLOSING -> CLOSED -> OPEN.
 * 4. Low-FPS Resilience: Works reliably at 3 - 30+ FPS. A 1-frame dip to closed (< 0.235 or 18% below baseline)
 *    followed by reopening is recognized as a valid blink.
 * 5. Permanent Closure Rejection: If eyes stay closed for > 2.0s or > 12 frames, rejects permanent closure.
 */

import type * as faceapi from "face-api.js";

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
 * Formula: (|p1 - p5| + |p2 - p4|) / (2 * |p0 - p3|)
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
 * Extracts left eye and right eye landmark points and computes individual EARs.
 */
export function getDetailedEAR(landmarks: faceapi.FaceLandmarks68): {
  leftEAR: number;
  rightEAR: number;
  meanEAR: number;
  validLandmarks: boolean;
} {
  const pts = landmarks.positions;
  if (!pts || pts.length < 68) {
    return { leftEAR: 0.28, rightEAR: 0.28, meanEAR: 0.28, validLandmarks: false };
  }

  // 68-point model:
  // Subject right eye (viewer left): indices 36..41
  // Subject left eye (viewer right): indices 42..47
  const leftEye = pts.slice(36, 42);
  const rightEye = pts.slice(42, 48);

  const leftEAR = computeEyeAspectRatio(leftEye);
  const rightEAR = computeEyeAspectRatio(rightEye);
  const meanEAR = (leftEAR + rightEAR) / 2.0;

  return {
    leftEAR: Number(leftEAR.toFixed(4)),
    rightEAR: Number(rightEAR.toFixed(4)),
    meanEAR: Number(meanEAR.toFixed(4)),
    validLandmarks: true,
  };
}

export function getAverageEAR(landmarks: faceapi.FaceLandmarks68): number {
  return getDetailedEAR(landmarks).meanEAR;
}

/* ------------------------------------------------------------------ */
/*  Temporal Blink State Machine                                       */
/* ------------------------------------------------------------------ */

export type EyePhysicalState = "OPEN" | "CLOSING" | "CLOSED" | "PERMANENTLY_CLOSED";
export type BlinkStateMachineState = "AWAITING_BLINK" | "CLOSING" | "CLOSED" | "BLINK_VERIFIED";
export type BlinkPhase = BlinkStateMachineState;

export interface BlinkTrackerState {
  // Telemetry Metrics
  leftEAR: number;
  rightEAR: number;
  currentEAR: number;
  baselineEAR: number;
  eyeState: EyePhysicalState;
  blinkState: BlinkStateMachineState;
  blinkCount: number;
  targetBlinks: number;
  closedFramesCount: number;
  framesSampled: number;
  livenessFPS: number;
  livenessTimerSec: number;
  isComplete: boolean;
  logMessage: string;
}

export class TemporalBlinkDetector {
  private targetCount: number;
  private completedCount: number = 0;
  private state: BlinkStateMachineState = "AWAITING_BLINK";
  private eyeState: EyePhysicalState = "OPEN";
  private isPermanentlyClosed: boolean = false;
  private closedFrames: number = 0;
  private openFrames: number = 0;
  private framesSampled: number = 0;
  private lastBlinkTime: number | null = null;
  private closedStartTime: number | null = null;
  private sessionStartTime: number = Date.now();

  private lastLeftEAR: number = 0.28;
  private lastRightEAR: number = 0.28;
  private lastMeanEAR: number = 0.28;
  private baselineEAR: number = 0.28;
  private baselineSamples: number = 0;

  // FPS tracking for liveness sampler
  private fpsTimer: number = Date.now();
  private fpsFrameCount: number = 0;
  private currentLivenessFPS: number = 0;

  constructor(targetBlinks: number = 1) {
    this.targetCount = targetBlinks;
    this.reset();
  }

  /**
   * Reset the detector state for a new session or retry.
   */
  reset(targetBlinks?: number): void {
    if (targetBlinks !== undefined) {
      this.targetCount = targetBlinks;
    }
    this.completedCount = 0;
    this.state = "AWAITING_BLINK";
    this.eyeState = "OPEN";
    this.isPermanentlyClosed = false;
    this.closedFrames = 0;
    this.openFrames = 0;
    this.framesSampled = 0;
    this.lastBlinkTime = null;
    this.closedStartTime = null;
    this.sessionStartTime = Date.now();

    this.lastLeftEAR = 0.28;
    this.lastRightEAR = 0.28;
    this.lastMeanEAR = 0.28;
    this.baselineEAR = 0.28;
    this.baselineSamples = 0;

    this.fpsTimer = Date.now();
    this.fpsFrameCount = 0;
    this.currentLivenessFPS = 0;
  }

  /**
   * Process a single video frame's landmarks.
   */
  processFrame(landmarks: faceapi.FaceLandmarks68): BlinkTrackerState {
    this.framesSampled++;
    this.fpsFrameCount++;
    const now = Date.now();

    // Track effective liveness FPS
    if (now - this.fpsTimer >= 1000) {
      this.currentLivenessFPS = Math.round((this.fpsFrameCount * 1000) / (now - this.fpsTimer));
      this.fpsFrameCount = 0;
      this.fpsTimer = now;
    }

    const { leftEAR, rightEAR, meanEAR } = getDetailedEAR(landmarks);
    this.lastLeftEAR = leftEAR;
    this.lastRightEAR = rightEAR;
    this.lastMeanEAR = meanEAR;

    // 1. Adaptive Baseline Initialization & Calibration
    if (this.baselineSamples < 5) {
      // Fast calibration on first 5 frames
      this.baselineEAR = Math.max(0.24, Math.min(0.38, (this.baselineEAR * this.baselineSamples + meanEAR) / (this.baselineSamples + 1)));
      this.baselineSamples++;
    } else if (this.state === "AWAITING_BLINK" && meanEAR > 0.22) {
      // Slowly adapt baseline to normal open eyes (moving average)
      this.baselineEAR = this.baselineEAR * 0.95 + meanEAR * 0.05;
    }

    // Dynamic thresholds relative to individual baseline:
    // - Closing threshold: EAR < 88% of baseline or < 0.25
    // - Closed threshold:  EAR < 80% of baseline or < 0.225
    // - Reopen threshold:  EAR >= 88% of baseline or >= 0.245
    const closedThreshold = Math.min(0.235, Math.max(0.18, this.baselineEAR * 0.80));
    const closingThreshold = Math.min(0.255, Math.max(0.20, this.baselineEAR * 0.88));
    const reopenThreshold = Math.max(0.240, Math.min(0.34, this.baselineEAR * 0.88));

    // Determine current physical eye state
    if (meanEAR <= closedThreshold) {
      this.eyeState = "CLOSED";
    } else if (meanEAR <= closingThreshold) {
      this.eyeState = "CLOSING";
    } else {
      this.eyeState = "OPEN";
    }

    let logMsg = "";

    // 2. Temporal State Machine: OPEN -> CLOSING -> CLOSED -> OPEN
    switch (this.state) {
      case "AWAITING_BLINK": {
        if (this.eyeState === "CLOSED" || this.eyeState === "CLOSING") {
          this.state = this.eyeState === "CLOSED" ? "CLOSED" : "CLOSING";
          this.closedFrames = 1;
          this.openFrames = 0;
          this.closedStartTime = now;
          logMsg = `Eye dip detected (EAR: ${meanEAR.toFixed(3)} < Thresh: ${closedThreshold.toFixed(3)}) -> Entering ${this.state}`;
        } else {
          this.openFrames++;
          this.closedFrames = 0;
          this.closedStartTime = null;
        }
        break;
      }

      case "CLOSING": {
        if (this.eyeState === "CLOSED") {
          this.state = "CLOSED";
          this.closedFrames++;
          logMsg = `Eyes fully closed (EAR: ${meanEAR.toFixed(3)})`;
        } else if (this.eyeState === "OPEN") {
          // Quick low-FPS transient blink: went OPEN -> CLOSING -> OPEN in 2 frames
          this.completedCount++;
          this.lastBlinkTime = now;
          this.state = this.completedCount >= this.targetCount ? "BLINK_VERIFIED" : "AWAITING_BLINK";
          this.closedFrames = 0;
          this.closedStartTime = null;
          logMsg = `Quick transient blink verified (EAR: ${meanEAR.toFixed(3)}) -> Blinks: ${this.completedCount}/${this.targetCount}`;
        } else {
          this.closedFrames++;
        }
        break;
      }

      case "CLOSED": {
        if (this.eyeState === "CLOSED") {
          this.closedFrames++;
          const closedDurationMs = this.closedStartTime ? now - this.closedStartTime : 0;

          // Rule 8: If eyes remain permanently closed (> 2.0s or > 15 consecutive frames), do NOT count as a blink
          if (closedDurationMs > 2000 || this.closedFrames > 15) {
            this.isPermanentlyClosed = true;
            this.eyeState = "PERMANENTLY_CLOSED";
            logMsg = `Permanently closed eye rejected (>2.0s / ${this.closedFrames} frames closed)`;
          }
        } else if (this.eyeState === "OPEN" || meanEAR >= reopenThreshold) {
          const closedDurationMs = this.closedStartTime ? now - this.closedStartTime : 0;

          // Check if closure was a legitimate natural blink (not permanently closed)
          if (!this.isPermanentlyClosed && closedDurationMs <= 2000) {
            this.completedCount++;
            this.lastBlinkTime = now;
            this.state = this.completedCount >= this.targetCount ? "BLINK_VERIFIED" : "AWAITING_BLINK";
            this.closedFrames = 0;
            this.closedStartTime = null;
            logMsg = `Natural blink complete! (Duration: ${closedDurationMs}ms, Closed Frames: ${this.closedFrames}) -> Blinks: ${this.completedCount}/${this.targetCount}`;
          } else {
            // Recover from permanently closed state back to awaiting blink
            this.state = "AWAITING_BLINK";
            this.isPermanentlyClosed = false;
            this.closedFrames = 0;
            this.closedStartTime = null;
            logMsg = "Eyes reopened after permanent closure. Waiting for fresh natural blink.";
          }
        }
        break;
      }

      case "BLINK_VERIFIED": {
        logMsg = `Blink liveness PASSED (${this.completedCount} natural blinks verified)`;
        break;
      }
    }

    return this.getState(logMsg);
  }

  /**
   * Current snapshot of the blink detector state.
   */
  getState(logMessage?: string): BlinkTrackerState {
    const livenessTimerSec = Number(((Date.now() - this.sessionStartTime) / 1000).toFixed(1));
    return {
      leftEAR: this.lastLeftEAR,
      rightEAR: this.lastRightEAR,
      currentEAR: this.lastMeanEAR,
      baselineEAR: Number(this.baselineEAR.toFixed(4)),
      eyeState: this.eyeState,
      blinkState: this.state,
      blinkCount: this.completedCount,
      targetBlinks: this.targetCount,
      closedFramesCount: this.closedFrames,
      framesSampled: this.framesSampled,
      livenessFPS: this.currentLivenessFPS,
      livenessTimerSec,
      isComplete: this.completedCount >= this.targetCount,
      logMessage: logMessage || (this.state === "BLINK_VERIFIED" ? "Blink liveness PASSED" : `Awaiting natural blink (Blinks: ${this.completedCount}/${this.targetCount})`),
    };
  }
}
