/**
 * Module: liveness
 *
 * Orchestrates multi-signal temporal liveness verification with randomized challenges:
 * 1. Blink once
 * 2. Blink twice
 * 3. Turn left
 * 4. Turn right
 * 5. Look up
 * 6. Look down
 * 7. Blink then turn left
 * 8. Blink then turn right
 *
 * Uses `blinkDetection` and `headPose` temporal analyzers.
 */

import type * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";
import {
  TemporalBlinkDetector,
  type BlinkTrackerState,
} from "./blink-detection";
import {
  TemporalHeadPoseDetector,
  type HeadDirection,
  type HeadPoseValidationState,
} from "./head-pose";

/* ------------------------------------------------------------------ */
/*  Challenge Types & Definitions                                      */
/* ------------------------------------------------------------------ */

export type ChallengeCategory =
  | "blink-once"
  | "blink-twice"
  | "turn-left"
  | "turn-right"
  | "look-up"
  | "look-down"
  | "blink-then-turn-left"
  | "blink-then-turn-right";

export type StepType = "blink" | "pose";

export interface ChallengeStep {
  id: string;
  type: StepType;
  instruction: string;
  targetBlinks?: number | undefined;
  targetDirection?: HeadDirection | undefined;
  completed: boolean;
}

export interface GeneratedChallenge {
  category: ChallengeCategory;
  name: string;
  steps: ChallengeStep[];
}

export type LivenessStatus = "idle" | "active" | "passed" | "failed";

export interface LivenessState {
  status: LivenessStatus;
  category: ChallengeCategory;
  challengeName: string;
  steps: ChallengeStep[];
  currentStepIndex: number;
  currentStep: ChallengeStep | null;
  instruction: string;
  blinkState: BlinkTrackerState;
  poseState: HeadPoseValidationState;
  startedAt: number;
  timeRemainingSec: number;
  failureReason?: string | undefined;
}

const CHALLENGE_POOL: ChallengeCategory[] = [
  "blink-once",
  "blink-twice",
  "turn-left",
  "turn-right",
  "look-up",
  "look-down",
  "blink-then-turn-left",
  "blink-then-turn-right",
];

