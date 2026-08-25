package com.campusattend.biometric.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Device settings entity for storing key-value device configuration.
 */
@Entity(tableName = "device_settings")
data class DeviceSettingsEntity(
    @PrimaryKey
    val key: String,
    val value: String
)

/**
 * Verification settings entity for storing biometric thresholds
 * and calibration parameters that can be adjusted at runtime.
 */
@Entity(tableName = "verification_settings")
data class VerificationSettingsEntity(
    @PrimaryKey
    val key: String,
    val floatValue: Float? = null,
    val intValue: Int? = null,
    val stringValue: String? = null
)
