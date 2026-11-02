package com.campusattend.biometric

import android.app.Application
import com.campusattend.biometric.data.AppDatabase
import com.campusattend.biometric.notification.AndroidNotificationManager

/**
 * Application class for CampusAttend Biometric.
 *
 * Initializes the Room database singleton on app start.
 * Pre-registers the institutional notification channel immediately so Android OS
 * unblocks the notification toggle in System Settings.
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
    }

    companion object {
        lateinit var instance: CampusAttendApp
            private set
    }
}
