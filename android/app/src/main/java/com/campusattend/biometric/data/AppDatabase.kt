package com.campusattend.biometric.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Room database for local biometric data.
 *
 * Tables:
 * - staff: enrolled staff members
 * - face_embeddings: 512-d ArcFace vectors (one-to-many with staff)
 * - device_settings: key-value device configuration
 * - verification_settings: calibrated thresholds and parameters
 *
 * Database is stored in app-private internal storage.
 * For production, wrap with SQLCipher for encryption.
 */
@Database(
    entities = [
        StaffEntity::class,
        FaceEmbeddingEntity::class,
        DeviceSettingsEntity::class,
        VerificationSettingsEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun staffDao(): StaffDao
    abstract fun faceEmbeddingDao(): FaceEmbeddingDao
    abstract fun settingsDao(): SettingsDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }

        private fun buildDatabase(context: Context): AppDatabase {
            return Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "campusattend_biometric.db"
            )
                .addCallback(SeedDatabaseCallback())
                .fallbackToDestructiveMigration()
                .build()
        }
    }

    /**
     * Pre-seed the database with 3 test staff on first creation.
     */
    private class SeedDatabaseCallback : Callback() {
        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            INSTANCE?.let { database ->
                CoroutineScope(Dispatchers.IO).launch {
                    seedInitialStaff(database.staffDao())
                }
            }
        }

        private suspend fun seedInitialStaff(staffDao: StaffDao) {
            val testStaff = listOf(
                StaffEntity(
                    id = "PERSON_001",
                    staffCode = "PERSON_001",
                    name = "Test Person 1",
                    email = "test.person1@sonatech.ac.in",
                    department = "Computer Science & Engineering",
                    designation = "Associate Professor",
                    active = true
                ),
                StaffEntity(
                    id = "PERSON_002",
                    staffCode = "PERSON_002",
                    name = "Test Person 2",
                    email = "test.person2@sonatech.ac.in",
                    department = "Information Technology",
                    designation = "Assistant Professor",
                    active = true
                ),
                StaffEntity(
                    id = "PERSON_003",
                    staffCode = "PERSON_003",
                    name = "Test Person 3",
                    email = "test.person3@sonatech.ac.in",
                    department = "Electronics & Communication",
                    designation = "Professor",
                    active = true
                )
            )
            staffDao.insertAllStaff(testStaff)
        }
    }
}
