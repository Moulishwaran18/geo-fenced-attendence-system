package com.campusattend.biometric.bridge

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Native Android PDF Download & Local Storage Bridge.
 *
 * Saves generated Monthly Attendance PDFs directly to:
 * Internal Storage/Download/CampusAttend/
 *
 * Fully supports Android 10 through Android 15 via MediaStore.Downloads API
 * and provides legacy fallback for older versions without unnecessary runtime permissions.
 */
class AndroidPdfBridge(
    private val context: Context,
    private val activity: Activity? = null,
    private val webView: WebView? = null
) {
    companion object {
        private const val TAG = "AndroidPdfBridge"
        private const val DEFAULT_FOLDER = "CampusAttend"
        private const val MIME_TYPE_PDF = "application/pdf"

        @Volatile
        var lastSavedUri: Uri? = null
            private set

        @Volatile
        var lastSavedPath: String? = null
            private set

        /**
         * Cleans Base64 input and decodes it safely to ByteArray.
         */
        fun decodePdfBase64(rawBase64: String): ByteArray {
            var clean = rawBase64.trim()
            val commaIdx = clean.indexOf(",")
            if (commaIdx != -1) {
                clean = clean.substring(commaIdx + 1)
            }
            clean = clean.replace("\n", "").replace("\r", "").replace(" ", "")
            return Base64.decode(clean, Base64.DEFAULT)
        }

        /**
         * Sanitizes filename ensuring safe filesystem characters and .pdf extension.
         */
        fun sanitizeFilename(filename: String?): String {
            if (filename.isNullOrBlank()) {
                return "CampusAttend_Monthly_Attendance_Report.pdf"
            }
            var clean = filename.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_")
            if (!clean.endsWith(".pdf", ignoreCase = true)) {
                clean += ".pdf"
            }
            return clean
        }

        /**
         * Authoritative method to save PDF directly to phone's MediaStore Downloads directory.
         * Target location: Internal Storage/Download/CampusAttend/
         * Supports Android 10 (API 29) through Android 15 (API 35) and legacy versions.
         */
        fun savePdfToDownloads(
            context: Context,
            pdfBytes: ByteArray,
            safeFilename: String
        ): Pair<Uri, String> {
            if (pdfBytes.isEmpty()) {
                throw IOException("PDF byte array is empty")
            }

            // Verify PDF magic header bytes (%PDF)
            if (pdfBytes.size >= 4) {
                val header = String(pdfBytes.copyOfRange(0, 4))
                if (!header.startsWith("%PDF")) {
                    Log.w(TAG, "Notice: PDF header does not start with %PDF, received header: $header")
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // MediaStore.Downloads API for Android 10 through Android 15 (API 29 to 35)
                val resolver = context.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeFilename)
                    put(MediaStore.Downloads.MIME_TYPE, MIME_TYPE_PDF)
                    put(MediaStore.Downloads.RELATIVE_PATH, "Download/$DEFAULT_FOLDER")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }

                val collectionUri = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val itemUri = resolver.insert(collectionUri, values)
                    ?: resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("Failed to create MediaStore entry for $safeFilename")

                resolver.openOutputStream(itemUri, "w")?.use { outputStream ->
                    outputStream.write(pdfBytes)
                    outputStream.flush()
                } ?: throw IOException("Failed to open output stream for MediaStore item: $itemUri")

                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(itemUri, values, null, null)

                val displayPath = "Internal Storage/Download/$DEFAULT_FOLDER/$safeFilename"
                lastSavedUri = itemUri
                lastSavedPath = displayPath
                Log.i(TAG, "Successfully saved PDF via MediaStore to: $displayPath (URI: $itemUri, Bytes: ${pdfBytes.size})")
                return Pair(itemUri, displayPath)
            } else {
                // Pre-Android 10 fallback
                @Suppress("DEPRECATION")
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val targetDir = File(downloadsDir, DEFAULT_FOLDER)
                if (!targetDir.exists()) {
                    targetDir.mkdirs()
                }
                val targetFile = File(targetDir, safeFilename)
                FileOutputStream(targetFile).use { fos ->
                    fos.write(pdfBytes)
                    fos.flush()
                }
                val fileUri = Uri.fromFile(targetFile)
                MediaScannerConnection.scanFile(
                    context,
                    arrayOf(targetFile.absolutePath),
                    arrayOf(MIME_TYPE_PDF),
                    null
                )
                val displayPath = targetFile.absolutePath
                lastSavedUri = fileUri
                lastSavedPath = displayPath
                Log.i(TAG, "Successfully saved PDF to filesystem: $displayPath (Bytes: ${pdfBytes.size})")
                return Pair(fileUri, displayPath)
            }
        }

        /**
         * Core save entry point callable from anywhere in the app.
         */
        fun executeSavePdf(
            context: Context,
            base64Data: String,
            filename: String?,
            activity: Activity? = null,
            openAfterSave: Boolean = false
        ): String {
            val response = JSONObject()
            try {
                val safeName = sanitizeFilename(filename)
                val pdfBytes = decodePdfBase64(base64Data)
                val (uri, displayPath) = savePdfToDownloads(context, pdfBytes, safeName)

                // Show native Android Toast notification on main thread
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(
                        context.applicationContext,
                        "PDF Downloaded Successfully\n$safeName\nLocation: Download/$DEFAULT_FOLDER",
                        Toast.LENGTH_LONG
                    ).show()

                    if (openAfterSave && activity != null) {
                        openPdfIntent(activity, uri)
                    }
                }

                response.put("success", true)
                response.put("filename", safeName)
                response.put("location", "Internal Storage / Download / $DEFAULT_FOLDER")
                response.put("displayPath", displayPath)
                response.put("uri", uri.toString())
                response.put("sizeBytes", pdfBytes.size)
                return response.toString()
            } catch (e: Exception) {
                Log.e(TAG, "Error saving PDF: ${e.message}", e)
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(
                        context.applicationContext,
                        "PDF Download Failed: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
                response.put("success", false)
                response.put("error", e.message ?: "Unknown error while saving PDF")
                return response.toString()
            }
        }

        /**
         * Launch installed PDF viewer with grant read URI permission.
         */
        fun openPdfIntent(activity: Activity, uri: Uri): Boolean {
            return try {
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, MIME_TYPE_PDF)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val chooser = Intent.createChooser(intent, "Open Monthly Attendance PDF").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(chooser)
                Log.i(TAG, "Opened PDF viewer for URI: $uri")
                true
            } catch (e: Exception) {
                Log.w(TAG, "Unable to open PDF viewer for URI: $uri. Error: ${e.message}")
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(
                        activity,
                        "No PDF reader app found. File saved in Download/$DEFAULT_FOLDER",
                        Toast.LENGTH_LONG
                    ).show()
                }
                false
            }
        }
    }

    /**
     * JavaScript Interface method called by frontend:
     * window.AndroidPdfBridge.downloadPdf(base64Data, filename)
     */
    @JavascriptInterface
    fun downloadPdf(base64Data: String, filename: String): String {
        Log.i(TAG, "downloadPdf invoked from JavaScript for filename: $filename, dataLength: ${base64Data.length}")
        val result = executeSavePdf(context, base64Data, filename, activity, openAfterSave = false)

        // Broadcast DOM custom event to WebView if available
        activity?.runOnUiThread {
            try {
                webView?.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('campusattend:pdf-downloaded', { detail: $result }));",
                    null
                )
            } catch (_: Exception) {}
        }
        return result
    }

    /**
     * JavaScript Interface method to open the downloaded PDF:
     * window.AndroidPdfBridge.openDownloadedPdf(uriString)
     */
    @JavascriptInterface
    fun openDownloadedPdf(uriString: String? = null): Boolean {
        val targetUri = if (!uriString.isNullOrBlank()) {
            Uri.parse(uriString)
        } else {
            lastSavedUri
        } ?: return false

        return if (activity != null) {
            activity.runOnUiThread {
                openPdfIntent(activity, targetUri)
            }
            true
        } else {
            false
        }
    }

    /**
     * Quick check if native PDF download bridge is available.
     */
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    /**
     * Get storage path description for UI display.
     */
    @JavascriptInterface
    fun getDownloadFolder(): String = "Internal Storage / Download / $DEFAULT_FOLDER"
}
