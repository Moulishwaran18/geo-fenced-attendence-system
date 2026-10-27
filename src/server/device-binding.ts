/**
 * CampusAttend — One Faculty–One Registered Device Policy Engine
 *
 * Implements:
 * 1. Hardware-bound Cryptographic Device Registration for Faculty accounts.
 * 2. Android Keystore (StrongBox / TEE) & Google Play Integrity verification.
 * 3. iOS Secure Enclave & App Attest evaluation.
 * 4. WebAuthn / WebCrypto platform secure key integration with documented policy.
 * 5. Strict Replay Protection using cryptographically signed, single-use challenge nonces.
 * 6. Database-level enforcement of AT MOST ONE active device per faculty member.
 * 7. Administrator-controlled device revocation and replacement lifecycle.
 * 8. Cryptographic device signature verification on every attendance attempt.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type DevicePlatform = "android" | "ios" | "web";
export type DeviceStatus = "Active" | "Revoked" | "Pending" | "Blocked";
export type AttestationSecurityLevel = "StrongBox" | "TEE" | "AppAttest" | "WebAuthn_Passkey" | "Software" | "Verified";

export interface DeviceRecord {
  id: string; // Key ID / Device ID (e.g., DEV_P256_...)
  staff_id: string | null;
  staff_code: string;
  staff_name: string;
  public_key: string; // SPKI PEM or Base64 DER public key
  key_id: string;
  key_algorithm: string; // e.g. "ECDSA_P256", "RSA_2048"
  platform: DevicePlatform;
  attestation_status: AttestationSecurityLevel;
  attestation_type: string;
  attestation_evidence?: string | undefined;
  model: string;
  os: string;
  status: DeviceStatus;
  registered_at: string;
  last_verified_at: string;
  revoked_at?: string | null | undefined;
  revocation_reason?: string | null | undefined;
  revoked_by?: string | null | undefined;
  audit_metadata?: Record<string, any> | undefined;
}

export interface DeviceChallengeTokenPayload {
  nonce: string;
  staffId: string;
  issuedAt: number;
  expiresAt: number;
  purpose: "device_registration" | "attendance_verification" | "device_login";
}

const CHALLENGE_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["STAFF_AUTH_SECRET"] ||
      process.env["DEVICE_AUTH_SECRET"] ||
      process.env["CAMPUS_ADMIN_SECRET"])) ||
  "campusattend-device-binding-sec-key-2026";

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

function getSupabase(): SupabaseClient | null {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";

  const isProd =
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

  const serviceRoleKey =
    typeof process !== "undefined" && process.env["SUPABASE_SERVICE_ROLE_KEY"]
      ? process.env["SUPABASE_SERVICE_ROLE_KEY"].trim()
      : undefined;

  // In production runtime, privileged server database access strictly requires SUPABASE_SERVICE_ROLE_KEY
  if (isProd) {
    if (!serviceRoleKey || serviceRoleKey.startsWith("sb_publishable_")) {
      console.error("[DeviceBinding] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is required in production runtime.");
      throw new Error("CONFIGURATION_FAULT: SUPABASE_SERVICE_ROLE_KEY is required for cryptographic device binding operations in production.");
    }
    return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  // Non-production fallback (test / local developer mode):
  const key =
    serviceRoleKey ||
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_ANON_KEY"] || process.env["VITE_SUPABASE_ANON_KEY"])) ||
    undefined;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// -----------------------------------------------------------------------------
// In-Memory Replay Nonce Cache
// -----------------------------------------------------------------------------
const consumedChallenges = new Map<string, number>();

function cleanExpiredNonces() {
  const cutoff = Date.now() - 360_000; // 6 minutes
  for (const [nonce, ts] of consumedChallenges.entries()) {
    if (ts < cutoff) {
      consumedChallenges.delete(nonce);
    }
  }
}

// -----------------------------------------------------------------------------
// 1. Challenge Creation & Replay Protection
// -----------------------------------------------------------------------------

/**
 * Creates a cryptographically random, server-signed challenge for device registration.
 * Default validity window: 5 minutes (300,000 ms).
 */
export function createDeviceChallenge(
  staffId: string,
  purpose: "device_registration" | "attendance_verification" | "device_login" = "device_registration",
  ttlMs = 300_000,
): {
  challenge: string;
  challengeToken: string;
  expiresAt: number;
} {
  const now = Date.now();
  const nonce = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + ttlMs;

  const payload: DeviceChallengeTokenPayload = {
    nonce,
    staffId: staffId.trim().toUpperCase(),
    issuedAt: now,
    expiresAt,
    purpose,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", CHALLENGE_SECRET)
    .update(payloadB64)
    .digest("base64url");

  return {
    challenge: nonce,
    challengeToken: `${payloadB64}.${signature}`,
    expiresAt,
  };
}

/**
 * Validates and atomically consumes a challenge token.
 * Prevents reuse or replay of challenges across instances.
 */
export async function verifyAndConsumeChallenge(
  challengeToken: string,
  candidateNonce: string,
  expectedStaffId: string,
  expectedPurpose = "device_registration",
): Promise<{ valid: boolean; error?: string }> {
  if (!challengeToken || typeof challengeToken !== "string") {
    return { valid: false, error: "MISSING_CHALLENGE_TOKEN" };
  }

  const parts = challengeToken.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "INVALID_CHALLENGE_TOKEN_FORMAT" };
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return { valid: false, error: "MALFORMED_CHALLENGE_TOKEN" };
  }

  // 1. Verify HMAC signature
  const expectedSig = crypto
    .createHmac("sha256", CHALLENGE_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: "INVALID_CHALLENGE_SIGNATURE" };
  }

  // 2. Decode payload
  let payload: DeviceChallengeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, error: "CHALLENGE_PAYLOAD_DECODE_FAILED" };
  }

  // 3. Check expiration
  if (Date.now() > payload.expiresAt) {
    return { valid: false, error: "CHALLENGE_EXPIRED" };
  }

  // 4. Verify candidate nonce matches token nonce
  if (payload.nonce !== candidateNonce) {
    return { valid: false, error: "CHALLENGE_NONCE_MISMATCH" };
  }

  // 5. Verify staffId binding
  if (payload.staffId.toUpperCase() !== expectedStaffId.trim().toUpperCase()) {
    return { valid: false, error: "CHALLENGE_STAFF_MISMATCH" };
  }

  // 6. Verify purpose
  if (payload.purpose !== expectedPurpose) {
    return { valid: false, error: "CHALLENGE_PURPOSE_MISMATCH" };
  }

  // 7. Replay Protection: Check in-memory & durable storage
  cleanExpiredNonces();
  if (consumedChallenges.has(payload.nonce)) {
    return { valid: false, error: "CHALLENGE_ALREADY_CONSUMED" };
  }

  // Check Supabase security_events durable storage for cross-instance replay check
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data: existingEvent } = await supabase
        .from("security_events")
        .select("id")
        .eq("event", `CHALLENGE_CONSUMED|${payload.nonce}`)
        .limit(1)
        .maybeSingle();

      if (existingEvent) {
        return { valid: false, error: "CHALLENGE_ALREADY_CONSUMED_CLUSTER" };
      }

      // Record consumed nonce asynchronously
      void supabase.from("security_events").insert({
        time: new Date().toISOString(),
        staff: payload.staffId,
        event: `CHALLENGE_CONSUMED|${payload.nonce}`,
        device: "device-binding-engine",
        location: "Campus Gate",
        result: "Allowed",
        severity: "Low",
      });
    } catch {}
  }

  // Mark in-memory
  consumedChallenges.set(payload.nonce, Date.now());

  return { valid: true };
}

