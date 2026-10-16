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

export type StepType = "pose" | "blink" | "nod";

export type LivenessAction = "BLINK_ONCE" | "TURN_LEFT" | "TURN_RIGHT" | "NOD_ONCE";

export const SUPPORTED_LIVENESS_ACTIONS: LivenessAction[] = [
  "BLINK_ONCE",
  "TURN_LEFT",
  "TURN_RIGHT",
  "NOD_ONCE",
];

export function getActionInstruction(action: LivenessAction): string {
  switch (action) {
    case "BLINK_ONCE":
      return "Face matched. Please blink once.";
    case "TURN_LEFT":
      return "Face matched. Please turn your head slightly to the left.";
    case "TURN_RIGHT":
      return "Face matched. Please turn your head slightly to the right.";
    case "NOD_ONCE":
      return "Face matched. Please nod once.";
  }
}

export interface ChallengeStep {
  id: string;
  type: StepType;
  instruction: string;
  targetDirection: HeadDirection;
  movementIndex?: number | undefined; // 1, 2, 3
  totalMovements?: number | undefined; // 3
  isReturnToCenter?: boolean | undefined;
  completed: boolean;
  targetBlinks?: number | undefined;
}

export interface GeneratedChallenge {
  category: ChallengeCategory;
  name: string;
  steps: ChallengeStep[];
  nonce: string;
  directionalSequence: HeadDirection[];
  selectedAction?: LivenessAction | undefined;
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
  pitchVariance?: number | undefined;
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
  timeRemainingSec: number; // 10s countdown window
  attemptNonce: string;
  selectedAction?: LivenessAction | undefined;
  retriesRemaining?: number | undefined;
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
 * Build single randomized movement challenge:
 * Movement 1 (e.g. Left/Right/Up/Down) -> Return to Center
 */
export function generateRandomChallenge(specifiedDirection?: HeadDirection): GeneratedChallenge {
  const nonce = generateNonce();
  const validDirections: HeadDirection[] = ["left", "right", "up", "down"];
  const target =
    specifiedDirection && validDirections.includes(specifiedDirection)
      ? specifiedDirection
      : validDirections[Math.floor(Math.random() * validDirections.length)]!;

  let moveInstruction = "";
  switch (target) {
    case "left":
      moveInstruction = "Turn your head LEFT, then return to center";
      break;
    case "right":
      moveInstruction = "Turn your head RIGHT, then return to center";
      break;
    case "up":
      moveInstruction = "Tilt your head UP, then return to center";
      break;
    case "down":
      moveInstruction = "Tilt your head DOWN, then return to center";
      break;
    default:
      moveInstruction = "Turn your head LEFT, then return to center";
      break;
  }

  const steps: ChallengeStep[] = [
    {
      id: "step-1-move",
      type: "pose",
      instruction: moveInstruction,
      targetDirection: target,
      movementIndex: 1,
      totalMovements: 1,
      isReturnToCenter: false,
      completed: false,
    },
    {
      id: "step-2-center",
      type: "pose",
      instruction: "Now return your head to CENTER",
      targetDirection: "center",
      movementIndex: 1,
      totalMovements: 1,
      isReturnToCenter: true,
      completed: false,
    },
  ];

  return {
    category: "head-movement",
    name: `Randomized Head Movement (${target.toUpperCase()})`,
    nonce,
    steps,
    directionalSequence: [target],
  };
}

/**
 * Generate a single random liveness action from the 4 supported actions:
 * BLINK_ONCE, TURN_LEFT, TURN_RIGHT, NOD_ONCE.
 */
export function generateSingleActionChallenge(
  specifiedAction?: LivenessAction,
  customNonce?: string
): GeneratedChallenge {
  const nonce = customNonce || generateNonce();
  const action: LivenessAction =
    specifiedAction && SUPPORTED_LIVENESS_ACTIONS.includes(specifiedAction)
      ? specifiedAction
      : SUPPORTED_LIVENESS_ACTIONS[Math.floor(Math.random() * SUPPORTED_LIVENESS_ACTIONS.length)]!;

  let category: ChallengeCategory = "head-movement";
  let stepType: StepType = "pose";
  let targetDirection: HeadDirection = "center";
  let name = "";

  switch (action) {
    case "BLINK_ONCE":
      category = "blink-once";
      stepType = "blink";
      targetDirection = "center";
      name = "Single Blink Challenge";
      break;
    case "TURN_LEFT":
      category = "turn-left";
      stepType = "pose";
      targetDirection = "left";
      name = "Turn Left Challenge";
      break;
    case "TURN_RIGHT":
      category = "turn-right";
      stepType = "pose";
      targetDirection = "right";
      name = "Turn Right Challenge";
      break;
    case "NOD_ONCE":
      category = "look-down";
      stepType = "nod";
      targetDirection = "down";
      name = "Head Nod Challenge";
      break;
  }

  const instruction = getActionInstruction(action);
  const steps: ChallengeStep[] = [
    {
      id: `step-${action.toLowerCase()}`,
      type: stepType,
      instruction,
      targetDirection,
      movementIndex: 1,
      totalMovements: 1,
      completed: false,
      targetBlinks: action === "BLINK_ONCE" ? 1 : undefined,
    },
  ];

  return {
    category,
    name,
    steps,
    nonce,
    directionalSequence: [targetDirection],
    selectedAction: action,
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
  private multiFaceFrames: number = 0;
  private lastBox: { x: number; y: number; width: number; height: number } | null = null;
  private lastTimestamp: number = 0;
  private earReadings: number[] = [];
  private yawReadings: number[] = [];
  private pitchReadings: number[] = [];
  private evidence: LivenessEvidence | undefined = undefined;

  // Single Action Challenge State
  private selectedAction: LivenessAction | null = null;
  private consecutiveSatisfiedFrames: number = 0;
  private nodDownObserved: boolean = false;
  private retryCount: number = 0;
  private timeoutMs: number = 0;

  constructor() {
    this.challenge = generateSingleActionChallenge();
    this.selectedAction = this.challenge.selectedAction || null;
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
   * Start a fresh randomized head movement or single action session.
   */
  start(
    actionOrCategory?: LivenessAction | ChallengeCategory | HeadDirection,
    customTimeoutMs?: number,
  ): LivenessState {
    if (actionOrCategory) {
      if (SUPPORTED_LIVENESS_ACTIONS.includes(actionOrCategory as LivenessAction)) {
        this.challenge = generateSingleActionChallenge(actionOrCategory as LivenessAction);
        this.selectedAction = actionOrCategory as LivenessAction;
        this.timeoutMs = customTimeoutMs ?? 10000;
      } else if (actionOrCategory === "blink-once") {
        this.challenge = generateSingleActionChallenge("BLINK_ONCE");
        this.selectedAction = "BLINK_ONCE";
        this.timeoutMs = customTimeoutMs ?? 8000;
      } else if (actionOrCategory === "turn-left" || actionOrCategory === "left") {
        this.challenge = generateSingleActionChallenge("TURN_LEFT");
        this.selectedAction = "TURN_LEFT";
        this.timeoutMs = customTimeoutMs ?? 8000;
      } else if (actionOrCategory === "turn-right" || actionOrCategory === "right") {
        this.challenge = generateSingleActionChallenge("TURN_RIGHT");
        this.selectedAction = "TURN_RIGHT";
        this.timeoutMs = customTimeoutMs ?? 8000;
      } else if (actionOrCategory === "look-down" || actionOrCategory === "down") {
        this.challenge = generateSingleActionChallenge("NOD_ONCE");
        this.selectedAction = "NOD_ONCE";
        this.timeoutMs = customTimeoutMs ?? 8000;
      } else {
        this.challenge = generateRandomChallenge(actionOrCategory as any);
        this.selectedAction = null;
        this.timeoutMs = customTimeoutMs ?? 0;
      }
    } else {
      this.challenge = generateRandomChallenge();
      this.selectedAction = null;
      this.timeoutMs = 0;
    }

    this.currentStepIndex = 0;
    this.status = "active";
    this.startedAt = Date.now();
    this.failureReason = undefined;
    this.trackedFrames = 0;
    this.faceLostFrames = 0;
    this.multiFaceFrames = 0;
    this.consecutiveSatisfiedFrames = 0;
    this.nodDownObserved = false;
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

    if (current.type === "blink") {
      this.blinkDetector.reset(current.targetBlinks ?? 1);
    } else {
      // Directional movements require 3 frames (or 2 if baseline calibrated); return-to-center requires 2 frames
      const reqFrames = current.targetDirection === "center" ? 2 : 3;
      this.poseDetector.reset(current.targetDirection, reqFrames);
    }
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

    // Check session timeout if active
    if (this.timeoutMs > 0 && this.startedAt > 0) {
      const elapsed = now - this.startedAt;
      if (elapsed > this.timeoutMs) {
        return this.fail("Liveness verification timed out. Please follow the instructions promptly.");
      }
    }

    // 1. Multiple Faces Check
    if (faceCount > 1) {
      this.multiFaceFrames++;
      const maxMultiFrames =
        this.challenge.category === "blink-once" || this.selectedAction === "BLINK_ONCE" ? 1 : 4;
      if (this.multiFaceFrames >= maxMultiFrames) {
        return this.fail(`Multiple faces detected (${faceCount}). Only one individual must be in view.`);
      }
      return this.getState(); // transient noise: do not fail immediately on 1 frame
    } else {
      this.multiFaceFrames = 0;
    }

    // 2. Lost Face Check (tolerate transient loss up to 6 or 25 frames)
    if (!landmarks || !boundingBox || faceCount === 0) {
      this.faceLostFrames++;
      const maxAllowedLostFrames =
        this.challenge.category === "blink-once" || this.selectedAction === "BLINK_ONCE" ? 6 : 25;
      if (this.faceLostFrames > maxAllowedLostFrames) {
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

    if (currentStep.type === "blink") {
      const bState = this.blinkDetector.processFrame(landmarks, now);
      if (bState.isComplete) {
        currentStep.completed = true;
        this.advanceToNextStep();
      }
    } else if (currentStep.type === "nod") {
      const deltaPitch = poseInfo.pitch - this.calibratedBaseline.pitch;
      if (deltaPitch <= -7.0) {
        this.nodDownObserved = true;
      }
      if (this.nodDownObserved && deltaPitch >= -4.0) {
        this.consecutiveSatisfiedFrames++;
        if (this.consecutiveSatisfiedFrames >= 2) {
          currentStep.completed = true;
          this.advanceToNextStep();
        }
      } else {
        const pState = this.poseDetector.processFrame(landmarks);
        if (pState.isSatisfied) {
          currentStep.completed = true;
          this.advanceToNextStep();
        }
      }
    } else {
      const poseState = this.poseDetector.processFrame(landmarks);
      if (poseState.isSatisfied) {
        currentStep.completed = true;
        this.advanceToNextStep();
      }
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
    // Check static photograph rejection across tracked frames
    if (this.trackedFrames >= 5) {
      const earVariance = this.computeVariance(this.earReadings);
      const yawVariance = this.computeVariance(this.yawReadings);
      const pitchVariance = this.computeVariance(this.pitchReadings);

      const isBlinkStep =
        this.challenge.category === "blink-once" || this.selectedAction === "BLINK_ONCE";
      if (isBlinkStep) {
        if (earVariance < 0.0005 && yawVariance < 0.001) {
          return this.fail("Static photograph detected. Zero physical eye blink or micro-variance observed.");
        }
      } else {
        if (yawVariance < 0.01 && pitchVariance < 0.01) {
          return this.fail("Static photograph detected. Zero physical head rotation or 3D depth variance observed.");
        }
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
    let instruction = "Preparing liveness challenge...";

    if (currentStep) {
      movementIndex = currentStep.movementIndex || 1;
      isReturnToCenter = Boolean(currentStep.isReturnToCenter);
      targetDirection = currentStep.targetDirection;
      instruction = currentStep.instruction;
    } else if (this.status === "passed") {
      instruction = "Liveness verified ✓ Live person confirmed.";
    } else if (this.status === "failed") {
      instruction = this.failureReason || "Liveness challenge failed. Please try again.";
    }

    const movementProgress: MovementProgress = {
      currentMovement: movementIndex,
      totalMovements: this.challenge.directionalSequence.length || 1,
      isReturnToCenter,
      targetDirection,
      instruction,
    };

    let timeRemainingSec = 10;
    if (this.timeoutMs > 0 && this.startedAt > 0) {
      const elapsedSec = (Date.now() - this.startedAt) / 1000;
      timeRemainingSec = Math.max(0, Math.ceil(this.timeoutMs / 1000 - elapsedSec));
    }

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
      timeRemainingSec,
      attemptNonce: this.challenge.nonce,
      selectedAction: this.selectedAction || undefined,
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
