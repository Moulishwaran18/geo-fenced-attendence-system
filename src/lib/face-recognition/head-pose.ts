/**
 * Module: headPose
 *
 * Estimates 3D head pose (Yaw & Pitch) from 68-point facial landmarks.
 * Validates temporal movement for:
 * - Turn left
 * - Turn right
 * - Look up
 * - Look down
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
  targetDirection: HeadDirection;
  consecutiveFramesSatisfied: number;
  isSatisfied: boolean;
}

/* ------------------------------------------------------------------ */
/*  Pose Estimation Calculations                                       */
/* ------------------------------------------------------------------ */

/**
 * Estimate head Yaw (horizontal turn) in degrees from 68-point landmarks.
 *
 * Camera coordinate system (un-mirrored input stream):
 * - User turning physical LEFT -> nose points to camera's right -> positive yaw.
 * - User turning physical RIGHT -> nose points to camera's left -> negative yaw.
 */
export function estimateYawAngle(landmarks: faceapi.FaceLandmarks68): number {
  const pts = landmarks.positions;
  const nose = pts[30];
  const leftEdge = pts[0];
  const rightEdge = pts[16];

  if (!nose || !leftEdge || !rightEdge) return 0;

  const faceCenterX = (leftEdge.x + rightEdge.x) / 2;
  const faceWidth = Math.abs(rightEdge.x - leftEdge.x);

  if (faceWidth === 0) return 0;

  const offset = (nose.x - faceCenterX) / (faceWidth / 2);
  // Scale to approximate angular degrees (-45° to +45°)
  return offset * 45;
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
 * Looking DOWN: nose tip (30) moves closer to chin (8).
 */
export function estimatePitchAngle(landmarks: faceapi.FaceLandmarks68): number {
  const pts = landmarks.positions;
  const noseBridge = pts[27];
  const noseTip = pts[30];
  const chin = pts[8];

  if (!noseBridge || !noseTip || !chin) return 0;

  const upperLen = noseTip.y - noseBridge.y;
  const lowerLen = chin.y - noseTip.y;
  const totalHeight = chin.y - noseBridge.y;

  if (totalHeight === 0) return 0;

  // In neutral face, upperLen is roughly 35-40% of total height, lowerLen is 60-65%
  // Ratio when neutral is approx ~0.60
  const ratio = upperLen / lowerLen;
  const neutralRatio = 0.58;

  // Normalized pitch: positive when looking up (upperLen shrinks, ratio drops),
  // negative when looking down (upperLen grows, ratio increases)
  const pitchEstimate = (neutralRatio - ratio) * 50;
  return pitchEstimate;
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

/**
 * Check whether the current landmarks meet the target direction threshold.
 */
export function checkDirection(
  landmarks: faceapi.FaceLandmarks68,
  direction: HeadDirection,
): boolean {
  const { yaw, pitch } = estimateHeadPose(landmarks);
  const yawThreshold = FACE_CONFIG.LIVENESS.HEAD_TURN_ANGLE_DEG;
  const pitchUpThreshold = FACE_CONFIG.LIVENESS.HEAD_PITCH_UP_DEG;
  const pitchDownThreshold = FACE_CONFIG.LIVENESS.HEAD_PITCH_DOWN_DEG;

  switch (direction) {
    case "left":
      return yaw > yawThreshold;
    case "right":
      return yaw < -yawThreshold;
    case "up":
      return pitch > pitchUpThreshold;
    case "down":
      return pitch < pitchDownThreshold;
    case "center":
      return Math.abs(yaw) < yawThreshold * 0.7 && Math.abs(pitch) < Math.abs(pitchUpThreshold) * 0.8;
  }
}

/* ------------------------------------------------------------------ */
/*  Temporal Pose Tracker                                              */
/* ------------------------------------------------------------------ */

export class TemporalHeadPoseDetector {
  private targetDirection: HeadDirection;
  private consecutiveFrames: number = 0;
  private isSatisfied: boolean = false;
  private lastAngles: HeadPoseAngles = { yaw: 0, pitch: 0 };

  constructor(targetDirection: HeadDirection = "center") {
    this.targetDirection = targetDirection;
  }

  reset(targetDirection?: HeadDirection): void {
    if (targetDirection !== undefined) {
      this.targetDirection = targetDirection;
    }
    this.consecutiveFrames = 0;
    this.isSatisfied = false;
    this.lastAngles = { yaw: 0, pitch: 0 };
  }

  processFrame(landmarks: faceapi.FaceLandmarks68): HeadPoseValidationState {
    this.lastAngles = estimateHeadPose(landmarks);
    const matchesDirection = checkDirection(landmarks, this.targetDirection);

    if (matchesDirection) {
      this.consecutiveFrames++;
      if (this.consecutiveFrames >= FACE_CONFIG.LIVENESS.POSE_CONSECUTIVE_FRAMES) {
        this.isSatisfied = true;
      }
    } else {
      this.consecutiveFrames = 0;
    }

    return {
      currentAngles: this.lastAngles,
      targetDirection: this.targetDirection,
      consecutiveFramesSatisfied: this.consecutiveFrames,
      isSatisfied: this.isSatisfied,
    };
  }

  getState(): HeadPoseValidationState {
    return {
      currentAngles: this.lastAngles,
      targetDirection: this.targetDirection,
      consecutiveFramesSatisfied: this.consecutiveFrames,
      isSatisfied: this.isSatisfied,
    };
  }
}
