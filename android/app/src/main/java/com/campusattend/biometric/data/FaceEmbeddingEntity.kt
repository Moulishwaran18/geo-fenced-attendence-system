package com.campusattend.biometric.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Face embedding entity.
 *
 * Each staff member may have multiple embeddings (different angles, lighting, expressions).
 * Embeddings are 512-dimensional float vectors from ArcFace MobileFaceNet (w600k_mbf.onnx).
 * Stored as ByteArray via TypeConverter for efficient Room storage.
 */
@Entity(
    tableName = "face_embeddings",
    foreignKeys = [
        ForeignKey(
            entity = StaffEntity::class,
            parentColumns = ["id"],
            childColumns = ["staffId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["staffId"])]
)
data class FaceEmbeddingEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    @ColumnInfo(name = "staffId")
    val staffId: String,

    /**
     * 512-dimensional L2-normalized ArcFace embedding vector.
     * Stored as raw bytes (512 * 4 = 2048 bytes per embedding).
     */
    val embedding: FloatArray,

    /** Descriptive label for the reference (e.g. "frontal", "left_angle_1"). */
    val referenceLabel: String = "",

    val createdAt: Long = System.currentTimeMillis()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is FaceEmbeddingEntity) return false
        return id == other.id && staffId == other.staffId && embedding.contentEquals(other.embedding)
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + staffId.hashCode()
        result = 31 * result + embedding.contentHashCode()
        return result
    }
}
