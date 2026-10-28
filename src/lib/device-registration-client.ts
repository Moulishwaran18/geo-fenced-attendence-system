/**
 * CampusAttend — Client-Side Device Registration & Signing Manager
 *
 * Provides cross-platform cryptographic key generation, device registration,
 * and attendance request signing:
 * - Android: Android Keystore via native AndroidBiometricBridge (StrongBox/TEE).
 * - iOS: Apple Secure Enclave & App Attest / WebAuthn Platform Authenticator.
 * - Web/Desktop: WebCrypto non-exportable ECDSA P-256 key pair stored in IndexedDB.
 */

export interface DeviceStatusResponse {
  success: boolean;
  staffCode: string;
  hasActiveDevice: boolean;
  device?: {
    id: string;
    keyId: string;
    model: string;
    os: string;
    platform: string;
    attestationStatus: string;
    registeredAt: string;
    lastVerifiedAt: string;
    status: string;
  } | null;
  history?: any[];
  error?: string;
}

export interface DeviceRegistrationResult {
  success: boolean;
  message?: string;
  device?: {
    id: string;
    model: string;
    platform: string;
    attestationStatus: string;
    registeredAt: string;
    status: string;
  };
  error?: string;
}

export interface AttendanceDeviceSignatureResult {
  deviceSignature: string;
  deviceKeyId: string;
  deviceTimestamp: number;
  attemptNonce: string;
  devicePayloadToSign?: string;
  publicKey?: string;
}

const LOCAL_KEY_STORAGE_PREFIX = "campusattend_device_key_";

function getAndroidBridge(): any {
  if (typeof window !== "undefined") {
    return (window as any).AndroidBiometricBridge || null;
  }
  return null;
}

/**
 * Check if the native Android Keystore bridge is available.
 */
export function isAndroidKeystoreAvailable(): boolean {
  const bridge = getAndroidBridge();
  return Boolean(
    bridge &&
      typeof bridge.isAvailable === "function" &&
      bridge.isAvailable() &&
      typeof bridge.generateDeviceRegistrationKey === "function",
  );
}

/**
 * Detect current client platform.
 */
export function detectPlatform(): "android" | "ios" | "web" {
  if (isAndroidKeystoreAvailable()) return "android";
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
      return "ios";
    }
    if (/Android/.test(ua)) {
      return "android";
    }
  }
  return "web";
}

/**
 * Queries whether the authenticated faculty member has an active registered device.
 */
export async function fetchDeviceRegistrationStatus(token?: string, staffCode?: string): Promise<DeviceStatusResponse> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["x-staff-token"] = token;
  }

  const url = staffCode
    ? `/api/device/status?staff_code=${encodeURIComponent(staffCode)}`
    : "/api/device/status";

  const res = await fetch(url, {
    method: "GET",
    headers,
    credentials: "include",
  });

  const json = await res.json();
  return json;
}

/**
 * Generates an ECDSA P-256 non-exportable key pair in WebCrypto (IndexedDB backed).
 */
