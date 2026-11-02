package com.campusattend.biometric.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.campusattend.biometric.MainActivity
import com.campusattend.biometric.R
import java.util.UUID

/**
 * Authoritative Notification Manager for CampusAttend Android APK.
 *
 * Configures notification channels, requests permissions, and presents
 * high-priority status-bar reminder notifications that navigate directly to /mark-attendance.
 */
object AndroidNotificationManager {

    const val CHANNEL_ID = "campus_attendance_reminders"
    private const val CHANNEL_NAME = "Campus Attendance Reminders"
    private const val CHANNEL_DESC = "Automated institutional daily attendance reminder notifications"
    private const val PREFS_NAME = "campus_notification_prefs"
    private const val KEY_DEVICE_TOKEN = "device_fcm_token"
    private const val NOTIFICATION_ID = 4096

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = CHANNEL_DESC
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 350, 200, 350)
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }

            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            notificationManager?.createNotificationChannel(channel)
            Log.d("NotificationManager", "Created notification channel: $CHANNEL_ID")
        }
    }

    /**
     * Save the real Firebase Cloud Messaging token.
     */
    fun saveDeviceToken(context: Context, token: String) {
        if (token.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_DEVICE_TOKEN, token.trim()).apply()
        Log.i("NotificationManager", "Stored device push token: $token")
    }

    /**
     * Retrieve or persistently generate this device's notification push token.
     */
    fun getOrCreateDeviceToken(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var token = prefs.getString(KEY_DEVICE_TOKEN, null)
        if (token.isNullOrBlank()) {
            val randomPart = UUID.randomUUID().toString().replace("-", "").uppercase()
            token = "FCM_CAMPUS_${randomPart}"
            prefs.edit().putString(KEY_DEVICE_TOKEN, token).apply()
            Log.d("NotificationManager", "Generated new push device token: $token")
        }
        return token
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
            Log.i("NotificationManager", "Presented attendance reminder notification to user.")
            true
        } catch (e: Exception) {
            Log.e("NotificationManager", "Failed to present notification: ${e.message}", e)
            false
        }
    }
}

