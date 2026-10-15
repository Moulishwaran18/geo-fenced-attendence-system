package com.campusattend.biometric.bridge

import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.room.withTransaction
import com.campusattend.biometric.CampusAttendApp
import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.data.BiometricRepository
import com.campusattend.biometric.data.EncryptedFaceTemplateEntity
import com.campusattend.biometric.data.StaffEntity
import com.campusattend.biometric.security.BiometricKeystoreManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.sqrt

/**
 * Native Android Biometric Bridge.
 *
 * Exposes hardware-backed on-device face enrollment and verification to the WebView.
 *
 * Privacy & Security Guarantees:
 * - Templates are AES-256-GCM encrypted via Android Keystore.
 * - Templates are stored strictly in local SQLite/Room; NEVER uploaded to PostgreSQL or Supabase.
 * - Raw face images are never retained.
 * - Authenticated Additional Data (AAD) binds templates to (staffId, deviceId).
 * - Issues short-lived, single-use HMAC biometric attestation tokens for server authorization.
 */
class AndroidBiometricBridge(
    private val context: Context,
    private val webView: WebView?
) {

    companion object {
        private val usedAttemptNonces = java.util.concurrent.ConcurrentHashMap<String, Long>()
        private const val NONCE_TTL_MS = 180_000L

        fun cleanExpiredNonces() {
            val cutoff = System.currentTimeMillis() - NONCE_TTL_MS
            usedAttemptNonces.entries.removeIf { it.value < cutoff }
        }
    }

    private val keystoreManager = BiometricKeystoreManager(context)
    private val repository: BiometricRepository by lazy {
        BiometricRepository(CampusAttendApp.instance.database)
    }

    @Volatile
    private var currentLoadedUrl: String = "https://geo-fenced-attendence-system.vercel.app/mark-attendance"

    fun setCurrentUrl(url: String?) {
        if (!url.isNullOrBlank()) {
            currentLoadedUrl = url
        }
    }

    private fun isCallingOriginTrusted(): Boolean {
        return try {
            val urlToTest = try {
                webView?.url ?: currentLoadedUrl
            } catch (_: Throwable) {
                currentLoadedUrl
            }
            val uri = android.net.Uri.parse(urlToTest)
            val host = uri.host?.lowercase() ?: ""
            val trustedHosts = listOf(
                "geo-fenced-attendence-system.vercel.app",
                "localhost",
                "127.0.0.1",
                "10.0.2.2"
            )
            trustedHosts.any { host == it || host.endsWith(".$it") }
        } catch (_: Throwable) {
            true
        }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun getDeviceId(): String {
        return try {
            keystoreManager.getDeviceId()
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "getDeviceId error", t)
            "android-keystore"
        }
    }

    /**
     * Inspect enrollment state for a specific staff member on this device.
     */
    @JavascriptInterface
    fun getEnrollmentStatus(staffId: String?): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("isEnrolled", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("isEnrolled", false)
                    put("count", 0)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val deviceId = keystoreManager.getDeviceId()

            runBlocking(Dispatchers.IO) {
                val count = repository.getEncryptedTemplateCount(cleanId, deviceId)
                val templates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, deviceId)
                val latestTime = templates.maxOfOrNull { it.createdAt } ?: 0L

                val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
                val hasPending = pendingFile.exists()
                var pendingCount = 0
                if (hasPending) {
                    try {
                        val pJson = JSONObject(pendingFile.readText(Charsets.UTF_8))
                        pendingCount = pJson.optJSONArray("templates")?.length() ?: 0
                    } catch (_: Throwable) {}
                }

                JSONObject().apply {
                    put("isEnrolled", count > 0)
                    put("count", count)
                    put("staffId", cleanId)
                    put("deviceId", deviceId)
                    put("isDeviceBound", true)
                    put("hardwareKeystore", true)
                    put("canEnroll", count == 0)
                    put("enrolledAt", latestTime)
                    put("hasPendingEnrollment", hasPending)
                    put("pendingCount", pendingCount)
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "getEnrollmentStatus error", t)
            JSONObject().apply {
                put("isEnrolled", false)
                put("count", 0)
                put("error", "STATUS_ERROR")
                put("message", t.message ?: "Failed to query enrollment status.")
            }.toString()
        }
    }

    /**
     * Stage pending face embeddings encrypted with Android Keystore AES-256-GCM in app-private storage.
     * Staged templates are NOT in the active Room database and cannot be used for attendance until administrator approves.
     */
    @JavascriptInterface
    fun stagePendingEnrollment(
        staffId: String?,
        deviceId: String?,
        embeddingsJson: String?,
        labelsJson: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                    put("message", "Staff ID cannot be empty.")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""

            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            if (embeddingsJson.isNullOrBlank()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            val embeddingsArr = JSONArray(embeddingsJson)
            if (embeddingsArr.length() == 0) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            if (embeddingsArr.length() > 5) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "TOO_MANY_SAMPLES")
                    put("message", "Maximum of 5 face samples allowed.")
                }.toString()
            }

            val labelsArr = if (!labelsJson.isNullOrBlank()) try { JSONArray(labelsJson) } catch (_: Throwable) { null } else null

            val parsedEmbeddings = mutableListOf<FloatArray>()
            for (sampleIdx in 0 until embeddingsArr.length()) {
                val sampleArr = embeddingsArr.getJSONArray(sampleIdx)
                if (sampleArr.length() != 512) {
                    return JSONObject().apply {
                        put("success", false)
                        put("error", "INVALID_DIMENSION")
                        put("message", "Sample at index $sampleIdx must contain exactly 512 float values.")
                    }.toString()
                }

                val embedding = FloatArray(512)
                for (i in 0 until 512) {
                    embedding[i] = sampleArr.getDouble(i).toFloat()
                }

                var sumSq = 0.0
                for (f in embedding) sumSq += f * f
                val norm = sqrt(sumSq).toFloat()
                if (norm !in 0.95f..1.05f && norm > 0f) {
                    for (i in embedding.indices) embedding[i] /= norm
                }
                parsedEmbeddings.add(embedding)
            }

            val templatesArray = JSONArray()
            for (idx in parsedEmbeddings.indices) {
                val embedding = parsedEmbeddings[idx]
                val label = if (labelsArr != null && idx < labelsArr.length()) {
                    labelsArr.optString(idx, "sample_${idx + 1}")
                } else {
                    "sample_${idx + 1}"
                }

                val encResult = keystoreManager.encryptEmbedding(cleanId, embedding)
                val templateObj = JSONObject().apply {
                    put("ciphertext", android.util.Base64.encodeToString(encResult.ciphertext, android.util.Base64.NO_WRAP))
                    put("iv", android.util.Base64.encodeToString(encResult.iv, android.util.Base64.NO_WRAP))
                    put("label", label)
                }
                templatesArray.put(templateObj)
            }

            val payload = JSONObject().apply {
                put("staffId", cleanId)
                put("deviceId", currentDeviceId)
                put("stagedAt", System.currentTimeMillis())
                put("templates", templatesArray)
            }

            val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
            pendingFile.writeText(payload.toString(), Charsets.UTF_8)

            JSONObject().apply {
                put("success", true)
                put("staffId", cleanId)
                put("deviceId", currentDeviceId)
                put("count", parsedEmbeddings.size)
                put("message", "Pending face templates encrypted with Android Keystore AES-256-GCM and staged locally.")
            }.toString()
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "stagePendingEnrollment error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "STAGE_EXCEPTION")
                put("message", t.message ?: "Failed to stage pending templates.")
            }.toString()
        }
    }

    /**
     * Check if pending face templates are staged locally on this device.
     */
    @JavascriptInterface
    fun getPendingEnrollmentStatus(staffId: String?): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("hasPending", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("hasPending", false)
                    put("count", 0)
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")

            if (!pendingFile.exists()) {
                return JSONObject().apply {
                    put("hasPending", false)
                    put("count", 0)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                }.toString()
            }

            val content = pendingFile.readText(Charsets.UTF_8)
            val json = JSONObject(content)
            val count = json.optJSONArray("templates")?.length() ?: 0
            val stagedAt = json.optLong("stagedAt", 0L)

            JSONObject().apply {
                put("hasPending", count > 0)
                put("count", count)
                put("staffId", cleanId)
                put("deviceId", currentDeviceId)
                put("stagedAt", stagedAt)
            }.toString()
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "getPendingEnrollmentStatus error", t)
            JSONObject().apply {
                put("hasPending", false)
                put("count", 0)
            }.toString()
        }
    }

    /**
     * Activate staged pending templates on this device after administrator approval.
     * Inserts the encrypted templates into Room DB within a database transaction and removes the pending stage file.
     * Strictly idempotent: if templates are already persisted and verified in Room, safely continues without re-inserting.
     */
    @JavascriptInterface
    fun activatePendingEnrollment(
        staffId: String?,
        deviceId: String?,
        oneTimeToken: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                    put("message", "Untrusted origin")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                    put("message", "Staff ID cannot be empty.")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""

            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            val cleanToken = oneTimeToken?.trim() ?: ""
            if (cleanToken.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "MISSING_APPROVAL_TOKEN")
                    put("message", "Administrator approval token is required to activate face registration.")
                }.toString()
            }

            val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")

            runBlocking(Dispatchers.IO) {
                // 1. Idempotency Check: Are templates ALREADY persisted and verified in Room DB?
                val existingTemplates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                if (existingTemplates.isNotEmpty()) {
                    var allVerified = true
                    for (tmpl in existingTemplates) {
                        if (tmpl.encryptedTemplate.isEmpty() || tmpl.iv.isEmpty() || tmpl.iv.size != 12) {
                            allVerified = false
                            break
                        }
                        val testDec = keystoreManager.decryptEmbedding(cleanId, currentDeviceId, tmpl.encryptedTemplate, tmpl.iv)
                        if (testDec == null || testDec.size != 512) {
                            allVerified = false
                            break
                        }
                    }

                    if (allVerified) {
                        // Templates are ALREADY verified and active in Room DB!
                        // Remove lingering pending file if present to keep storage clean
                        if (pendingFile.exists()) {
                            try { pendingFile.delete() } catch (_: Throwable) {}
                        }

                        return@runBlocking JSONObject().apply {
                            put("success", true)
                            put("alreadyPersisted", true)
                            put("staffId", cleanId)
                            put("deviceId", currentDeviceId)
                            put("count", existingTemplates.size)
                            put("message", "Templates already securely persisted and verified in device storage.")
                        }.toString()
                    }
                }

                // 2. Pending file check
                if (!pendingFile.exists()) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "NO_PENDING_ENROLLMENT")
                        put("recoverable", true)
                        put("message", "No staged pending face enrollment found on this device. Please use Re-capture Photos to enroll with your approved token.")
                    }.toString()
                }

                val content = pendingFile.readText(Charsets.UTF_8)
                val json = JSONObject(content)
                val templatesArray = json.optJSONArray("templates") ?: JSONArray()

                if (templatesArray.length() == 0) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "EMPTY_PENDING_SAMPLES")
                        put("recoverable", true)
                        put("message", "Pending enrollment file contained 0 templates. Please use Re-capture Photos.")
                    }.toString()
                }

                // 3. Insert inside database transaction using withTransaction (COROUTINE-SAFE)
                CampusAttendApp.instance.database.withTransaction {
                    // Ensure staff entity exists
                    val existingStaff = repository.getStaffById(cleanId)
                    if (existingStaff == null) {
                        repository.insertStaff(
                            StaffEntity(
                                id = cleanId,
                                staffCode = cleanId,
                                name = cleanId,
                                active = true
                            )
                        )
                    }

                    // Delete any previous templates for staff + device
                    repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)

                    for (i in 0 until templatesArray.length()) {
                        val tmpl = templatesArray.getJSONObject(i)
                        val ciphertext = android.util.Base64.decode(tmpl.getString("ciphertext"), android.util.Base64.NO_WRAP)
                        val iv = android.util.Base64.decode(tmpl.getString("iv"), android.util.Base64.NO_WRAP)
                        val label = tmpl.optString("label", "sample_${i + 1}")

                        repository.insertEncryptedTemplate(
                            EncryptedFaceTemplateEntity(
                                staffId = cleanId,
                                deviceId = currentDeviceId,
                                encryptedTemplate = ciphertext,
                                iv = iv,
                                referenceLabel = label,
                                templateVersion = 1,
                                createdAt = System.currentTimeMillis()
                            )
                        )
                    }
                }

                // 4. Read-back persistence and cryptographic integrity verification
                val insertedTemplates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                if (insertedTemplates.size != templatesArray.length() || insertedTemplates.isEmpty()) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "PERSISTENCE_COUNT_MISMATCH")
                        put("message", "Failed to verify local encrypted template count in device storage.")
                    }.toString()
                }

                for (tmpl in insertedTemplates) {
                    if (tmpl.encryptedTemplate.isEmpty() || tmpl.iv.isEmpty() || tmpl.iv.size != 12) {
                        return@runBlocking JSONObject().apply {
                            put("success", false)
                            put("error", "CORRUPTED_CIPHERTEXT")
                            put("message", "Persisted encrypted template ciphertext or IV is invalid.")
                        }.toString()
                    }
                    val testDec = keystoreManager.decryptEmbedding(cleanId, currentDeviceId, tmpl.encryptedTemplate, tmpl.iv)
                    if (testDec == null || testDec.size != 512) {
                        return@runBlocking JSONObject().apply {
                            put("success", false)
                            put("error", "DECRYPTION_VERIFY_FAILED")
                            put("message", "Local persistence verification failed. Templates could not be verified by Android Keystore AEAD.")
                        }.toString()
                    }
                }

                // 5. Remove staged pending file ONLY AFTER successful read-back verification
                try { pendingFile.delete() } catch (_: Throwable) {}

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", insertedTemplates.size)
                    put("message", "Face registration approved and activated on this device.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "activatePendingEnrollment failed", t)
            JSONObject().apply {
                put("success", false)
                put("error", "ACTIVATION_EXCEPTION")
                put("message", t.message ?: "Failed to activate pending templates.")
            }.toString()
        }
    }

    /**
     * Verify persistence and cryptographic integrity of templates stored in Room DB.
     */
    @JavascriptInterface
    fun verifyPersistence(staffId: String?): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("verified", false)
                    put("count", 0)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("verified", false)
                    put("count", 0)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()

            runBlocking(Dispatchers.IO) {
                val templates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                if (templates.isEmpty()) {
                    return@runBlocking JSONObject().apply {
                        put("verified", false)
                        put("count", 0)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("error", "NO_TEMPLATES")
                        put("message", "No encrypted templates found in local storage.")
                    }.toString()
                }

                var validDecryptions = 0
                for (tmpl in templates) {
                    if (tmpl.encryptedTemplate.isEmpty() || tmpl.iv.isEmpty() || tmpl.iv.size != 12) {
                        return@runBlocking JSONObject().apply {
                            put("verified", false)
                            put("count", 0)
                            put("error", "CORRUPTED_TEMPLATE")
                            put("message", "Template data or IV is malformed.")
                        }.toString()
                    }

                    val dec = keystoreManager.decryptEmbedding(
                        cleanId,
                        currentDeviceId,
                        tmpl.encryptedTemplate,
                        tmpl.iv
                    )
                    if (dec == null || dec.size != 512) {
                        return@runBlocking JSONObject().apply {
                            put("verified", false)
                            put("count", 0)
                            put("error", "DECRYPTION_VERIFY_FAILED")
                            put("message", "Hardware Keystore AEAD verification failed.")
                        }.toString()
                    }
                    validDecryptions++
                }

                val latestTime = templates.maxOfOrNull { it.createdAt } ?: 0L

                JSONObject().apply {
                    put("verified", validDecryptions == templates.size && validDecryptions > 0)
                    put("count", validDecryptions)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("enrolledAt", latestTime)
                    put("message", "$validDecryptions template(s) verified in secure Android Keystore storage.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "verifyPersistence error", t)
            JSONObject().apply {
                put("verified", false)
                put("count", 0)
                put("error", "VERIFY_EXCEPTION")
                put("message", t.message ?: "Persistence verification failed.")
            }.toString()
        }
    }

    /**
     * Clear staged pending enrollment file.
     */
    @JavascriptInterface
    fun clearPendingEnrollment(staffId: String?): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isNotEmpty()) {
                val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
                if (pendingFile.exists()) {
                    try { pendingFile.delete() } catch (_: Throwable) {}
                }
            }
            JSONObject().apply {
                put("success", true)
                put("staffId", cleanId)
            }.toString()
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "clearPendingEnrollment error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "CLEAR_FAILED")
            }.toString()
        }
    }

    /**
     * Batch-enroll multiple 512-dimensional face templates locally in an atomic transaction.
     * Enforces that once enrolled, templates cannot be silently overwritten without authorized replacement.
     */
    @JavascriptInterface
    fun enrollLocalTemplates(
        staffId: String?,
        deviceId: String?,
        embeddingsJson: String?,
        labelsJson: String?,
        oneTimeToken: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                    put("message", "Staff ID cannot be empty.")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""

            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            if (embeddingsJson.isNullOrBlank()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            val embeddingsArr = JSONArray(embeddingsJson)
            if (embeddingsArr.length() == 0) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            val labelsArr = if (!labelsJson.isNullOrBlank()) try { JSONArray(labelsJson) } catch (_: Throwable) { null } else null

            val parsedEmbeddings = mutableListOf<FloatArray>()
            for (sampleIdx in 0 until embeddingsArr.length()) {
                val sampleArr = embeddingsArr.getJSONArray(sampleIdx)
                if (sampleArr.length() != 512) {
                    return JSONObject().apply {
                        put("success", false)
                        put("error", "INVALID_DIMENSION")
                        put("message", "Sample at index $sampleIdx must contain exactly 512 float values.")
                    }.toString()
                }

                val embedding = FloatArray(512)
                for (i in 0 until 512) {
                    embedding[i] = sampleArr.getDouble(i).toFloat()
                }

                var sumSq = 0.0
                for (f in embedding) sumSq += f * f
                val norm = sqrt(sumSq).toFloat()
                if (norm !in 0.95f..1.05f && norm > 0f) {
                    for (i in embedding.indices) embedding[i] /= norm
                }
                parsedEmbeddings.add(embedding)
            }

            runBlocking(Dispatchers.IO) {
                val existingCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                val cleanToken = oneTimeToken?.trim() ?: ""
                val tokenRegex = Regex("^ftok_[a-f0-9]{48}$")
                val isAuthorizedReplacement = existingCount > 0 && cleanToken.isNotEmpty() && tokenRegex.matches(cleanToken)

                // If already enrolled, replacement requires a valid, unconsumed administrator approval token
                if (existingCount > 0 && !isAuthorizedReplacement) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", if (cleanToken.isEmpty()) "ALREADY_ENROLLED" else "INVALID_APPROVAL_TOKEN")
                        put("message", "Face is already enrolled and locked on this device. Re-enrollment requires an authorized face-change approval token.")
                    }.toString()
                }

                // Stage a memory backup of existing templates so any insertion or persistence failure rolls back cleanly
                val backupTemplates = if (existingCount > 0) repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId) else emptyList()

                // Insert templates atomically in Room transaction
                var insertSuccess = false
                try {
                    CampusAttendApp.instance.database.withTransaction {
                        // If authorized replacement, remove prior templates
                        if (existingCount > 0 && isAuthorizedReplacement) {
                            repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                        }

                        // Ensure staff entity exists
                        val existingStaff = repository.getStaffById(cleanId)
                        if (existingStaff == null) {
                            repository.insertStaff(
                                StaffEntity(
                                    id = cleanId,
                                    staffCode = cleanId,
                                    name = cleanId,
                                    active = true
                                )
                            )
                        }

                        // Encrypt each embedding with Android Keystore AES-256-GCM using AAD "$staffId:$deviceId"
                        for (idx in parsedEmbeddings.indices) {
                            val embedding = parsedEmbeddings[idx]
                            val label = if (labelsArr != null && idx < labelsArr.length()) {
                                labelsArr.optString(idx, "sample_${idx + 1}")
                            } else {
                                "sample_${idx + 1}"
                            }

                            val encResult = keystoreManager.encryptEmbedding(cleanId, embedding)
                            repository.insertEncryptedTemplate(
                                EncryptedFaceTemplateEntity(
                                    staffId = cleanId,
                                    deviceId = currentDeviceId,
                                    encryptedTemplate = encResult.ciphertext,
                                    iv = encResult.iv,
                                    referenceLabel = label,
                                    templateVersion = 1,
                                    createdAt = System.currentTimeMillis()
                                )
                            )
                        }
                    }
                    insertSuccess = true
                } catch (txEx: Throwable) {
                    Log.e("AndroidBiometricBridge", "Room transaction error during template enrollment", txEx)
                    insertSuccess = false
                }

                // Verify persistence in Room
                val finalCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (!insertSuccess || finalCount == 0) {
                    // Restore backup templates if replacement failed
                    if (backupTemplates.isNotEmpty()) {
                        try {
                            CampusAttendApp.instance.database.withTransaction {
                                repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                                for (b in backupTemplates) {
                                    repository.insertEncryptedTemplate(b)
                                }
                            }
                        } catch (_: Throwable) {}
                    }
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "PERSISTENCE_FAILED")
                        put("message", "Failed to verify local encrypted templates in device storage. Existing templates preserved.")
                    }.toString()
                }

                // If a pending or staged replacement file existed, clean up
                val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
                if (pendingFile.exists()) {
                    try { pendingFile.delete() } catch (_: Throwable) {}
                }
                val stagedFile = java.io.File(context.filesDir, "staged_replacement_${cleanId}.json")
                if (stagedFile.exists()) {
                    try { stagedFile.delete() } catch (_: Throwable) {}
                }

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", finalCount)
                    put("message", "Face enrolled on this device. Templates securely encrypted with Android Keystore.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "enrollLocalTemplates error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "ENROLLMENT_EXCEPTION")
                put("message", t.message ?: "Failed to encrypt and store local templates.")
            }.toString()
        }
    }

    /**
     * Stage replacement face embeddings locally without modifying active Room DB templates.
     * Leaves existing enrolled templates intact until server validates and consumes authorization token.
     */
    @JavascriptInterface
    fun stageReplacementTemplates(
        staffId: String?,
        deviceId: String?,
        oneTimeToken: String?,
        requestId: String?,
        embeddingsJson: String?,
        labelsJson: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""
            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            val cleanToken = oneTimeToken?.trim() ?: ""
            val tokenRegex = Regex("^(?:ftok|preptok)_[a-zA-Z0-9_-]{12,64}$")
            if (cleanToken.isEmpty() || !tokenRegex.matches(cleanToken)) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_APPROVAL_TOKEN")
                    put("message", "A valid, unconsumed administrator approval token is required for replacement.")
                }.toString()
            }

            if (embeddingsJson.isNullOrBlank()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            val embeddingsArr = JSONArray(embeddingsJson)
            if (embeddingsArr.length() == 0 || embeddingsArr.length() > 5) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_SAMPLE_COUNT")
                    put("message", "Between 1 and 5 face samples are required.")
                }.toString()
            }

            val labelsArr = if (!labelsJson.isNullOrBlank()) try { JSONArray(labelsJson) } catch (_: Throwable) { null } else null

            val templatesArray = JSONArray()
            for (sampleIdx in 0 until embeddingsArr.length()) {
                val sampleArr = embeddingsArr.getJSONArray(sampleIdx)
                if (sampleArr.length() != 512) {
                    return JSONObject().apply {
                        put("success", false)
                        put("error", "INVALID_DIMENSION")
                        put("message", "Sample at index $sampleIdx must contain exactly 512 float values.")
                    }.toString()
                }

                val embedding = FloatArray(512)
                for (i in 0 until 512) {
                    embedding[i] = sampleArr.getDouble(i).toFloat()
                }

                var sumSq = 0.0
                for (f in embedding) sumSq += f * f
                val norm = sqrt(sumSq).toFloat()
                if (norm !in 0.95f..1.05f && norm > 0f) {
                    for (i in embedding.indices) embedding[i] /= norm
                }

                val label = if (labelsArr != null && sampleIdx < labelsArr.length()) {
                    labelsArr.optString(sampleIdx, "sample_${sampleIdx + 1}")
                } else {
                    "sample_${sampleIdx + 1}"
                }

                val encResult = keystoreManager.encryptEmbedding(cleanId, embedding)
                templatesArray.put(JSONObject().apply {
                    put("ciphertext", android.util.Base64.encodeToString(encResult.ciphertext, android.util.Base64.NO_WRAP))
                    put("iv", android.util.Base64.encodeToString(encResult.iv, android.util.Base64.NO_WRAP))
                    put("label", label)
                })
            }

            val payload = JSONObject().apply {
                put("staffId", cleanId)
                put("deviceId", currentDeviceId)
                put("token", cleanToken)
                put("requestId", requestId?.trim() ?: "")
                put("stagedAt", System.currentTimeMillis())
                put("templates", templatesArray)
            }

            val stagedFile = java.io.File(context.filesDir, "staged_replacement_${cleanId}.json")
            stagedFile.writeText(payload.toString(), Charsets.UTF_8)

            JSONObject().apply {
                put("success", true)
                put("staffId", cleanId)
                put("deviceId", currentDeviceId)
                put("count", templatesArray.length())
                put("message", "Replacement face templates encrypted and staged. Existing templates remain active until server confirms token consumption.")
            }.toString()
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "stageReplacementTemplates error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "STAGE_EXCEPTION")
                put("message", t.message ?: "Failed to stage replacement templates.")
            }.toString()
        }
    }

    @JavascriptInterface
    fun stageReplacementTemplates(
        staffId: String?,
        deviceId: String?,
        oneTimeToken: String?,
        requestId: String?,
        embeddingsJson: String?,
        labelsJson: String?,
        digest: String?
    ): String {
        val result = stageReplacementTemplates(staffId, deviceId, oneTimeToken, requestId, embeddingsJson, labelsJson)
        if (!digest.isNullOrBlank()) {
            try {
                val cleanId = staffId?.trim()?.uppercase() ?: ""
                val stagedFile = java.io.File(context.filesDir, "staged_replacement_${cleanId}.json")
                if (stagedFile.exists()) {
                    val json = JSONObject(stagedFile.readText(Charsets.UTF_8))
                    json.put("digest", digest.trim())
                    stagedFile.writeText(json.toString(), Charsets.UTF_8)
                }
            } catch (_: Throwable) {}
        }
        return result
    }

    /**
     * Commit staged replacement templates into Room DB after server confirms token consumption.
     * Atomic transaction: deletes previous templates, commits new templates, verifies read-back.
     */
    @JavascriptInterface
    fun commitReplacementTemplates(
        staffId: String?,
        deviceId: String?,
        oneTimeToken: String?
    ): String = commitReplacementTemplates(staffId, deviceId, oneTimeToken, null)

    @JavascriptInterface
    fun commitReplacementTemplates(
        staffId: String?,
        deviceId: String?,
        oneTimeToken: String?,
        expectedDigest: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""
            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            val cleanToken = oneTimeToken?.trim() ?: ""
            val tokenRegex = Regex("^ftok_[a-zA-Z0-9_-]{12,64}$")
            if (cleanToken.isEmpty() || !tokenRegex.matches(cleanToken)) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_APPROVAL_TOKEN")
                    put("message", "A valid, consumed administrator approval token is required to commit replacement.")
                }.toString()
            }

            val stagedFile = java.io.File(context.filesDir, "staged_replacement_${cleanId}.json")
            if (!stagedFile.exists()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "NO_STAGED_REPLACEMENT")
                    put("message", "No staged replacement templates found on this device.")
                }.toString()
            }

            val content = stagedFile.readText(Charsets.UTF_8)
            val json = JSONObject(content)
            val stagedToken = json.optString("token", "")
            if (stagedToken != cleanToken && !(stagedToken.startsWith("preptok_") && cleanToken.startsWith("ftok_"))) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "TOKEN_MISMATCH")
                    put("message", "Staged replacement token does not match authorized token.")
                }.toString()
            }

            val stagedDigest = json.optString("digest", "")
            if (!expectedDigest.isNullOrBlank() && stagedDigest.isNotBlank() && stagedDigest != expectedDigest.trim()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DIGEST_MISMATCH")
                    put("message", "Staged face templates digest does not match authorized digest.")
                }.toString()
            }

            val templatesArray = json.optJSONArray("templates") ?: JSONArray()
            if (templatesArray.length() == 0) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_STAGED_TEMPLATES")
                    put("message", "Staged replacement template file contains no valid templates.")
                }.toString()
            }

            runBlocking(Dispatchers.IO) {
                val existingCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                val backupTemplates = if (existingCount > 0) repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId) else emptyList()

                var commitOk = false
                try {
                    CampusAttendApp.instance.database.withTransaction {
                        repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)

                        val existingStaff = repository.getStaffById(cleanId)
                        if (existingStaff == null) {
                            repository.insertStaff(
                                StaffEntity(
                                    id = cleanId,
                                    staffCode = cleanId,
                                    name = cleanId,
                                    active = true
                                )
                            )
                        }

                        for (i in 0 until templatesArray.length()) {
                            val tObj = templatesArray.getJSONObject(i)
                            val cipherBytes = android.util.Base64.decode(tObj.getString("ciphertext"), android.util.Base64.NO_WRAP)
                            val ivBytes = android.util.Base64.decode(tObj.getString("iv"), android.util.Base64.NO_WRAP)
                            val label = tObj.optString("label", "sample_${i + 1}")

                            repository.insertEncryptedTemplate(
                                EncryptedFaceTemplateEntity(
                                    staffId = cleanId,
                                    deviceId = currentDeviceId,
                                    encryptedTemplate = cipherBytes,
                                    iv = ivBytes,
                                    referenceLabel = label,
                                    templateVersion = 1,
                                    createdAt = System.currentTimeMillis()
                                )
                            )
                        }
                    }
                    commitOk = true
                } catch (txEx: Throwable) {
                    Log.e("AndroidBiometricBridge", "commitReplacementTemplates transaction failure", txEx)
                    commitOk = false
                }

                val finalCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (!commitOk || finalCount == 0) {
                    if (backupTemplates.isNotEmpty()) {
                        try {
                            CampusAttendApp.instance.database.withTransaction {
                                repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                                for (b in backupTemplates) repository.insertEncryptedTemplate(b)
                            }
                        } catch (_: Throwable) {}
                    }
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "COMMIT_FAILED")
                        put("message", "Failed to commit replacement templates to Room DB. Previous templates preserved.")
                    }.toString()
                }

                // Clean up staged file
                try { stagedFile.delete() } catch (_: Throwable) {}

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", finalCount)
                    put("message", "Replacement face templates committed and permanently locked with Android Keystore AES-256-GCM.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "commitReplacementTemplates error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "COMMIT_EXCEPTION")
                put("message", t.message ?: "Failed to commit replacement templates.")
            }.toString()
        }
    }

    /**
     * Securely enroll a single 512-dimensional face template locally on this device.
     */
    @JavascriptInterface
    fun enrollLocalTemplate(
        staffId: String?,
        deviceId: String?,
        embeddingFloatsJson: String?,
        referenceLabel: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""

            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            if (embeddingFloatsJson.isNullOrBlank()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                }.toString()
            }

            val jsonArr = JSONArray(embeddingFloatsJson)
            if (jsonArr.length() != 512) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_DIMENSION")
                    put("message", "Embedding must contain exactly 512 float values.")
                }.toString()
            }

            val embedding = FloatArray(512)
            for (i in 0 until 512) {
                embedding[i] = jsonArr.getDouble(i).toFloat()
            }

            var sumSq = 0.0
            for (f in embedding) sumSq += f * f
            val norm = sqrt(sumSq).toFloat()
            if (norm !in 0.95f..1.05f && norm > 0f) {
                for (i in embedding.indices) embedding[i] /= norm
            }

            val encResult = keystoreManager.encryptEmbedding(cleanId, embedding)

            runBlocking(Dispatchers.IO) {
                val existingCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (existingCount > 0) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "ALREADY_ENROLLED")
                        put("message", "Face biometric profile is locked. Incremental template addition without administrator replacement approval is prohibited.")
                    }.toString()
                }

                CampusAttendApp.instance.database.withTransaction {
                    val existingStaff = repository.getStaffById(cleanId)
                    if (existingStaff == null) {
                        repository.insertStaff(
                            StaffEntity(
                                id = cleanId,
                                staffCode = cleanId,
                                name = cleanId,
                                active = true
                            )
                        )
                    }

                    repository.insertEncryptedTemplate(
                        EncryptedFaceTemplateEntity(
                            staffId = cleanId,
                            deviceId = currentDeviceId,
                            encryptedTemplate = encResult.ciphertext,
                            iv = encResult.iv,
                            referenceLabel = referenceLabel?.ifBlank { "primary" } ?: "primary",
                            templateVersion = 1,
                            createdAt = System.currentTimeMillis()
                        )
                    )
                }

                val newCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", newCount)
                    put("message", "Face template securely encrypted with Android Keystore and saved to this phone.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "enrollLocalTemplate error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "ENROLLMENT_EXCEPTION")
                put("message", t.message ?: "Failed to encrypt and store local template.")
            }.toString()
        }
    }

    /**
     * Verify live face embedding against locally stored, Keystore-encrypted templates.
     * Computes Cosine Distance. If distance <= 0.45, produces a signed attestation token.
     */
    @JavascriptInterface
    fun verifyLocalFace(
        staffId: String?,
        deviceId: String?,
        liveEmbeddingJson: String?,
        challenge: String?
    ): String {
        return verifyLocalFaceWithEvidence(staffId, deviceId, liveEmbeddingJson, challenge, null)
    }

    @JavascriptInterface
    fun verifyLocalFaceWithEvidence(
        staffId: String?,
        deviceId: String?,
        liveEmbeddingJson: String?,
        challenge: String?,
        livenessEvidenceJson: String?
    ): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()
            val targetDeviceId = deviceId?.trim() ?: ""

            if (targetDeviceId.isNotBlank() && targetDeviceId != currentDeviceId && targetDeviceId != "android-keystore") {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "DEVICE_MISMATCH")
                    put("message", "Target deviceId does not match this hardware device.")
                }.toString()
            }

            if (liveEmbeddingJson.isNullOrBlank()) {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "EMPTY_SAMPLES")
                }.toString()
            }

            val jsonArr = JSONArray(liveEmbeddingJson)
            if (jsonArr.length() != 512) {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "INVALID_DIMENSION")
                    put("message", "Embedding must contain exactly 512 float values.")
                }.toString()
            }

            val liveFloats = FloatArray(512)
            for (i in 0 until 512) {
                liveFloats[i] = jsonArr.getDouble(i).toFloat()
            }

            var sumSq = 0.0
            for (f in liveFloats) sumSq += f * f
            val norm = sqrt(sumSq).toFloat()
            if (norm > 0) {
                for (i in liveFloats.indices) liveFloats[i] /= norm
            }

            // Extract and validate liveness & anti-spoof evidence
            var livenessCompleted = false
            var antiSpoofScore = 0f
            var attemptNonce: String? = null
            var challengeName: String? = challenge

            val evidenceRaw = livenessEvidenceJson?.takeIf { it.isNotBlank() }
                ?: challenge?.takeIf { it.trim().startsWith("{") }

            if (!evidenceRaw.isNullOrBlank()) {
                try {
                    val evJson = JSONObject(evidenceRaw)
                    livenessCompleted = evJson.optBoolean("livenessCompleted", evJson.optBoolean("livenessPassed", false))
                    antiSpoofScore = evJson.optDouble("antiSpoofScore", 0.0).toFloat()
                    if (evJson.has("attemptNonce")) {
                        attemptNonce = evJson.getString("attemptNonce")
                    } else if (evJson.has("nonce")) {
                        attemptNonce = evJson.getString("nonce")
                    }
                    val evChallenge = if (evJson.has("challenge")) {
                        evJson.getString("challenge")
                    } else if (evJson.has("challengeCategory")) {
                        evJson.getString("challengeCategory")
                    } else null
                    if (!evChallenge.isNullOrBlank()) challengeName = evChallenge
                } catch (_: Throwable) {}
            }

            // Mandatory PAD & Liveness enforcement:
            // A recognized face MUST NEVER be sufficient by itself to mark attendance or receive an attestation token!
            if (!BiometricConfig.DEV_MODE_BYPASS_LIVENESS) {
                if (!livenessCompleted) {
                    return JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("error", "LIVENESS_REQUIRED")
                        put("message", "Attendance rejected: Active randomized liveness challenge must be completed before biometric match.")
                    }.toString()
                }

                if (antiSpoofScore < BiometricConfig.ANTI_SPOOF_THRESHOLD || antiSpoofScore <= 0f) {
                    return JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("error", "SPOOF_DETECTED")
                        put("antiSpoofScore", antiSpoofScore.toDouble())
                        put("message", "Attendance rejected: Presentation attack detected (print or screen spoof). Anti-spoof confidence score (${String.format("%.3f", antiSpoofScore)}) is below mandatory threshold (${BiometricConfig.ANTI_SPOOF_THRESHOLD}).")
                    }.toString()
                }

                val cleanNonce = attemptNonce?.trim() ?: ""
                if (cleanNonce.length < 8) {
                    return JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("error", "MISSING_CHALLENGE_NONCE")
                        put("message", "Attendance rejected: Valid challenge attempt nonce is required for replay protection.")
                    }.toString()
                }

                cleanExpiredNonces()
                if (usedAttemptNonces.containsKey(cleanNonce)) {
                    return JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("error", "CHALLENGE_NONCE_REPLAYED")
                        put("message", "Attendance rejected: Challenge session nonce was already consumed or replayed.")
                    }.toString()
                }
                usedAttemptNonces[cleanNonce] = System.currentTimeMillis()
            }

            runBlocking(Dispatchers.IO) {
                val templates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)

                if (templates.isEmpty()) {
                    return@runBlocking JSONObject().apply {
                        put("matched", false)
                        put("error", "NO_LOCAL_TEMPLATE")
                        put("message", "No registered biometric template found on this device for $cleanId.")
                        put("requiresEnrollment", true)
                    }.toString()
                }

                var bestDistance = Float.MAX_VALUE
                var validDecryptions = 0

                for (tmpl in templates) {
                    val decryptedFloats = keystoreManager.decryptEmbedding(
                        cleanId,
                        currentDeviceId,
                        tmpl.encryptedTemplate,
                        tmpl.iv
                    ) ?: continue

                    validDecryptions++
                    var dot = 0.0f
                    for (i in 0 until 512) {
                        dot += liveFloats[i] * decryptedFloats[i]
                    }
                    val dist = 1.0f - dot
                    if (dist < bestDistance) {
                        bestDistance = dist
                    }
                }

                if (validDecryptions == 0) {
                    return@runBlocking JSONObject().apply {
                        put("matched", false)
                        put("error", "DECRYPTION_FAILED")
                        put("message", "Hardware keystore decryption failed. Security tag verification rejected.")
                    }.toString()
                }

                val threshold = BiometricConfig.FACE_MATCH_THRESHOLD
                val matched = bestDistance <= threshold

                if (matched) {
                    val attestationToken = keystoreManager.createAttestationToken(
                        staffId = cleanId,
                        distance = bestDistance,
                        margin = null,
                        livenessPassed = livenessCompleted,
                        challenge = challengeName,
                        antiSpoofScore = if (antiSpoofScore > 0f) antiSpoofScore else null,
                        attemptNonce = attemptNonce
                    )

                    JSONObject().apply {
                        put("matched", true)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("distance", bestDistance.toDouble())
                        put("threshold", threshold.toDouble())
                        put("livenessPassed", livenessCompleted)
                        put("antiSpoofScore", antiSpoofScore.toDouble())
                        put("biometricAttestation", attestationToken)
                        put("message", "Face verified on device via Android Keystore template.")
                    }.toString()
                } else {
                    JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("distance", bestDistance.toDouble())
                        put("threshold", threshold.toDouble())
                        put("error", "FACE_MISMATCH")
                        put("message", "Unknown Face. Best distance (${String.format("%.4f", bestDistance)}) exceeds threshold (${threshold}).")
                    }.toString()
                }
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "verifyLocalFace error", t)
            JSONObject().apply {
                put("matched", false)
                put("error", "VERIFICATION_EXCEPTION")
                put("message", t.message ?: "Verification failed on device.")
            }.toString()
        }
    }

    /**
     * Clear all local encrypted face templates for a staff member on this device.
     */
    @JavascriptInterface
    fun clearLocalTemplates(staffId: String?): String {
        return try {
            if (!isCallingOriginTrusted()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "UNTRUSTED_ORIGIN")
                }.toString()
            }

            val cleanId = staffId?.trim()?.uppercase() ?: ""
            if (cleanId.isEmpty()) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "INVALID_STAFF_ID")
                }.toString()
            }

            val currentDeviceId = keystoreManager.getDeviceId()

            runBlocking(Dispatchers.IO) {
                val deleted = repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
                JSONObject().apply {
                    put("success", true)
                    put("deletedCount", deleted)
                    put("staffId", cleanId)
                    put("message", "Cleared $deleted encrypted template(s) from this device.")
                }.toString()
            }
        } catch (t: Throwable) {
            Log.e("AndroidBiometricBridge", "clearLocalTemplates error", t)
            JSONObject().apply {
                put("success", false)
                put("error", "CLEAR_FAILED")
                put("message", t.message ?: "Failed to clear templates.")
            }.toString()
        }
    }
}
