package com.campusattend.biometric.notification

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Native Android Background Reminder Scheduler.
 *
 * Uses AlarmManager.setExactAndAllowWhileIdle to wake up the device and dispatch
 * attendance reminders at the administrator-configured times even if CampusAttend
 * is backgrounded, asleep in Doze mode, or completely terminated/closed by the user.
 */
object AttendanceAlarmScheduler {

    private const val TAG = "AlarmScheduler"
    private const val PREFS_NAME = "campus_alarm_prefs"
    private const val KEY_TIME_1 = "reminder_time_1"
    private const val KEY_TIME_2 = "reminder_time_2"
    private const val KEY_TIME_2_ENABLED = "reminder_time_2_enabled"
    private const val KEY_DAYS = "applicable_days"
    private const val KEY_TIMEZONE = "timezone"

    private const val REQ_CODE_SLOT_1 = 2001
    private const val REQ_CODE_SLOT_2 = 2002
    private const val REQ_CODE_TEST = 2099

    fun scheduleDailyReminders(
        context: Context,
        time1: String,
        time2Enabled: Boolean = false,
        time2: String = "10:00",
        applicableDays: List<String> = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"),
        timezone: String = "Asia/Kolkata"
    ) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_TIME_1, time1)
            .putString(KEY_TIME_2, time2)
            .putBoolean(KEY_TIME_2_ENABLED, time2Enabled)
            .putString(KEY_DAYS, applicableDays.joinToString(","))
            .putString(KEY_TIMEZONE, timezone)
            .apply()

        scheduleSlotAlarm(context, "first", time1, REQ_CODE_SLOT_1, timezone)

        if (time2Enabled && time2.isNotBlank()) {
            scheduleSlotAlarm(context, "second", time2, REQ_CODE_SLOT_2, timezone)
        } else {
            cancelAlarm(context, REQ_CODE_SLOT_2)
        }
    }

    private fun scheduleSlotAlarm(
        context: Context,
        slot: String,
        timeStr: String,
        requestCode: Int,
        timezone: String
    ) {
        val parts = timeStr.trim().split(":")
        if (parts.size < 2) return

        val hour = parts[0].toIntOrNull() ?: 9
        val minute = parts[1].toIntOrNull() ?: 0

        val tz = TimeZone.getTimeZone(timezone)
        val now = Calendar.getInstance(tz)

        val target = Calendar.getInstance(tz).apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        // If time today has already elapsed, schedule for tomorrow
        if (target.before(now)) {
            target.add(Calendar.DAY_OF_YEAR, 1)
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val intent = Intent(context, AttendanceReminderReceiver::class.java).apply {
            action = "com.campusattend.biometric.ACTION_ATTENDANCE_REMINDER"
            putExtra("slot", slot)
            putExtra("scheduledTime", timeStr)
            putExtra("destination", "/mark-attendance")
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getBroadcast(context, requestCode, intent, flags)

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    target.timeInMillis,
                    pendingIntent
                )
            } else {
                alarmManager.setExact(
                    AlarmManager.RTC_WAKEUP,
                    target.timeInMillis,
                    pendingIntent
                )
            }
            Log.i(TAG, "Scheduled alarm for slot $slot at ${target.time} (epoch: ${target.timeInMillis})")
        } catch (e: SecurityException) {
            Log.w(TAG, "Exact alarm permission restricted; falling back to standard alarm: ${e.message}")
            alarmManager.set(AlarmManager.RTC_WAKEUP, target.timeInMillis, pendingIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule alarm for slot $slot: ${e.message}", e)
        }
    }

    /**
     * Test notification triggered after delaySeconds so user can verify background/closed behavior.
     */
    fun scheduleTestReminder(context: Context, delaySeconds: Int = 5): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return false
        val triggerTime = System.currentTimeMillis() + (delaySeconds * 1000L)

        val intent = Intent(context, AttendanceReminderReceiver::class.java).apply {
            action = "com.campusattend.biometric.ACTION_ATTENDANCE_REMINDER"
            putExtra("slot", "test")
            putExtra("title", "CampusAttend – Test Attendance Reminder")
            putExtra("message", "This is an OS-level reminder delivered while CampusAttend was in background or closed.")
            putExtra("route", "/mark-attendance")
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val pendingIntent = PendingIntent.getBroadcast(context, REQ_CODE_TEST, intent, flags)

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerTime, pendingIntent)
            }
            Log.i(TAG, "Scheduled test alarm in $delaySeconds seconds (epoch: $triggerTime)")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule test alarm: ${e.message}", e)
            false
        }
    }

    fun scheduleNextOccurrence(context: Context, slot: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val time1 = prefs.getString(KEY_TIME_1, "09:00") ?: "09:00"
        val time2 = prefs.getString(KEY_TIME_2, "10:00") ?: "10:00"
        val timezone = prefs.getString(KEY_TIMEZONE, "Asia/Kolkata") ?: "Asia/Kolkata"

        if (slot == "first") {
            scheduleSlotAlarm(context, "first", time1, REQ_CODE_SLOT_1, timezone)
        } else if (slot == "second") {
            val enabled = prefs.getBoolean(KEY_TIME_2_ENABLED, false)
            if (enabled) {
                scheduleSlotAlarm(context, "second", time2, REQ_CODE_SLOT_2, timezone)
            }
        }
    }

    fun rescheduleFromPreferences(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val time1 = prefs.getString(KEY_TIME_1, null) ?: return
        val time2 = prefs.getString(KEY_TIME_2, "10:00") ?: "10:00"
        val time2Enabled = prefs.getBoolean(KEY_TIME_2_ENABLED, false)
        val timezone = prefs.getString(KEY_TIMEZONE, "Asia/Kolkata") ?: "Asia/Kolkata"

        scheduleSlotAlarm(context, "first", time1, REQ_CODE_SLOT_1, timezone)
        if (time2Enabled) {
            scheduleSlotAlarm(context, "second", time2, REQ_CODE_SLOT_2, timezone)
        }
    }

    private fun cancelAlarm(context: Context, requestCode: Int) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val intent = Intent(context, AttendanceReminderReceiver::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_NO_CREATE
        }
        val pendingIntent = PendingIntent.getBroadcast(context, requestCode, intent, flags)
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
    }
}
