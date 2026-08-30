package com.campusattend.biometric.verification

import android.app.Application
import android.graphics.Bitmap
import android.graphics.RectF
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.campusattend.biometric.CampusAttendApp
import com.campusattend.biometric.antispoof.AntiSpoofService
import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.data.BiometricRepository
import com.campusattend.biometric.data.StaffEntity
import com.campusattend.biometric.detection.FaceDetectionResult
import com.campusattend.biometric.detection.FaceDetectionService
import com.campusattend.biometric.detection.FaceLandmarkResult
import com.campusattend.biometric.detection.FaceLandmarkService
import com.campusattend.biometric.liveness.ChallengeCategory
import com.campusattend.biometric.liveness.LivenessService
import com.campusattend.biometric.liveness.LivenessState
import com.campusattend.biometric.liveness.LivenessStatus
import com.campusattend.biometric.recognition.FaceEmbeddingService
import com.campusattend.biometric.recognition.FaceMatchingService
import com.campusattend.biometric.recognition.FacePreprocessingService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Verification pipeline orchestrator ViewModel.
 *
 * Manages the complete biometric verification flow:
 *
 * CAMERA FRAME
 *   ↓ FaceDetectionService → exactly 1 face (continuous/throttled)
 *   ↓ FaceLandmarkService → landmarks (continuous while face present)
 *   ↓ LivenessService → random challenge (continuous during liveness window)
 *   ↓ AntiSpoofService → MiniFASNet inference (sampled frames)
 *   ↓ FacePreprocessingService → alignment (once after liveness)
 *   ↓ FaceEmbeddingService → 512-d vector (once after liveness)
 *   ↓ FaceMatchingService → search local DB
 *   ↓ BiometricResult
 */
class VerificationViewModel(application: Application) : AndroidViewModel(application) {

    // Services
    private val faceDetectionService = FaceDetectionService(application)
    private val faceLandmarkService = FaceLandmarkService(application)
    private val livenessService = LivenessService(faceLandmarkService)
    private val antiSpoofService = AntiSpoofService(application)
    private val facePreprocessingService = FacePreprocessingService()
    private val faceEmbeddingService = FaceEmbeddingService(application)
    private val faceMatchingService = FaceMatchingService()

    // Repository
    private val repository = BiometricRepository(
        (application as CampusAttendApp).database
    )

    // Pipeline state
    private val _pipelineState = MutableStateFlow(PipelineState())
    val pipelineState: StateFlow<PipelineState> = _pipelineState.asStateFlow()

    private val _biometricResult = MutableStateFlow<BiometricResult?>(null)
    val biometricResult: StateFlow<BiometricResult?> = _biometricResult.asStateFlow()

    private var verificationStartTime = 0L
    private var antiSpoofFramesSampled = 0
    private var livenessCompleted = false
    private var lastFaceBoundingBox: RectF? = null

    // Latency tracking
    private var lastDetectionLatency = 0L
    private var lastLandmarkLatency = 0L
    private var lastAntiSpoofLatency = 0L
    private var lastEmbeddingLatency = 0L
    private var lastMatchingLatency = 0L

    /**
     * Initialize all ML models. Call once before starting verification.
     */
    fun initializeModels() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                _pipelineState.value = _pipelineState.value.copy(
                    modelStatus = "Loading face detection model..."
                )
                faceDetectionService.initialize()

                _pipelineState.value = _pipelineState.value.copy(
                    modelStatus = "Loading face landmark model..."
                )
                faceLandmarkService.initialize()

                _pipelineState.value = _pipelineState.value.copy(
                    modelStatus = "Loading anti-spoof model..."
                )
                antiSpoofService.initialize()

                _pipelineState.value = _pipelineState.value.copy(
                    modelStatus = "Loading face recognition model..."
                )
                faceEmbeddingService.initialize()

