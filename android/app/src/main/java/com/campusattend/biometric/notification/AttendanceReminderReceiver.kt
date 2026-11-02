package com.campusattend.biometric.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BroadcastReceiver triggered by Android AlarmManager at the administrator-configured
 * reminder times, even when the application is backgrounded or completely closed.
 */
class AttendanceReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        Log.i(TAG, "AttendanceReminderReceiver received intent action: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Log.i(TAG, "Phone rebooted or package updated; restoring scheduled alarms.")
            AttendanceAlarmScheduler.rescheduleFromPreferences(context)
            return
        }

        val slot = intent?.getStringExtra("slot") ?: "first"
        val title = intent?.getStringExtra("title") ?: "CampusAttend – Attendance Reminder"
        val message = intent?.getStringExtra("message")
            ?: "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification."
        val route = intent?.getStringExtra("destination") ?: intent?.getStringExtra("route") ?: "/mark-attendance"

        Log.i(TAG, "Executing background attendance reminder alarm for slot: $slot")

        // Display high-priority status bar notification via Android Notification Manager
        AndroidNotificationManager.showAttendanceReminder(
            context = context,
            title = title,
            message = message,
            destinationRoute = route
        )

        // Reschedule recurring alarm for next working day
        if (slot != "test") {
            AttendanceAlarmScheduler.scheduleNextOccurrence(context, slot)
        }
    }

    companion object {
        private const val TAG = "AttendanceReminderRcvr"
    }
}
