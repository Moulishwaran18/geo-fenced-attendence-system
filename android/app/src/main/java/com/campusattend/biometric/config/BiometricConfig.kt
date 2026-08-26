package com.campusattend.biometric.config

/**
 * Centralized biometric configuration for the on-device face verification pipeline.
 *
 * All thresholds are configurable and must be calibrated using actual enrollment
 * and test samples before production use. Do NOT use default values blindly.
 *
 * Ported from: src/lib/face-recognition/face-config.ts
 */
object BiometricConfig {

    // ── Development / Testing Bypass Flags ──

    /**
     * Development Mode flag to bypass liveness and anti-spoof checks during
     * face detection, face embedding, and database matching testing.
     *
     * Set to true to bypass liveness.
     * Set to false for standard production liveness + anti-spoof security.
     */
    @Volatile
    var DEV_MODE_BYPASS_LIVENESS = true

    // ── Face Recognition (ArcFace MobileFaceNet w600k_mbf.onnx) ──

    /** Model file in assets/ */
    const val ARCFACE_MODEL_PATH = "w600k_mbf.onnx"

    /** Output embedding dimension. */
    const val EMBEDDING_DIMENSION = 512

    /** Input image size (square). */
    const val ARCFACE_INPUT_SIZE = 112

    /**
     * ArcFace Cosine Distance threshold for biometric matching.
     * - distance <= threshold: SAME PERSON
     * - distance >  threshold: DIFFERENT / UNKNOWN
     *
     * MUST be calibrated using genuine/impostor distance distributions.
     * Initial value from existing web system, subject to recalibration.
     */
    @Volatile
    var FACE_MATCH_THRESHOLD = 0.45f

    /**
     * Minimum separation margin between best match and second-best match
     * from a different identity. Prevents misidentification when two
     * people have similar face geometry.
     */
    @Volatile
    var MIN_MATCH_MARGIN = 0.08f

    // ── Anti-Spoof (MiniFASNet V2 / V1SE) ──

    /** Primary anti-spoof model. */
    const val ANTI_SPOOF_MODEL_V2_PATH = "MiniFASNetV2.onnx"

    /** Secondary anti-spoof model (optional, for devices with headroom). */
    const val ANTI_SPOOF_MODEL_V1SE_PATH = "MiniFASNetV1SE.onnx"

    /** Anti-spoof input image size (square). */
    const val ANTI_SPOOF_INPUT_SIZE = 80

    /**
     * Scale factor for face crop before anti-spoof inference.
     * The face bounding box is expanded by this factor centered on the face.
     * The official Silent-Face-Anti-Spoofing uses 2.7x.
     */
    const val ANTI_SPOOF_CROP_SCALE = 2.7f

    /**
     * Minimum "live" confidence score from MiniFASNet to pass anti-spoof.
     * Output index 0 is typically the "live" class.
     */
    @Volatile
    var ANTI_SPOOF_THRESHOLD = 0.80f

    /** Number of frames to sample for anti-spoof during verification. */
    const val ANTI_SPOOF_SAMPLE_COUNT = 5

    /** Whether to load and use the secondary V1SE model. */
    @Volatile
    var USE_DUAL_ANTI_SPOOF = false

    // ── Face Detection (MediaPipe) ──

    /** Minimum confidence for face detection. */
    const val MIN_FACE_DETECTION_CONFIDENCE = 0.5f

    /** Minimum confidence for face landmark tracking. */
    const val MIN_FACE_LANDMARK_CONFIDENCE = 0.5f

    /** Minimum confidence for face landmark presence. */
    const val MIN_FACE_PRESENCE_CONFIDENCE = 0.5f

    // ── Liveness: Blink Detection ──

    /**
     * Eye Aspect Ratio closure threshold (relative to baseline).
     * Eyes are considered closed when EAR drops below
     * min(baseline * 0.80, this absolute value).
     */
    @Volatile
    var BLINK_CLOSED_THRESHOLD = 0.235f

    /** Minimum frames eyes must stay closed to count as one blink. */
    @Volatile
    var BLINK_MIN_CLOSED_FRAMES = 1

    /** Maximum duration (ms) for a single blink to be valid. */
    @Volatile
    var BLINK_MAX_DURATION_MS = 800L

    /** Maximum interval (ms) between first and second blink for double-blink. */
    const val DOUBLE_BLINK_MAX_INTERVAL_MS = 3000L

    // ── Liveness: Head Pose ──

    /** Minimum yaw angle (degrees) to consider head turned left/right. */
    const val HEAD_TURN_ANGLE_DEG = 7.5f

    /** Minimum pitch angle (degrees) to consider head tilted up. */
    const val HEAD_PITCH_UP_DEG = 6.0f

    /** Pitch angle threshold for looking down (negative value). */
    const val HEAD_PITCH_DOWN_DEG = -6.0f

    /** Consecutive frames the head must hold the target pose. */
    const val POSE_CONSECUTIVE_FRAMES = 2

    // ── Liveness: Session ──

    /** Time limit (ms) for each challenge step before timeout failure. */
    @Volatile
    var CHALLENGE_TIMEOUT_MS = 8000L

    /** Overall session time limit (ms). */
    @Volatile
    var SESSION_TTL_MS = 30000L

    // ── Camera ──

    /** Minimum interval (ms) between processing consecutive camera frames. */
    const val ANALYSIS_INTERVAL_MS = 100L

    /** Camera resolution width preference. */
    const val CAMERA_WIDTH = 720

    /** Camera resolution height preference. */
    const val CAMERA_HEIGHT = 720

    // ── Quality ──

    /** Minimum face detection confidence to proceed with enrollment. */
    const val MIN_ENROLLMENT_CONFIDENCE = 0.6f

    // ── Staff ──

    /** Authorized test identity IDs. */
    val AUTHORIZED_IDENTITIES = listOf("PERSON_001", "PERSON_002", "PERSON_003")
}