                _pipelineState.value = _pipelineState.value.copy(
                    modelsReady = true,
                    modelStatus = "All models loaded"
                )
            } catch (e: Exception) {
                _pipelineState.value = _pipelineState.value.copy(
                    modelStatus = "Model loading failed: ${e.message}",
                    error = e.message
                )
            }
        }
    }

    /**
     * Start a new verification session.
     */
    fun startVerification() {
        verificationStartTime = System.currentTimeMillis()
        antiSpoofFramesSampled = 0
        livenessCompleted = false
        lastFaceBoundingBox = null
        antiSpoofService.reset()
        _biometricResult.value = null

        // Start liveness with a random challenge or bypass in dev mode
        val baseState = livenessService.start()
        val livenessState = if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
            livenessCompleted = true
            baseState.copy(
                status = LivenessStatus.PASSED,
                instruction = "LIVENESS: DISABLED (DEVELOPMENT MODE)"
            )
        } else {
            baseState
        }

        _pipelineState.value = PipelineState(
            modelsReady = true,
            verificationActive = true,
            livenessState = livenessState,
            statusMessage = if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
                "LIVENESS: DISABLED (DEVELOPMENT MODE)"
            } else {
                livenessState.instruction
            }
        )
    }

    /**
     * Process a single camera frame through the pipeline.
     * Called from CameraService's analysis callback.
     */
    fun processFrame(bitmap: Bitmap) {
        if (!_pipelineState.value.verificationActive) return
        if (_biometricResult.value != null) return  // Already have result

        // ── Step 1: Face Detection ──
        val detStartTime = System.currentTimeMillis()
        val detectionResult = faceDetectionService.detect(bitmap)
        lastDetectionLatency = System.currentTimeMillis() - detStartTime

        when (detectionResult) {
            is FaceDetectionResult.NoFace -> {
                _pipelineState.value = _pipelineState.value.copy(
                    statusMessage = "No face detected",
                    faceDetected = false
                )
                return
            }
            is FaceDetectionResult.MultipleFaces -> {
                if (!BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
                    livenessService.fail("Multiple faces detected. Only one person should be visible.")
                }
                _pipelineState.value = _pipelineState.value.copy(
                    statusMessage = "Multiple faces detected (${detectionResult.count}). Only one person should be visible.",
                    faceDetected = false,
                    livenessState = if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) null else livenessService.getState()
                )
                return
            }
            is FaceDetectionResult.Error -> {
                _pipelineState.value = _pipelineState.value.copy(
                    statusMessage = detectionResult.message,
                    error = detectionResult.message
                )
                return
            }
            is FaceDetectionResult.SingleFace -> {
                lastFaceBoundingBox = detectionResult.boundingBox
            }
        }

        val singleFace = detectionResult as FaceDetectionResult.SingleFace

        // ── Step 2: Face Landmarks ──
        val lmStartTime = System.currentTimeMillis()
        val landmarkResult = faceLandmarkService.detect(bitmap)
        lastLandmarkLatency = System.currentTimeMillis() - lmStartTime

        if (landmarkResult == null) {
            _pipelineState.value = _pipelineState.value.copy(
                statusMessage = "Could not detect facial landmarks.",
                faceDetected = true
            )
            return
        }

        // ── Step 3: Liveness Challenge ──
        if (!livenessCompleted && !BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
            val livenessState = livenessService.processFrame(landmarkResult)

            _pipelineState.value = _pipelineState.value.copy(
                faceDetected = true,
                faceBoundingBox = singleFace.boundingBox,
                livenessState = livenessState,
                statusMessage = livenessState.instruction
            )

            when (livenessState.status) {
                LivenessStatus.PASSED -> {
                    livenessCompleted = true
                    // Continue to anti-spoof and recognition below
                }
                LivenessStatus.FAILED -> {
                    completeFailed(
                        livenessPassed = false,
                        reason = livenessState.failureReason ?: "Liveness failed"
                    )
                    return
                }
                else -> return  // Still in progress
            }
        } else if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
            livenessCompleted = true
        }

        // ── Step 4: Anti-Spoof (sampled frames after liveness) ──
        var antiSpoofScore = 1.0f
        var antiSpoofFrameCount = 0

        if (!BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
            if (antiSpoofFramesSampled < BiometricConfig.ANTI_SPOOF_SAMPLE_COUNT) {
                val asStartTime = System.currentTimeMillis()
                antiSpoofService.analyzeFrame(bitmap, singleFace.boundingBox)
                lastAntiSpoofLatency = System.currentTimeMillis() - asStartTime
                antiSpoofFramesSampled++

                _pipelineState.value = _pipelineState.value.copy(
                    statusMessage = "Analyzing anti-spoof... (${antiSpoofFramesSampled}/${BiometricConfig.ANTI_SPOOF_SAMPLE_COUNT})"
                )

                if (antiSpoofFramesSampled < BiometricConfig.ANTI_SPOOF_SAMPLE_COUNT) {
                    return  // Need more frames
                }
            }

            // Check aggregated anti-spoof result
            val antiSpoofResult = antiSpoofService.getAggregatedResult()
            antiSpoofScore = antiSpoofResult.medianLiveScore
            antiSpoofFrameCount = antiSpoofResult.frameCount

            if (!antiSpoofResult.passed) {
                completeFailed(
                    livenessPassed = true,
                    antiSpoofPassed = false,
                    antiSpoofScore = antiSpoofScore,
                    reason = antiSpoofResult.reason ?: "Presentation attack detected"
                )
                return
            }
        }

        // ── Step 5: Face Alignment + Embedding (once) ──
        _pipelineState.value = _pipelineState.value.copy(
            statusMessage = if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
                "LIVENESS: DISABLED (DEVELOPMENT MODE) - Generating face embedding..."
            } else {
                "Generating face embedding..."
            }
        )

        val alignmentPoints = faceLandmarkService.extract5AlignmentPoints(landmarkResult)

        val embStartTime = System.currentTimeMillis()
        val alignedTensor = facePreprocessingService.alignFaceToTensor(bitmap, alignmentPoints)
        val embedding = faceEmbeddingService.generateEmbedding(alignedTensor)
        lastEmbeddingLatency = System.currentTimeMillis() - embStartTime

        if (embedding == null) {
            completeFailed(
                livenessPassed = true,
                antiSpoofPassed = true,
                reason = "Failed to generate face embedding"
            )
            return
        }

        // ── Step 6: Face Matching against local DB ──
        _pipelineState.value = _pipelineState.value.copy(
            statusMessage = "Searching enrolled faces..."
        )

        viewModelScope.launch(Dispatchers.IO) {
            val matchStartTime = System.currentTimeMillis()

            val groupedEmbeddings = repository.getEmbeddingsGroupedByStaff()
            val staffLookup = mutableMapOf<String, StaffEntity>()
            for (staffId in groupedEmbeddings.keys) {
                repository.getStaffById(staffId)?.let { staffLookup[staffId] = it }
            }

            val matchResult = faceMatchingService.findBestMatch(
                embedding, groupedEmbeddings, staffLookup
            )
            lastMatchingLatency = System.currentTimeMillis() - matchStartTime

            val totalLatency = System.currentTimeMillis() - verificationStartTime

            if (matchResult.matched) {
                _biometricResult.value = BiometricResult(
                    verified = true,
                    staffId = matchResult.staffId,
                    staffName = matchResult.staffName,
                    livenessPassed = true,
                    antiSpoofPassed = true,
                    matchPassed = true,
                    matchDistance = matchResult.distance,
                    matchMargin = matchResult.matchMargin,
                    antiSpoofScore = antiSpoofScore,
                    antiSpoofFrameCount = antiSpoofFrameCount,
                    challengeCategory = if (BiometricConfig.DEV_MODE_BYPASS_LIVENESS) "DISABLED_DEV_MODE" else (_pipelineState.value.livenessState?.category?.name ?: ""),
                    totalLatencyMs = totalLatency
                )

                _pipelineState.value = _pipelineState.value.copy(
                    verificationActive = false,
                    statusMessage = "Identity Verified: ${matchResult.staffName}"
                )
            } else {
                completeFailed(
                    livenessPassed = true,
                    antiSpoofPassed = true,
                    matchPassed = false,
                    matchDistance = matchResult.distance,
                    matchMargin = matchResult.matchMargin,
                    reason = matchResult.reason ?: "Face Not Recognized. Only authorized staff members can mark attendance."
                )
            }
        }
    }

    private fun completeFailed(
        livenessPassed: Boolean = false,
        antiSpoofPassed: Boolean = false,
        matchPassed: Boolean = false,
        matchDistance: Float = Float.MAX_VALUE,
        matchMargin: Float? = null,
        antiSpoofScore: Float = 0f,
        reason: String
    ) {
        val totalLatency = System.currentTimeMillis() - verificationStartTime

        _biometricResult.value = BiometricResult(
            verified = false,
            staffId = null,
            staffName = null,
            livenessPassed = livenessPassed,
            antiSpoofPassed = antiSpoofPassed,
            matchPassed = matchPassed,
            matchDistance = matchDistance,
            matchMargin = matchMargin,
            antiSpoofScore = antiSpoofScore,
            challengeCategory = _pipelineState.value.livenessState?.category?.name ?: "",
            totalLatencyMs = totalLatency,
            rejectionReason = reason
        )

        _pipelineState.value = _pipelineState.value.copy(
            verificationActive = false,
            statusMessage = reason
        )
    }

    /**
     * Reset for a retry.
     */
    fun reset() {
        _biometricResult.value = null
        _pipelineState.value = PipelineState(
            modelsReady = _pipelineState.value.modelsReady
        )
    }

    /**
     * Get current performance metrics for diagnostics.
     */
    fun getPerformanceMetrics(): PerformanceMetrics {
        return PerformanceMetrics(
            detectionLatencyMs = lastDetectionLatency,
            landmarkLatencyMs = lastLandmarkLatency,
            antiSpoofLatencyMs = lastAntiSpoofLatency,
            embeddingLatencyMs = lastEmbeddingLatency,
            matchingLatencyMs = lastMatchingLatency
        )
    }

    override fun onCleared() {
        super.onCleared()
        faceDetectionService.close()
        faceLandmarkService.close()
        antiSpoofService.close()
        faceEmbeddingService.close()
    }
}

data class PipelineState(
    val modelsReady: Boolean = false,
    val modelStatus: String = "Initializing...",
    val verificationActive: Boolean = false,
    val faceDetected: Boolean = false,
    val faceBoundingBox: RectF? = null,
    val livenessState: LivenessState? = null,
    val statusMessage: String = "",
    val error: String? = null
)

data class PerformanceMetrics(
    val detectionLatencyMs: Long,
    val landmarkLatencyMs: Long,
    val antiSpoofLatencyMs: Long,
    val embeddingLatencyMs: Long,
    val matchingLatencyMs: Long
) {
    val totalLatencyMs: Long
        get() = detectionLatencyMs + landmarkLatencyMs + antiSpoofLatencyMs +
                embeddingLatencyMs + matchingLatencyMs
}
