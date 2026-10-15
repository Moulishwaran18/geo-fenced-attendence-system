/**
 * Centralized face-recognition & multi-layer anti-spoofing configuration.
 *
 * Every security threshold and detection parameter is configured here
 * to support defense-in-depth across quality, Viola-Jones face detection,
 * temporal liveness, presentation attack detection, GAN classification, and closed-set matching.
 */

export const FACE_CONFIG = {
  /** Path to face-api.js pre-trained model weights (relative to public root). */
  MODELS_URL: "/models",
  ARCFACE_MODEL_URL: "/models/w600k_mbf.onnx",

  /** Feature Embedding Vector Dimension (InsightFace MobileFaceNet ArcFace). */
  EMBEDDING_DIMENSION: 512,

  /**
   * ArcFace Cosine Distance threshold for biometric matching:
   * - <= 0.45: SAME PERSON (Cosine Similarity >= 0.55)
   * - > 0.45: DIFFERENT / UNKNOWN PERSON
   */
  FACE_MATCH_THRESHOLD: 0.45,
  MATCH_THRESHOLD: 0.45,
  COSINE_DISTANCE_THRESHOLD: 0.45,

  /** Minimum margin between best match and second-best identity to prevent misidentification. */
  MIN_MATCH_MARGIN: 0.08,

  /** Minimum detection confidence for a face to be considered valid (prevents false hair/shadow detections). */
  MIN_FACE_CONFIDENCE: 0.50,

  /** Eye Aspect Ratio threshold for liveness blink detection. */
  LIVENESS_THRESHOLD: 0.235,

  /** Exactly 3 authorized staff profiles in this closed-set system. */
  MAX_STAFF_PROFILES: 3,

  /** Authorized identity IDs in the closed-set system. */
  AUTHORIZED_IDENTITIES: ["PERSON_001", "PERSON_002", "PERSON_003"] as const,

  /** Camera constraints for live WebRTC capture. */
  CAMERA: {
    facingMode: "user" as const,
    width: { ideal: 720 },
    height: { ideal: 720 },
  },

  /** Layer 1: Frame Quality Parameters */
  FRAME_QUALITY: {
    MIN_SHARPNESS: 10.0,
    MIN_BRIGHTNESS: 25,
    MAX_BRIGHTNESS: 235,
    MIN_CONFIDENCE: 0.25,
  },

  /** Layer 2: Viola–Jones Haar Cascade Detection Parameters */
  VIOLA_JONES: {
    SCALE_FACTOR: 1.25,
    MIN_SIZE: 40,
    MAX_SIZE: 400,
    STEP_SIZE: 4,
    MIN_NEIGHBORS: 1,
  },

  /** Layer 3 & 4: Temporal Liveness & Head Movement Tracking */
  LIVENESS: {
    EAR_BLINK_THRESHOLD: 0.235,
    EAR_OPEN_THRESHOLD: 0.26,
    BLINK_MIN_CLOSED_FRAMES: 1,
    BLINK_MAX_CLOSED_FRAMES: 15,
    DOUBLE_BLINK_MAX_INTERVAL_MS: 4000,
    HEAD_TURN_ANGLE_DEG: 14.0,
    HEAD_PITCH_UP_DEG: 9.0,
    HEAD_PITCH_DOWN_DEG: -9.0,
    POSE_CONSECUTIVE_FRAMES: 3,
    POSE_MOVEMENTS_COUNT: 1, // Simplified: 1 randomized directional head movement + return to center
    MIN_CHALLENGES: 1,
    MAX_CHALLENGES: 1,
    CHALLENGE_TIMEOUT_SEC: 0, // Disabled: no fixed 4s/8s timeout for head movements
    SESSION_TTL_SEC: 60,
  },

  /** Layer 5: Presentation Attack Detection (PAD) Heuristics & MiniFASNet */
  ANTI_SPOOF: {
    MINIFASNET_MODEL_URL: "/models/MiniFASNetV2.onnx",
    MIN_LIVE_SCORE: 0.70,
    MAX_SPOOF_RISK: 0.40,
    MOIRE_THRESHOLD: 0.45, // Calibrated from 0.35 to 0.45 to prevent camera sharpness/glasses from triggering false replay attack
    MAX_GLARE_RATIO: 0.22, // Calibrated from 0.08 to 0.22 (22%) to prevent natural skin shine / ambient light from triggering false rejection
    MIN_DYNAMIC_RANGE: 40.0,
    MIN_TEMPORAL_VARIANCE: 0.8,
    CROP_SCALE: 2.7,
    SAMPLE_FRAMES: 5,
  },

  /** Layer 6: GAN & Deepfake Artifact Classifier */
  DEEPFAKE: {
    MAX_DEEPFAKE_RISK: 0.45,
    UNCERTAIN_RISK_THRESHOLD: 0.35,
  },

  /** Path to staff reference photos in public directory. */
  STAFF_PHOTOS_DIR: "/staff-photos",
} as const;

export type FaceConfig = typeof FACE_CONFIG;