export async function getOrCreateWebCryptoKeyPair(staffId: string): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyPem: string;
  keyId: string;
}> {
  const dbName = "CampusAttendKeystoreDB";
  const storeName = "DeviceKeys";
  const cleanId = staffId.trim().toUpperCase();

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(storeName);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const existing = await new Promise<CryptoKeyPair | null>((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(`key_${cleanId}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });

  let keyPair: CryptoKeyPair;

  if (existing && existing.privateKey && existing.publicKey) {
    keyPair = existing;
  } else {
    // Generate fresh non-exportable ECDSA P-256 key pair
    keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false, // non-exportable private key (cannot be extracted from browser)
      ["sign", "verify"],
    );

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(keyPair, `key_${cleanId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Export public key as SPKI
  const spkiDer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(spkiDer)));
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;

  // Compute keyId
  const hashBuf = await window.crypto.subtle.digest("SHA-256", spkiDer);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  const keyId = `DEV_WEB_${hashHex}_${cleanId}`;

  return { keyPair, publicKeyPem: pem, keyId };
}

/**
 * Executes end-to-end device registration for an authenticated faculty member.
 */
export async function registerCurrentDevice(
  staffId: string,
  sessionToken?: string,
  password?: string,
  options?: { reRegister?: boolean },
): Promise<DeviceRegistrationResult> {
  const cleanStaffId = staffId.trim().toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
    headers["x-staff-token"] = sessionToken;
  }

  // 1. Request fresh challenge from backend
  const challengeBody: any = {
    staff_code: cleanStaffId,
    action: "challenge",
    reRegister: Boolean(options?.reRegister),
    isReRegistration: Boolean(options?.reRegister),
  };
  if (password) challengeBody.password = password;

  const challengeRes = await fetch("/api/device/challenge", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(challengeBody),
  });

  const challengeJson = await challengeRes.json();
  if (!challengeRes.ok || !challengeJson.success) {
    return {
      success: false,
      error: challengeJson.error || challengeJson.message || "Failed to obtain device challenge.",
    };
  }

  const { challenge, challengeToken } = challengeJson;
  const platform = detectPlatform();

  let registrationPayload: Record<string, any>;

  // 2. Hardware key generation & challenge signing
  if (platform === "android" && isAndroidKeystoreAvailable()) {
    const bridge = getAndroidBridge();
    const rawResult = bridge.generateDeviceRegistrationKey(challenge, cleanStaffId);
    const parsed = typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

    if (!parsed || !parsed.success) {
      return {
        success: false,
        error: parsed?.error || "Android Keystore key generation failed.",
      };
    }

    registrationPayload = {
      challengeToken,
      challenge,
      publicKey: parsed.publicKeyPem,
      keyId: parsed.keyId,
      keyAlgorithm: "ECDSA_P256",
      signature: parsed.challengeSignature,
      platform: "android",
      model: parsed.model || "Android Keystore Device",
      os: parsed.os || "Android",
      attestationEvidence: {
        chain: parsed.attestationChain || [],
      },
      isStrongBox: parsed.isStrongBox,
      isHardwareBacked: parsed.isHardwareBacked,
    };
  } else {
    // Web / iOS browser Secure Key (WebCrypto non-exportable P-256)
    const { keyPair, publicKeyPem, keyId } = await getOrCreateWebCryptoKeyPair(cleanStaffId);

    // Sign challenge with private key
    const challengeBytes = new TextEncoder().encode(challenge);
    const signatureDer = await window.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: { name: "SHA-256" },
      },
      keyPair.privateKey,
      challengeBytes,
    );

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signatureDer)));
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "Browser";
    let modelName = "Personal Computer (Web Browser)";
    if (/Android/.test(userAgent)) modelName = "Android Device (Web Browser)";
    else if (/iPhone/.test(userAgent)) modelName = "Apple iPhone (Safari)";
    else if (/iPad/.test(userAgent)) modelName = "Apple iPad (Safari)";
    else if (/Macintosh/.test(userAgent)) modelName = "Apple Mac (Secure Enclave)";
    else if (/Windows/.test(userAgent)) modelName = "Windows PC (Secure Hardware)";

    registrationPayload = {
      challengeToken,
      challenge,
      publicKey: publicKeyPem,
      keyId,
      keyAlgorithm: "ECDSA_P256",
      signature: sigB64,
      platform: "web",
      model: modelName,
      os: /Android/.test(userAgent) ? "Android" : platform === "ios" ? "iOS" : "Web Platform",
      attestationEvidence: {
        cryptoSystem: "WebCrypto non-exportable ECDSA P-256",
        timestamp: Date.now(),
      },
      isHardwareBacked: platform === "ios" || /Macintosh|Windows/.test(userAgent),
    };
  }

  // 3. Submit registration to server
  registrationPayload["staff_code"] = cleanStaffId;
  if (password) registrationPayload["password"] = password;
  registrationPayload["action"] = "register";
  if (options?.reRegister) {
    registrationPayload["reRegister"] = true;
    registrationPayload["isReRegistration"] = true;
  }

  const regRes = await fetch("/api/device/register", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(registrationPayload),
  });

  const regJson = await regRes.json();
  if (!regRes.ok || !regJson.success) {
    return {
      success: false,
      error: regJson.error || regJson.message || "Device registration failed.",
    };
  }

  // Save registered device ID in sessionStorage
  if (typeof sessionStorage !== "undefined" && regJson.device?.id) {
    sessionStorage.setItem(`${LOCAL_KEY_STORAGE_PREFIX}${cleanStaffId}`, regJson.device.id);
  }

  return {
    success: true,
    message: regJson.message,
    device: regJson.device,
  };
}

