package com.campusattend.biometric.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for the staff table.
 */
@Dao
interface StaffDao {

    @Query("SELECT * FROM staff WHERE active = 1 ORDER BY staffCode ASC")
    fun getAllActiveStaff(): Flow<List<StaffEntity>>

    @Query("SELECT * FROM staff ORDER BY staffCode ASC")
    fun getAllStaff(): Flow<List<StaffEntity>>

    @Query("SELECT * FROM staff WHERE id = :staffId")
    suspend fun getStaffById(staffId: String): StaffEntity?

    @Query("SELECT COUNT(*) FROM staff WHERE active = 1")
    suspend fun getActiveStaffCount(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertStaff(staff: StaffEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAllStaff(staffList: List<StaffEntity>)

    @Update
    suspend fun updateStaff(staff: StaffEntity)

    @Query("UPDATE staff SET active = :active WHERE id = :staffId")
    suspend fun setStaffActive(staffId: String, active: Boolean)

    @Query("DELETE FROM staff WHERE id = :staffId")
    suspend fun deleteStaff(staffId: String)
}

/**
 * Data Access Object for the face_embeddings table.
 */
@Dao
interface FaceEmbeddingDao {

    /**
     * Get all embeddings for active staff (used during face matching).
     * This is the main query for the verification pipeline.
     */
    @Query("""
        SELECT fe.* FROM face_embeddings fe
        INNER JOIN staff s ON fe.staffId = s.id
        WHERE s.active = 1
        ORDER BY fe.staffId ASC, fe.createdAt ASC
    """)
    suspend fun getAllActiveEmbeddings(): List<FaceEmbeddingEntity>

    @Query("SELECT * FROM face_embeddings WHERE staffId = :staffId ORDER BY createdAt ASC")
    suspend fun getEmbeddingsForStaff(staffId: String): List<FaceEmbeddingEntity>

    @Query("SELECT COUNT(*) FROM face_embeddings WHERE staffId = :staffId")
    suspend fun getEmbeddingCountForStaff(staffId: String): Int

    @Query("SELECT COUNT(*) FROM face_embeddings")
    suspend fun getTotalEmbeddingCount(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEmbedding(embedding: FaceEmbeddingEntity): Long

    @Query("DELETE FROM face_embeddings WHERE id = :embeddingId")
    suspend fun deleteEmbedding(embeddingId: Long)

    @Query("DELETE FROM face_embeddings WHERE staffId = :staffId")
    suspend fun deleteAllEmbeddingsForStaff(staffId: String)
}

/**
 * DAO for settings tables.
 */
@Dao
interface SettingsDao {

    @Query("SELECT * FROM verification_settings WHERE `key` = :key")
    suspend fun getVerificationSetting(key: String): VerificationSettingsEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun setVerificationSetting(setting: VerificationSettingsEntity)

    @Query("SELECT * FROM device_settings WHERE `key` = :key")
    suspend fun getDeviceSetting(key: String): DeviceSettingsEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun setDeviceSetting(setting: DeviceSettingsEntity)
}