export function generateRandomChallenge(
  preferredCategory: ChallengeCategory = "blink-once",
): GeneratedChallenge {
  const category = preferredCategory;

  switch (category) {
    case "blink-once":
      return {
        category,
        name: "Aadhaar Face RD — Single Natural Eye Blink",
        steps: [
          {
            id: "s1",
            type: "blink",
            instruction: "Hold still & blink your eyes once to verify",
            targetBlinks: 1,
            completed: false,
          },
        ],
      };

    case "blink-twice":
      return {
        category,
        name: "Blink Twice",
        steps: [
          {
            id: "s1",
            type: "blink",
            instruction: "Please blink twice.",
            targetBlinks: 2,
            completed: false,
          },
        ],
      };

    case "turn-left":
      return {
        category,
        name: "Turn Left",
        steps: [
          {
            id: "s1",
            type: "pose",
            instruction: "Please turn your head slightly left.",
            targetDirection: "left",
            completed: false,
          },
        ],
      };

    case "turn-right":
      return {
        category,
        name: "Turn Right",
        steps: [
          {
            id: "s1",
            type: "pose",
            instruction: "Please turn your head slightly right.",
            targetDirection: "right",
            completed: false,
          },
        ],
      };

    case "look-up":
      return {
        category,
        name: "Look Up",
        steps: [
          {
            id: "s1",
            type: "pose",
            instruction: "Please look slightly up.",
            targetDirection: "up",
            completed: false,
          },
        ],
      };

    case "look-down":
      return {
        category,
        name: "Look Down",
        steps: [
          {
            id: "s1",
            type: "pose",
            instruction: "Please look slightly down.",
            targetDirection: "down",
            completed: false,
          },
        ],
      };

    case "blink-then-turn-left":
      return {
        category,
        name: "Blink then Turn Left",
        steps: [
          {
            id: "s1",
            type: "blink",
            instruction: "Step 1/2: Please blink once.",
            targetBlinks: 1,
            completed: false,
          },
          {
            id: "s2",
            type: "pose",
            instruction: "Step 2/2: Please turn your head slightly left.",
            targetDirection: "left",
            completed: false,
          },
        ],
      };

    case "blink-then-turn-right":
      return {
        category,
        name: "Blink then Turn Right",
        steps: [
          {
            id: "s1",
            type: "blink",
            instruction: "Step 1/2: Please blink once.",
            targetBlinks: 1,
            completed: false,
          },
          {
            id: "s2",
            type: "pose",
            instruction: "Step 2/2: Please turn your head slightly right.",
            targetDirection: "right",
            completed: false,
          },
        ],
      };
  }
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

  private blinkDetector: TemporalBlinkDetector;
  private poseDetector: TemporalHeadPoseDetector;

  constructor() {
    this.challenge = generateRandomChallenge();
    this.blinkDetector = new TemporalBlinkDetector(1);
    this.poseDetector = new TemporalHeadPoseDetector("center");
  }

  /**
   * Start the liveness verification session (defaulting to 3s double blink).
   */
  start(preferredCategory?: ChallengeCategory): LivenessState {
    this.challenge = generateRandomChallenge(preferredCategory || "blink-once");
    this.currentStepIndex = 0;
    this.status = "active";
    this.startedAt = Date.now();
    this.failureReason = undefined;

    this.configureDetectorsForCurrentStep();
    return this.getState();
  }

  private configureDetectorsForCurrentStep(): void {
    const current = this.challenge.steps[this.currentStepIndex];
    if (!current) return;

    if (current.type === "blink") {
      this.blinkDetector.reset(current.targetBlinks ?? 1);
    } else if (current.type === "pose") {
      this.poseDetector.reset(current.targetDirection ?? "center");
    }
  }

  /**
   * Process a live frame landmarks.
   */
  processFrame(landmarks: faceapi.FaceLandmarks68): LivenessState {
    if (this.status !== "active") {
      return this.getState();
    }

    // Check session timeout
    const elapsedSec = (Date.now() - this.startedAt) / 1000;
    if (elapsedSec > FACE_CONFIG.LIVENESS.CHALLENGE_TIMEOUT_SEC) {
      this.status = "failed";
      this.failureReason = "Liveness verification timed out. Please follow the instructions promptly.";
      return this.getState();
    }

    const currentStep = this.challenge.steps[this.currentStepIndex];
    if (!currentStep) {
      this.status = "passed";
      return this.getState();
    }

    // Process respective detector
    if (currentStep.type === "blink") {
      const blinkState = this.blinkDetector.processFrame(landmarks);
      if (blinkState.isComplete) {
        currentStep.completed = true;
        this.advanceToNextStep();
      }
    } else if (currentStep.type === "pose") {
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
      // All steps passed!
      this.status = "passed";
    } else {
      // Setup next step
      this.configureDetectorsForCurrentStep();
    }
  }

  /**
   * Force fail the session (e.g. if face lost for too long or multiple faces detected).
   */
  fail(reason: string = "Liveness verification failed."): LivenessState {
    this.status = "failed";
    this.failureReason = reason;
    return this.getState();
  }

  /**
   * Get current state snapshot.
   */
  getState(): LivenessState {
    const elapsedSec = this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    const timeRemainingSec = Math.max(
      0,
      Math.ceil(FACE_CONFIG.LIVENESS.CHALLENGE_TIMEOUT_SEC - elapsedSec),
    );

    const currentStep = this.challenge.steps[this.currentStepIndex] ?? null;
    const instruction =
      this.status === "passed"
        ? "Live person verified."
        : this.status === "failed"
          ? (this.failureReason ?? "Liveness verification failed.")
          : (currentStep?.instruction ?? "Verifying liveness...");

    return {
      status: this.status,
      category: this.challenge.category,
      challengeName: this.challenge.name,
      steps: this.challenge.steps,
      currentStepIndex: this.currentStepIndex,
      currentStep,
      instruction,
      blinkState: this.blinkDetector.getState(),
      poseState: this.poseDetector.getState(),
      startedAt: this.startedAt,
      timeRemainingSec,
      failureReason: this.failureReason,
    };
  }
}