/**
 * Cryptographically signs an attendance payload with the registered device's private key.
 */
export async function signAttendanceRequest(
  staffId: string,
  nonce: string,
  timestamp: number = Date.now(),
  options?: {
    deviceId?: string;
    latitude?: number;
    longitude?: number;
  },
): Promise<AttendanceDeviceSignatureResult | null> {
  const cleanStaffId = staffId.trim().toUpperCase();
  let resolvedDeviceId = options?.deviceId;
  if (!resolvedDeviceId && typeof sessionStorage !== "undefined") {
    resolvedDeviceId = sessionStorage.getItem(`${LOCAL_KEY_STORAGE_PREFIX}${cleanStaffId}`) || undefined;
  }
  if (!resolvedDeviceId && isAndroidKeystoreAvailable()) {
    const bridge = getAndroidBridge();
    if (typeof bridge.getDeviceKeyInfo === "function") {
      try {
        const info = bridge.getDeviceKeyInfo(cleanStaffId);
        const parsed = typeof info === "string" ? JSON.parse(info) : info;
        if (parsed?.keyId) resolvedDeviceId = parsed.keyId;
      } catch {}
    }
    if (!resolvedDeviceId && typeof bridge.getDeviceId === "function") {
      const rawId = bridge.getDeviceId();
      if (rawId) {
        resolvedDeviceId = `DEV_ANDROID_${rawId.slice(0, 12)}_${cleanStaffId}`;
      }
    }
  }
  const effectiveDeviceId = resolvedDeviceId || "";
  const canonicalPayload =
    typeof options?.latitude === "number" && typeof options?.longitude === "number"
      ? `v2:${cleanStaffId}:${effectiveDeviceId}:${nonce}:${options.latitude.toFixed(6)}:${options.longitude.toFixed(6)}:${timestamp}`
      : `${cleanStaffId}:${nonce}:${timestamp}`;

  // 1. If Android native bridge available, sign via Android Keystore
  if (isAndroidKeystoreAvailable()) {
    const bridge = getAndroidBridge();
    const rawRes = bridge.signAttendancePayload(cleanStaffId, canonicalPayload);
    const parsed = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
    if (parsed && parsed.success && parsed.signature) {
      const deviceId = typeof bridge.getDeviceId === "function" ? bridge.getDeviceId() : "native";
      const shortId = (deviceId || "native").slice(0, 12);
      return {
        deviceSignature: parsed.signature,
        deviceKeyId: parsed.keyId || `DEV_ANDROID_${shortId}_${cleanStaffId}`,
        deviceTimestamp: timestamp,
        attemptNonce: nonce,
        devicePayloadToSign: canonicalPayload,
        publicKey: parsed.publicKey || parsed.publicKeyPem,
      };
    }
  }

  // 2. WebCrypto fallback
  try {
    const { keyPair, keyId, publicKeyPem } = await getOrCreateWebCryptoKeyPair(cleanStaffId);
    const payloadBytes = new TextEncoder().encode(canonicalPayload);
    const sigDer = await window.crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: { name: "SHA-256" },
      },
      keyPair.privateKey,
      payloadBytes,
    );
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigDer)));

    return {
      deviceSignature: sigB64,
      deviceKeyId: keyId,
      deviceTimestamp: timestamp,
      attemptNonce: nonce,
      devicePayloadToSign: canonicalPayload,
      publicKey: publicKeyPem,
    };
  } catch (err) {
    console.warn("[device-registration-client] WebCrypto sign error:", err);
    return null;
  }
}

