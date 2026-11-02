package com.campusattend.biometric

import android.app.Application
import android.util.Log
import com.campusattend.biometric.data.AppDatabase
import com.campusattend.biometric.notification.AndroidNotificationManager
import com.campusattend.biometric.notification.AttendanceAlarmScheduler
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Application class for CampusAttend Biometric.
 *
 * Initializes the Room database singleton on app start.
 * Pre-registers the institutional notification channel immediately so Android OS
 * unblocks the notification toggle in System Settings.
 * Initializes Firebase Cloud Messaging and restores exact alarm schedules.
 * Model files (ONNX, MediaPipe) are loaded lazily by their respective services.
 */
class CampusAttendApp : Application() {

    lateinit var database: AppDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        database = AppDatabase.getInstance(this)

        // Initialize Android notification channel immediately upon application initialization
        // so that Android 13+ Settings -> Notifications channel switch is enabled and active.
        try {
            AndroidNotificationManager.createNotificationChannel(this)
        } catch (_: Exception) {}

        // Restore native background alarm schedules for daily attendance reminders
        try {
            AttendanceAlarmScheduler.rescheduleFromPreferences(this)
        } catch (_: Exception) {}

        // Initialize Firebase Cloud Messaging safely
        try {
            FirebaseApp.initializeApp(this)
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (task.isSuccessful && !task.result.isNullOrBlank()) {
                    val fcmToken = task.result
                    AndroidNotificationManager.saveDeviceToken(this, fcmToken)
                    Log.i("CampusAttendApp", "Retrieved Firebase Cloud Messaging token: $fcmToken")
                } else {
                    Log.d("CampusAttendApp", "FCM token not available; fallback token in use.")
                }
            }
        } catch (e: Exception) {
            Log.d("CampusAttendApp", "Firebase initialization deferred or using fallback: ${e.message}")
        }
    }

    companion object {
        lateinit var instance: CampusAttendApp
            private set
    }
}
