package com.campusattend.biometric.notification

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Service to handle Firebase Cloud Messaging push events when CampusAttend is
 * open, backgrounded, or completely closed.
 */
class CampusFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "FCM registration token refreshed: $token")
        AndroidNotificationManager.saveDeviceToken(applicationContext, token, isRealFcm = true)
        com.campusattend.biometric.CampusAttendApp.initFirebase(applicationContext)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.i(TAG, "FCM remote push message received from: ${remoteMessage.from}")

        val title = remoteMessage.notification?.title
            ?: remoteMessage.data["title"]
            ?: "CampusAttend – Attendance Reminder"

        val body = remoteMessage.notification?.body
            ?: remoteMessage.data["message"]
            ?: remoteMessage.data["body"]
            ?: "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification."

        val route = remoteMessage.data["route"]
            ?: remoteMessage.data["destinationRoute"]
            ?: "/mark-attendance"

        AndroidNotificationManager.showAttendanceReminder(
            context = applicationContext,
            title = title,
            message = body,
            destinationRoute = route
        )
    }

    companion object {
        private const val TAG = "CampusFCMService"
    }
}

