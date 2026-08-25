package com.campusattend.biometric.detection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.facedetector.FaceDetectorResult
import com.campusattend.biometric.config.BiometricConfig

/**
 * MediaPipe Face Detector service.
 *
 * Wraps the MediaPipe Tasks Vision Face Detector for on-device face detection.
 * For each analyzed frame:
 *   - 0 faces → FaceNotDetected
 *   - 1 face → SingleFaceDetected (with bounding box and keypoints)
 *   - >1 faces → MultipleFacesDetected (rejection)
 *
 * Does NOT automatically choose one face from multiple faces.
 */
class FaceDetectionService(private val context: Context) {

    private var detector: FaceDetector? = null

    /**
     * Initialize the MediaPipe Face Detector.
     * Must be called before [detect].
     */
    fun initialize() {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("face_detection_short_range.tflite")
            .build()

        val options = FaceDetector.FaceDetectorOptions.builder()
            .setBaseOptions(baseOptions)
            .setMinDetectionConfidence(BiometricConfig.MIN_FACE_DETECTION_CONFIDENCE)
            .setRunningMode(com.google.mediapipe.tasks.vision.core.RunningMode.IMAGE)
            .build()

        detector = FaceDetector.createFromOptions(context, options)
    }

    /**
     * Detect faces in the given bitmap.
     *
     * @return [FaceDetectionResult] indicating zero, one, or multiple faces
     */
    fun detect(bitmap: Bitmap): FaceDetectionResult {
        val det = detector ?: return FaceDetectionResult.Error("Face detector not initialized")

        val mpImage = BitmapImageBuilder(bitmap).build()
        val result: FaceDetectorResult = det.detect(mpImage)

        val detections = result.detections()
        return when {
            detections.isEmpty() -> FaceDetectionResult.NoFace
            detections.size == 1 -> {
                val detection = detections[0]
                val bbox = detection.boundingBox()
                val keypoints = detection.keypoints().orElse(emptyList()).map { kp ->
                    FaceKeypoint(kp.x(), kp.y(), kp.label().orElse(""))
                }
                FaceDetectionResult.SingleFace(
                    boundingBox = RectF(bbox.left.toFloat(), bbox.top.toFloat(),
                        bbox.right.toFloat(), bbox.bottom.toFloat()),
                    confidence = detection.categories()[0].score(),
                    keypoints = keypoints
                )
            }
            else -> FaceDetectionResult.MultipleFaces(detections.size)
        }
    }

    fun close() {
        detector?.close()
        detector = null
    }

    companion object {
        private const val TAG = "FaceDetectionService"
    }
}

/**
 * Result of face detection on a single frame.
 */
sealed class FaceDetectionResult {
    /** No face was detected in the frame. */
    data object NoFace : FaceDetectionResult()

    /** Exactly one face was detected. */
    data class SingleFace(
        val boundingBox: RectF,
        val confidence: Float,
        val keypoints: List<FaceKeypoint>
    ) : FaceDetectionResult()

    /** Multiple faces detected — verification must be rejected. */
    data class MultipleFaces(val count: Int) : FaceDetectionResult()

    /** Detection error. */
    data class Error(val message: String) : FaceDetectionResult()
}

/**
 * A detected face keypoint (e.g., eye center, nose tip).
 * Coordinates are normalized [0, 1] relative to image dimensions.
 */
data class FaceKeypoint(
    val x: Float,
    val y: Float,
    val label: String
)
