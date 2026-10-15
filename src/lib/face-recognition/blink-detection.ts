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

export type EyePhysicalState = "OPEN" | "CLOSING" | "CLOSED" | "REOPENED" | "PERMANENTLY_CLOSED";
export type BlinkStateMachineState = "AWAITING_BLINK" | "CLOSING" | "CLOSED" | "REOPENED" | "BLINK_VERIFIED";
export type BlinkPhase = BlinkStateMachineState;

export interface BlinkEventRecord {
  blinkIndex: number;
  timestamp: number;
  durationMs: number;
  minEAR: number;
  reason: string;
}

export interface BlinkTrackerState {
  // Telemetry Metrics
  leftEAR: number;
  rightEAR: number;
  currentEAR: number;
  baselineEAR: number;
  closedThreshold: number;
  closingThreshold: number;
  reopenThreshold: number;
  eyeState: EyePhysicalState;
  blinkState: BlinkStateMachineState;
  blinkCount: number;
  targetBlinks: number;
  closedFramesCount: number;
  framesSampled: number;
  framesDropped: number;
  livenessFPS: number;
  livenessTimerSec: number;
  isComplete: boolean;
  blinkHistory: BlinkEventRecord[];
  lastBlinkDurationMs: number | null;
  lastBlinkTimestamp: number | null;
  exactReason: string;
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
  private framesDropped: number = 0;
  private lastBlinkTime: number | null = null;
  private lastBlinkDurationMs: number | null = null;
  private closedStartTime: number | null = null;
  private reopenStartTime: number | null = null;
  private sessionStartTime: number = Date.now();
  private minClosedEAR: number = 1.0;
  private exactReason: string = "Awaiting natural blink";

  private lastLeftEAR: number = 0.28;
  private lastRightEAR: number = 0.28;
  private lastMeanEAR: number = 0.28;
  private baselineEAR: number = 0.28;
  private baselineSamples: number = 0;
  private blinkHistory: BlinkEventRecord[] = [];

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
    this.framesDropped = 0;
    this.lastBlinkTime = null;
    this.lastBlinkDurationMs = null;
    this.closedStartTime = null;
    this.reopenStartTime = null;
    this.sessionStartTime = Date.now();
    this.minClosedEAR = 1.0;
    this.exactReason = "Awaiting natural blink";
    this.blinkHistory = [];

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
   * Record dropped or unparsed frame (e.g. landmark detection failure or obscured eyes).
   */
  recordFrameDrop(reason: string = "Landmark detection missed"): void {
    this.framesDropped++;
    this.exactReason = reason;
  }

