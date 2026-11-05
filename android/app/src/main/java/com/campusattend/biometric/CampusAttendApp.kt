package com.campusattend.biometric

import android.app.Application
import android.content.Context
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
        initFirebase(this)
    }

    companion object {
        lateinit var instance: CampusAttendApp
            private set

        @Volatile
        var isFirebaseInitialized: Boolean = false
            private set

        @Volatile
        var fcmToken: String? = null
            private set

        @Volatile
        var fcmStatus: String = "NOT_STARTED"
            private set

        @Volatile
        var fcmError: String? = null
            private set

        @Volatile
        var fcmInitTimestamp: Long = 0L
            private set

        fun initFirebase(context: Context) {
            try {
                val app = FirebaseApp.initializeApp(context)
                isFirebaseInitialized = (app != null)
                fcmStatus = if (app != null) "INITIALIZED_PENDING_TOKEN" else "APP_NULL"
                fcmInitTimestamp = System.currentTimeMillis()
                Log.i("CampusAttendApp", "FirebaseApp.initializeApp() completed. App name: ${app?.name}")

                fetchFcmToken(context)
            } catch (e: Exception) {
                isFirebaseInitialized = false
                fcmStatus = "INIT_FAILED"
                fcmError = e.message ?: e.javaClass.simpleName
                Log.e("CampusAttendApp", "FirebaseApp.initializeApp() failed: ${e.message}", e)
            }
        }

        fun fetchFcmToken(context: Context, callback: ((Boolean, String?, String?) -> Unit)? = null) {
            try {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (task.isSuccessful && !task.result.isNullOrBlank()) {
                        val token = task.result
                        fcmToken = token
                        fcmStatus = "TOKEN_SUCCESS"
                        fcmError = null
                        AndroidNotificationManager.saveDeviceToken(context, token, isRealFcm = true)
                        Log.i("CampusAttendApp", "Retrieved real FCM token: ${token.take(6)}...${token.takeLast(6)}")
                        callback?.invoke(true, token, null)
                    } else {
                        val err = task.exception?.message ?: "Firebase token task failed without exception message"
                        fcmStatus = "TOKEN_FAILED"
                        fcmError = err
                        Log.w("CampusAttendApp", "FCM token fetch failed: $err", task.exception)
                        callback?.invoke(false, null, err)
                    }
                }
            } catch (e: Exception) {
                fcmStatus = "TOKEN_EXCEPTION"
                fcmError = e.message ?: e.javaClass.simpleName
                Log.e("CampusAttendApp", "Exception querying FirebaseMessaging token: ${e.message}", e)
                callback?.invoke(false, null, e.message)
            }
        }
    }
}
