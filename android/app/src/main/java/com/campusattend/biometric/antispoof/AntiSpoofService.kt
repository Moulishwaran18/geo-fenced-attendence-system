package com.campusattend.biometric.antispoof

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.campusattend.biometric.config.BiometricConfig
import java.nio.FloatBuffer

/**
 * MiniFASNet anti-spoof inference service.
 *
 * Uses MiniFASNetV2 (primary) and optionally MiniFASNetV1SE (secondary)
 * to classify whether a face presentation is REAL or SPOOF.
 *
 * Source: Silent-Face-Anti-Spoofing (Minivision AI)
 * License: Apache-2.0
 *
 * PREPROCESSING (CRITICAL — matches official training pipeline):
 * 1. Get face bounding box from detector
 * 2. Expand bounding box by 2.7× scale factor (centered on face center)
 * 3. Crop from original frame
 * 4. Resize to 80×80
 * 5. Convert RGB → BGR
 * 6. Normalize: divide all pixels by 255.0
 * 7. Transpose to [1, 3, 80, 80] channel-first NCHW format
 *
 * OUTPUT: 3-class softmax [live, print_attack, replay_attack]
 * Decision: live_score > ANTI_SPOOF_THRESHOLD → PASS
 */
class AntiSpoofService(private val context: Context) {

    private var ortEnvironment: OrtEnvironment? = null
    private var sessionV2: OrtSession? = null
    private var sessionV1SE: OrtSession? = null

    @Volatile
    private var isInitialized = false

    /** Accumulated anti-spoof scores across sampled frames. */
    private val frameScores = mutableListOf<Float>()

    /**
     * Initialize ONNX Runtime and load anti-spoof model(s).
     */
    fun initialize() {
        if (isInitialized) return

        ortEnvironment = OrtEnvironment.getEnvironment()
        val env = ortEnvironment ?: return

        try {
            // Load primary model (MiniFASNetV2)
            val v2Bytes = context.assets.open(BiometricConfig.ANTI_SPOOF_MODEL_V2_PATH)
                .use { it.readBytes() }
            sessionV2 = env.createSession(v2Bytes)

            // Optionally load secondary model (MiniFASNetV1SE)
            if (BiometricConfig.USE_DUAL_ANTI_SPOOF) {
                try {
                    val v1seBytes = context.assets.open(BiometricConfig.ANTI_SPOOF_MODEL_V1SE_PATH)
                        .use { it.readBytes() }
                    sessionV1SE = env.createSession(v1seBytes)
                } catch (e: Exception) {
                    android.util.Log.w(TAG, "MiniFASNetV1SE not available, using V2 only", e)
                }
            }

            isInitialized = true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to initialize anti-spoof models", e)
        }
    }

    /**
     * Reset frame score accumulator for a new verification session.
     */
    fun reset() {
        frameScores.clear()
    }

    /**
     * Run anti-spoof inference on a single frame.
     *
     * @param frameBitmap Full camera frame bitmap
     * @param faceBoundingBox Detected face bounding box in pixel coordinates
     * @return Anti-spoof result for this frame
     */
    fun analyzeFrame(frameBitmap: Bitmap, faceBoundingBox: RectF): AntiSpoofResult {
        if (!isInitialized || sessionV2 == null) {
            return AntiSpoofResult(
                liveScore = 0f,
                printAttackScore = 0f,
                replayAttackScore = 0f,
                isLive = false,
                error = "Anti-spoof model not initialized"
            )
        }

        try {
            // 1. Crop face with 2.7× scale expansion
            val croppedBitmap = cropFaceWithScale(
                frameBitmap, faceBoundingBox, BiometricConfig.ANTI_SPOOF_CROP_SCALE
            )

            // 2. Resize to 80×80
            val resized = Bitmap.createScaledBitmap(
                croppedBitmap,
                BiometricConfig.ANTI_SPOOF_INPUT_SIZE,
                BiometricConfig.ANTI_SPOOF_INPUT_SIZE,
                true
            )

            // 3. Preprocess: RGB→BGR, normalize /255, NCHW format
            val inputTensor = preprocessForMiniFASNet(resized)

            // 4. Run inference on V2
            val v2Scores = runInference(sessionV2!!, inputTensor)

            // 5. Optionally run V1SE and average
            val finalScores = if (sessionV1SE != null) {
                val v1seScores = runInference(sessionV1SE!!, inputTensor)
                floatArrayOf(
                    (v2Scores[0] + v1seScores[0]) / 2f,
                    (v2Scores[1] + v1seScores[1]) / 2f,
                    (v2Scores[2] + v1seScores[2]) / 2f
                )
            } else {
                v2Scores
            }

            val liveScore = finalScores[0]
            frameScores.add(liveScore)

            return AntiSpoofResult(
                liveScore = finalScores[0],
                printAttackScore = finalScores[1],
                replayAttackScore = finalScores[2],
                isLive = liveScore > BiometricConfig.ANTI_SPOOF_THRESHOLD,
                error = null
            )
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Anti-spoof inference error", e)
            return AntiSpoofResult(
                liveScore = 0f, printAttackScore = 0f, replayAttackScore = 0f,
                isLive = false, error = e.message
            )
        }
    }