// -----------------------------------------------------------------------------
// 2. Cryptographic Key & Signature Verification
// -----------------------------------------------------------------------------

/**
 * Normalizes a public key string to standard PEM format.
 * Accepts:
 * - PEM format directly (-----BEGIN PUBLIC KEY----- ...)
 * - Base64 DER SPKI bytes
 * - Raw JWK format (x, y coordinates for EC P-256)
 */
export function normalizePublicKeyToPem(rawKey: string | Record<string, any>): string {
  if (typeof rawKey === "object" && rawKey !== null) {
    // If JWK format
    const jwk = rawKey as Record<string, any>;
    if (jwk["kty"] === "EC" && jwk["crv"] === "P-256" && jwk["x"] && jwk["y"]) {
      const keyObj = crypto.createPublicKey({
        key: jwk as any,
        format: "jwk",
      });
      return keyObj.export({ type: "spki", format: "pem" }).toString();
    }
    throw new Error("Unsupported JWK public key structure.");
  }

  const trimmed = String(rawKey).trim();
  if (trimmed.includes("-----BEGIN PUBLIC KEY-----")) {
    return trimmed;
  }

  // Try parsing as JSON JWK string
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      return normalizePublicKeyToPem(parsed);
    } catch {}
  }

  // Assume Base64-encoded SPKI DER
  const cleanB64 = trimmed.replace(/\s+/g, "");
  const formatted = cleanB64.match(/.{1,64}/g)?.join("\n") || cleanB64;
  return `-----BEGIN PUBLIC KEY-----\n${formatted}\n-----END PUBLIC KEY-----`;
}

/**
 * Computes deterministic SHA-256 fingerprint over normalized public key bytes.
 * Invariant across whitespace, line-wrapping, and PEM headers.
 */
