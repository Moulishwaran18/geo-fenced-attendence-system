package com.campusattend.biometric.security

import android.content.Context
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * Android Keystore-backed Biometric Security Manager.
 *
 * Implements hardware-backed AES-256-GCM encryption for 512-dimensional
 * ArcFace biometric embeddings.
 *
 * Security Features:
 * 1. Hardware/TEE/StrongBox key storage (keys never leave secure hardware).
 * 2. Authenticated Additional Data (AAD) bound to (staffId, deviceId).
 *    Prevents cross-account or cross-device template reuse.
 * 3. Short-lived cryptographic attendance attestation tokens using HMAC-SHA256.
 * 4. Zero plaintext biometric storage on disk or in logs.
 */
class BiometricKeystoreManager(private val context: Context) {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val MASTER_KEY_ALIAS = "campusattend_biometric_master_aes256"
        private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_LENGTH_BITS = 128

        // Shared server secret for HMAC attestation verification
        private const val ATTESTATION_SECRET = "sona-campus-wifi-egress-auth-secret-key-2026"

        private const val TAG = "BiometricKeystoreMgr"
    }

    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply {
        load(null)
    }

    init {
        ensureMasterKey()
    }

    /**
     * Get or create the master AES-256 key inside Android Keystore.
     */
    private fun ensureMasterKey(): SecretKey {
        if (!keyStore.containsAlias(MASTER_KEY_ALIAS)) {
            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE
            )

            val spec = KeyGenParameterSpec.Builder(
                MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false) // Allows bridge execution without extra modal
                .setRandomizedEncryptionRequired(true)
                .build()

            keyGenerator.init(spec)
            keyGenerator.generateKey()
        }

        val entry = keyStore.getEntry(MASTER_KEY_ALIAS, null) as KeyStore.SecretKeyEntry
        return entry.secretKey
    }

    /**
     * Get unique hardware-bound device identifier.
     */
    fun getDeviceId(): String {
        return Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "ANDROID_${UUID.randomUUID().toString().take(12)}"
    }

    data class EncryptedResult(
        val ciphertext: ByteArray,
        val iv: ByteArray,
        val deviceId: String
    )

    /**
     * Encrypt a 512-dimensional float embedding using AES-GCM in Android Keystore.
     * The staffId and deviceId are injected as Authenticated Additional Data (AAD).
     */
    fun encryptEmbedding(staffId: String, embedding: FloatArray): EncryptedResult {
        require(embedding.size == 512) { "Embedding dimension must be exactly 512" }
        val secretKey = ensureMasterKey()
        val deviceId = getDeviceId()

        val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)

        // Bind ciphertext cryptographically to this specific staff member and device
        val aad = "$staffId:$deviceId".toByteArray(Charsets.UTF_8)
        cipher.updateAAD(aad)

        // Convert FloatArray (512 floats) to ByteArray (2048 bytes)
        val byteBuffer = ByteBuffer.allocate(embedding.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        for (f in embedding) {
            byteBuffer.putFloat(f)
        }
        val plaintext = byteBuffer.array()

        val ciphertext = cipher.doFinal(plaintext)
        val iv = cipher.iv

        return EncryptedResult(
            ciphertext = ciphertext,
            iv = iv,
            deviceId = deviceId
        )
    }

    /**
     * Decrypt an AES-GCM encrypted template using Android Keystore.
     * If the staffId or deviceId does not match the original enrollment AAD,
     * GCM tag verification fails immediately with AEADBadTagException.
     */
    fun decryptEmbedding(
        staffId: String,
        deviceId: String,
        ciphertext: ByteArray,
        iv: ByteArray
    ): FloatArray? {
        return try {
            val secretKey = ensureMasterKey()
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            val gcmSpec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv)

            cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)

            // Must match enrollment AAD exactly
            val aad = "$staffId:$deviceId".toByteArray(Charsets.UTF_8)
            cipher.updateAAD(aad)

            val decryptedBytes = cipher.doFinal(ciphertext)
            val floatBuffer = ByteBuffer.wrap(decryptedBytes).order(ByteOrder.LITTLE_ENDIAN)
            val floats = FloatArray(decryptedBytes.size / 4)
            for (i in floats.indices) {
                floats[i] = floatBuffer.getFloat()
            }
            floats
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Biometric decryption failed for staff $staffId on $deviceId: ${e.message}")
            null
        }
    }

    /**
     * Mint a short-lived, single-use cryptographic biometric attestation token.
     * The server validates this token to confirm that local face matching succeeded
     * without relying on client-supplied booleans.
     */
    fun createAttestationToken(
        staffId: String,
        distance: Float,
        margin: Float?,
        livenessPassed: Boolean,
        challenge: String?
    ): String {
        val now = System.currentTimeMillis()
        val nonce = UUID.randomUUID().toString()
        val deviceId = getDeviceId()

        val payload = JSONObject().apply {
            put("staffId", staffId)
            put("deviceId", deviceId)
            put("distance", distance.toDouble())
            if (margin != null) put("margin", margin.toDouble())
            put("livenessPassed", livenessPassed)
            put("method", "device_local_arcface_keystore")
            put("timestamp", now)
            put("nonce", nonce)
            if (!challenge.isNullOrBlank()) put("challenge", challenge)
        }

        val payloadJson = payload.toString()
        val payloadB64 = android.util.Base64.encodeToString(
            payloadJson.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )

        // HMAC-SHA256 signature
        val mac = Mac.getInstance("HmacSHA256")
        val secretSpec = SecretKeySpec(ATTESTATION_SECRET.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(secretSpec)
        val signatureBytes = mac.doFinal(payloadB64.toByteArray(Charsets.UTF_8))
        val signatureB64 = android.util.Base64.encodeToString(
            signatureBytes,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )

        return "$payloadB64.$signatureB64"
    }
}
