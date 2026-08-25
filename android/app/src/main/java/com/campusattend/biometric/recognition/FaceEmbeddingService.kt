package com.campusattend.biometric.recognition

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import com.campusattend.biometric.config.BiometricConfig
import java.nio.FloatBuffer
import kotlin.math.sqrt

/**
 * ArcFace face embedding service using ONNX Runtime Mobile.
 *
 * Model: MobileFaceNet ArcFace (w600k_mbf.onnx, trained on MS1M-w600k)
 * Input: [1, 3, 112, 112] RGB face crop normalized with (x - 127.5) / 128.0
 * Output: 512-dimensional L2-normalized biometric embedding vector
 *
 * This is the SAME model already used in the web version (onnxruntime-web),
 * now running natively via onnxruntime-android.
 */
class FaceEmbeddingService(private val context: Context) {

    private var ortEnvironment: OrtEnvironment? = null
    private var session: OrtSession? = null

    @Volatile
    private var isInitialized = false

    /**
     * Initialize the ONNX Runtime session with the ArcFace model.
     */
    fun initialize() {
        if (isInitialized) return

        ortEnvironment = OrtEnvironment.getEnvironment()
        val env = ortEnvironment ?: return

        try {
            val modelBytes = context.assets.open(BiometricConfig.ARCFACE_MODEL_PATH)
                .use { it.readBytes() }

            val sessionOptions = OrtSession.SessionOptions().apply {
                setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
                setIntraOpNumThreads(2)
            }

            session = env.createSession(modelBytes, sessionOptions)
            isInitialized = true

            // Log model info
            session?.let { s ->
                android.util.Log.i(TAG, "ArcFace model loaded successfully")
                android.util.Log.i(TAG, "Input: ${s.inputNames.joinToString()}")
                android.util.Log.i(TAG, "Output: ${s.outputNames.joinToString()}")
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to initialize ArcFace ONNX session", e)
        }
    }

    /**
     * Generate a 512-dimensional L2-normalized face embedding.
     *
     * @param alignedTensorData Preprocessed face tensor from FacePreprocessingService
     *                          Shape: [3 * 112 * 112] = 37632 floats
     * @return 512-float normalized embedding vector, or null on error
     */
    fun generateEmbedding(alignedTensorData: FloatArray): FloatArray? {
        val env = ortEnvironment ?: return null
        val sess = session ?: return null

        try {
            val inputBuffer = FloatBuffer.wrap(alignedTensorData)
            val shape = longArrayOf(1, 3,
                BiometricConfig.ARCFACE_INPUT_SIZE.toLong(),
                BiometricConfig.ARCFACE_INPUT_SIZE.toLong()
            )

            val inputTensor = OnnxTensor.createTensor(env, inputBuffer, shape)
            val inputName = sess.inputNames.first()

            val results = sess.run(mapOf(inputName to inputTensor))
            inputTensor.close()

            val outputTensor = results[0].value

            // Parse output — expected [1, 512]
            val rawEmbedding = when (outputTensor) {
                is Array<*> -> {
                    @Suppress("UNCHECKED_CAST")
                    (outputTensor as Array<FloatArray>)[0]
                }
                is FloatArray -> outputTensor
                else -> {
                    android.util.Log.e(TAG, "Unexpected output type: ${outputTensor?.javaClass}")
                    return null
                }
            }

            if (rawEmbedding.size != BiometricConfig.EMBEDDING_DIMENSION) {
                android.util.Log.e(TAG,
                    "Unexpected embedding dimension: expected ${BiometricConfig.EMBEDDING_DIMENSION}, got ${rawEmbedding.size}")
                return null
            }

            // L2 normalization: ||v|| = 1
            var norm = 0f
            for (v in rawEmbedding) {
                norm += v * v
            }
            norm = sqrt(norm)
            if (norm < 1e-6f) norm = 1e-6f

            val normalized = FloatArray(rawEmbedding.size)
            for (i in rawEmbedding.indices) {
                normalized[i] = rawEmbedding[i] / norm
            }

            return normalized
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Embedding inference error", e)
            return null
        }
    }

    fun isLoaded(): Boolean = isInitialized

    fun close() {
        session?.close()
        session = null
        isInitialized = false
    }

    companion object {
        private const val TAG = "FaceEmbeddingService"
    }
}
