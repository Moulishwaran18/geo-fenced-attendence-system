package com.campusattend.biometric.verification

/**
 * Final biometric verification result.
 *
 * The attendance module will consume this result later.
 * The attendance decision is NOT made here.
 *
 * `verified` is true ONLY when ALL conditions are met:
 * - exactlyOneFace
 * - livenessPassed
 * - antiSpoofPassed
 * - matchPassed
 * - matchMarginPassed
 */
data class BiometricResult(
    /** Whether the complete biometric verification passed all gates. */
    val verified: Boolean,

    /** Matched staff ID, or null if unknown. */
    val staffId: String?,

    /** Matched staff name, or null if unknown. */
    val staffName: String?,

    /** Whether the active liveness challenge was completed. */
    val livenessPassed: Boolean,

    /** Whether passive anti-spoof (MiniFASNet) passed. */
    val antiSpoofPassed: Boolean,

    /** Whether face matching found a valid enrolled identity. */
    val matchPassed: Boolean,

    /** Cosine distance to best match (lower = more similar). */
    val matchDistance: Float,

    /** Margin between best and second-best match. */
    val matchMargin: Float?,

    /** Anti-spoof live score (developer mode only). */
    val antiSpoofScore: Float = 0f,

    /** Number of anti-spoof frames analyzed. */
    val antiSpoofFrameCount: Int = 0,

    /** Challenge category that was used. */
    val challengeCategory: String = "",

    /** Total verification latency in milliseconds. */
    val totalLatencyMs: Long = 0,

    /** Detailed rejection reason, if any. */
    val rejectionReason: String? = null
)