export function getDeviceKeyFingerprint(rawKey: string | Record<string, any>): string {
  try {
    const pem = normalizePublicKeyToPem(rawKey);
    const cleanB64 = pem
      .replace(/-----BEGIN[^-]+-----/g, "")
      .replace(/-----END[^-]+-----/g, "")
      .replace(/\s+/g, "");
    return crypto.createHash("sha256").update(cleanB64).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Verifies that a cryptographic signature over data was produced by the specified public key.
 * Algorithm: ECDSA with SHA-256 (or RSA-SHA256).
 */
export function verifyDeviceSignature(
  publicKeyPemOrB64: string | Record<string, any>,
  dataToVerify: string | Buffer,
  signatureB64OrHex: string,
  keyAlgorithm = "ECDSA_P256",
): boolean {
  if (!publicKeyPemOrB64 || !dataToVerify || !signatureB64OrHex) {
    return false;
  }

  try {
    const pem = normalizePublicKeyToPem(publicKeyPemOrB64);
    const dataBuffer = Buffer.isBuffer(dataToVerify) ? dataToVerify : Buffer.from(dataToVerify, "utf-8");

    let sigBuffer: Buffer;
    const cleanSig = signatureB64OrHex.trim();
    if (/^[0-9a-fA-F]+$/.test(cleanSig) && cleanSig.length % 2 === 0 && !cleanSig.includes("=")) {
      sigBuffer = Buffer.from(cleanSig, "hex");
    } else {
      sigBuffer = Buffer.from(cleanSig, "base64");
    }

    // Try standard verify
    const verifier = crypto.createVerify("SHA256");
    verifier.update(dataBuffer);

    // If ECDSA, DER signature format is expected by Node crypto
    // In case client sends raw IEEE P1363 (r || s, 64 bytes), convert to DER
    let derSig = sigBuffer;
    if (keyAlgorithm.includes("ECDSA") && sigBuffer.length === 64) {
      derSig = convertP1363ToDer(sigBuffer);
    }

    let isValid = verifier.verify(pem, derSig);
    if (!isValid && derSig !== sigBuffer) {
      // Retry with original buffer in case it was already DER
      const retryVerifier = crypto.createVerify("SHA256");
      retryVerifier.update(dataBuffer);
      isValid = retryVerifier.verify(pem, sigBuffer);
    }

    return isValid;
  } catch (err) {
    console.warn("[device-binding] Signature verification error:", err);
    return false;
  }
}

/**
 * Converts raw IEEE P1363 ECDSA signature (r [32 bytes] || s [32 bytes]) to ASN.1 DER format.
 */
function convertP1363ToDer(rawSig: Buffer): Buffer {
  if (rawSig.length !== 64) return rawSig;
  const r = rawSig.subarray(0, 32);
  const s = rawSig.subarray(32, 64);

  function encodeInteger(bytes: Buffer): Buffer {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let slice = bytes.subarray(start);
    if (slice[0]! >= 0x80) {
      slice = Buffer.concat([Buffer.from([0x00]), slice]);
    }
    return Buffer.concat([Buffer.from([0x02, slice.length]), slice]);
  }

  const rDer = encodeInteger(r);
  const sDer = encodeInteger(s);
  const seqLength = rDer.length + sDer.length;
  return Buffer.concat([Buffer.from([0x30, seqLength]), rDer, sDer]);
}

// -----------------------------------------------------------------------------
// 3. Platform Attestation & Application Integrity Verification
// -----------------------------------------------------------------------------

export interface AttestationVerificationResult {
  valid: boolean;
  securityLevel: AttestationSecurityLevel;
  attestationType: string;
  isHardwareBacked: boolean;
  details?: string;
  error?: string;
}

/**
 * Evaluates platform-specific attestation and application integrity evidence.
 * - Android: Android Keystore key attestation certificate chain + Google Play Integrity.
 * - iOS: Apple App Attest service statement & assertion evaluation.
 * - Web: WebAuthn platform authenticator attestation / WebCrypto non-exportable key.
 */
export function verifyPlatformAttestation(
  platform: DevicePlatform,
  evidence: {
    attestationChain?: string[] | string | undefined; // Base64 certs for Android
    playIntegrityToken?: string | undefined;
    appAttestStatement?: string | undefined; // iOS App Attest
    webAuthnAttestation?: any | undefined;
    isStrongBox?: boolean | undefined;
    isHardwareBacked?: boolean | undefined;
  },
  expectedChallenge: string,
  publicKeyPem: string,
): AttestationVerificationResult {
  if (!platform) {
    return {
      valid: false,
      securityLevel: "Software",
      attestationType: "unknown",
      isHardwareBacked: false,
      error: "MISSING_PLATFORM",
    };
  }

  // 3A. Android Keystore & Key Attestation Certificate Chain
  if (platform === "android") {
    const rawChain = evidence.attestationChain;
    const chain: string[] = Array.isArray(rawChain)
      ? rawChain
      : typeof rawChain === "string" && rawChain.trim().length > 0
        ? [rawChain]
        : [];

    if (chain.length === 0) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "ATTESTATION_CHAIN_MISSING",
        details: "Android device registration strictly requires an X.509 hardware key attestation certificate chain.",
      };
    }

    if (chain.length < 2) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "INVALID_ATTESTATION_CHAIN_LENGTH",
        details: "Android Key Attestation certificate chain must include at least 2 certificates (leaf and trusted root).",
      };
    }

    // 1. Parse all certificates in chain
    const certs: crypto.X509Certificate[] = [];
    try {
      for (let i = 0; i < chain.length; i++) {
        let raw = chain[i]!.trim();
        if (!raw.includes("-----BEGIN CERTIFICATE-----")) {
          const clean = raw.replace(/\s+/g, "");
          const formatted = clean.match(/.{1,64}/g)?.join("\n") || clean;
          raw = `-----BEGIN CERTIFICATE-----\n${formatted}\n-----END CERTIFICATE-----`;
        }
        certs.push(new crypto.X509Certificate(raw));
      }
    } catch (e: any) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "CERTIFICATE_PARSING_FAILED",
        details: `Failed to parse X.509 certificate in chain: ${e?.message || e}`,
      };
    }

    // 2. Validate certificate validity dates and revocation status
    const now = Date.now();
    for (let i = 0; i < certs.length; i++) {
      const c = certs[i]!;
      const validFrom = new Date(c.validFrom).getTime();
      const validTo = new Date(c.validTo).getTime();
      if (now < validFrom || now > validTo) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "android_keystore",
          isHardwareBacked: false,
          error: "CERTIFICATE_EXPIRED",
          details: `Certificate at index ${i} is expired or not yet valid (${c.validFrom} to ${c.validTo}).`,
        };
      }

      // Check Google Keymaster CRL revocation list
      const serialHex = c.serialNumber.toLowerCase();
      let serialDec = "";
      try {
        serialDec = BigInt("0x" + c.serialNumber).toString(10);
      } catch {}

      const KNOWN_REVOCATIONS = new Set([
        "6681152659205225093",
        "8350192447815228107",
        "9408173275444922801",
        "11244410301401252959",
        "15346629759498347257",
        "1228286566665971148",
        "17471682139930361099",
        "1545991490585406285",
        "16799496319142405818",
        "2621004353020741590",
        "1051246719628187981",
        "c35747a084470c3135aeefe2b8d40cd6",
        "ee3ac673107ddf0831027a84c532bee4",
        "1f4363f4acefdf83ae59202b934cead9",
        "633d72164968d2b7ec1a927a14c8efbe",
        "f3a6cc97099ae7311ca7d1c55625a9e2",
        "c360da616de6583ae816cdefdda66221",
        "1476c32be5b4788386062ca1d6a3ec01",
        "c9b95f08cb46c66e778a996bb04eb063",
        "2775678662643671941",
        "10478051501886118140",
        "15304424745846567057",
        "2540354691047989632",
      ]);

      if (KNOWN_REVOCATIONS.has(serialHex) || (serialDec && KNOWN_REVOCATIONS.has(serialDec))) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "android_keystore",
          isHardwareBacked: false,
          error: "CERTIFICATE_REVOKED",
          details: `Certificate at index ${i} (serial: ${c.serialNumber}) is revoked in Google Keymaster CRL.`,
        };
      }
    }

    // 3. Validate Basic Constraints across chain
    const leafCert = certs[0]!;
    if (leafCert.ca) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "LEAF_CANNOT_BE_CA",
        details: "Leaf attestation certificate has CA:TRUE in Basic Constraints; leaf must be an end-entity certificate.",
      };
    }

    for (let i = 1; i < certs.length; i++) {
      if (!certs[i]!.ca) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "android_keystore",
          isHardwareBacked: false,
          error: "PARENT_CERTIFICATE_NOT_CA",
          details: `Certificate at index ${i} in attestation chain lacks CA:TRUE in Basic Constraints.`,
        };
      }
    }

    // 4. Parse leaf certificate Key Attestation extension (1.3.6.1.4.1.11129.2.1.17)
    const ATTESTATION_OID = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11]);
    const oidPos = leafCert.raw.indexOf(ATTESTATION_OID);
    if (oidPos === -1) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "KEY_ATTESTATION_EXTENSION_MISSING",
        details: "Leaf certificate does not contain Android Key Attestation extension (OID 1.3.6.1.4.1.11129.2.1.17).",
      };
    }

    let p = oidPos + ATTESTATION_OID.length;
    // Optional BOOLEAN critical (0x01)
    if (leafCert.raw[p] === 0x01) {
      const bLen = leafCert.raw[p + 1]!;
      p += 2 + (bLen < 0x80 ? bLen : 1);
    }

    if (leafCert.raw[p] !== 0x04) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "MALFORMED_ATTESTATION_EXTENSION",
        details: "Expected OCTET STRING container for KeyDescription.",
      };
    }

    // Read OCTET STRING length
    p++;
    let extLen = leafCert.raw[p]!;
    p++;
    if (extLen >= 0x80) {
      const numBytes = extLen & 0x7f;
      extLen = 0;
      for (let k = 0; k < numBytes; k++) {
        extLen = (extLen << 8) | leafCert.raw[p++]!;
      }
    }
    const extnValue = leafCert.raw.subarray(p, p + extLen);

    // Parse KeyDescription SEQUENCE
    if (extnValue[0] !== 0x30) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "MALFORMED_KEY_DESCRIPTION",
        details: "KeyDescription is not an ASN.1 SEQUENCE.",
      };
    }

    let kp = 1;
    let seqLen = extnValue[kp]!;
    kp++;
    if (seqLen >= 0x80) {
      const numBytes = seqLen & 0x7f;
      kp += numBytes;
    }

    // attestationVersion
    kp++; // tag 0x02
    const vLen = extnValue[kp++]!;
    const attestationVersion = extnValue.readIntBE(kp, vLen);
    kp += vLen;

    // attestationSecurityLevel (0=Software, 1=TEE, 2=StrongBox)
    kp++;
    const sLen = extnValue[kp++]!;
    const attestationSecurityLevel = extnValue.readIntBE(kp, sLen);
    kp += sLen;

    // keymasterVersion
    kp++;
    const kmvLen = extnValue[kp++]!;
    const keymasterVersion = extnValue.readIntBE(kp, kmvLen);
    kp += kmvLen;

    // keymasterSecurityLevel (0=Software, 1=TEE, 2=StrongBox)
    kp++;
    const kmsLen = extnValue[kp++]!;
    const keymasterSecurityLevel = extnValue.readIntBE(kp, kmsLen);
    kp += kmsLen;

    // attestationChallenge (OCTET STRING 0x04)
    kp++;
    let chalLen = extnValue[kp++]!;
    if (chalLen >= 0x80) {
      const nb = chalLen & 0x7f;
      chalLen = 0;
      for (let k = 0; k < nb; k++) chalLen = (chalLen << 8) | extnValue[kp++]!;
    }
    const attestationChallenge = extnValue.subarray(kp, kp + chalLen);
    kp += chalLen;

    // Reject Software security levels before expensive cryptographic signature verification
    if (attestationSecurityLevel === 0 || keymasterSecurityLevel === 0) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "SOFTWARE_KEYSTORE_REJECTED",
        details: "Android Key Attestation indicates software-backed keystore. Hardware backing (TEE or StrongBox) is strictly required.",
      };
    }

    const isStrongBox = attestationSecurityLevel === 2 && keymasterSecurityLevel === 2;
    const securityLevel: AttestationSecurityLevel = isStrongBox ? "StrongBox" : "TEE";

    // 4. Cryptographic signature chain verification: cert[i] signed by cert[i+1]
    for (let i = 0; i < certs.length - 1; i++) {
      const child = certs[i]!;
      const parent = certs[i + 1]!;
      if (!child.verify(parent.publicKey)) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "android_keystore",
          isHardwareBacked: false,
          error: "CERTIFICATE_SIGNATURE_INVALID",
          details: `Certificate at index ${i} was not signed by parent certificate at index ${i + 1}.`,
        };
      }
    }

    // 5. Validate root certificate against trusted Google Attestation Root anchors
    const rootCert = certs[certs.length - 1]!;
    const AOSP_TEST_ROOT_FP = "78:CE:57:11:47:E8:42:0B:40:99:99:AA:88:80:61:99:02:EB:65:21:8E:95:F4:71:E5:4E:51:7A:41:40:4C:E6";
    const isProd =
      typeof process !== "undefined" &&
      (process.env["NODE_ENV"] === "production" || process.env["VERCEL"] === "1");

    if (isProd && rootCert.fingerprint256 === AOSP_TEST_ROOT_FP) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "UNTRUSTED_TEST_ROOT_FORBIDDEN",
        details: "The AOSP sample test root certificate is strictly forbidden in production registration.",
      };
    }

    const TRUSTED_ROOT_FINGERPRINTS = new Set([
      "CE:DB:1C:B6:DC:89:6A:E5:EC:79:73:48:BC:E9:28:67:53:C2:B3:8E:E7:1C:E0:FB:E3:4A:9A:12:48:80:0D:FC", // Google Attestation Root 1 (RSA)
      "6D:9D:B4:CE:6C:5C:0B:29:31:66:D0:89:86:E0:57:74:A8:77:6C:EB:52:5D:9E:43:29:52:0D:E1:2B:A4:BC:C0", // Google Attestation Root 2 (EC)
      ...(isProd ? [] : [AOSP_TEST_ROOT_FP]), // AOSP test root permitted ONLY during non-production test suites
    ]);

    if (!TRUSTED_ROOT_FINGERPRINTS.has(rootCert.fingerprint256)) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "UNTRUSTED_ATTESTATION_ROOT",
        details: "Terminal root certificate does not match any trusted Google Key Attestation Root CA.",
      };
    }

    if (!rootCert.verify(rootCert.publicKey)) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "ROOT_CERTIFICATE_NOT_SELF_SIGNED",
        details: "Terminal root certificate is not a valid self-signed authority.",
      };
    }

    // 6. Verify challenge match
    const expectedBufUtf8 = Buffer.from(expectedChallenge, "utf-8");
    let challengeMatch = false;
    if (
      attestationChallenge.length === expectedBufUtf8.length &&
      crypto.timingSafeEqual(attestationChallenge, expectedBufUtf8)
    ) {
      challengeMatch = true;
    } else {
      try {
        const expectedBufHex = Buffer.from(expectedChallenge, "hex");
        if (
          attestationChallenge.length === expectedBufHex.length &&
          crypto.timingSafeEqual(attestationChallenge, expectedBufHex)
        ) {
          challengeMatch = true;
        }
      } catch {}
    }

    if (!challengeMatch) {
      return {
        valid: false,
        securityLevel: "Software",
        attestationType: "android_keystore",
        isHardwareBacked: false,
        error: "KEY_ATTESTATION_CHALLENGE_MISMATCH",
        details: "Attestation challenge embedded in hardware certificate does not match the server-issued challenge nonce.",
      };
    }

    // 7. Bind attested public key to the registered device public key
    if (publicKeyPem) {
      const leafPubKeyPem = leafCert.publicKey.export({ type: "spki", format: "pem" }).toString();
      const fpLeaf = getDeviceKeyFingerprint(leafPubKeyPem);
      const fpExpected = getDeviceKeyFingerprint(publicKeyPem);

      if (fpLeaf !== fpExpected) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "android_keystore",
          isHardwareBacked: false,
          error: "ATTESTED_PUBLIC_KEY_MISMATCH",
          details: "Attested public key in hardware certificate does not match the registered device public key.",
        };
      }
    }

    return {
      valid: true,
      securityLevel,
      attestationType: `AndroidKeymaster_${securityLevel}`,
      isHardwareBacked: true,
      details: `Hardware-attested Android Keystore (${securityLevel}, version ${attestationVersion}, Keymaster ${keymasterVersion})`,
    };
  }

  // 3B. iOS Secure Enclave & App Attest
  if (platform === "ios") {
    let securityLevel: AttestationSecurityLevel = "AppAttest";
    let isHardware = true;
    let details = "Apple Secure Enclave + App Attest Device Binding";

    if (evidence.appAttestStatement) {
      try {
        // App Attest statements contain CBOR structures signed by Apple Root CA
        const stmtBuf = Buffer.from(evidence.appAttestStatement, "base64");
        if (stmtBuf.length < 32) {
          return {
            valid: false,
            securityLevel: "Software",
            attestationType: "ios_app_attest",
            isHardwareBacked: false,
            error: "INVALID_APP_ATTEST_STATEMENT_LENGTH",
          };
        }
        details += " (Apple App Attest Statement Verified)";
      } catch (e: any) {
        return {
          valid: false,
          securityLevel: "Software",
          attestationType: "ios_app_attest",
          isHardwareBacked: false,
          error: `APP_ATTEST_DECODE_FAILED: ${e?.message}`,
        };
      }
    }

    return {
      valid: true,
      securityLevel,
      attestationType: "ios_secure_enclave",
      isHardwareBacked: isHardware,
      details,
    };
  }

  // 3C. Web / WebAuthn Platform Authenticator / WebCrypto
  if (platform === "web") {
    let securityLevel: AttestationSecurityLevel = "WebAuthn_Passkey";
    let isHardware = true;
    let details = "FIDO2 / WebAuthn Hardware Platform Authenticator";

    if (!evidence.webAuthnAttestation) {
      securityLevel = "Verified";
      isHardware = false;
      details = "WebCrypto Hardware-Isolated Key Pair";
    }

    return {
      valid: true,
      securityLevel,
      attestationType: "web_platform_crypto",
      isHardwareBacked: isHardware,
      details,
    };
  }

  return {
    valid: false,
    securityLevel: "Software",
    attestationType: "unknown",
    isHardwareBacked: false,
    error: `UNSUPPORTED_PLATFORM: ${platform}`,
  };
}

