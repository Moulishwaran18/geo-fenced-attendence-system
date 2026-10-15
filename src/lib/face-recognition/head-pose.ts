/**
 * Module: headPose
 *
 * Estimates 3D head pose (Yaw & Pitch) from 68-point facial landmarks.
 * Validates temporal movement for:
 * - Turn head LEFT
 * - Turn head RIGHT
 * - Tilt head UP
 * - Tilt head DOWN
 * - Return head to CENTER (neutral baseline)
 */

import type * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";

export type HeadDirection = "left" | "right" | "up" | "down" | "center";

export interface HeadPoseAngles {
  /** Yaw angle in degrees. Positive = physical left, Negative = physical right. */
  yaw: number;
  /** Pitch angle in degrees. Positive = looking up, Negative = looking down. */
  pitch: number;
}

export interface HeadPoseValidationState {
  currentAngles: HeadPoseAngles;
  baselineAngles: HeadPoseAngles;
  deltaAngles: HeadPoseAngles;
  targetDirection: HeadDirection;
  detectedDirection: HeadDirection | "none";
  consecutiveFramesSatisfied: number;
  requiredFrames: number;
  stabilityRatio: number;
  isSatisfied: boolean;
  thresholdDegrees: number;
}

/* ------------------------------------------------------------------ */
/*  Pose Estimation Calculations                                       */
/* ------------------------------------------------------------------ */

/**
 * Estimate head Yaw (horizontal turn) in degrees from 68-point landmarks.
 *
 * Camera coordinate system:
 * - Landmark 0: Subject's right edge (screen/image left)
 * - Landmark 16: Subject's left edge (screen/image right)
 * - Landmark 30: Nose tip
 *
 * Physical user turning LEFT -> Nose shifts towards subject's left edge (Point 16) -> positive yaw.
 * Physical user turning RIGHT -> Nose shifts towards subject's right edge (Point 0) -> negative yaw.
 */
export function estimateYawAngle(landmarks: faceapi.FaceLandmarks68): number {
  if (!landmarks?.positions || landmarks.positions.length < 68) return 0;
  const pts = landmarks.positions;
  const nose = pts[30];
  const leftEdge = pts[0];
  const rightEdge = pts[16];

  if (!nose || !leftEdge || !rightEdge) return 0;

  const faceCenterX = (leftEdge.x + rightEdge.x) / 2;
  const faceWidth = Math.abs(rightEdge.x - leftEdge.x);

  if (faceWidth === 0) return 0;

  const offset = (nose.x - faceCenterX) / (faceWidth / 2);
  // Scale to approximate angular degrees (-45° to +45° range)
  const deg = offset * 45;
  return Number(Math.max(-50, Math.min(50, deg)).toFixed(1));
}

/**
 * Estimate head Pitch (vertical tilt) in degrees from 68-point landmarks.
 *
 * Landmark geometry:
 * - Landmark 27: Top of nose bridge (between eyes).
 * - Landmark 30: Nose tip.
 * - Landmark 8: Chin bottom.
 *
 * Looking UP: distance from nose bridge (27) to nose tip (30) compresses vertically.
 * Looking DOWN: nose tip (30) moves closer to chin (8), upper nose lengthens.
 */
export function estimatePitchAngle(landmarks: faceapi.FaceLandmarks68): number {
  if (!landmarks?.positions || landmarks.positions.length < 68) return 0;
  const pts = landmarks.positions;
  const noseBridge = pts[27];
  const noseTip = pts[30];
  const chin = pts[8];

  if (!noseBridge || !noseTip || !chin) return 0;

  const upperLen = noseTip.y - noseBridge.y;
  const lowerLen = chin.y - noseTip.y;
  const totalHeight = chin.y - noseBridge.y;

  if (totalHeight === 0 || lowerLen === 0) return 0;

  // In neutral face, upperLen is roughly 36-39% of total height, lowerLen is 61-64%
  const ratio = upperLen / lowerLen;
  const neutralRatio = 0.58;

  // Normalized pitch: positive when looking up, negative when looking down
  const pitchEstimate = (neutralRatio - ratio) * 50;
  return Number(Math.max(-40, Math.min(40, pitchEstimate)).toFixed(1));
}

/**
 * Extract complete head pose angles from landmarks.
 */
export function estimateHeadPose(landmarks: faceapi.FaceLandmarks68): HeadPoseAngles {
  return {
    yaw: estimateYawAngle(landmarks),
    pitch: estimatePitchAngle(landmarks),
  };
}

/* ------------------------------------------------------------------ */
/*  Direction Validation                                               */
/* ------------------------------------------------------------------ */

export function classifyDirection(
  current: HeadPoseAngles,
  baseline: HeadPoseAngles = { yaw: 0, pitch: 0 },
): HeadDirection | "none" {
  const deltaYaw = current.yaw - baseline.yaw;
  const deltaPitch = current.pitch - baseline.pitch;

  const yawThreshold = FACE_CONFIG.LIVENESS.HEAD_TURN_ANGLE_DEG || 14.0;
  const pitchUpThreshold = FACE_CONFIG.LIVENESS.HEAD_PITCH_UP_DEG || 9.0;
  const pitchDownThreshold = FACE_CONFIG.LIVENESS.HEAD_PITCH_DOWN_DEG || -9.0;
  const centerYawThreshold = 7.0;
  const centerPitchThreshold = 6.0;

  if (deltaYaw >= yawThreshold) return "left";
  if (deltaYaw <= -yawThreshold) return "right";
  if (deltaPitch >= pitchUpThreshold) return "up";
  if (deltaPitch <= pitchDownThreshold) return "down";

  if (Math.abs(deltaYaw) <= centerYawThreshold && Math.abs(deltaPitch) <= centerPitchThreshold) {
    return "center";
  }

  return "none";
}

