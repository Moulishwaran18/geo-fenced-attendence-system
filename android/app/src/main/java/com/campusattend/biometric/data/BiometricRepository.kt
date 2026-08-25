package com.campusattend.biometric.data

import kotlinx.coroutines.flow.Flow

/**
 * Repository for all biometric database operations.
 *
 * Provides a clean abstraction layer over Room DAOs.
 * Designed so that the matching implementation can be swapped
 * (e.g., from linear scan to approximate nearest-neighbor)
 * without changing the rest of the application.
 */
class BiometricRepository(private val database: AppDatabase) {

    private val staffDao = database.staffDao()
    private val embeddingDao = database.faceEmbeddingDao()
    private val settingsDao = database.settingsDao()

    // ── Staff Operations ──

    fun getAllActiveStaff(): Flow<List<StaffEntity>> = staffDao.getAllActiveStaff()

    fun getAllStaff(): Flow<List<StaffEntity>> = staffDao.getAllStaff()

    suspend fun getStaffById(staffId: String): StaffEntity? = staffDao.getStaffById(staffId)

    suspend fun getActiveStaffCount(): Int = staffDao.getActiveStaffCount()

    suspend fun insertStaff(staff: StaffEntity) = staffDao.insertStaff(staff)

    suspend fun updateStaff(staff: StaffEntity) = staffDao.updateStaff(staff)

    suspend fun setStaffActive(staffId: String, active: Boolean) =
        staffDao.setStaffActive(staffId, active)

    suspend fun deleteStaff(staffId: String) = staffDao.deleteStaff(staffId)

    // ── Embedding Operations ──

    /**
     * Get all embeddings for active staff members.
     * Used by the face matching pipeline during verification.
     */
    suspend fun getAllActiveEmbeddings(): List<FaceEmbeddingEntity> =
        embeddingDao.getAllActiveEmbeddings()

    suspend fun getEmbeddingsForStaff(staffId: String): List<FaceEmbeddingEntity> =
        embeddingDao.getEmbeddingsForStaff(staffId)

    suspend fun getEmbeddingCountForStaff(staffId: String): Int =
        embeddingDao.getEmbeddingCountForStaff(staffId)

    suspend fun getTotalEmbeddingCount(): Int =
        embeddingDao.getTotalEmbeddingCount()

    suspend fun insertEmbedding(embedding: FaceEmbeddingEntity): Long =
        embeddingDao.insertEmbedding(embedding)

    suspend fun deleteEmbedding(embeddingId: Long) =
        embeddingDao.deleteEmbedding(embeddingId)

    suspend fun deleteAllEmbeddingsForStaff(staffId: String) =
        embeddingDao.deleteAllEmbeddingsForStaff(staffId)

    // ── Settings Operations ──

    suspend fun getVerificationSetting(key: String): VerificationSettingsEntity? =
        settingsDao.getVerificationSetting(key)

    suspend fun setVerificationSetting(setting: VerificationSettingsEntity) =
        settingsDao.setVerificationSetting(setting)

    suspend fun getDeviceSetting(key: String): DeviceSettingsEntity? =
        settingsDao.getDeviceSetting(key)

    suspend fun setDeviceSetting(setting: DeviceSettingsEntity) =
        settingsDao.setDeviceSetting(setting)

    // ── Grouped Embeddings for Matching ──

    /**
     * Load all active embeddings grouped by staff ID.
     * Returns a map of staffId → list of embedding vectors for efficient matching.
     */
    suspend fun getEmbeddingsGroupedByStaff(): Map<String, List<FaceEmbeddingEntity>> {
        return getAllActiveEmbeddings().groupBy { it.staffId }
    }
}