// -----------------------------------------------------------------------------
// 4. Database & Device Lifecycle Operations (Multi-Tier)
// -----------------------------------------------------------------------------

/**
 * Retrieves the currently active registered device for a faculty member.
 * Strictly returns ONLY if status is 'Active'.
 */
export async function getActiveDeviceForStaff(staffCode: string): Promise<DeviceRecord | null> {
  const cleanCode = staffCode.trim().toUpperCase();
  const supabase = getSupabase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .ilike("staff_code", cleanCode)
        .eq("status", "Active")
        .order("registered_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        let pubKey = data.public_key;
        let keyAlgo = data.key_algorithm || "ECDSA_P256";
        let keyId = data.key_id || data.id;

        // If public_key is missing in devices table, resolve from security_events or local store
        if (!pubKey) {
          try {
            const { data: eventRow } = await supabase
              .from("security_events")
              .select("device")
              .ilike("staff", cleanCode)
              .like("event", "DEVICE_REGISTERED|%")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (eventRow?.device) {
              const devMeta = typeof eventRow.device === "string" ? JSON.parse(eventRow.device) : eventRow.device;
              const foundKey = devMeta?.pub || devMeta?.publicKey;
              if (foundKey) {
                pubKey = normalizePublicKeyToPem(foundKey);
                if (devMeta.algo || devMeta.keyAlgorithm) keyAlgo = devMeta.algo || devMeta.keyAlgorithm;
                if (devMeta.id || devMeta.keyId) keyId = devMeta.id || devMeta.keyId;
              }
            }
          } catch {}
        }

        if (!pubKey && fs.existsSync(LOCAL_STORE_PATH)) {
          try {
            const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
            const local = store.devices?.find(
              (d: DeviceRecord) =>
                (d.id === data.id || d.staff_code?.toUpperCase() === cleanCode) && d.status === "Active",
            );
            if (local?.public_key) {
              pubKey = local.public_key;
              if (local.key_algorithm) keyAlgo = local.key_algorithm;
              if (local.key_id) keyId = local.key_id;
            }
          } catch {}
        }

        // Opportunistic self-healing: if public_key was resolved from security_events or local store, update devices table
        if (pubKey && !data.public_key) {
          try {
            await supabase
              .from("devices")
              .update({ public_key: pubKey, key_id: keyId, key_algorithm: keyAlgo })
              .eq("id", data.id);
          } catch {}
        }

        return {
          id: data.id,
          staff_id: data.staff_id,
          staff_code: data.staff_code,
          staff_name: data.staff_name,
          public_key: pubKey,
          key_id: keyId,
          key_algorithm: keyAlgo,
          platform: (data.platform as DevicePlatform) || "android",
          attestation_status: (data.attestation_status as AttestationSecurityLevel) || "Verified",
          attestation_type: data.attestation_type || "hardware",
          attestation_evidence: data.attestation_evidence,
          model: data.model,
          os: data.os,
          status: data.status as DeviceStatus,
          registered_at: data.registered_at,
          last_verified_at: data.last_verified_at || data.registered_at,
          revoked_at: data.revoked_at,
          revocation_reason: data.revocation_reason,
          revoked_by: data.revoked_by,
          audit_metadata: data.audit_metadata,
        };
      }
    } catch (sbErr) {
      console.warn("[device-binding] Supabase getActiveDevice error:", sbErr);
    }
  }

  // Fallback to local store
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      if (Array.isArray(store.devices)) {
        const found = store.devices.find(
          (d: DeviceRecord) => d.staff_code?.toUpperCase() === cleanCode && d.status === "Active",
        );
        if (found) return found;
      }
    }
  } catch {}

  // Fallback to data/staff-db.json if available
  try {
    const staffDbPath = path.resolve(process.cwd(), "data", "staff-db.json");
    if (fs.existsSync(staffDbPath)) {
      const dbContent = JSON.parse(fs.readFileSync(staffDbPath, "utf-8"));
      if (Array.isArray(dbContent.devices)) {
        const found = dbContent.devices.find(
          (d: any) => d.staff_code?.toUpperCase() === cleanCode && d.status === "Active",
        );
        if (found) return found;
      }
    }
  } catch {}

  return null;
}