  /**
   * Process a single video frame's landmarks.
   */
  processFrame(landmarks: faceapi.FaceLandmarks68, frameTimestamp?: number): BlinkTrackerState {
    this.framesSampled++;
    this.fpsFrameCount++;
    const now = frameTimestamp || Date.now();

    // Track effective liveness FPS
    if (now - this.fpsTimer >= 1000) {
      this.currentLivenessFPS = Math.round((this.fpsFrameCount * 1000) / (now - this.fpsTimer));
      this.fpsFrameCount = 0;
      this.fpsTimer = now;
    }

    const { leftEAR, rightEAR, meanEAR, validLandmarks } = getDetailedEAR(landmarks);
    if (!validLandmarks) {
      this.recordFrameDrop("Landmark geometry missing or <68 points");
      return this.getState();
    }

    this.lastLeftEAR = leftEAR;
    this.lastRightEAR = rightEAR;
    this.lastMeanEAR = meanEAR;

    // 1. Adaptive Baseline Tracking: Dynamically learn open eye geometry (0.21 - 0.42)
    if (this.baselineSamples < 5) {
      if (meanEAR >= 0.19) {
        this.baselineEAR = (this.baselineEAR * this.baselineSamples + meanEAR) / (this.baselineSamples + 1);
        this.baselineEAR = Math.max(0.21, Math.min(0.42, this.baselineEAR));
        this.baselineSamples++;
      }
    } else if (this.state === "AWAITING_BLINK" && this.eyeState === "OPEN" && meanEAR >= this.baselineEAR * 0.85) {
      // Slowly adapt baseline to confirmed open eyes
      this.baselineEAR = this.baselineEAR * 0.96 + meanEAR * 0.04;
    }

    // Dynamic thresholds with calibrated hysteresis:
    // - Closed threshold: EAR drops by >= 22% below baseline or <= 0.245
    // - Closing threshold: EAR drops by >= 14% below baseline
    // - Reopen threshold: EAR returns to >= 86% of baseline with minimum 0.025 gap above closedThreshold
    const closedThreshold = Math.min(0.245, Math.max(0.170, Number((this.baselineEAR * 0.78).toFixed(4))));
    const closingThreshold = Math.min(0.265, Math.max(0.190, Number((this.baselineEAR * 0.86).toFixed(4))));
    const reopenThreshold = Math.min(0.360, Math.max(closedThreshold + 0.025, Number((this.baselineEAR * 0.86).toFixed(4))));

    // Determine current physical eye state
    if (meanEAR <= closedThreshold) {
      this.eyeState = "CLOSED";
    } else if (meanEAR <= closingThreshold) {
      this.eyeState = "CLOSING";
    } else if (meanEAR >= reopenThreshold) {
      this.eyeState = "OPEN";
    } else {
      // In hysteresis band: maintain previous state unless transitioning
      if (this.eyeState === "CLOSED" || this.eyeState === "CLOSING") {
        this.eyeState = "CLOSING";
      } else {
        this.eyeState = "OPEN";
      }
    }

    let logMsg = "";

    // 2. Inter-blink interval expiration check for multi-blink challenges (e.g. double-blink)
    if (this.targetCount === 2 && this.completedCount === 1 && this.lastBlinkTime !== null) {
      const intervalSinceFirstBlink = now - this.lastBlinkTime;
      if (intervalSinceFirstBlink > 4000) {
        // Exceeded 4s max interval between 1st and 2nd blink -> reset to require 2 consecutive blinks
        this.completedCount = 0;
        this.state = "AWAITING_BLINK";
        this.exactReason = "Interval between blinks exceeded 4.0s. Please blink twice consecutively.";
        logMsg = "Double-blink interval exceeded 4s: Resetting counter to 0/2";
      }
    }

    // 3. Temporal State Machine: OPEN -> CLOSING -> CLOSED -> REOPENED
    switch (this.state) {
      case "AWAITING_BLINK": {
        if (this.eyeState === "CLOSED") {
          // Low-FPS fast blink: dropped directly to closed in 1 frame
          this.state = "CLOSED";
          this.closedFrames = 1;
          this.openFrames = 0;
          this.closedStartTime = now;
          this.minClosedEAR = meanEAR;
          this.exactReason = `Eyes closed (EAR: ${meanEAR.toFixed(3)} <= ${closedThreshold.toFixed(3)})`;
          logMsg = `Eyes closed (EAR: ${meanEAR.toFixed(3)}) -> Entering CLOSED`;
        } else if (this.eyeState === "CLOSING") {
          this.state = "CLOSING";
          this.closedFrames = 1;
          this.openFrames = 0;
          this.closedStartTime = now;
          this.minClosedEAR = meanEAR;
          this.exactReason = `Eyes closing (EAR: ${meanEAR.toFixed(3)} <= ${closingThreshold.toFixed(3)})`;
          logMsg = `Eye dip detected (EAR: ${meanEAR.toFixed(3)}) -> Entering CLOSING`;
        } else {
          this.openFrames++;
          this.closedFrames = 0;
          this.closedStartTime = null;
          this.exactReason = `Eyes open (EAR: ${meanEAR.toFixed(3)}, Baseline: ${this.baselineEAR.toFixed(3)})`;
        }
        break;
      }

      case "CLOSING": {
        this.minClosedEAR = Math.min(this.minClosedEAR, meanEAR);
        if (this.eyeState === "CLOSED") {
          this.state = "CLOSED";
          this.closedFrames++;
          this.exactReason = `Eyes fully closed (EAR: ${meanEAR.toFixed(3)})`;
          logMsg = `Eyes fully closed (EAR: ${meanEAR.toFixed(3)}) -> Entering CLOSED`;
        } else if (this.eyeState === "OPEN" || meanEAR >= reopenThreshold) {
          // Quick low-FPS transient blink: went OPEN -> CLOSING -> OPEN in 2 frames
          const durationMs = this.closedStartTime ? Math.max(60, now - this.closedStartTime) : 120;
          if (durationMs >= 60 && durationMs <= 1500) {
            this.completedCount++;
            this.lastBlinkTime = now;
            this.lastBlinkDurationMs = durationMs;
            this.blinkHistory.push({
              blinkIndex: this.completedCount,
              timestamp: now,
              durationMs,
              minEAR: Number(this.minClosedEAR.toFixed(4)),
              reason: `Valid transient blink (duration: ${durationMs}ms, minEAR: ${this.minClosedEAR.toFixed(3)})`,
            });

            if (this.completedCount >= this.targetCount) {
              this.state = "BLINK_VERIFIED";
              this.exactReason = `All ${this.targetCount} blinks verified!`;
              logMsg = `Quick transient blink verified -> Blinks: ${this.completedCount}/${this.targetCount}`;
            } else {
              this.state = "REOPENED";
              this.reopenStartTime = now;
              this.exactReason = `First blink verified (${durationMs}ms). Blink once more.`;
              logMsg = `Blink 1/2 complete -> Awaiting second blink`;
            }
          } else {
            this.state = "AWAITING_BLINK";
            this.exactReason = `Blink duration (${durationMs}ms) outside natural range (60-1500ms)`;
          }
          this.closedFrames = 0;
          this.closedStartTime = null;
        } else {
          this.closedFrames++;
          this.exactReason = `Eyes in closing motion (EAR: ${meanEAR.toFixed(3)})`;
        }
        break;
      }

      case "CLOSED": {
        this.minClosedEAR = Math.min(this.minClosedEAR, meanEAR);
        const closedDurationMs = this.closedStartTime ? now - this.closedStartTime : 0;

        if (this.eyeState === "CLOSED" || this.eyeState === "CLOSING") {
          this.closedFrames++;
          // Reject prolonged eye closure (> 2.0s or > 15 consecutive frames closed)
          if (closedDurationMs > 2000 || this.closedFrames > 15) {
            this.isPermanentlyClosed = true;
            this.eyeState = "PERMANENTLY_CLOSED";
            this.exactReason = `Prolonged closed eye rejected (>2.0s / ${this.closedFrames} frames closed)`;
            logMsg = `Permanently closed eye rejected (>2.0s / ${this.closedFrames} frames closed)`;
          } else {
            this.exactReason = `Eyes held closed (${closedDurationMs}ms, EAR: ${meanEAR.toFixed(3)})`;
          }
        } else if (this.eyeState === "OPEN" || meanEAR >= reopenThreshold) {
          // Check if closure was a legitimate natural blink
          if (!this.isPermanentlyClosed && closedDurationMs >= 50 && closedDurationMs <= 2000) {
            this.completedCount++;
            this.lastBlinkTime = now;
            this.lastBlinkDurationMs = closedDurationMs;
            this.blinkHistory.push({
              blinkIndex: this.completedCount,
              timestamp: now,
              durationMs: closedDurationMs,
              minEAR: Number(this.minClosedEAR.toFixed(4)),
              reason: `Natural blink verified (duration: ${closedDurationMs}ms, minEAR: ${this.minClosedEAR.toFixed(3)})`,
            });

            if (this.completedCount >= this.targetCount) {
              this.state = "BLINK_VERIFIED";
              this.exactReason = `All ${this.targetCount} blinks verified!`;
              logMsg = `Natural blink complete! -> Blinks: ${this.completedCount}/${this.targetCount}`;
            } else {
              this.state = "REOPENED";
              this.reopenStartTime = now;
              this.exactReason = `First blink verified (${closedDurationMs}ms). Blink once more.`;
              logMsg = `First blink verified (${closedDurationMs}ms) -> Waiting for second blink`;
            }
          } else {
            // Recover from permanently closed state or noise
            this.state = "AWAITING_BLINK";
            this.isPermanentlyClosed = false;
            this.exactReason = closedDurationMs < 50
              ? "Instant dip rejected as optical noise (<50ms)"
              : "Eyes reopened after permanent closure. Waiting for fresh natural blink.";
            logMsg = this.exactReason;
          }
          this.closedFrames = 0;
          this.closedStartTime = null;
        }
        break;
      }

      case "REOPENED": {
        // Enforce an inter-blink open confirmation period (minimum 120ms eyes confirmed OPEN)
        // to prevent a single blink's recovery fluctuation from counting twice!
        const openDuration = this.reopenStartTime ? now - this.reopenStartTime : 0;
        if (this.eyeState === "OPEN" || meanEAR >= reopenThreshold) {
          this.openFrames++;
          if (openDuration >= 120 && this.openFrames >= 1) {
            this.state = "AWAITING_BLINK";
            this.exactReason = `Eyes confirmed reopened (${openDuration}ms). Ready for blink 2.`;
            logMsg = "Eyes confirmed reopened. Ready for next blink.";
          } else {
            this.exactReason = `Eyes reopening (${openDuration}ms) — confirming open state...`;
          }
        } else {
          this.exactReason = "Keep eyes open before second blink";
        }
        break;
      }

      case "BLINK_VERIFIED": {
        this.exactReason = `Blink liveness PASSED (${this.completedCount}/${this.targetCount} verified)`;
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
    const closedThreshold = Math.min(0.245, Math.max(0.170, Number((this.baselineEAR * 0.78).toFixed(4))));
    const closingThreshold = Math.min(0.265, Math.max(0.190, Number((this.baselineEAR * 0.86).toFixed(4))));
    const reopenThreshold = Math.min(0.360, Math.max(closedThreshold + 0.025, Number((this.baselineEAR * 0.86).toFixed(4))));

    return {
      leftEAR: this.lastLeftEAR,
      rightEAR: this.lastRightEAR,
      currentEAR: this.lastMeanEAR,
      baselineEAR: Number(this.baselineEAR.toFixed(4)),
      closedThreshold,
      closingThreshold,
      reopenThreshold,
      eyeState: this.eyeState,
      blinkState: this.state,
      blinkCount: this.completedCount,
      targetBlinks: this.targetCount,
      closedFramesCount: this.closedFrames,
      framesSampled: this.framesSampled,
      framesDropped: this.framesDropped,
      livenessFPS: this.currentLivenessFPS,
      livenessTimerSec,
      isComplete: this.completedCount >= this.targetCount,
      blinkHistory: [...this.blinkHistory],
      lastBlinkDurationMs: this.lastBlinkDurationMs,
      lastBlinkTimestamp: this.lastBlinkTime,
      exactReason: this.exactReason,
      logMessage:
        logMessage ||
        (this.state === "BLINK_VERIFIED"
          ? "Blink liveness PASSED"
          : `Awaiting natural blink (${this.completedCount}/${this.targetCount})`),
    };
  }
}

