package com.campusattend.biometric.notification

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.campusattend.biometric.MainActivity
import org.json.JSONObject

/**
 * JavaScript Bridge for Android Notification Operations.
 *
 * Exposes device push registration, notification permission telemetry,
 * application settings navigation, and high-priority native notification dispatching
 * to the CampusAttend WebView.
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
        // 1. Check master application notification setting in Android system
        val systemEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (!systemEnabled) {
            return "denied"
        }

        // 2. Check Android 13+ runtime POST_NOTIFICATIONS permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val runtimeGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!runtimeGranted) {
                return "denied"
            }
        }

        // 3. Check notification channel status
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val channel = nm?.getNotificationChannel(AndroidNotificationManager.CHANNEL_ID)
            if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) {
                return "denied"
            }
        }

        return "granted"
    }

    @JavascriptInterface
    fun requestPermission(): String {
        val currentStatus = getPermissionStatus()
        if (currentStatus == "granted") return "granted"

        val mainActivity = activity as? MainActivity
        if (mainActivity != null) {
            mainActivity.requestNotificationPermission()
            return "requested"
        }

        return currentStatus
    }

    @JavascriptInterface
    fun openNotificationSettings(): Boolean {
        val mainActivity = activity as? MainActivity
        if (mainActivity != null) {
            mainActivity.openAppNotificationSettings()
            return true
        }

        return try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", context.packageName, null)
                }
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e("NotificationBridge", "Failed to open notification settings: ${e.message}", e)
            false
        }
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

