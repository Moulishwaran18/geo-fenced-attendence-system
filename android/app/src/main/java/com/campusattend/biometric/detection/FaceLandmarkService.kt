package com.campusattend.biometric.detection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PointF
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.campusattend.biometric.config.BiometricConfig

/**
 * MediaPipe Face Landmarker service.
 *
 * Provides 478 3D facial mesh landmarks for:
 * - Eye state detection (blink / EAR computation)
 * - Head pose estimation (yaw / pitch)
 * - 5-point face alignment for ArcFace recognition
 *
 * MediaPipe 478-landmark mesh indices used:
 *
 * LEFT EYE (upper/lower contour):
 *   Upper: 159, 145, 133, 160, 161, 246
 *   Lower: 144, 163, 153, 154, 155, 173
 *   Outer corner: 33, Inner corner: 133
 *   For EAR: p1=159, p2=145, p3=33, p4=133, p5=153, p6=144
 *
 * RIGHT EYE:
 *   Upper: 386, 374, 362, 387, 388, 466
 *   Lower: 373, 390, 380, 381, 382, 398
 *   Outer corner: 263, Inner corner: 362
 *   For EAR: p1=386, p2=374, p3=263, p4=362, p5=380, p6=373
 *
 * LEFT EYE CENTER: average of 33, 133 (or use iris center 468)
 * RIGHT EYE CENTER: average of 263, 362 (or use iris center 473)
 * NOSE TIP: 1
 * LEFT MOUTH CORNER: 61
 * RIGHT MOUTH CORNER: 291
 * CHIN: 152
 * NOSE BRIDGE (between eyes): 6
 * LEFT JAW EDGE: 234
 * RIGHT JAW EDGE: 454
 */
class FaceLandmarkService(private val context: Context) {

    private var landmarker: FaceLandmarker? = null

    fun initialize() {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("face_landmarker.task")
            .build()

        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setMinFaceDetectionConfidence(BiometricConfig.MIN_FACE_DETECTION_CONFIDENCE)
            .setMinFacePresenceConfidence(BiometricConfig.MIN_FACE_PRESENCE_CONFIDENCE)
            .setMinTrackingConfidence(BiometricConfig.MIN_FACE_LANDMARK_CONFIDENCE)
            .setNumFaces(1)
            .setRunningMode(com.google.mediapipe.tasks.vision.core.RunningMode.IMAGE)
            .build()

        landmarker = FaceLandmarker.createFromOptions(context, options)
    }

    /**
     * Detect face landmarks in the given bitmap.
     *
     * @return [FaceLandmarkResult] with 478 normalized landmarks, or null if no face found
     */
    fun detect(bitmap: Bitmap): FaceLandmarkResult? {
        val lm = landmarker ?: return null

        val mpImage = BitmapImageBuilder(bitmap).build()
        val result: FaceLandmarkerResult = lm.detect(mpImage)

        if (result.faceLandmarks().isEmpty()) return null

        val landmarks = result.faceLandmarks()[0]
        val points = landmarks.map { lmk ->
            // MediaPipe landmarks are normalized [0,1]; convert to pixel coordinates
            LandmarkPoint(
                x = lmk.x() * bitmap.width,
                y = lmk.y() * bitmap.height,
                z = lmk.z()
            )
        }

        return FaceLandmarkResult(
            landmarks = points,
            imageWidth = bitmap.width,
            imageHeight = bitmap.height
        )
    }

    /**
     * Extract the 5 key points needed for ArcFace alignment:
     * left eye center, right eye center, nose tip, left mouth corner, right mouth corner.
     *
     * Uses MediaPipe mesh indices mapped from the 68-point model equivalent.
     */
    fun extract5AlignmentPoints(result: FaceLandmarkResult): Array<FloatArray> {
        val pts = result.landmarks

        // Left eye center: average of outer (33) and inner (133) corners
        val leftEyeX = (pts[33].x + pts[133].x) / 2f
        val leftEyeY = (pts[33].y + pts[133].y) / 2f

        // Right eye center: average of outer (263) and inner (362) corners
        val rightEyeX = (pts[263].x + pts[362].x) / 2f
        val rightEyeY = (pts[263].y + pts[362].y) / 2f

        // Nose tip: index 1
        val noseX = pts[1].x
        val noseY = pts[1].y

        // Left mouth corner: index 61
        val leftMouthX = pts[61].x
        val leftMouthY = pts[61].y

        // Right mouth corner: index 291
        val rightMouthX = pts[291].x
        val rightMouthY = pts[291].y

        return arrayOf(
            floatArrayOf(leftEyeX, leftEyeY),
            floatArrayOf(rightEyeX, rightEyeY),
            floatArrayOf(noseX, noseY),
            floatArrayOf(leftMouthX, leftMouthY),
            floatArrayOf(rightMouthX, rightMouthY)
        )
    }

    /**
     * Extract eye contour points for EAR (Eye Aspect Ratio) computation.
     *
     * Returns 6 points per eye in the order expected by the EAR formula:
     * p0=outer corner, p1=upper-left, p2=upper-right,
     * p3=inner corner, p4=lower-right, p5=lower-left
     */
    fun extractEyePoints(result: FaceLandmarkResult): Pair<List<PointF>, List<PointF>> {
        val pts = result.landmarks

        // Left eye (6-point contour for EAR)
        val leftEye = listOf(
            PointF(pts[33].x, pts[33].y),    // outer corner
            PointF(pts[160].x, pts[160].y),  // upper-left
            PointF(pts[158].x, pts[158].y),  // upper-right
            PointF(pts[133].x, pts[133].y),  // inner corner
            PointF(pts[153].x, pts[153].y),  // lower-right
            PointF(pts[144].x, pts[144].y)   // lower-left
        )

        // Right eye (6-point contour for EAR)
        val rightEye = listOf(
            PointF(pts[263].x, pts[263].y),   // outer corner
            PointF(pts[387].x, pts[387].y),  // upper-left
            PointF(pts[385].x, pts[385].y),  // upper-right
            PointF(pts[362].x, pts[362].y),  // inner corner
            PointF(pts[380].x, pts[380].y),  // lower-right
            PointF(pts[373].x, pts[373].y)   // lower-left
        )

        return Pair(leftEye, rightEye)
    }

    /**
     * Extract head pose estimation points.
     * Returns key landmarks for yaw/pitch computation.
     */
    fun extractHeadPosePoints(result: FaceLandmarkResult): HeadPosePoints {
        val pts = result.landmarks
        return HeadPosePoints(
            noseTip = PointF(pts[1].x, pts[1].y),
            noseBridge = PointF(pts[6].x, pts[6].y),
            chin = PointF(pts[152].x, pts[152].y),
            leftJaw = PointF(pts[234].x, pts[234].y),
            rightJaw = PointF(pts[454].x, pts[454].y)
        )
    }

    fun close() {
        landmarker?.close()
        landmarker = null
    }

    companion object {
        private const val TAG = "FaceLandmarkService"
    }
}

/**
 * Result containing 478 facial mesh landmarks.
 */
data class FaceLandmarkResult(
    val landmarks: List<LandmarkPoint>,
    val imageWidth: Int,
    val imageHeight: Int
)

/**
 * A single 3D landmark point in pixel coordinates.
 */
data class LandmarkPoint(
    val x: Float,
    val y: Float,
    val z: Float = 0f
)

/**
 * Key points for head pose estimation.
 */
data class HeadPosePoints(
    val noseTip: PointF,
    val noseBridge: PointF,
    val chin: PointF,
    val leftJaw: PointF,
    val rightJaw: PointF
)
