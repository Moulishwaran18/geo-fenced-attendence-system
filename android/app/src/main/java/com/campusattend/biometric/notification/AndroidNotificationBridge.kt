package com.campusattend.biometric.notification

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * JavaScript Bridge for Android Notification Operations.
 *
 * Exposes device push registration, notification permission telemetry,
 * and high-priority native notification dispatching to the CampusAttend WebView.
 */
class AndroidNotificationBridge(
    private val context: Context,
    private val activity: Activity?,
    private val webView: WebView?
) {

    @JavascriptInterface
    fun getDeviceToken(): String {
        return AndroidNotificationManager.getOrCreateDeviceToken(context)
    }

    @JavascriptInterface
    fun getPermissionStatus(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // Android 12 and below: Notifications granted automatically at install
            return "granted"
        }
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED

        return if (granted) "granted" else "denied"
    }

    @JavascriptInterface
    fun requestPermission(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted"
        }
        val act = activity ?: return getPermissionStatus()
        val alreadyGranted = ContextCompat.checkSelfPermission(
            act,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED

        if (alreadyGranted) return "granted"

        ActivityCompat.requestPermissions(
            act,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            2002
        )
        return "requested"
    }

    @JavascriptInterface
    fun showNotification(title: String, message: String, route: String?): Boolean {
        val dest = if (route.isNullOrBlank()) "/mark-attendance" else route
        return AndroidNotificationManager.showAttendanceReminder(
            context,
            title,
            message,
            dest
        )
    }

    @JavascriptInterface
    fun getNotificationChannelInfo(): String {
        val json = JSONObject()
        json.put("channelId", AndroidNotificationManager.CHANNEL_ID)
        json.put("sdkVersion", Build.VERSION.SDK_INT)
        json.put("permissionStatus", getPermissionStatus())
        json.put("deviceToken", getDeviceToken())
        return json.toString()
    }
}

