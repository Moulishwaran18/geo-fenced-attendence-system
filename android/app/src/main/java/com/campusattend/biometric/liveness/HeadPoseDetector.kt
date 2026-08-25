package com.campusattend.biometric.liveness

import android.graphics.PointF
import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.detection.HeadPosePoints
import kotlin.math.abs

/**
 * Head pose estimator and temporal direction validator.
 *
 * Port of: src/lib/face-recognition/head-pose.ts
 *
 * Estimates yaw (horizontal turn) and pitch (vertical tilt) from facial landmarks.
 * Validates temporal consistency by requiring consecutive frames at the target pose.
 */
class HeadPoseDetector(private var targetDirection: HeadDirection = HeadDirection.CENTER) {

    private var consecutiveFrames: Int = 0
    private var isSatisfied: Boolean = false
    private var lastAngles: HeadPoseAngles = HeadPoseAngles(0f, 0f)

    fun reset(direction: HeadDirection? = null) {
        if (direction != null) targetDirection = direction
        consecutiveFrames = 0
        isSatisfied = false
        lastAngles = HeadPoseAngles(0f, 0f)
    }

    /**
     * Process a frame's head pose landmarks.
     *
     * @param posePoints Key landmarks for yaw/pitch computation
     * @return Current head pose validation state
     */
    fun processFrame(posePoints: HeadPosePoints): HeadPoseValidationState {
        lastAngles = estimateHeadPose(posePoints)
        val matchesDirection = checkDirection(lastAngles, targetDirection)

        if (matchesDirection) {
            consecutiveFrames++
            if (consecutiveFrames >= BiometricConfig.POSE_CONSECUTIVE_FRAMES) {
                isSatisfied = true
            }
        } else {
            consecutiveFrames = 0
        }

        return getState()
    }

    fun getState(): HeadPoseValidationState {
        return HeadPoseValidationState(
            currentAngles = lastAngles,
            targetDirection = targetDirection,
            consecutiveFramesSatisfied = consecutiveFrames,
            isSatisfied = isSatisfied
        )
    }

    companion object {
        /**
         * Estimate head yaw (horizontal turn) in degrees.
         *
         * Nose displacement relative to face center:
         * - Physical LEFT turn → positive yaw
         * - Physical RIGHT turn → negative yaw
         */
        fun estimateYawAngle(posePoints: HeadPosePoints): Float {
            val faceCenterX = (posePoints.leftJaw.x + posePoints.rightJaw.x) / 2f
            val faceWidth = abs(posePoints.rightJaw.x - posePoints.leftJaw.x)
            if (faceWidth == 0f) return 0f

            val offset = (posePoints.noseTip.x - faceCenterX) / (faceWidth / 2f)
            return offset * 45f  // Scale to approximate degrees (-45° to +45°)
        }

        /**
         * Estimate head pitch (vertical tilt) in degrees.
         *
         * Uses nose-bridge-to-nose-tip vs nose-tip-to-chin ratio:
         * - Looking UP → positive pitch (nose-tip-to-bridge distance shrinks)
         * - Looking DOWN → negative pitch (nose-tip-to-bridge distance grows)
         */
        fun estimatePitchAngle(posePoints: HeadPosePoints): Float {
            val upperLen = posePoints.noseTip.y - posePoints.noseBridge.y
            val lowerLen = posePoints.chin.y - posePoints.noseTip.y
            val totalHeight = posePoints.chin.y - posePoints.noseBridge.y
            if (totalHeight == 0f || lowerLen == 0f) return 0f

            val ratio = upperLen / lowerLen
            val neutralRatio = 0.58f

            return (neutralRatio - ratio) * 50f
        }

        fun estimateHeadPose(posePoints: HeadPosePoints): HeadPoseAngles {
            return HeadPoseAngles(
                yaw = estimateYawAngle(posePoints),
                pitch = estimatePitchAngle(posePoints)
            )
        }

        /**
         * Check if the current head pose matches the target direction.
         */
        fun checkDirection(angles: HeadPoseAngles, direction: HeadDirection): Boolean {
            val yawThreshold = BiometricConfig.HEAD_TURN_ANGLE_DEG
            val pitchUpThreshold = BiometricConfig.HEAD_PITCH_UP_DEG
            val pitchDownThreshold = BiometricConfig.HEAD_PITCH_DOWN_DEG

            return when (direction) {
                HeadDirection.LEFT -> angles.yaw > yawThreshold
                HeadDirection.RIGHT -> angles.yaw < -yawThreshold
                HeadDirection.UP -> angles.pitch > pitchUpThreshold
                HeadDirection.DOWN -> angles.pitch < pitchDownThreshold
                HeadDirection.CENTER ->
                    abs(angles.yaw) < yawThreshold * 0.7f &&
                    abs(angles.pitch) < abs(pitchUpThreshold) * 0.8f
            }
        }
    }
}

enum class HeadDirection {
    LEFT, RIGHT, UP, DOWN, CENTER
}

data class HeadPoseAngles(
    /** Yaw in degrees. Positive = physical left, Negative = physical right. */
    val yaw: Float,
    /** Pitch in degrees. Positive = looking up, Negative = looking down. */
    val pitch: Float
)

data class HeadPoseValidationState(
    val currentAngles: HeadPoseAngles,
    val targetDirection: HeadDirection,
    val consecutiveFramesSatisfied: Int,
    val isSatisfied: Boolean
)
