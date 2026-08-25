package com.campusattend.biometric.liveness

import android.graphics.PointF
import com.campusattend.biometric.config.BiometricConfig
import kotlin.math.sqrt

/**
 * Temporal blink detector using Eye Aspect Ratio (EAR).
 *
 * Port of: src/lib/face-recognition/blink-detection.ts (TemporalBlinkDetector)
 *
 * Implements:
 * 1. Adaptive baseline tracking for individual eye shapes
 * 2. Dual-trigger closure (relative EAR drop + absolute threshold)
 * 3. Hysteresis state machine: AWAITING_OPEN → CLOSING → REOPENED
 * 4. Debounce interval between consecutive blinks
 *
 * A valid blink MUST follow: EYES OPEN → EYES CLOSING → EYES CLOSED → EYES OPEN
 * Single-frame closed eyes are NOT counted as a blink.
 */
class BlinkDetector(private var targetCount: Int = 1) {

    private var completedCount: Int = 0
    private var phase: BlinkPhase = BlinkPhase.AWAITING_OPEN
    private var closedFrames: Int = 0
    private var lastBlinkTime: Long? = null
    private var lastEAR: Float = 0.28f
    private var baselineEAR: Float = 0.28f
    private var initializedBaseline: Boolean = false

    /**
     * Reset the detector for a new session or retry.
     */
    fun reset(targetBlinks: Int? = null) {
        if (targetBlinks != null) targetCount = targetBlinks
        completedCount = 0
        phase = BlinkPhase.AWAITING_OPEN
        closedFrames = 0
        lastBlinkTime = null
        lastEAR = 0.28f
        baselineEAR = 0.28f
        initializedBaseline = false
    }

    /**
     * Process a single frame's eye landmarks.
     *
     * @param leftEye 6-point left eye contour
     * @param rightEye 6-point right eye contour
     * @return current blink tracking state
     */
    fun processFrame(leftEye: List<PointF>, rightEye: List<PointF>): BlinkTrackerState {
        val leftEAR = computeEAR(leftEye)
        val rightEAR = computeEAR(rightEye)
        val ear = (leftEAR + rightEAR) / 2f
        lastEAR = ear
        val now = System.currentTimeMillis()

        // 1. Adaptive baseline tracking
        if (!initializedBaseline) {
            baselineEAR = ear.coerceIn(0.24f, 0.38f)
            initializedBaseline = true
        } else if (phase == BlinkPhase.AWAITING_OPEN && ear > 0.22f) {
            // Slowly adapt baseline to normal open eyes (EMA)
            baselineEAR = baselineEAR * 0.9f + ear * 0.1f
        }

        // Relative and absolute closure thresholds
        val closureThreshold = minOf(baselineEAR * 0.80f, 0.245f)
        val reopenThreshold = maxOf(baselineEAR * 0.88f, 0.255f)

        val isClosed = ear < closureThreshold
        val isOpen = ear >= reopenThreshold

        // Debounce interval between consecutive blinks
        val timeSinceLastBlink = lastBlinkTime?.let { now - it } ?: 999999L

        when (phase) {
            BlinkPhase.AWAITING_OPEN -> {
                if (isClosed && timeSinceLastBlink > 120) {
                    // Eyes went from open to closed → start of blink
                    phase = BlinkPhase.CLOSING
                    closedFrames = 1
                }
            }

            BlinkPhase.CLOSING -> {
                if (isClosed) {
                    closedFrames++
                } else if (isOpen && closedFrames >= BiometricConfig.BLINK_MIN_CLOSED_FRAMES) {
                    // Eyes reopened after being closed → complete 1 blink
                    completedCount++
                    lastBlinkTime = now
                    closedFrames = 0

                    if (completedCount >= targetCount) {
                        phase = BlinkPhase.REOPENED
                    } else {
                        phase = BlinkPhase.AWAITING_OPEN
                    }
                }
            }

            BlinkPhase.REOPENED -> {
                // Target blinks achieved — no further processing
            }
        }

        // Double-blink timeout: reset if too much time between 1st and 2nd blink
        if (targetCount == 2 && completedCount == 1 && lastBlinkTime != null) {
            if (now - lastBlinkTime!! > BiometricConfig.DOUBLE_BLINK_MAX_INTERVAL_MS) {
                completedCount = 0
                phase = BlinkPhase.AWAITING_OPEN
            }
        }

        return getState()
    }

    fun getState(): BlinkTrackerState {
        return BlinkTrackerState(
            completedBlinks = completedCount,
            targetBlinks = targetCount,
            currentPhase = phase,
            closedFramesCount = closedFrames,
            lastBlinkCompletedAt = lastBlinkTime,
            currentEAR = lastEAR,
            baselineEAR = baselineEAR,
            isComplete = completedCount >= targetCount
        )
    }

    companion object {
        /**
         * Compute Eye Aspect Ratio (EAR) for a 6-point eye contour.
         *
         * Points: p0=outer, p1=upper-left, p2=upper-right,
         *         p3=inner, p4=lower-right, p5=lower-left
         *
         * EAR = (||p1-p5|| + ||p2-p4||) / (2 * ||p0-p3||)
         */
        fun computeEAR(eyePoints: List<PointF>): Float {
            if (eyePoints.size < 6) return 0.28f

            val p0 = eyePoints[0]
            val p1 = eyePoints[1]
            val p2 = eyePoints[2]
            val p3 = eyePoints[3]
            val p4 = eyePoints[4]
            val p5 = eyePoints[5]

            val vertical1 = distance(p1, p5)
            val vertical2 = distance(p2, p4)
            val horizontal = distance(p0, p3)

            if (horizontal == 0f) return 0.28f
            return (vertical1 + vertical2) / (2f * horizontal)
        }

        private fun distance(a: PointF, b: PointF): Float {
            val dx = a.x - b.x
            val dy = a.y - b.y
            return sqrt(dx * dx + dy * dy)
        }
    }
}

enum class BlinkPhase {
    /** Waiting for open eyes (baseline confirmation). */
    AWAITING_OPEN,
    /** Eyes are currently closing / closed. */
    CLOSING,
    /** Blink completed — eyes reopened after closure. */
    REOPENED
}

data class BlinkTrackerState(
    val completedBlinks: Int,
    val targetBlinks: Int,
    val currentPhase: BlinkPhase,
    val closedFramesCount: Int,
    val lastBlinkCompletedAt: Long?,
    val currentEAR: Float,
    val baselineEAR: Float,
    val isComplete: Boolean
)
