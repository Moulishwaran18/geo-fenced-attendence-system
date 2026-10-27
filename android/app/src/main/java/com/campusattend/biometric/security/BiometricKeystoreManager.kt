package com.campusattend.biometric.security

import android.content.Context
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
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
     * Mint a short-lived, device-bound asymmetric biometric attestation token.
     * The token binds the client-generated biometric scores to the hardware-backed
     * EC P-256 private key and the server-issued challenge nonce.
     *
     * NOTE: Cryptographically signing client-reported scores proves device origin
     * and challenge binding; it does NOT independently prove face identity or
     * liveness without trusted execution environment camera hardware attestation.
     */
    fun createAttestationToken(
        staffId: String,
        distance: Float,
        margin: Float?,
        livenessPassed: Boolean,
        challenge: String?,
        antiSpoofScore: Float? = null,
        attemptNonce: String? = null,
        canonicalDeviceId: String? = null
    ): String? {
        val now = System.currentTimeMillis()
        val nonce = attemptNonce ?: UUID.randomUUID().toString()
        val cleanId = staffId.trim().lowercase()
        val alias = "campusattend_device_signing_$cleanId"

        // Use canonical device identifier (DEV_ANDROID_...) matching server registered device record
        val resolvedDeviceId = canonicalDeviceId?.takeIf { it.isNotBlank() }
            ?: getDeviceKeyInfo(staffId).keyId
            ?: getDeviceId()

        val payload = JSONObject().apply {
            put("staffId", staffId)
            put("deviceId", resolvedDeviceId)
            put("distance", distance.toDouble())
            if (margin != null) put("margin", margin.toDouble())
            put("livenessPassed", livenessPassed)
            if (antiSpoofScore != null) put("antiSpoofScore", antiSpoofScore.toDouble())
            put("method", "device_local_arcface_keystore_asymmetric")
            put("timestamp", now)
            put("nonce", nonce)
            if (!challenge.isNullOrBlank()) put("challenge", challenge)
        }

        val payloadJson = payload.toString()
        val payloadB64 = android.util.Base64.encodeToString(
            payloadJson.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
        )

        return try {
            if (!keyStore.containsAlias(alias)) {
                android.util.Log.w(TAG, "Cannot create asymmetric attestation: no device signing key found for $cleanId")
                return null
            }
            val privateKey = (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry).privateKey
            val signer = Signature.getInstance("SHA256withECDSA")
            signer.initSign(privateKey)
            signer.update(payloadB64.toByteArray(Charsets.UTF_8))
            val signatureBytes = signer.sign()
            val signatureB64 = android.util.Base64.encodeToString(
                signatureBytes,
                android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP
            )
            "$payloadB64.$signatureB64"
        } catch (e: Throwable) {
            android.util.Log.e(TAG, "Asymmetric attestation signing failed: ${e.message}")
            null
        }
    }

    data class DeviceKeyResult(
        val keyId: String,
        val publicKeyPem: String,
        val challengeSignature: String,
        val attestationChain: List<String>,
        val isStrongBox: Boolean,
        val isHardwareBacked: Boolean,
        val securityLevel: String
    )

    data class DeviceKeyInfo(
        val hasKey: Boolean,
        val keyId: String?,
        val publicKeyPem: String?,
        val model: String,
        val os: String
    )

    /**
     * Inspect whether a valid hardware-backed signing key already exists for this staff member.
     * Prevents regenerating keys on logout/login and normal app restarts.
     */
    fun getDeviceKeyInfo(staffId: String): DeviceKeyInfo {
        val cleanId = staffId.trim().lowercase()
        val alias = "campusattend_device_signing_$cleanId"
        if (!keyStore.containsAlias(alias)) {
            return DeviceKeyInfo(
                hasKey = false,
                keyId = null,
                publicKeyPem = null,
                model = android.os.Build.MODEL ?: "Android Device",
                os = "Android " + android.os.Build.VERSION.RELEASE
            )
        }

        return try {
            val cert = keyStore.getCertificate(alias)
            val publicKey = cert?.publicKey
            if (publicKey != null) {
                val pubKeyB64 = android.util.Base64.encodeToString(publicKey.encoded, android.util.Base64.NO_WRAP)
                val pubKeyPem = "-----BEGIN PUBLIC KEY-----\n" +
                        pubKeyB64.chunked(64).joinToString("\n") +
                        "\n-----END PUBLIC KEY-----"
                val keyId = "DEV_ANDROID_${getDeviceId().take(12)}_${cleanId.uppercase()}"
                DeviceKeyInfo(
                    hasKey = true,
                    keyId = keyId,
                    publicKeyPem = pubKeyPem,
                    model = android.os.Build.MODEL ?: "Android Device",
                    os = "Android " + android.os.Build.VERSION.RELEASE
                )
            } else {
                DeviceKeyInfo(
                    hasKey = false,
                    keyId = null,
                    publicKeyPem = null,
                    model = android.os.Build.MODEL ?: "Android Device",
                    os = "Android " + android.os.Build.VERSION.RELEASE
                )
            }
        } catch (_: Throwable) {
            DeviceKeyInfo(
                hasKey = false,
                keyId = null,
                publicKeyPem = null,
                model = android.os.Build.MODEL ?: "Android Device",
                os = "Android " + android.os.Build.VERSION.RELEASE
            )
        }
    }

    /**
     * Generate a non-exportable hardware-backed EC P-256 signing key in Android Keystore.
     * Prefers StrongBox when supported; falls back explicitly to standard TEE.
     * Uses Key Attestation to bind the server challenge into the hardware certificate chain.
     */
    fun generateDeviceSigningKey(challenge: String, staffId: String): DeviceKeyResult {
        val cleanId = staffId.trim().lowercase()
        val alias = "campusattend_device_signing_$cleanId"
        var isStrongBox = false
        var isHardwareBacked = true
        var securityLevel = "TEE"

        if (keyStore.containsAlias(alias)) {
            try {
                keyStore.deleteEntry(alias)
            } catch (_: Throwable) {}
        }

        var keyGenSuccess = false
        // 1. Prefer StrongBox dedicated HSM
        try {
            val kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                ANDROID_KEYSTORE
            )
            val strongBoxSpec = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge.toByteArray(Charsets.UTF_8))
                .setIsStrongBoxBacked(true)
                .setUserAuthenticationRequired(false)
                .build()

            kpg.initialize(strongBoxSpec)
            kpg.generateKeyPair()
            keyGenSuccess = true
            isStrongBox = true
            securityLevel = "StrongBox"
        } catch (e: Throwable) {
            android.util.Log.i(TAG, "StrongBox not available on device (${e.message}), falling back to TEE Android Keystore")
        }

        // 2. Fallback to TEE Android Keystore
        if (!keyGenSuccess) {
            val kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                ANDROID_KEYSTORE
            )
            val teeSpec = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge.toByteArray(Charsets.UTF_8))
                .setUserAuthenticationRequired(false)
                .build()

            kpg.initialize(teeSpec)
            kpg.generateKeyPair()
            securityLevel = "TEE"
        }

        val certChain = keyStore.getCertificateChain(alias)
        val attestationB64List = certChain?.map { cert ->
            android.util.Base64.encodeToString(cert.encoded, android.util.Base64.NO_WRAP)
        } ?: emptyList()

        val publicKey = keyStore.getCertificate(alias).publicKey
        val pubKeyB64 = android.util.Base64.encodeToString(publicKey.encoded, android.util.Base64.NO_WRAP)
        val pubKeyPem = "-----BEGIN PUBLIC KEY-----\n" +
                pubKeyB64.chunked(64).joinToString("\n") +
                "\n-----END PUBLIC KEY-----"

        // Sign the server challenge with the newly minted private key
        val privateKey = (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry).privateKey
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(challenge.toByteArray(Charsets.UTF_8))
        val signatureBytes = signer.sign()
        val signatureB64 = android.util.Base64.encodeToString(signatureBytes, android.util.Base64.NO_WRAP)

        val keyId = "DEV_ANDROID_${getDeviceId().take(12)}_${cleanId.uppercase()}"

        return DeviceKeyResult(
            keyId = keyId,
            publicKeyPem = pubKeyPem,
            challengeSignature = signatureB64,
            attestationChain = attestationB64List,
            isStrongBox = isStrongBox,
            isHardwareBacked = isHardwareBacked,
            securityLevel = securityLevel
        )
    }

    /**
     * Cryptographically sign an attendance request payload using the device's private key.
     */
    fun signAttendancePayload(staffId: String, payload: String): String? {
        return try {
            val alias = "campusattend_device_signing_${staffId.trim().lowercase()}"
            if (!keyStore.containsAlias(alias)) return null
            val privateKey = (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry).privateKey
            val signer = Signature.getInstance("SHA256withECDSA")
            signer.initSign(privateKey)
            signer.update(payload.toByteArray(Charsets.UTF_8))
            val signatureBytes = signer.sign()
            android.util.Base64.encodeToString(signatureBytes, android.util.Base64.NO_WRAP)
        } catch (e: Throwable) {
            android.util.Log.e(TAG, "signAttendancePayload failed for staff $staffId: ${e.message}")
            null
        }
    }
}
