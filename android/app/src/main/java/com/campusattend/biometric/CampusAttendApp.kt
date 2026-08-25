package com.campusattend.biometric

import android.app.Application
import com.campusattend.biometric.data.AppDatabase

/**
 * Application class for CampusAttend Biometric.
 *
 * Initializes the Room database singleton on app start.
 * Model files (ONNX, MediaPipe) are loaded lazily by their respective services.
 */
class CampusAttendApp : Application() {

    lateinit var database: AppDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        database = AppDatabase.getInstance(this)
    }

    companion object {
        lateinit var instance: CampusAttendApp
            private set
    }
}
