package com.campusattend.biometric.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.campusattend.biometric.CampusAttendApp
import com.campusattend.biometric.MainActivity
import com.campusattend.biometric.R
import org.json.JSONObject

/**
 * Authoritative Notification Manager for CampusAttend Android APK.
 *
 * Configures notification channels, requests permissions, and presents
 * high-priority status-bar reminder notifications that navigate directly to /mark-attendance.
 */
object AndroidNotificationManager {

    const val CHANNEL_ID = "campusattend_reminders_channel"
    const val LEGACY_CHANNEL_ID = "campus_attendance_reminders"
    private const val CHANNEL_NAME = "Campus Attendance Reminders"
    private const val CHANNEL_DESC = "Automated institutional daily attendance reminder notifications"
    private const val PREFS_NAME = "campus_notification_prefs"
    private const val KEY_DEVICE_TOKEN = "device_fcm_token"
    private const val KEY_IS_REAL_FCM = "device_is_real_fcm"
    private const val KEY_TOKEN_TIMESTAMP = "device_token_timestamp"
    private const val NOTIFICATION_ID = 4096

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return

            // 1. Primary canonical channel
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                description = CHANNEL_DESC
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 200, 350)
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(channel)

            // 2. Backward compatibility alias channel
            val legacyChannel = NotificationChannel(LEGACY_CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                description = CHANNEL_DESC
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 200, 350)
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(legacyChannel)

            Log.d("NotificationManager", "Created notification channels: $CHANNEL_ID, $LEGACY_CHANNEL_ID")
        }
    }

    /**
     * Save the real Firebase Cloud Messaging token.
     */
    fun saveDeviceToken(context: Context, token: String, isRealFcm: Boolean = true) {
        if (token.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_DEVICE_TOKEN, token.trim())
            .putBoolean(KEY_IS_REAL_FCM, isRealFcm)
            .putLong(KEY_TOKEN_TIMESTAMP, System.currentTimeMillis())
            .apply()
        Log.i("NotificationManager", "Stored device push token: $token (isRealFcm=$isRealFcm)")
    }

    /**
     * Retrieve the stored device notification push token.
     */
    fun getStoredDeviceToken(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_DEVICE_TOKEN, null)
    }

    /**
     * Check if the currently stored token is an authentic FCM token from Google Play Services.
     */
    fun isRealFcmToken(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_IS_REAL_FCM, false)
    }

    /**
     * Retrieve the active token or report status without generating fake/dummy tokens.
     */
    fun getOrCreateDeviceToken(context: Context): String {
        val stored = getStoredDeviceToken(context)
        if (!stored.isNullOrBlank()) {
            return stored
        }
        val memoryToken = CampusAttendApp.fcmToken
        if (!memoryToken.isNullOrBlank()) {
            saveDeviceToken(context, memoryToken, true)
            return memoryToken
        }
        return ""
    }

    /**
     * Retrieve detailed diagnostic status for the diagnostic screen.
     */
    fun getDiagnosticInfo(context: Context): JSONObject {
        createNotificationChannel(context)
        val json = JSONObject()

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        val nmCompat = NotificationManagerCompat.from(context)

        val areNotificationsEnabled = nmCompat.areNotificationsEnabled()
        var postNotificationsGranted = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            postNotificationsGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        }

        var channelImportance = -1
        var isChannelEnabled = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            val channel = nm.getNotificationChannel(CHANNEL_ID)
            if (channel != null) {
                channelImportance = channel.importance
                isChannelEnabled = channel.importance != NotificationManager.IMPORTANCE_NONE
            }
        }

        val storedToken = getStoredDeviceToken(context)
        val isReal = isRealFcmToken(context)
        val maskedToken = if (!storedToken.isNullOrBlank()) {
            if (storedToken.length > 12) {
                "${storedToken.take(6)}...${storedToken.takeLast(6)}"
            } else {
                "***"
            }
        } else {
            null
        }

        var isBatteryOptimized = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null) {
                isBatteryOptimized = !pm.isIgnoringBatteryOptimizations(context.packageName)
            }
        }

        json.put("firebaseInitialized", CampusAttendApp.isFirebaseInitialized)
        json.put("fcmStatus", CampusAttendApp.fcmStatus)
        json.put("fcmError", CampusAttendApp.fcmError)
        json.put("fcmTokenMasked", maskedToken)
        json.put("isRealFcmToken", isReal)
        json.put("areNotificationsEnabled", areNotificationsEnabled)
        json.put("postNotificationsGranted", postNotificationsGranted)
        json.put("permissionStatus", if (areNotificationsEnabled && postNotificationsGranted) "granted" else "denied")
        json.put("channelId", CHANNEL_ID)
        json.put("channelImportance", channelImportance)
        json.put("isChannelEnabled", isChannelEnabled)
        json.put("deviceManufacturer", Build.MANUFACTURER)
        json.put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
        json.put("androidVersion", Build.VERSION.RELEASE)
        json.put("sdkInt", Build.VERSION.SDK_INT)
        json.put("isBatteryOptimized", isBatteryOptimized)

        return json
    }

    /**
     * Show high-priority native notification in Android status bar.
     */
    fun showAttendanceReminder(
        context: Context,
        title: String,
        message: String,
        destinationRoute: String = "/mark-attendance"
    ): Boolean {
        createNotificationChannel(context)

        // Android 13+ permission check before presenting notification
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                Log.w("NotificationManager", "POST_NOTIFICATIONS permission not granted. Notification suppressed.")
                return false
            }
        }

        val areEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        if (!areEnabled) {
            Log.w("NotificationManager", "App notifications disabled in system settings. Notification suppressed.")
            return false
        }

        return try {
            val targetIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("destination", destinationRoute)
                putExtra("openedFromNotification", true)
                putExtra("notificationTimestamp", System.currentTimeMillis())
            }

            val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

            val pendingIntent = PendingIntent.getActivity(
                context,
                1001,
                targetIntent,
                pendingIntentFlags
            )

            val cleanTitle = if (title.isBlank()) "CampusAttend – Attendance Reminder" else title
            val cleanMessage = if (message.isBlank()) {
                "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification."
            } else {
                message
            }

            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(cleanTitle)
                .setContentText(cleanMessage)
                .setStyle(NotificationCompat.BigTextStyle().bigText(cleanMessage))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setVibrate(longArrayOf(0, 350, 200, 350))
                .addAction(
                    android.R.drawable.ic_menu_today,
                    "Mark Attendance",
                    pendingIntent
                )

            val manager = NotificationManagerCompat.from(context)
            manager.notify(NOTIFICATION_ID, builder.build())
            Log.i("NotificationManager", "Presented attendance reminder notification to user successfully.")
            true
        } catch (e: Exception) {
            Log.e("NotificationManager", "Failed to present notification: ${e.message}", e)
            false
        }
    }
}

