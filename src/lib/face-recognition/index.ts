/**
 * Face Recognition, Real-Time Liveness & Multi-Layer Anti-Spoofing Layer — Barrel Export.
 *
 * Modular Architecture:
 * - Module 1: `frameQuality` (`frame-quality.ts`)
 * - Module 2: `violaJones` (`viola-jones.ts`) & `faceDetection` (`face-detection.ts`)
 * - Module 3: `blinkDetection` (`blink-detection.ts`)
 * - Module 4: `headPose` (`head-pose.ts`)
 * - Module 5: `livenessEngine` (`liveness-engine.ts`)
 * - Module 6: `antiSpoofService` (`anti-spoof-service.ts`)
 * - Module 7: `deepfakeDetection` (`deepfake-detection.ts`)
 * - Module 8: `faceMatching` (`face-matching.ts`)
 * - Module 9: `verificationSession` (`verification-session.ts`)
 * - Module 10: `staffStore` (`staff-store.ts`)
 */

// Configuration
export { FACE_CONFIG } from "./face-config";
export type { FaceConfig } from "./face-config";

// Module 1: frameQuality
export { evaluateFrameQuality } from "./frame-quality";
export type { FrameQualityResult } from "./frame-quality";

// Module 2: violaJones & faceDetection
export { detectFacesViolaJones, IntegralImage } from "./viola-jones";
export type { ViolaJonesBox } from "./viola-jones";
export {
  loadModels,
  areModelsLoaded,
  detectFaces,
  detectSingleFace,
  validateSingleFacePresence,
  generateEmbedding,
  drawFaceBox,
} from "./face-detection";
export type { DetectedFace, FaceCountValidation } from "./face-detection";

// Module 3: blinkDetection
export {
  computeEyeAspectRatio,
  getAverageEAR,
  TemporalBlinkDetector,
} from "./blink-detection";
export type { BlinkPhase, BlinkTrackerState } from "./blink-detection";

// Module 4: headPose
export {
  estimateYawAngle,
  estimatePitchAngle,
  estimateHeadPose,
  checkDirection,
  TemporalHeadPoseDetector,
} from "./head-pose";
export type {
  HeadDirection,
  HeadPoseAngles,
  HeadPoseValidationState,
} from "./head-pose";

// Module 5: liveness
export {
  generateRandomChallenge,
  LivenessSession,
} from "./liveness-engine";
export type {
  ChallengeCategory,
  StepType,
  ChallengeStep,
  GeneratedChallenge,
  LivenessStatus,
  LivenessState,
} from "./liveness-engine";

// Module 6: antiSpoofService
export { AntiSpoofService } from "./anti-spoof-service";
export type { PresentationAttackAnalysis } from "./anti-spoof-service";

// Module 7: deepfakeDetection
export { DeepfakeDetectionService } from "./deepfake-detection";
export type {
  DeepfakeClassification,
  DeepfakeAnalysisResult,
} from "./deepfake-detection";

// Module 8: faceMatching
export {
  compareFaces,
  findBestMatch,
  evaluateAllIdentities,
} from "./face-matching";
export type { MatchResult, IdentityMatchEvaluation } from "./face-matching";

// Module 9: verificationSession
export {
  createVerificationSession,
  isSessionActive,
  submitFaceVerification,
  buildVerificationPayload,
} from "./verification-session";
export type {
  VerificationSession,
  VerificationPayload,
  VerificationResult,
} from "./verification-session";

// Module 10: Staff Store & Scalable Face Verification
export {
  fetchAllStaff,
  createNewStaff,
  toggleStaffStatus,
  enrollStaffFace,
  deleteStaffEmbedding,
  verifyLiveFace,
  getEnrolledStaff,
  getAllProfiles,
  isEnrolled,
  enrolledCount,
  clearAllProfiles,
} from "./staff-store";
export type { StaffProfile, ReferenceSample, VerifyFaceResponse } from "./staff-store";

// Module 11: ArcFace 512-D Neural Recognition Engine
export {
  ARCFACE_CONFIG,
  initArcFaceSession,
  isArcFaceLoaded,
  alignFaceToTensor,
  generateArcFaceEmbedding,
  calculateCosineSimilarity,
  calculateCosineDistance,
  estimateSimilarityTransform,
  extract5Landmarks,
} from "./arcface-engine";

