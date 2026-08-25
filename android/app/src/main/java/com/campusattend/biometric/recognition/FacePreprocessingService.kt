package com.campusattend.biometric.recognition

import android.graphics.Bitmap
import com.campusattend.biometric.config.BiometricConfig
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Shared face preprocessing service for ArcFace recognition.
 *
 * Port of: src/lib/face-recognition/arcface-engine.ts (alignment logic)
 *
 * Used by BOTH enrollment and verification to ensure consistent preprocessing.
 * This is the SINGLE source of truth for face alignment/crop/normalize.
 *
 * Pipeline:
 * 1. Extract 5-point landmarks from detection
 * 2. Compute Umeyama similarity transform to ArcFace reference coordinates
 * 3. Warp + bilinear interpolate to 112×112
 * 4. Normalize: (pixel - 127.5) / 128.0
 * 5. Output: Float array in [1, 3, 112, 112] planar RGB format
 */
class FacePreprocessingService {

    companion object {
        /**
         * Standard ArcFace 5-Point Reference Coordinates in 112×112 target space.
         * These are the canonical positions where ArcFace expects facial features.
         */
        val ARCFACE_REFERENCE_POINTS = arrayOf(
            floatArrayOf(38.2946f, 51.6963f),  // left eye
            floatArrayOf(73.5318f, 51.5014f),  // right eye
            floatArrayOf(56.0252f, 71.7366f),  // nose tip
            floatArrayOf(41.5493f, 92.3655f),  // left mouth corner
            floatArrayOf(70.7299f, 92.2041f)   // right mouth corner
        )
    }

    /**
     * Align face and generate the input tensor for ArcFace.
     *
     * @param sourceBitmap Full camera frame or image
     * @param landmarks5 5-point face landmarks [leftEye, rightEye, nose, leftMouth, rightMouth]
     *                    in pixel coordinates of the source bitmap
     * @return Float array [1, 3, 112, 112] ready for ONNX inference
     */
    fun alignFaceToTensor(sourceBitmap: Bitmap, landmarks5: Array<FloatArray>): FloatArray {
        val width = sourceBitmap.width
        val height = sourceBitmap.height

        // Get pixel data from bitmap
        val pixels = IntArray(width * height)
        sourceBitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        // Compute similarity transform (Umeyama algorithm)
        val (_, invM) = estimateSimilarityTransform(landmarks5, ARCFACE_REFERENCE_POINTS)

        val outW = BiometricConfig.ARCFACE_INPUT_SIZE
        val outH = BiometricConfig.ARCFACE_INPUT_SIZE

        // [1, 3, 112, 112] planar float tensor
        val floatPlanar = FloatArray(3 * outW * outH)

        for (dy in 0 until outH) {
            for (dx in 0 until outW) {
                // Inverse warp: map output pixel to source pixel
                val sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2]
                val sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2]

                val x0 = floor(sx).toInt()
                val y0 = floor(sy).toInt()
                val x1 = min(x0 + 1, width - 1)
                val y1 = min(y0 + 1, height - 1)

                val wx = sx - x0
                val wy = sy - y0

                var r = 0f
                var g = 0f
                var b = 0f

                if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
                    val p00 = pixels[y0 * width + x0]
                    val p10 = pixels[y0 * width + x1]
                    val p01 = pixels[y1 * width + x0]
                    val p11 = pixels[y1 * width + x1]

                    // Bilinear interpolation for each channel
                    r = (1 - wx) * (1 - wy) * ((p00 shr 16) and 0xFF) +
                        wx * (1 - wy) * ((p10 shr 16) and 0xFF) +
                        (1 - wx) * wy * ((p01 shr 16) and 0xFF) +
                        wx * wy * ((p11 shr 16) and 0xFF)

                    g = (1 - wx) * (1 - wy) * ((p00 shr 8) and 0xFF) +
                        wx * (1 - wy) * ((p10 shr 8) and 0xFF) +
                        (1 - wx) * wy * ((p01 shr 8) and 0xFF) +
                        wx * wy * ((p11 shr 8) and 0xFF)

                    b = (1 - wx) * (1 - wy) * (p00 and 0xFF) +
                        wx * (1 - wy) * (p10 and 0xFF) +
                        (1 - wx) * wy * (p01 and 0xFF) +
                        wx * wy * (p11 and 0xFF)
                }

                // ArcFace normalization: (pixel - 127.5) / 128.0
                val pixelIdx = dy * outW + dx
                floatPlanar[0 * outW * outH + pixelIdx] = (r - 127.5f) / 128.0f  // R
                floatPlanar[1 * outW * outH + pixelIdx] = (g - 127.5f) / 128.0f  // G
                floatPlanar[2 * outW * outH + pixelIdx] = (b - 127.5f) / 128.0f  // B
            }
        }

        return floatPlanar
    }

    /**
     * Compute 2D Similarity Transform using Umeyama algorithm.
     *
     * Port of: estimateSimilarityTransform from arcface-engine.ts
     *
     * Returns forward transform M and inverse transform invM.
     */
    fun estimateSimilarityTransform(
        src: Array<FloatArray>,
        dst: Array<FloatArray> = ARCFACE_REFERENCE_POINTS
    ): Pair<Array<FloatArray>, Array<FloatArray>> {
        val n = src.size

        var srcMeanX = 0f; var srcMeanY = 0f
        var dstMeanX = 0f; var dstMeanY = 0f

        for (i in 0 until n) {
            srcMeanX += src[i][0]; srcMeanY += src[i][1]
            dstMeanX += dst[i][0]; dstMeanY += dst[i][1]
        }
        srcMeanX /= n; srcMeanY /= n
        dstMeanX /= n; dstMeanY /= n

        var srcVar = 0f
        for (i in 0 until n) {
            val dx = src[i][0] - srcMeanX
            val dy = src[i][1] - srcMeanY
            srcVar += dx * dx + dy * dy
        }
        srcVar /= n
        if (srcVar == 0f) srcVar = 1e-6f

        var sxx = 0f; var sxy = 0f; var syx = 0f; var syy = 0f
        for (i in 0 until n) {
            val sx = src[i][0] - srcMeanX
            val sy = src[i][1] - srcMeanY
            val ddx = dst[i][0] - dstMeanX
            val ddy = dst[i][1] - dstMeanY
            sxx += ddx * sx; sxy += ddx * sy
            syx += ddy * sx; syy += ddy * sy
        }
        sxx /= n; sxy /= n; syx /= n; syy /= n

        val a = (sxx + syy) / srcVar
        val b = (sxy - syx) / srcVar
        val tx = dstMeanX - (a * srcMeanX - b * srcMeanY)
        val ty = dstMeanY - (b * srcMeanX + a * srcMeanY)

        val det = a * a + b * b
        val detSafe = if (det == 0f) 1e-6f else det
        val invA = a / detSafe
        val invB = -b / detSafe
        val invTx = (-a * tx - b * ty) / detSafe
        val invTy = (b * tx - a * ty) / detSafe

        val M = arrayOf(
            floatArrayOf(a, -b, tx),
            floatArrayOf(b, a, ty)
        )
        val invM = arrayOf(
            floatArrayOf(invA, -invB, invTx),
            floatArrayOf(invB, invA, invTy)
        )

        return Pair(M, invM)
    }
}