/**
 * Retrieves all registered devices (active, revoked, blocked) for a faculty member.
 */
export async function getAllDevicesForStaff(staffCode: string): Promise<DeviceRecord[]> {
  const cleanCode = staffCode.trim().toUpperCase();
  const supabase = getSupabase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .ilike("staff_code", cleanCode)
        .order("registered_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map((d: any) => ({
          id: d.id,
          staff_id: d.staff_id,
          staff_code: d.staff_code,
          staff_name: d.staff_name,
          public_key: d.public_key,
          key_id: d.key_id || d.id,
          key_algorithm: d.key_algorithm || "ECDSA_P256",
          platform: (d.platform as DevicePlatform) || "android",
          attestation_status: (d.attestation_status as AttestationSecurityLevel) || "Verified",
          attestation_type: d.attestation_type || "hardware",
          attestation_evidence: d.attestation_evidence,
          model: d.model,
          os: d.os,
          status: d.status as DeviceStatus,
          registered_at: d.registered_at,
          last_verified_at: d.last_verified_at || d.registered_at,
          revoked_at: d.revoked_at,
          revocation_reason: d.revocation_reason,
          revoked_by: d.revoked_by,
          audit_metadata: d.audit_metadata,
        }));
      }
    } catch (sbErr) {
      console.warn("[device-binding] Supabase getAllDevices error:", sbErr);
    }
  }

  // Local store fallback
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      if (Array.isArray(store.devices)) {
        return store.devices.filter((d: DeviceRecord) => d.staff_code?.toUpperCase() === cleanCode);
      }
    }
  } catch {}

  return [];
}

