package com.campusattend.biometric.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Staff member entity.
 *
 * Each staff member can have multiple face embeddings for multi-angle recognition.
 * Staff are never auto-created from unknown faces.
 */
@Entity(tableName = "staff")
data class StaffEntity(
    @PrimaryKey
    val id: String,                     // e.g. "PERSON_001"
    val staffCode: String,              // Same as id for now; can differ in future
    val name: String,
    val email: String? = null,
    val department: String? = null,
    val designation: String? = null,
    val active: Boolean = true,
    val createdAt: Long = System.currentTimeMillis()
)
