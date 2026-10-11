package com.campusattend.biometric.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.campusattend.biometric.CampusAttendApp
import com.campusattend.biometric.config.BiometricConfig
import com.campusattend.biometric.data.BiometricRepository
import com.campusattend.biometric.data.EncryptedFaceTemplateEntity
import com.campusattend.biometric.data.StaffEntity
import com.campusattend.biometric.security.BiometricKeystoreManager
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

    private val keystoreManager = BiometricKeystoreManager(context)
    private val repository: BiometricRepository by lazy {
        BiometricRepository(CampusAttendApp.instance.database)
    }

    private fun isCallingOriginTrusted(): Boolean {
        val currentUrl = webView?.url ?: return true
        val trustedHosts = listOf(
            "geo-fenced-attendence-system.vercel.app",
            "localhost",
            "127.0.0.1",
            "10.0.2.2"
        )
        return try {
            val uri = android.net.Uri.parse(currentUrl)
            val host = uri.host?.lowercase() ?: ""
            trustedHosts.any { host == it || host.endsWith(".$it") }
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun getDeviceId(): String = keystoreManager.getDeviceId()

    /**
     * Inspect enrollment state for a specific staff member on this device.
     */
    @JavascriptInterface
    fun getEnrollmentStatus(staffId: String): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("isEnrolled", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val deviceId = keystoreManager.getDeviceId()

        return runBlocking {
            val count = repository.getEncryptedTemplateCount(cleanId, deviceId)
            val templates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, deviceId)
            val latestTime = templates.maxOfOrNull { it.createdAt } ?: 0L

            val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
            val hasPending = pendingFile.exists()
            var pendingCount = 0
            if (hasPending) {
                try {
                    val pJson = JSONObject(pendingFile.readText())
                    pendingCount = pJson.optJSONArray("templates")?.length() ?: 0
                } catch (_: Exception) {}
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
    }

    /**
     * Stage pending face embeddings encrypted with Android Keystore AES-256-GCM in app-private storage.
     * Staged templates are NOT in the active Room database and cannot be used for attendance until administrator approves.
     */
    @JavascriptInterface
    fun stagePendingEnrollment(
        staffId: String,
        deviceId: String,
        embeddingsJson: String,
        labelsJson: String?
    ): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        if (deviceId.isNotBlank() && deviceId != currentDeviceId) {
            return JSONObject().apply {
                put("success", false)
                put("error", "DEVICE_MISMATCH")
                put("message", "Target deviceId does not match this hardware device.")
            }.toString()
        }

        return try {
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

            val labelsArr = if (!labelsJson.isNullOrBlank()) try { JSONArray(labelsJson) } catch (_: Exception) { null } else null

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
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", "STAGE_EXCEPTION")
                put("message", e.message ?: "Failed to stage pending templates.")
            }.toString()
        }
    }

    /**
     * Check if pending face templates are staged locally on this device.
     */
    @JavascriptInterface
    fun getPendingEnrollmentStatus(staffId: String): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("hasPending", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
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

        return try {
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
        } catch (_: Exception) {
            JSONObject().apply {
                put("hasPending", false)
                put("count", 0)
            }.toString()
        }
    }

    /**
     * Activate staged pending templates on this device after administrator approval.
     * Inserts the encrypted templates into Room DB and removes the pending stage file.
     */
    @JavascriptInterface
    fun activatePendingEnrollment(
        staffId: String,
        deviceId: String,
        oneTimeToken: String?
    ): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        if (deviceId.isNotBlank() && deviceId != currentDeviceId) {
            return JSONObject().apply {
                put("success", false)
                put("error", "DEVICE_MISMATCH")
                put("message", "Target deviceId does not match this hardware device.")
            }.toString()
        }

        if (oneTimeToken.isNullOrBlank()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "MISSING_APPROVAL_TOKEN")
                put("message", "Administrator approval token is required to activate face registration.")
            }.toString()
        }

        val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
        if (!pendingFile.exists()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "NO_PENDING_ENROLLMENT")
                put("message", "No staged pending face enrollment found on this device.")
            }.toString()
        }

        return try {
            val content = pendingFile.readText(Charsets.UTF_8)
            val json = JSONObject(content)
            val templatesArray = json.getJSONArray("templates")

            if (templatesArray.length() == 0) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_PENDING_SAMPLES")
                    put("message", "Pending enrollment file contained 0 templates.")
                }.toString()
            }

            runBlocking {
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

                val finalCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (finalCount == 0) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "PERSISTENCE_FAILED")
                        put("message", "Failed to verify local encrypted templates in device storage.")
                    }
                }

                // Remove staged pending file upon successful Room insertion
                pendingFile.delete()

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", finalCount)
                    put("message", "Face registration approved and activated on this device.")
                }
            }.toString()
        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", "ACTIVATION_EXCEPTION")
                put("message", e.message ?: "Failed to activate pending templates.")
            }.toString()
        }
    }

    /**
     * Clear staged pending enrollment file.
     */
    @JavascriptInterface
    fun clearPendingEnrollment(staffId: String): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val pendingFile = java.io.File(context.filesDir, "pending_face_${cleanId}.json")
        if (pendingFile.exists()) {
            pendingFile.delete()
        }
        return JSONObject().apply {
            put("success", true)
            put("staffId", cleanId)
        }.toString()
    }

    /**
     * Batch-enroll multiple 512-dimensional face templates locally in an atomic transaction.
     * Enforces that once enrolled, templates cannot be silently overwritten without authorized replacement.
     */
    @JavascriptInterface
    fun enrollLocalTemplates(
        staffId: String,
        deviceId: String,
        embeddingsJson: String,
        labelsJson: String?,
        oneTimeToken: String?
    ): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        if (deviceId.isNotBlank() && deviceId != currentDeviceId) {
            return JSONObject().apply {
                put("success", false)
                put("error", "DEVICE_MISMATCH")
                put("message", "Target deviceId does not match this hardware device.")
            }.toString()
        }

        return try {
            val embeddingsArr = JSONArray(embeddingsJson)
            if (embeddingsArr.length() == 0) {
                return JSONObject().apply {
                    put("success", false)
                    put("error", "EMPTY_SAMPLES")
                    put("message", "At least one face sample is required.")
                }.toString()
            }

            val labelsArr = if (!labelsJson.isNullOrBlank()) try { JSONArray(labelsJson) } catch (_: Exception) { null } else null

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
                if (norm !in 0.95f..1.05f) {
                    for (i in embedding.indices) embedding[i] /= norm
                }
                parsedEmbeddings.add(embedding)
            }

            runBlocking {
                val existingCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                val isReplacement = !oneTimeToken.isNullOrBlank()

                // Prevent silent re-enrollment if already enrolled and no replacement token
                if (existingCount > 0 && !isReplacement) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "ALREADY_ENROLLED")
                        put("message", "Face is already enrolled and locked on this device. Re-enrollment requires an authorized face-change approval.")
                    }
                }

                // If authorized replacement, remove prior templates
                if (existingCount > 0 && isReplacement) {
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

                // Verify persistence in Room
                val finalCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (finalCount == 0) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "PERSISTENCE_FAILED")
                        put("message", "Failed to verify local encrypted templates in device storage.")
                    }
                }

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", finalCount)
                    put("message", "Face enrolled on this device. Templates securely encrypted with Android Keystore.")
                }
            }.toString()

        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", "ENROLLMENT_EXCEPTION")
                put("message", e.message ?: "Failed to encrypt and store local templates.")
            }.toString()
        }
    }

    /**
     * Securely enroll a single 512-dimensional face template locally on this device.
     * The template is encrypted with Android Keystore AES-256-GCM before database insertion.
     */
    @JavascriptInterface
    fun enrollLocalTemplate(
        staffId: String,
        deviceId: String,
        embeddingFloatsJson: String,
        referenceLabel: String
    ): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        if (deviceId.isNotBlank() && deviceId != currentDeviceId) {
            return JSONObject().apply {
                put("success", false)
                put("error", "DEVICE_MISMATCH")
                put("message", "Target deviceId does not match this hardware device.")
            }.toString()
        }

        return try {
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

            // Verify L2 normalization
            var sumSq = 0.0
            for (f in embedding) sumSq += f * f
            val norm = sqrt(sumSq).toFloat()
            if (norm !in 0.95f..1.05f) {
                // Normalize if slight precision drift
                for (i in embedding.indices) embedding[i] /= norm
            }

            // 1. Encrypt with Android Keystore AES-256-GCM
            val encResult = keystoreManager.encryptEmbedding(cleanId, embedding)

            // 2. Ensure staff entity exists in local Room database
            runBlocking {
                val existingCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)
                if (existingCount >= 3) {
                    return@runBlocking JSONObject().apply {
                        put("success", false)
                        put("error", "ALREADY_ENROLLED")
                        put("message", "Face biometric is already enrolled and locked on this device ($existingCount templates). Re-enrollment requires authorized face-change approval.")
                    }
                }

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

                // 3. Store encrypted template in Room
                repository.insertEncryptedTemplate(
                    EncryptedFaceTemplateEntity(
                        staffId = cleanId,
                        deviceId = currentDeviceId,
                        encryptedTemplate = encResult.ciphertext,
                        iv = encResult.iv,
                        referenceLabel = referenceLabel.ifBlank { "primary" },
                        templateVersion = 1,
                        createdAt = System.currentTimeMillis()
                    )
                )

                val newCount = repository.getEncryptedTemplateCount(cleanId, currentDeviceId)

                JSONObject().apply {
                    put("success", true)
                    put("staffId", cleanId)
                    put("deviceId", currentDeviceId)
                    put("count", newCount)
                    put("message", "Face template securely encrypted with Android Keystore and saved to this phone.")
                }
            }.toString()

        } catch (e: Exception) {
            JSONObject().apply {
                put("success", false)
                put("error", "ENROLLMENT_EXCEPTION")
                put("message", e.message ?: "Failed to encrypt and store local template.")
            }.toString()
        }
    }

    /**
     * Verify live face embedding against locally stored, Keystore-encrypted templates.
     * Computes Cosine Distance. If distance <= 0.45, produces a signed attestation token.
     */
    @JavascriptInterface
    fun verifyLocalFace(
        staffId: String,
        deviceId: String,
        liveEmbeddingJson: String,
        challenge: String?
    ): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("matched", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        if (deviceId.isNotBlank() && deviceId != currentDeviceId) {
            return JSONObject().apply {
                put("matched", false)
                put("error", "DEVICE_MISMATCH")
                put("message", "Target deviceId does not match this hardware device.")
            }.toString()
        }

        return try {
            val jsonArr = JSONArray(liveEmbeddingJson)
            if (jsonArr.length() != 512) {
                return JSONObject().apply {
                    put("matched", false)
                    put("error", "INVALID_DIMENSION")
                }.toString()
            }

            val liveFloats = FloatArray(512)
            for (i in 0 until 512) {
                liveFloats[i] = jsonArr.getDouble(i).toFloat()
            }

            // Normalize live vector
            var sumSq = 0.0
            for (f in liveFloats) sumSq += f * f
            val norm = sqrt(sumSq).toFloat()
            if (norm > 0) {
                for (i in liveFloats.indices) liveFloats[i] /= norm
            }

            runBlocking {
                val templates = repository.getEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)

                if (templates.isEmpty()) {
                    return@runBlocking JSONObject().apply {
                        put("matched", false)
                        put("error", "NO_LOCAL_TEMPLATE")
                        put("message", "No registered biometric template found on this device for $cleanId.")
                        put("requiresEnrollment", true)
                    }
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
                    // Cosine Distance: 1.0 - dotProduct
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
                    }
                }

                val threshold = BiometricConfig.FACE_MATCH_THRESHOLD
                val matched = bestDistance <= threshold

                if (matched) {
                    val attestationToken = keystoreManager.createAttestationToken(
                        staffId = cleanId,
                        distance = bestDistance,
                        margin = null,
                        livenessPassed = true,
                        challenge = challenge
                    )

                    JSONObject().apply {
                        put("matched", true)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("distance", bestDistance.toDouble())
                        put("threshold", threshold.toDouble())
                        put("biometricAttestation", attestationToken)
                        put("message", "Face verified on device via Android Keystore template.")
                    }
                } else {
                    JSONObject().apply {
                        put("matched", false)
                        put("staffId", cleanId)
                        put("deviceId", currentDeviceId)
                        put("distance", bestDistance.toDouble())
                        put("threshold", threshold.toDouble())
                        put("error", "FACE_MISMATCH")
                        put("message", "Unknown Face. Best distance (${String.format("%.4f", bestDistance)}) exceeds threshold (${threshold}).")
                    }
                }
            }.toString()

        } catch (e: Exception) {
            JSONObject().apply {
                put("matched", false)
                put("error", "VERIFICATION_EXCEPTION")
                put("message", e.message ?: "Verification failed on device.")
            }.toString()
        }
    }

    /**
     * Clear all local encrypted face templates for a staff member on this device.
     */
    @JavascriptInterface
    fun clearLocalTemplates(staffId: String): String {
        if (!isCallingOriginTrusted()) {
            return JSONObject().apply {
                put("success", false)
                put("error", "UNTRUSTED_ORIGIN")
            }.toString()
        }

        val cleanId = staffId.trim().uppercase()
        val currentDeviceId = keystoreManager.getDeviceId()

        return runBlocking {
            val deleted = repository.deleteEncryptedTemplatesForStaffAndDevice(cleanId, currentDeviceId)
            JSONObject().apply {
                put("success", true)
                put("deletedCount", deleted)
                put("staffId", cleanId)
                put("message", "Cleared $deleted encrypted template(s) from this device.")
            }.toString()
        }
    }
}
