package com.campusattend.biometric.data

import androidx.room.TypeConverter
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Room TypeConverters for storing FloatArray embeddings as ByteArray blobs.
 *
 * Each 512-dimensional float vector is stored as 2048 bytes (512 × 4 bytes/float).
 * Uses little-endian byte order for consistency.
 */
class Converters {

    @TypeConverter
    fun fromFloatArray(value: FloatArray): ByteArray {
        val buffer = ByteBuffer.allocate(value.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        for (f in value) {
            buffer.putFloat(f)
        }
        return buffer.array()
    }

    @TypeConverter
    fun toFloatArray(bytes: ByteArray): FloatArray {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val result = FloatArray(bytes.size / 4)
        for (i in result.indices) {
            result[i] = buffer.getFloat()
        }
        return result
    }
}
