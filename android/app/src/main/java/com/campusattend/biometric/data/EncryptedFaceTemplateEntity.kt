package com.campusattend.biometric.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Keystore-Encrypted Face Template Entity.
 *
 * Stores AES-256-GCM encrypted 512-dimensional ArcFace biometric templates.
 * Raw biometric embeddings are NEVER stored in plaintext.
 * Encrypted with Android Keystore hardware-backed keys and bound to (staffId, deviceId).
 */
@Entity(
    tableName = "encrypted_face_templates",
    foreignKeys = [
        ForeignKey(
            entity = StaffEntity::class,
            parentColumns = ["id"],
            childColumns = ["staffId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["staffId"]),
        Index(value = ["deviceId"]),
        Index(value = ["staffId", "deviceId"])
    ]
)
data class EncryptedFaceTemplateEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    @ColumnInfo(name = "staffId")
    val staffId: String,

    @ColumnInfo(name = "deviceId")
    val deviceId: String,

    /** AES-256-GCM ciphertext including 16-byte authentication tag. */
    val encryptedTemplate: ByteArray,

    /** 12-byte initialization vector. */
    val iv: ByteArray,

    /** Descriptive label for reference sample. */
    val referenceLabel: String = "primary",

    val templateVersion: Int = 1,

    val createdAt: Long = System.currentTimeMillis()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EncryptedFaceTemplateEntity) return false
        return id == other.id &&
                staffId == other.staffId &&
                deviceId == other.deviceId &&
                encryptedTemplate.contentEquals(other.encryptedTemplate) &&
                iv.contentEquals(other.iv)
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + staffId.hashCode()
        result = 31 * result + deviceId.hashCode()
        result = 31 * result + encryptedTemplate.contentHashCode()
        result = 31 * result + iv.contentHashCode()
        return result
    }
}