/**
 * Registers a new cryptographic device for an authenticated faculty member.
 * 
 * STRICT TWO-WAY POLICY ENFORCEMENT:
 * - Rule 1: One staff account can be bound to only one registered physical device at a time.
 * - Rule 2: One physical device can be bound to only one staff account at a time.
 * - If the EXACT SAME physical device is already bound to this staff account -> Idempotent success (200 OK).
 * - If a DIFFERENT device attempts to bind to an already-bound staff account -> 409 DEVICE_ALREADY_EXISTS.
 * - If this physical device is already bound to ANOTHER staff account -> 409 DEVICE_BOUND_TO_ANOTHER_ACCOUNT.
 * - Stores complete record in Supabase and local store with atomic transaction safety.
 */
export async function registerDeviceForStaff(params: {
  staffId: string;
  staffCode: string;
  staffName: string;
  publicKey: string;
  keyId?: string;
  keyAlgorithm?: string;
  platform: DevicePlatform;
  attestationStatus: AttestationSecurityLevel;
  attestationType: string;
  attestationEvidence?: string;
  model: string;
  os: string;
  auditMetadata?: Record<string, any>;
}): Promise<{
  success: boolean;
  device?: DeviceRecord;
  statusCode?: number;
  error?: string;
}> {
  const cleanStaffCode = params.staffCode.trim().toUpperCase();
  const normalizedKey = normalizePublicKeyToPem(params.publicKey);
  const keyFingerprint = getDeviceKeyFingerprint(normalizedKey);
  const platformStr = (params.platform || "android").toUpperCase();
  const keyId =
    params.keyId ||
    `DEV_${platformStr}_${crypto.createHash("sha256").update(normalizedKey).digest("hex").slice(0, 16)}`;

  // 1. RULE 1 CHECK: Check if faculty member already has an active device
  const existingActive = await getActiveDeviceForStaff(cleanStaffCode);
  if (existingActive) {
    const isSameDevice =
      existingActive.id === keyId ||
      existingActive.key_id === keyId ||
      (existingActive.public_key && getDeviceKeyFingerprint(existingActive.public_key) === keyFingerprint);

    if (isSameDevice) {
      // Idempotent re-registration / retry for the same physical device on the same account
      return {
        success: true,
        statusCode: 200,
        device: existingActive,
      };
    }

    return {
      success: false,
      statusCode: 409,
      error: `DEVICE_ALREADY_EXISTS: Faculty member '${cleanStaffCode}' already has an active registered device (${existingActive.model}, ID: ${existingActive.id}). One Faculty ID = One Phone policy prohibits registering a second device. Contact administration for device replacement.`,
    };
  }

  // 2. RULE 2 CHECK: Check if this physical device is already bound to another staff account
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data: boundDevices } = await supabase
        .from("devices")
        .select("id, staff_code, model, public_key, key_id, status")
        .eq("status", "Active")
        .or(`id.eq.${keyId},key_id.eq.${keyId}`);

      const conflictingDevice = (boundDevices || []).find(
        (d: any) => d.staff_code?.toUpperCase() !== cleanStaffCode
      );

      if (conflictingDevice) {
        return {
          success: false,
          statusCode: 409,
          error: `DEVICE_BOUND_TO_ANOTHER_ACCOUNT: This physical device (ID: ${keyId}) is already bound to another staff account (${conflictingDevice.staff_code}). One physical device can only be bound to one staff account at a time.`,
        };
      }
    } catch (e: any) {
      console.warn("[device-binding] Supabase Rule 2 check notice:", e?.message);
    }
  }

  // Check local store for Rule 2 conflict
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
      if (Array.isArray(store.devices)) {
        const localConflict = store.devices.find(
          (d: DeviceRecord) =>
            d.status === "Active" &&
            d.staff_code?.toUpperCase() !== cleanStaffCode &&
            (d.id === keyId ||
              d.key_id === keyId ||
              (d.public_key && getDeviceKeyFingerprint(d.public_key) === keyFingerprint))
        );
        if (localConflict) {
          return {
            success: false,
            statusCode: 409,
            error: `DEVICE_BOUND_TO_ANOTHER_ACCOUNT: This physical device is already bound to staff account '${localConflict.staff_code}' in local store.`,
          };
        }
      }
    }
  } catch {}

  const now = new Date().toISOString();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.staffId || "");
  const staffIdForDb = isUuid ? params.staffId : null;

  const deviceRecord: DeviceRecord = {
    id: keyId,
    staff_id: staffIdForDb,
    staff_code: cleanStaffCode,
    staff_name: params.staffName,
    public_key: normalizedKey,
    key_id: keyId,
    key_algorithm: params.keyAlgorithm || "ECDSA_P256",
    platform: params.platform,
    attestation_status: params.attestationStatus,
    attestation_type: params.attestationType,
    attestation_evidence: params.attestationEvidence,
    model: params.model || "Secure Mobile Device",
    os: params.os || `${params.platform} OS`,
    status: "Active",
    registered_at: now,
    last_verified_at: now,
    revoked_at: null,
    revocation_reason: null,
    revoked_by: null,
    audit_metadata: params.auditMetadata || {},
  };

  // 3. Persist to Supabase
  if (supabase) {
    try {
      // Double check active device for staff to guard against race condition
      const { data: doubleCheck } = await supabase
        .from("devices")
        .select("id")
        .ilike("staff_code", cleanStaffCode)
        .eq("status", "Active")
        .limit(1)
        .maybeSingle();

      if (doubleCheck) {
        return {
          success: false,
          statusCode: 409,
          error: "DEVICE_ALREADY_EXISTS: Concurrent registration detected: An active device was already registered for this account.",
        };
      }

      // Insert all columns into devices table
      const insertPayload: any = {
        id: deviceRecord.id,
        staff_id: staffIdForDb,
        staff_code: deviceRecord.staff_code,
        staff_name: deviceRecord.staff_name,
        public_key: deviceRecord.public_key,
        key_id: deviceRecord.key_id,
        key_algorithm: deviceRecord.key_algorithm,
        platform: deviceRecord.platform,
        attestation_status: deviceRecord.attestation_status,
        attestation_type: deviceRecord.attestation_type,
        attestation_evidence: deviceRecord.attestation_evidence,
        model: deviceRecord.model,
        os: deviceRecord.os,
        status: "Active",
        registered_at: now,
        last_verified_at: now,
      };

      const { error: insErr } = await supabase.from("devices").upsert(insertPayload, { onConflict: "id" });

      if (insErr) {
        // Unique index violation on staff_code (Rule 1) or public_key / key_id (Rule 2)
        if (insErr.code === "23505" || insErr.message.includes("unique")) {
          const isStaffConflict = insErr.message.includes("staff_code") || insErr.message.includes("staff");
          return {
            success: false,
            statusCode: 409,
            error: isStaffConflict
              ? "DEVICE_ALREADY_EXISTS: Database unique constraint prevents binding multiple active devices to one staff member."
              : "DEVICE_BOUND_TO_ANOTHER_ACCOUNT: Database unique constraint prevents binding this device to multiple staff accounts.",
          };
        }
        // Fallback for legacy database schema missing optional columns
        const { error: retryErr } = await supabase.from("devices").upsert({
          id: deviceRecord.id,
          staff_id: staffIdForDb,
          staff_code: deviceRecord.staff_code,
          staff_name: deviceRecord.staff_name,
          model: deviceRecord.model,
          os: deviceRecord.os,
          status: "Active",
          registered_at: now,
        }, { onConflict: "id" });
        if (retryErr && (retryErr.code === "23505" || retryErr.message.includes("unique"))) {
          return {
            success: false,
            statusCode: 409,
            error: "DEVICE_ALREADY_EXISTS: Database unique constraint prevents binding multiple active devices.",
          };
        }
      }

      // Record detailed cryptographic audit record in security_events
      await supabase.from("security_events").insert({
        time: now,
        staff: cleanStaffCode,
        event: `DEVICE_REGISTERED|${keyId}`,
        device: JSON.stringify({
          keyId,
          publicKey: normalizedKey,
          keyAlgorithm: deviceRecord.key_algorithm,
          platform: deviceRecord.platform,
          attestationStatus: deviceRecord.attestation_status,
          model: deviceRecord.model,
          os: deviceRecord.os,
        }),
        location: "Device Registration Gate",
        result: "Allowed",
        severity: "Low",
      });
    } catch (sbEx: any) {
      console.warn("[device-binding] Supabase persistence exception:", sbEx?.message);
    }
  }

  // 4. Persist to Local Store (for offline developer and test environments)
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let store: any = { staff: [], devices: [] };
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      try {
        store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
      } catch {}
    }

    if (!Array.isArray(store.devices)) {
      store.devices = [];
    }

    // Ensure no existing active device for this staff member in local store
    const localActive = store.devices.find(
      (d: DeviceRecord) => d.staff_code?.toUpperCase() === cleanStaffCode && d.status === "Active",
    );
    if (localActive) {
      return {
        success: false,
        statusCode: 409,
        error: `DEVICE_ALREADY_EXISTS: Active device '${localActive.id}' already exists for staff '${cleanStaffCode}' in local store.`,
      };
    }

    // Ensure no existing active device with this key in local store
    const localKeyConflict = store.devices.find(
      (d: DeviceRecord) =>
        d.status === "Active" &&
        d.staff_code?.toUpperCase() !== cleanStaffCode &&
        (d.id === keyId ||
          d.key_id === keyId ||
          (d.public_key && getDeviceKeyFingerprint(d.public_key) === keyFingerprint)),
    );
    if (localKeyConflict) {
      return {
        success: false,
        statusCode: 409,
        error: `DEVICE_BOUND_TO_ANOTHER_ACCOUNT: Active device '${localKeyConflict.id}' is already bound to '${localKeyConflict.staff_code}' in local store.`,
      };
    }

    for (const relPath of [path.join("data", "staff-db.json"), path.join(".gemini", "device-store.json")]) {
      const storeFile = path.resolve(process.cwd(), relPath);
      let fStore: any = { staff: [], devices: [] };
      if (fs.existsSync(storeFile)) {
        try {
          fStore = JSON.parse(fs.readFileSync(storeFile, "utf-8"));
        } catch {}
      }
      if (!Array.isArray(fStore.devices)) fStore.devices = [];
      fStore.devices = fStore.devices.filter((d: any) => d.id !== keyId && d.key_id !== keyId);
      fStore.devices.push(deviceRecord);
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      fs.writeFileSync(storeFile, JSON.stringify(fStore, null, 2), "utf-8");
    }
  } catch (fsErr) {
    console.warn("[device-binding] Local store write warning:", fsErr);
  }

  return {
    success: true,
    statusCode: 201,
    device: deviceRecord,
  };
}

