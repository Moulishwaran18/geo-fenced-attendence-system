package com.campusattend.biometric.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.campusattend.biometric.config.BiometricConfig
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * CameraX service managing front camera lifecycle, preview, and frame analysis.
 *
 * Requirements:
 * - Front camera only
 * - Continuous preview
 * - ImageAnalysis pipeline with controlled frame rate
 * - Proper resource cleanup
 * - Does not block the UI thread
 */
class CameraService(private val context: Context) {

    private var cameraProvider: ProcessCameraProvider? = null
    private val analysisExecutor = Executors.newSingleThreadExecutor()

    @Volatile
    private var lastAnalysisTimestamp = 0L

    /**
     * Bind camera to lifecycle with preview and frame analysis.
     *
     * @param lifecycleOwner Activity/Fragment lifecycle
     * @param previewView CameraX PreviewView for displaying camera feed
     * @param onFrame Callback invoked with each analyzed Bitmap frame (on analysis thread)
     */
    fun startCamera(
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView,
        onFrame: (Bitmap, Int) -> Unit  // bitmap, rotation degrees
    ) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            val provider = cameraProviderFuture.get()
            cameraProvider = provider

            val preview = Preview.Builder()
                .build()
                .also { it.setSurfaceProvider(previewView.surfaceProvider) }

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build()
                .also { analysis ->
                    analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                        processFrame(imageProxy, onFrame)
                    }
                }

            val cameraSelector = CameraSelector.Builder()
                .requireLensFacing(CameraSelector.LENS_FACING_FRONT)
                .build()

            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    imageAnalysis
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "Camera binding failed", e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /**
     * Process a single camera frame with throttling.
     * Converts YUV_420_888 → Bitmap and invokes the callback.
     */
    private fun processFrame(
        imageProxy: ImageProxy,
        onFrame: (Bitmap, Int) -> Unit
    ) {
        val now = System.currentTimeMillis()
        if (now - lastAnalysisTimestamp < BiometricConfig.ANALYSIS_INTERVAL_MS) {
            imageProxy.close()
            return
        }
        lastAnalysisTimestamp = now

        try {
            val bitmap = imageProxyToBitmap(imageProxy)
            if (bitmap != null) {
                onFrame(bitmap, imageProxy.imageInfo.rotationDegrees)
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Frame processing error", e)
        } finally {
            imageProxy.close()
        }
    }

    /**
     * Convert ImageProxy (YUV_420_888) to Bitmap (ARGB_8888).
     * Applies rotation correction for the front camera.
     */
    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        val yBuffer = imageProxy.planes[0].buffer
        val uBuffer = imageProxy.planes[1].buffer
        val vBuffer = imageProxy.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(
            nv21,
            ImageFormat.NV21,
            imageProxy.width,
            imageProxy.height,
            null
        )

        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(
            Rect(0, 0, imageProxy.width, imageProxy.height),
            90,
            out
        )

        val jpegBytes = out.toByteArray()
        val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size) ?: return null

        // Apply rotation and horizontal mirror for front camera
        val matrix = Matrix().apply {
            postRotate(imageProxy.imageInfo.rotationDegrees.toFloat())
            postScale(-1f, 1f) // Mirror for front camera
        }

        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    /**
     * Release camera resources.
     */
    fun stopCamera() {
        cameraProvider?.unbindAll()
        cameraProvider = null
    }

    /**
     * Shutdown the analysis executor thread pool.
     * Call this when the service is no longer needed.
     */
    fun shutdown() {
        stopCamera()
        analysisExecutor.shutdown()
    }

    companion object {
        private const val TAG = "CameraService"
    }
}
