/**
 * Module: liveness
 *
 * Orchestrates randomized head-movement liveness verification:
 * - Neutral head-pose baseline calibration.
 * - Sequence of 3 randomized directional movements without consecutive duplicates:
 *   - Turn your head LEFT
 *   - Turn your head RIGHT
 *   - Tilt your head UP
 *   - Tilt your head DOWN
 * - Confirmed return to CENTER between directional movements.
 * - Multi-frame temporal validation (consecutive stable frames).
 * - No fixed countdown timeout (usable, stress-free user experience).
 * - Cancellation and retry support.
 * - Cryptographically random attempt nonce for replay protection.
 * - Micro-movement variance check to reject static photo presentations.
 */

import type * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";
import {
  TemporalBlinkDetector,
  type BlinkTrackerState,
  getDetailedEAR,
} from "./blink-detection";
import {
  TemporalHeadPoseDetector,
  type HeadDirection,
  type HeadPoseValidationState,
  type HeadPoseAngles,
  estimateHeadPose,
} from "./head-pose";

/* ------------------------------------------------------------------ */
/*  Challenge Types & Definitions                                      */
/* ------------------------------------------------------------------ */

export type ChallengeCategory =
  | "head-movement"
  | "turn-left"
  | "turn-right"
  | "look-up"
  | "look-down"
  | "blink-once"
  | "blink-twice"
  | "blink-then-turn-left"
  | "blink-then-turn-right"
  | "turn-left-then-blink"
  | "turn-right-then-blink";

export type StepType = "pose" | "blink";

export interface ChallengeStep {
  id: string;
  type: StepType;
  instruction: string;
  targetDirection: HeadDirection;
  movementIndex?: number; // 1, 2, 3
  totalMovements?: number; // 3
  isReturnToCenter?: boolean;
  completed: boolean;
  targetBlinks?: number;
}

export interface GeneratedChallenge {
  category: ChallengeCategory;
  name: string;
  steps: ChallengeStep[];
  nonce: string;
  directionalSequence: HeadDirection[];
}

export interface LivenessEvidence {
  attemptNonce: string;
  challengeCategory: ChallengeCategory;
  challengeName: string;
  stepsCompleted: number;
  totalSteps: number;
  framesTracked: number;
  durationMs: number;
  earVariance: number;
  yawVariance: number;
  pitchVariance?: number;
  timestamp: number;
  livenessPassed: boolean;
  directionalSequence: HeadDirection[];
}

export type LivenessStatus = "idle" | "active" | "passed" | "failed";

export interface MovementProgress {
  currentMovement: number; // 1, 2, or 3
  totalMovements: number; // 3
  isReturnToCenter: boolean;
  targetDirection: HeadDirection;
  instruction: string;
}

export interface LivenessState {
  status: LivenessStatus;
  category: ChallengeCategory;
  challengeName: string;
  steps: ChallengeStep[];
  currentStepIndex: number;
  currentStep: ChallengeStep | null;
  instruction: string;
  movementProgress: MovementProgress;
  poseState: HeadPoseValidationState;
  blinkState: BlinkTrackerState; // Retained for backward-compatibility in diagnostics
  startedAt: number;
  timeRemainingSec: number; // Retained for UI compatibility, 0 indicates no timeout
  attemptNonce: string;
  evidence?: LivenessEvidence | undefined;
  failureReason?: string | undefined;
}

const SUPPORTED_DIRECTIONS: HeadDirection[] = ["left", "right", "up", "down"];

function generateNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `NONCE-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

/**
 * Generate a sequence of 3 randomized directional movements without consecutive duplicates.
 */
export function generateRandomDirectionSequence(count: number = 3): HeadDirection[] {
  const sequence: HeadDirection[] = [];
  let lastDir: HeadDirection | null = null;

  for (let i = 0; i < count; i++) {
    const available = SUPPORTED_DIRECTIONS.filter((d) => d !== lastDir);
    const chosen = available[Math.floor(Math.random() * available.length)]!;
    sequence.push(chosen);
    lastDir = chosen;
  }

  return sequence;
}

function getDirectionInstruction(direction: HeadDirection, movementNumber: number, total: number): string {
  switch (direction) {
    case "left":
      return `Movement ${movementNumber} of ${total}: Turn your head LEFT`;
    case "right":
      return `Movement ${movementNumber} of ${total}: Turn your head RIGHT`;
    case "up":
      return `Movement ${movementNumber} of ${total}: Tilt your head UP`;
    case "down":
      return `Movement ${movementNumber} of ${total}: Tilt your head DOWN`;
    case "center":
      return `Return your head to CENTER`;
  }
}

/**
 * Build interleaved challenge steps:
 * Movement 1 -> Return Center -> Movement 2 -> Return Center -> Movement 3
 */
export function generateRandomChallenge(): GeneratedChallenge {
  const nonce = generateNonce();
  const sequence = generateRandomDirectionSequence(3);
  const steps: ChallengeStep[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const dir = sequence[i]!;
    const movementIndex = i + 1;

    // Directional movement step
    steps.push({
      id: `step-${movementIndex}-move`,
      type: "pose",
      instruction: getDirectionInstruction(dir, movementIndex, sequence.length),
      targetDirection: dir,
      movementIndex,
      totalMovements: sequence.length,
      isReturnToCenter: false,
      completed: false,
    });

    // Return to center step (except after the final movement)
    if (i < sequence.length - 1) {
      steps.push({
        id: `step-${movementIndex}-center`,
        type: "pose",
        instruction: `Return your head to CENTER`,
        targetDirection: "center",
        movementIndex,
        totalMovements: sequence.length,
        isReturnToCenter: true,
        completed: false,
      });
    }
  }

  return {
    category: "head-movement",
    name: "Randomized 3-Direction Head Movement",
    nonce,
    steps,
    directionalSequence: sequence,
  };
}

/* ------------------------------------------------------------------ */
/*  Liveness Session Controller                                        */
/* ------------------------------------------------------------------ */

export class LivenessSession {
  private challenge: GeneratedChallenge;
  private currentStepIndex: number = 0;
  private status: LivenessStatus = "idle";
  private startedAt: number = 0;
  private failureReason: string | undefined = undefined;

  private poseDetector: TemporalHeadPoseDetector;
  private blinkDetector: TemporalBlinkDetector; // Retained for fallback telemetry

  // Neutral Baseline Calibration
  private baselineCalibrated: boolean = false;
  private baselineSamples: HeadPoseAngles[] = [];
  private calibratedBaseline: HeadPoseAngles = { yaw: 0, pitch: 0 };

  // Face Tracking & Anti-Spoof Telemetry
  private trackedFrames: number = 0;
  private faceLostFrames: number = 0;
  private lastBox: { x: number; y: number; width: number; height: number } | null = null;
  private lastTimestamp: number = 0;
  private earReadings: number[] = [];
  private yawReadings: number[] = [];
  private pitchReadings: number[] = [];
  private evidence: LivenessEvidence | undefined = undefined;

  constructor() {
    this.challenge = generateRandomChallenge();
    this.poseDetector = new TemporalHeadPoseDetector("center", 3);
    this.blinkDetector = new TemporalBlinkDetector(1);
  }

  /**
   * Set neutral head-pose baseline directly (e.g. from stable face tracking).
   */
  setNeutralBaseline(baseline: HeadPoseAngles): void {
    this.calibratedBaseline = {
      yaw: Number(baseline.yaw.toFixed(1)),
      pitch: Number(baseline.pitch.toFixed(1)),
    };
    this.baselineCalibrated = true;
    this.poseDetector.setBaseline(this.calibratedBaseline);
  }

  getNeutralBaseline(): HeadPoseAngles {
    return { ...this.calibratedBaseline };
  }

  /**
   * Start a fresh randomized head movement session.
   */
  start(): LivenessState {
    this.challenge = generateRandomChallenge();
    this.currentStepIndex = 0;
    this.status = "active";
    this.startedAt = Date.now();
    this.failureReason = undefined;
    this.trackedFrames = 0;
    this.faceLostFrames = 0;
    this.lastBox = null;
    this.lastTimestamp = 0;
    this.earReadings = [];
    this.yawReadings = [];
    this.pitchReadings = [];
    this.evidence = undefined;
    this.baselineSamples = [];

    this.configureDetectorForCurrentStep();
    return this.getState();
  }

  private configureDetectorForCurrentStep(): void {
    const current = this.challenge.steps[this.currentStepIndex];
    if (!current) return;

    // Directional movements require 3 frames; return-to-center requires 2 frames
    const reqFrames = current.targetDirection === "center" ? 2 : 3;
    this.poseDetector.reset(current.targetDirection, reqFrames);
  }

  /**
   * Process a single timestamped camera frame.
   *
   * @param landmarks 68 facial landmarks from detector
   * @param boundingBox Face bounding box in video coordinates
   * @param frameTimestamp Frame capture timestamp (ms)
   * @param faceCount Total faces detected in this camera frame (must be exactly 1)
   */
  processFrame(
    landmarks: faceapi.FaceLandmarks68 | null,
    boundingBox?: { x: number; y: number; width: number; height: number } | null,
    frameTimestamp?: number,
    faceCount: number = 1,
  ): LivenessState {
    if (this.status !== "active") {
      return this.getState();
    }

    const now = frameTimestamp || Date.now();

    // Check monotonic timestamps
    if (this.lastTimestamp > 0 && now < this.lastTimestamp) {
      return this.fail("Timestamp anomaly detected: Camera frame ordering violated.");
    }
    this.lastTimestamp = now;

    // 1. Multiple Faces Check
    if (faceCount > 1) {
      return this.fail(`Multiple faces detected (${faceCount}). Only one individual must be in view.`);
    }

    // 2. Lost Face Check
    if (!landmarks || !boundingBox || faceCount === 0) {
      this.faceLostFrames++;
      // Allow temporary landmark occlusion (e.g. sharp turn) up to 25 frames (~1 sec)
      if (this.faceLostFrames > 25) {
        return this.fail("Face tracking lost during liveness verification. Please keep your face centered.");
      }
      return this.getState();
    }

    this.faceLostFrames = 0;
    this.trackedFrames++;

    // 3. Stable Face Tracking Continuity Check (detects swapping phone/photo)
    if (this.lastBox) {
      const curCenterX = boundingBox.x + boundingBox.width / 2;
      const curCenterY = boundingBox.y + boundingBox.height / 2;
      const prevCenterX = this.lastBox.x + this.lastBox.width / 2;
      const prevCenterY = this.lastBox.y + this.lastBox.height / 2;

      const centerJump = Math.sqrt((curCenterX - prevCenterX) ** 2 + (curCenterY - prevCenterY) ** 2);
      const allowedJump = Math.max(boundingBox.width, boundingBox.height) * 0.45;

      if (centerJump > allowedJump) {
        return this.fail("Face tracking continuity violated: Sudden displacement or swapped subject detected.");
      }

      const scaleRatio = boundingBox.width / this.lastBox.width;
      if (scaleRatio > 2.2 || scaleRatio < 0.45) {
        return this.fail("Face scale anomaly detected during verification.");
      }
    }
    this.lastBox = boundingBox;

    // 4. Baseline Calibration if not pre-calibrated
    const poseInfo = estimateHeadPose(landmarks);
    if (!this.baselineCalibrated) {
      this.baselineSamples.push(poseInfo);
      if (this.baselineSamples.length >= 3) {
        const avgYaw = this.baselineSamples.reduce((acc, p) => acc + p.yaw, 0) / this.baselineSamples.length;
        const avgPitch = this.baselineSamples.reduce((acc, p) => acc + p.pitch, 0) / this.baselineSamples.length;
        this.setNeutralBaseline({ yaw: avgYaw, pitch: avgPitch });
      }
    }

    // Record physical biometric variances
    const earInfo = getDetailedEAR(landmarks);
    this.earReadings.push(earInfo.meanEAR);
    this.yawReadings.push(poseInfo.yaw);
    this.pitchReadings.push(poseInfo.pitch);

    // Check for frozen static photograph presentation attack (zero micro-movement across 10 frames)
    if (this.trackedFrames >= 10) {
      const recentYaw = this.yawReadings.slice(-10);
      const recentPitch = this.pitchReadings.slice(-10);
      const recentEar = this.earReadings.slice(-10);
      const yVar = this.computeVariance(recentYaw);
      const pVar = this.computeVariance(recentPitch);
      const eVar = this.computeVariance(recentEar);
      if (yVar < 0.00001 && pVar < 0.00001 && eVar < 0.00001) {
        return this.fail("Static photograph detected. Zero physiological micro-variance or 3D depth change observed.");
      }
    }

    // 5. Action Verification & Sequential Step Progression
    const currentStep = this.challenge.steps[this.currentStepIndex];
    if (!currentStep) {
      return this.evaluateCompletion();
    }

    const poseState = this.poseDetector.processFrame(landmarks);
    if (poseState.isSatisfied) {
      currentStep.completed = true;
      this.advanceToNextStep();
    }

    return this.getState();
  }

  private advanceToNextStep(): void {
    this.currentStepIndex++;
    if (this.currentStepIndex >= this.challenge.steps.length) {
      this.evaluateCompletion();
    } else {
      this.configureDetectorForCurrentStep();
    }
  }

  private evaluateCompletion(): LivenessState {
    // Check static photograph rejection across tracked frames:
    // A genuine human turning head 3 times will have significant yaw or pitch variance (> 1.0)
    if (this.trackedFrames >= 10) {
      const yawVariance = this.computeVariance(this.yawReadings);
      const pitchVariance = this.computeVariance(this.pitchReadings);

      if (yawVariance < 0.05 && pitchVariance < 0.05) {
        return this.fail("Static photograph detected. Zero physical head rotation or 3D depth variance observed.");
      }
    }

    const durationMs = Date.now() - this.startedAt;
    const earVariance = this.computeVariance(this.earReadings);
    const yawVariance = this.computeVariance(this.yawReadings);
    const pitchVariance = this.computeVariance(this.pitchReadings);

    this.evidence = {
      attemptNonce: this.challenge.nonce,
      challengeCategory: this.challenge.category,
      challengeName: this.challenge.name,
      stepsCompleted: this.challenge.steps.length,
      totalSteps: this.challenge.steps.length,
      framesTracked: this.trackedFrames,
      durationMs,
      earVariance,
      yawVariance,
      pitchVariance,
      timestamp: Date.now(),
      livenessPassed: true,
      directionalSequence: this.challenge.directionalSequence,
    };

    this.status = "passed";
    return this.getState();
  }

  fail(reason: string): LivenessState {
    this.status = "failed";
    this.failureReason = reason;
    return this.getState();
  }

  cancel(): void {
    this.status = "idle";
    this.failureReason = "Verification cancelled by user.";
  }

  getState(): LivenessState {
    const currentStep = this.challenge.steps[this.currentStepIndex] || null;

    let movementIndex = 1;
    let isReturnToCenter = false;
    let targetDirection: HeadDirection = "center";
    let instruction = "Preparing head movement challenge...";

    if (currentStep) {
      movementIndex = currentStep.movementIndex || 1;
      isReturnToCenter = Boolean(currentStep.isReturnToCenter);
      targetDirection = currentStep.targetDirection;
      instruction = currentStep.instruction;
    } else if (this.status === "passed") {
      instruction = "Head movements verified ✓ Checking presentation attacks...";
    } else if (this.status === "failed") {
      instruction = this.failureReason || "Head movement challenge failed. Please try again.";
    }

    const movementProgress: MovementProgress = {
      currentMovement: movementIndex,
      totalMovements: 3,
      isReturnToCenter,
      targetDirection,
      instruction,
    };

    return {
      status: this.status,
      category: this.challenge.category,
      challengeName: this.challenge.name,
      steps: this.challenge.steps,
      currentStepIndex: this.currentStepIndex,
      currentStep,
      instruction,
      movementProgress,
      poseState: this.poseDetector.getState(),
      blinkState: this.blinkDetector.getState(),
      startedAt: this.startedAt,
      timeRemainingSec: 0, // No countdown timeout
      attemptNonce: this.challenge.nonce,
      evidence: this.evidence,
      failureReason: this.failureReason,
    };
  }

  getEvidence(): LivenessEvidence | undefined {
    return this.evidence;
  }

  private computeVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const sumSquares = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return sumSquares / values.length;
  }
}