/**
 * Check whether current landmarks meet target direction relative to baseline.
 */
export function checkDirection(
  landmarks: faceapi.FaceLandmarks68,
  direction: HeadDirection,
  baseline: HeadPoseAngles = { yaw: 0, pitch: 0 },
): boolean {
  const current = estimateHeadPose(landmarks);
  const detected = classifyDirection(current, baseline);
  return detected === direction;
}

/* ------------------------------------------------------------------ */
/*  Temporal Pose Tracker                                              */
/* ------------------------------------------------------------------ */

export class TemporalHeadPoseDetector {
  private targetDirection: HeadDirection;
  private baselineAngles: HeadPoseAngles = { yaw: 0, pitch: 0 };
  private consecutiveFrames: number = 0;
  private requiredFrames: number = 3;
  private isSatisfied: boolean = false;
  private lastAngles: HeadPoseAngles = { yaw: 0, pitch: 0 };
  private detectedDirection: HeadDirection | "none" = "none";

  constructor(targetDirection: HeadDirection = "center", requiredFrames: number = 3) {
    this.targetDirection = targetDirection;
    this.requiredFrames = Math.max(2, requiredFrames);
  }

  /**
   * Calibrate neutral baseline pose.
   */
  setBaseline(baseline: HeadPoseAngles): void {
    this.baselineAngles = {
      yaw: Number(baseline.yaw.toFixed(1)),
      pitch: Number(baseline.pitch.toFixed(1)),
    };
  }

  getBaseline(): HeadPoseAngles {
    return { ...this.baselineAngles };
  }

  reset(targetDirection?: HeadDirection, requiredFrames?: number): void {
    if (targetDirection !== undefined) {
      this.targetDirection = targetDirection;
    }
    if (requiredFrames !== undefined) {
      this.requiredFrames = Math.max(2, requiredFrames);
    }
    this.consecutiveFrames = 0;
    this.isSatisfied = false;
  }

  processFrame(landmarks: faceapi.FaceLandmarks68): HeadPoseValidationState {
    this.lastAngles = estimateHeadPose(landmarks);
    this.detectedDirection = classifyDirection(this.lastAngles, this.baselineAngles);

    const matches = this.detectedDirection === this.targetDirection;

    if (matches) {
      this.consecutiveFrames++;
      if (this.consecutiveFrames >= this.requiredFrames) {
        this.isSatisfied = true;
      }
    } else {
      // Hysteresis: small decay rather than immediate reset to avoid single dropped frame penalty
      if (this.consecutiveFrames > 0) {
        this.consecutiveFrames = Math.max(0, this.consecutiveFrames - 1);
      }
    }

    const deltaAngles: HeadPoseAngles = {
      yaw: Number((this.lastAngles.yaw - this.baselineAngles.yaw).toFixed(1)),
      pitch: Number((this.lastAngles.pitch - this.baselineAngles.pitch).toFixed(1)),
    };

    let thresholdDegrees = 14.0;
    if (this.targetDirection === "up" || this.targetDirection === "down") {
      thresholdDegrees = 9.0;
    } else if (this.targetDirection === "center") {
      thresholdDegrees = 7.0;
    }

    const stabilityRatio = Math.min(1.0, this.consecutiveFrames / this.requiredFrames);

    return {
      currentAngles: this.lastAngles,
      baselineAngles: this.baselineAngles,
      deltaAngles,
      targetDirection: this.targetDirection,
      detectedDirection: this.detectedDirection,
      consecutiveFramesSatisfied: this.consecutiveFrames,
      requiredFrames: this.requiredFrames,
      stabilityRatio,
      isSatisfied: this.isSatisfied,
      thresholdDegrees,
    };
  }

  getState(): HeadPoseValidationState {
    const deltaAngles: HeadPoseAngles = {
      yaw: Number((this.lastAngles.yaw - this.baselineAngles.yaw).toFixed(1)),
      pitch: Number((this.lastAngles.pitch - this.baselineAngles.pitch).toFixed(1)),
    };

    let thresholdDegrees = 14.0;
    if (this.targetDirection === "up" || this.targetDirection === "down") {
      thresholdDegrees = 9.0;
    } else if (this.targetDirection === "center") {
      thresholdDegrees = 7.0;
    }

    const stabilityRatio = Math.min(1.0, this.consecutiveFrames / this.requiredFrames);

    return {
      currentAngles: this.lastAngles,
      baselineAngles: this.baselineAngles,
      deltaAngles,
      targetDirection: this.targetDirection,
      detectedDirection: this.detectedDirection,
      consecutiveFramesSatisfied: this.consecutiveFrames,
      requiredFrames: this.requiredFrames,
      stabilityRatio,
      isSatisfied: this.isSatisfied,
      thresholdDegrees,
    };
  }
}