    /**
     * Get the aggregated anti-spoof decision across all sampled frames.
     * Uses median of accumulated live scores for robustness.
     */
    fun getAggregatedResult(): AntiSpoofAggregatedResult {
        if (frameScores.isEmpty()) {
            return AntiSpoofAggregatedResult(
                passed = false,
                medianLiveScore = 0f,
                frameCount = 0,
                reason = "No anti-spoof frames analyzed"
            )
        }

        val sorted = frameScores.sorted()
        val median = sorted[sorted.size / 2]
        val passed = median > BiometricConfig.ANTI_SPOOF_THRESHOLD

        return AntiSpoofAggregatedResult(
            passed = passed,
            medianLiveScore = median,
            frameCount = frameScores.size,
            reason = if (!passed) "Presentation attack detected. Median live score: ${"%.3f".format(median)}" else null
        )
    }

    /**
     * Crop face region from frame with scale expansion.
     */
    private fun cropFaceWithScale(frame: Bitmap, box: RectF, scale: Float): Bitmap {
        val centerX = (box.left + box.right) / 2f
        val centerY = (box.top + box.bottom) / 2f
        val boxWidth = box.width()
        val boxHeight = box.height()

        val newWidth = boxWidth * scale
        val newHeight = boxHeight * scale

        val left = maxOf(0f, centerX - newWidth / 2f).toInt()
        val top = maxOf(0f, centerY - newHeight / 2f).toInt()
        val right = minOf(frame.width.toFloat(), centerX + newWidth / 2f).toInt()
        val bottom = minOf(frame.height.toFloat(), centerY + newHeight / 2f).toInt()

        val cropWidth = maxOf(1, right - left)
        val cropHeight = maxOf(1, bottom - top)

        return Bitmap.createBitmap(frame, left, top, cropWidth, cropHeight)
    }

    /**
     * Preprocess bitmap for MiniFASNet:
     * - RGB → BGR channel swap
     * - Normalize: pixel / 255.0
     * - Transpose to [1, 3, 80, 80] NCHW planar format
     */
    private fun preprocessForMiniFASNet(bitmap: Bitmap): FloatBuffer {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        // [1, 3, H, W] = 3 * 80 * 80 = 19200 floats
        val buffer = FloatBuffer.allocate(3 * h * w)

        // Channel order: BGR (reversed from Android ARGB)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val pixel = pixels[y * w + x]
                val r = ((pixel shr 16) and 0xFF) / 255f
                val g = ((pixel shr 8) and 0xFF) / 255f
                val b = (pixel and 0xFF) / 255f

                // BGR channel-first planar layout
                val pixelIdx = y * w + x
                buffer.put(0 * h * w + pixelIdx, b)   // Blue channel
                buffer.put(1 * h * w + pixelIdx, g)   // Green channel
                buffer.put(2 * h * w + pixelIdx, r)   // Red channel
            }
        }

        buffer.rewind()
        return buffer
    }

    /**
     * Run ONNX inference and extract 3-class softmax output.
     */
    private fun runInference(session: OrtSession, input: FloatBuffer): FloatArray {
        val env = ortEnvironment ?: throw IllegalStateException("ORT environment not initialized")

        val inputName = session.inputNames.first()
        val shape = longArrayOf(1, 3,
            BiometricConfig.ANTI_SPOOF_INPUT_SIZE.toLong(),
            BiometricConfig.ANTI_SPOOF_INPUT_SIZE.toLong()
        )

        val tensor = OnnxTensor.createTensor(env, input, shape)
        val results = session.run(mapOf(inputName to tensor))
        val outputTensor = results[0].value

        tensor.close()

        // Parse output — expected shape [1, 3]
        return when (outputTensor) {
            is Array<*> -> {
                @Suppress("UNCHECKED_CAST")
                val outer = outputTensor as Array<FloatArray>
                outer[0]
            }
            is FloatArray -> outputTensor
            else -> floatArrayOf(0f, 0f, 0f)
        }
    }

    fun close() {
        sessionV2?.close()
        sessionV1SE?.close()
        sessionV2 = null
        sessionV1SE = null
        isInitialized = false
    }

    companion object {
        private const val TAG = "AntiSpoofService"
    }
}

data class AntiSpoofResult(
    val liveScore: Float,
    val printAttackScore: Float,
    val replayAttackScore: Float,
    val isLive: Boolean,
    val error: String?
)

data class AntiSpoofAggregatedResult(
    val passed: Boolean,
    val medianLiveScore: Float,
    val frameCount: Int,
    val reason: String?
)