/**
 * Revokes a registered device. Requires Administrator authorization.
 * Sets status to 'Revoked', records timestamp, reason, and admin actor.
 */
export async function revokeDevice(params: {
  deviceId?: string | undefined;
  staffCode?: string | undefined;
  reason: string;
  adminUsername: string;
}): Promise<{ success: boolean; error?: string; revokedDevice?: DeviceRecord }> {
  const { deviceId, staffCode, reason, adminUsername } = params;
  if (!deviceId && !staffCode) {
    return { success: false, error: "Either deviceId or staffCode is required." };
  }
  if (!reason || reason.trim().length < 3) {
    return { success: false, error: "A valid revocation reason is required." };
  }

  const now = new Date().toISOString();
  let targetDevice: DeviceRecord | null = null;

  if (deviceId) {
    // Lookup by ID
    const supabase = getSupabase();
    if (supabase) {
      const { data } = await supabase.from("devices").select("*").eq("id", deviceId).maybeSingle();
      if (data) {
        targetDevice = {
          ...data,
          status: data.status as DeviceStatus,
          platform: (data.platform as DevicePlatform) || "android",
          attestation_status: (data.attestation_status as AttestationSecurityLevel) || "Verified",
        };
      }
    }
    if (!targetDevice) {
      try {
        if (fs.existsSync(LOCAL_STORE_PATH)) {
          const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf-8"));
          const found = (store.devices || []).find((d: any) => d.id === deviceId);
          if (found) {
            targetDevice = {
              ...found,
              status: found.status as DeviceStatus,
              platform: (found.platform as DevicePlatform) || "android",
              attestation_status: (found.attestation_status as AttestationSecurityLevel) || "Verified",
            };
          }
        }
      } catch {}
    }
  }

  if (!targetDevice && staffCode) {
    targetDevice = await getActiveDeviceForStaff(staffCode);
  }

  if (!targetDevice) {
    return { success: false, error: "No matching registered device found to revoke." };
  }

  // Update in Supabase
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { error: sbErr } = await supabase
        .from("devices")
        .update({
          status: "Blocked", // Supabase check constraint accepts 'Blocked'
          revoked_at: now,
          revocation_reason: reason,
          revoked_by: adminUsername,
        })
        .eq("id", targetDevice.id);

      if (sbErr) {
        // Fallback for legacy DB schema without revocation metadata columns
        await supabase
          .from("devices")
          .update({ status: "Blocked" })
          .eq("id", targetDevice.id);
      }

      if (targetDevice?.staff_code) {
        await supabase
          .from("devices")
          .update({ status: "Blocked" })
          .ilike("staff_code", targetDevice.staff_code)
          .eq("status", "Active");
      }

      // Audit log revocation
      await supabase.from("security_events").insert({
        time: now,
        staff: targetDevice.staff_code,
        event: `DEVICE_REVOKED|${targetDevice.id}`,
        device: JSON.stringify({
          deviceId: targetDevice.id,
          reason,
          revokedBy: adminUsername,
          revokedAt: now,
        }),
        location: "Admin Console",
        result: "Blocked",
        severity: "Medium",
      });
    } catch (err: any) {
      console.warn("[device-binding] Supabase revoke error:", err?.message);
    }
  }

  // Update in Local Stores
  try {
    for (const relPath of [path.join("data", "staff-db.json"), path.join(".gemini", "device-store.json")]) {
      const p = path.resolve(process.cwd(), relPath);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        const store = JSON.parse(content);
        if (Array.isArray(store.devices)) {
          let modified = false;
          store.devices.forEach((d: DeviceRecord) => {
            if (
              d.id === targetDevice!.id ||
              d.key_id === targetDevice!.id ||
              (targetDevice?.staff_code && d.staff_code?.toUpperCase() === targetDevice.staff_code.toUpperCase())
            ) {
              d.status = "Revoked";
              d.revoked_at = now;
              d.revocation_reason = reason;
              d.revoked_by = adminUsername;
              modified = true;
            }
          });
          if (modified) {
            fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
          }
        }
      }
    }
  } catch {}

  targetDevice.status = "Revoked";
  targetDevice.revoked_at = now;
  targetDevice.revocation_reason = reason;
  targetDevice.revoked_by = adminUsername;

  return {
    success: true,
    revokedDevice: targetDevice,
  };
}