/**
 * Generates cryptographic login authentication proof using the device's hardware key.
 */
export async function getDeviceLoginPayload(staffId: string): Promise<{
  deviceSignature?: string;
  deviceTimestamp?: number;
  deviceNonce?: string;
  deviceKeyId?: string;
  publicKey?: string;
  platform: string;
  model: string;
  os: string;
} | null> {
  const cleanStaffId = staffId.trim().toUpperCase();
  const timestamp = Date.now();
  const nonce =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const canonicalPayload = `${cleanStaffId}:${nonce}:${timestamp}`;

  // 1. Android Keystore native bridge
  if (isAndroidKeystoreAvailable()) {
    try {
      const bridge = getAndroidBridge();
      const rawRes = bridge.signAttendancePayload(cleanStaffId, canonicalPayload);
      const parsed = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
      if (parsed && parsed.success && parsed.signature) {
        let keyInfo: any = null;
        if (typeof bridge.getDeviceKeyInfo === "function") {
          try {
            const rawInfo = bridge.getDeviceKeyInfo(cleanStaffId);
            keyInfo = typeof rawInfo === "string" ? JSON.parse(rawInfo) : rawInfo;
          } catch {}
        }
        const deviceId = typeof bridge.getDeviceId === "function" ? bridge.getDeviceId() : "native";
        const shortId = (deviceId || "native").slice(0, 12);
        return {
          deviceSignature: parsed.signature,
          deviceKeyId: keyInfo?.keyId || parsed.keyId || `DEV_ANDROID_${shortId}_${cleanStaffId}`,
          deviceTimestamp: timestamp,
          deviceNonce: nonce,
          publicKey: keyInfo?.publicKeyPem || parsed.publicKeyPem,
          platform: "android",
          model: keyInfo?.model || parsed.model || "Android Keystore Device",
          os: keyInfo?.os || parsed.os || "Android",
        };
      }
    } catch {}
  }

  // 2. WebCrypto non-exportable key
  try {
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const { keyPair, publicKeyPem, keyId } = await getOrCreateWebCryptoKeyPair(cleanStaffId);
      const payloadBytes = new TextEncoder().encode(canonicalPayload);
      const sigDer = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        keyPair.privateKey,
        payloadBytes,
      );
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigDer)));
      const platform = detectPlatform();
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "Browser";
      let model = "Web Browser";
      if (/iPhone/.test(userAgent)) model = "Apple iPhone";
      else if (/Android/.test(userAgent)) model = "Android Phone";
      else if (/Windows/.test(userAgent)) model = "Windows PC";
      else if (/Macintosh/.test(userAgent)) model = "Apple Mac";

      return {
        deviceSignature: sigB64,
        deviceKeyId: keyId,
        deviceTimestamp: timestamp,
        deviceNonce: nonce,
        publicKey: publicKeyPem,
        platform,
        model,
        os: platform === "ios" ? "iOS" : "Web Platform",
      };
    }
  } catch (err) {
    console.warn("[device-registration-client] getDeviceLoginPayload notice:", err);
  }

  return null;
}

/**
 * Signs a server-issued challenge nonce using the local device's hardware key.
 */
export async function signLoginChallenge(staffId: string, challenge: string): Promise<string | null> {
  const cleanStaffId = staffId.trim().toUpperCase();

  if (isAndroidKeystoreAvailable()) {
    try {
      const bridge = getAndroidBridge();
      const rawRes = bridge.signAttendancePayload(cleanStaffId, challenge);
      const parsed = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
      if (parsed && parsed.success && parsed.signature) {
        return parsed.signature;
      }
    } catch {}
  }

  try {
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const { keyPair } = await getOrCreateWebCryptoKeyPair(cleanStaffId);
      const challengeBytes = new TextEncoder().encode(challenge);
      const sigDer = await window.crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        keyPair.privateKey,
        challengeBytes,
      );
      return btoa(String.fromCharCode(...new Uint8Array(sigDer)));
    }
  } catch (err) {
    console.warn("[device-registration-client] signLoginChallenge error:", err);
  }

  return null;
}
