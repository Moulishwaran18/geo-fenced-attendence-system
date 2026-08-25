package com.campusattend.biometric.liveness

import android.graphics.PointF
import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.detection.FaceLandmarkResult
import com.campusattend.biometric.detection.FaceLandmarkService
import com.campusattend.biometric.detection.HeadPosePoints

/**
 * Liveness verification session orchestrator.
 *
 * Port of: src/lib/face-recognition/liveness-engine.ts (LivenessSession)
 *
 * Manages the lifecycle of a liveness verification session:
 * - Generates a random challenge at session start
 * - Processes each frame through blink and/or head pose detectors
 * - Enforces timeout
 * - Reports session state (idle → active → passed/failed)
 */
class LivenessService(private val landmarkService: FaceLandmarkService) {

    private var challenge: GeneratedChallenge = generateRandomChallenge()
    private var currentStepIndex: Int = 0
    private var status: LivenessStatus = LivenessStatus.IDLE
    private var startedAt: Long = 0L
    private var failureReason: String? = null

    private val blinkDetector = BlinkDetector(1)
    private val poseDetector = HeadPoseDetector(HeadDirection.CENTER)

    /**
     * Start a new liveness session with a random or specified challenge.
     */
    fun start(preferredCategory: ChallengeCategory? = null): LivenessState {
        challenge = generateRandomChallenge(preferredCategory)
        currentStepIndex = 0
        status = LivenessStatus.ACTIVE
        startedAt = System.currentTimeMillis()
        failureReason = null

        configureDetectorsForCurrentStep()
        return getState()
    }

    /**
     * Process a frame's landmarks through the active challenge step.
     */
    fun processFrame(landmarkResult: FaceLandmarkResult): LivenessState {
        if (status != LivenessStatus.ACTIVE) return getState()

        // Check session timeout
        val elapsed = System.currentTimeMillis() - startedAt
        if (elapsed > BiometricConfig.CHALLENGE_TIMEOUT_MS) {
            status = LivenessStatus.FAILED
            failureReason = "Liveness verification timed out. Please follow the instructions promptly."
            return getState()
        }

        val currentStep = challenge.steps.getOrNull(currentStepIndex) ?: run {
            status = LivenessStatus.PASSED
            return getState()
        }

        when (currentStep.type) {
            StepType.BLINK -> {
                val (leftEye, rightEye) = landmarkService.extractEyePoints(landmarkResult)
                val blinkState = blinkDetector.processFrame(leftEye, rightEye)
                if (blinkState.isComplete) {
                    currentStep.completed = true
                    advanceToNextStep()
                }
            }
            StepType.POSE -> {
                val posePoints = landmarkService.extractHeadPosePoints(landmarkResult)
                val poseState = poseDetector.processFrame(posePoints)
                if (poseState.isSatisfied) {
                    currentStep.completed = true
                    advanceToNextStep()
                }
            }
        }

        return getState()
    }

    /**
     * Force-fail the session (e.g., face lost, multiple faces detected).
     */
    fun fail(reason: String = "Liveness verification failed."): LivenessState {
        status = LivenessStatus.FAILED
        failureReason = reason
        return getState()
    }

    fun getState(): LivenessState {
        val elapsed = if (startedAt > 0) System.currentTimeMillis() - startedAt else 0L
        val timeRemainingMs = maxOf(0L, BiometricConfig.CHALLENGE_TIMEOUT_MS - elapsed)
        val currentStep = challenge.steps.getOrNull(currentStepIndex)

        val instruction = when (status) {
            LivenessStatus.PASSED -> "Live person verified."
            LivenessStatus.FAILED -> failureReason ?: "Liveness verification failed."
            else -> currentStep?.instruction ?: "Verifying liveness..."
        }

        return LivenessState(
            status = status,
            category = challenge.category,
            challengeName = challenge.name,
            steps = challenge.steps,
            currentStepIndex = currentStepIndex,
            currentStep = currentStep,
            instruction = instruction,
            blinkState = blinkDetector.getState(),
            poseState = poseDetector.getState(),
            startedAt = startedAt,
            timeRemainingMs = timeRemainingMs,
            failureReason = failureReason
        )
    }

    private fun configureDetectorsForCurrentStep() {
        val step = challenge.steps.getOrNull(currentStepIndex) ?: return
        when (step.type) {
            StepType.BLINK -> blinkDetector.reset(step.targetBlinks ?: 1)
            StepType.POSE -> poseDetector.reset(step.targetDirection ?: HeadDirection.CENTER)
        }
    }

    private fun advanceToNextStep() {
        currentStepIndex++
        if (currentStepIndex >= challenge.steps.size) {
            status = LivenessStatus.PASSED
        } else {
            configureDetectorsForCurrentStep()
        }
    }
}

enum class LivenessStatus {
    IDLE, ACTIVE, PASSED, FAILED
}

data class LivenessState(
    val status: LivenessStatus,
    val category: ChallengeCategory,
    val challengeName: String,
    val steps: List<ChallengeStep>,
    val currentStepIndex: Int,
    val currentStep: ChallengeStep?,
    val instruction: String,
    val blinkState: BlinkTrackerState,
    val poseState: HeadPoseValidationState,
    val startedAt: Long,
    val timeRemainingMs: Long,
    val failureReason: String?
)