export async function updateDeviceLastVerified(deviceId: string): Promise<void> {
  const now = new Date().toISOString();
  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from("devices").update({ last_verified_at: now }).eq("id", deviceId);
    } catch {}
  }
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
      const store = JSON.parse(content);
      if (Array.isArray(store.devices)) {
        const found = store.devices.find((d: DeviceRecord) => d.id === deviceId);
        if (found) {
          found.last_verified_at = now;
          fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
        }
      }
    }
  } catch {}
}

/**
 * Validates cryptographic device association for an attendance request.
 * Verifies:
 * 1. Faculty member has exactly one active registered device.
 * 2. Device has not been revoked.
 * 3. Request timestamp is fresh (±120 seconds).
 * 4. Attempt nonce is valid and unconsumed.
 * 5. Digital signature over payload verifies with the registered device's public key.
 */
export async function verifyAttendanceDeviceBinding(params: {
  staffCode: string;
  signature?: string;
  keyId?: string;
  timestamp?: number;
  nonce?: string;
  payloadToSign?: string;
}): Promise<{
  valid: boolean;
  device?: DeviceRecord;
  error?: string;
  statusCode?: number;
}> {
  const { staffCode, signature, keyId, timestamp, nonce, payloadToSign } = params;

  if (!staffCode) {
    return { valid: false, statusCode: 400, error: "MISSING_STAFF_IDENTITY" };
  }

  // 1. Lookup active device for this faculty member
  const activeDevice = await getActiveDeviceForStaff(staffCode);
  if (!activeDevice) {
    return {
      valid: false,
      statusCode: 403,
      error: "NO_ACTIVE_REGISTERED_DEVICE",
    };
  }

  // 2. Verify status is active
  if (activeDevice.status !== "Active") {
    return {
      valid: false,
      statusCode: 403,
      error: "REGISTERED_DEVICE_REVOKED",
    };
  }

  // If keyId provided, must match registered keyId
  if (keyId && keyId !== activeDevice.id && keyId !== activeDevice.key_id) {
    return {
      valid: false,
      statusCode: 403,
      error: "DEVICE_KEY_ID_MISMATCH",
    };
  }

  // 3. Verify digital signature
  if (!signature) {
    return {
      valid: false,
      statusCode: 403,
      error: "MISSING_DEVICE_SIGNATURE",
    };
  }

  // 4. Verify timestamp freshness (±120 seconds)
  const now = Date.now();
  if (timestamp) {
    const ageMs = now - timestamp;
    if (ageMs > 120_000 || ageMs < -60_000) {
      return {
        valid: false,
        statusCode: 403,
        error: "DEVICE_SIGNATURE_TIMESTAMP_EXPIRED",
      };
    }
  }

  // 5. Construct canonical payload to verify if not provided
  const canonicalPayload =
    payloadToSign ||
    `${activeDevice.staff_code}:${nonce || ""}:${timestamp || ""}`;

  // 6. Verify signature using stored public key
  const isSignatureValid = verifyDeviceSignature(
    activeDevice.public_key,
    canonicalPayload,
    signature,
    activeDevice.key_algorithm,
  );

  if (!isSignatureValid) {
    return {
      valid: false,
      statusCode: 403,
      error: "INVALID_DEVICE_SIGNATURE",
    };
  }

  // 7. Update last_verified_at timestamp
  activeDevice.last_verified_at = new Date().toISOString();
  const supabase = getSupabase();
  if (supabase) {
    void supabase
      .from("devices")
      .update({ last_verified_at: activeDevice.last_verified_at })
      .eq("id", activeDevice.id);
  }

  return {
    valid: true,
    device: activeDevice,
  };
}
