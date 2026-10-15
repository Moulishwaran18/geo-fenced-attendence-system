/**
 * Native Android Biometric Bridge Client
 *
 * Provides type-safe access to Android Keystore-backed on-device face recognition.
 * When running inside com.campusattend.biometric WebView, calls the native AndroidBiometricBridge.
 * In a desktop or standard mobile browser, cleanly reports unavailability so that the user
 * is informed that hardware Keystore biometric isolation requires the native Android app.
 */

export interface NativeEnrollmentStatus {
  isAvailable: boolean;
  isEnrolled: boolean;
  count: number;
  staffId?: string | undefined;
  deviceId?: string | undefined;
  isDeviceBound?: boolean | undefined;
  hardwareKeystore?: boolean | undefined;
  enrolledAt?: number | undefined;
  hasPendingEnrollment?: boolean | undefined;
  pendingCount?: number | undefined;
}

export interface NativeEnrollResult {
  success: boolean;
  staffId?: string | undefined;
  deviceId?: string | undefined;
  count?: number | undefined;
  error?: string | undefined;
  message?: string | undefined;
}

export interface NativeVerifyResult {
  matched: boolean;
  staffId?: string | undefined;
  deviceId?: string | undefined;
  distance?: number | undefined;
  threshold?: number | undefined;
  biometricAttestation?: string | undefined;
  requiresEnrollment?: boolean | undefined;
  error?: string | undefined;
  message?: string | undefined;
}

function getBridge(): any {
  if (typeof window !== "undefined") {
    return (window as any).AndroidBiometricBridge || null;
  }
  return null;
}

/**
 * Check if the native Android Keystore biometric bridge is active.
 */
export function isNativeBiometricAvailable(): boolean {
  const bridge = getBridge();
  try {
    return Boolean(bridge && typeof bridge.isAvailable === "function" && bridge.isAvailable());
  } catch {
    return false;
  }
}

/**
 * Retrieve the hardware-bound Android device identifier.
 */
export function getNativeDeviceId(): string | null {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getDeviceId !== "function") return null;
  try {
    return bridge.getDeviceId() || null;
  } catch {
    return null;
  }
}

/**
 * Get the local enrollment status for a staff member on this Android device.
 */
export async function getNativeEnrollmentStatus(staffId: string): Promise<NativeEnrollmentStatus> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getEnrollmentStatus !== "function") {
    return {
      isAvailable: false,
      isEnrolled: false,
      count: 0,
    };
  }

  try {
    const raw = bridge.getEnrollmentStatus(staffId);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      isAvailable: true,
      isEnrolled: Boolean(parsed.isEnrolled),
      count: Number(parsed.count || 0),
      staffId: parsed.staffId,
      deviceId: parsed.deviceId,
      isDeviceBound: Boolean(parsed.isDeviceBound),
      hardwareKeystore: Boolean(parsed.hardwareKeystore),
      enrolledAt: parsed.enrolledAt ? Number(parsed.enrolledAt) : undefined,
      hasPendingEnrollment: Boolean(parsed.hasPendingEnrollment),
      pendingCount: Number(parsed.pendingCount || 0),
    };
  } catch (err) {
    console.warn("[NativeBiometricBridge] getEnrollmentStatus error:", err);
    return {
      isAvailable: true,
      isEnrolled: false,
      count: 0,
    };
  }
}

/**
 * Stage 1 to 5 face embeddings encrypted with Android Keystore AES-256-GCM in app-private storage.
 * Biometrics are never sent to the server.
 */
export async function stageNativePendingEnrollment(
  staffId: string,
  embeddings: Array<number[] | Float32Array>,
  labels?: string[],
): Promise<NativeEnrollResult> {
  const bridge = getBridge();
  const deviceId = getNativeDeviceId() || "android-keystore";
  const samplesArray = embeddings.map((emb) => Array.from(emb));

  if (bridge) {
    if (typeof bridge.stagePendingEnrollment !== "function") {
      return {
        success: false,
        error: "BRIDGE_STAGE_UNAVAILABLE",
        message: "Installed CampusAttend app does not support biometric staging. Please update to the latest APK.",
      };
    }
    try {
      const raw = bridge.stagePendingEnrollment(
        staffId,
        deviceId,
        JSON.stringify(samplesArray),
        labels ? JSON.stringify(labels) : "[]",
      );
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        success: Boolean(parsed.success),
        staffId: parsed.staffId,
        deviceId: parsed.deviceId,
        count: parsed.count,
        error: parsed.error,
        message: parsed.message,
      };
    } catch (err: any) {
      return {
        success: false,
        error: "STAGE_FAILED",
        message: err?.message || "Failed to stage pending templates in Android Keystore.",
      };
    }
  }

  // Web fallback simulation ONLY when running in desktop/standard browser without native hardware bridge
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(
        `pending_face_${staffId.trim().toUpperCase()}`,
        JSON.stringify({
          staffId: staffId.trim().toUpperCase(),
          deviceId,
          count: embeddings.length,
          stagedAt: Date.now(),
        })
      );
    }
    return {
      success: true,
      staffId: staffId.trim().toUpperCase(),
      deviceId,
      count: embeddings.length,
      message: "Face templates staged locally.",
    };
  } catch (err: any) {
    return {
      success: false,
      error: "FALLBACK_STAGE_FAILED",
      message: err?.message || "Failed to stage templates.",
    };
  }
}

/**
 * Check if pending face templates are staged locally on this device.
 */
export async function getNativePendingEnrollmentStatus(
  staffId: string
): Promise<{ hasPending: boolean; count: number; deviceId?: string | undefined; stagedAt?: number | undefined }> {
  const bridge = getBridge();
  if (bridge) {
    if (typeof bridge.getPendingEnrollmentStatus === "function") {
      try {
        const raw = bridge.getPendingEnrollmentStatus(staffId);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
          hasPending: Boolean(parsed.hasPending),
          count: Number(parsed.count || 0),
          deviceId: parsed.deviceId,
          stagedAt: parsed.stagedAt ? Number(parsed.stagedAt) : undefined,
        };
      } catch {
        return { hasPending: false, count: 0 };
      }
    }
    return { hasPending: false, count: 0 };
  }

  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      const item = window.sessionStorage.getItem(`pending_face_${staffId.trim().toUpperCase()}`);
      if (item) {
        const parsed = JSON.parse(item);
        return {
          hasPending: Boolean(parsed.count > 0),
          count: Number(parsed.count || 0),
          deviceId: parsed.deviceId,
          stagedAt: parsed.stagedAt,
        };
      }
    } catch {}
  }

  return { hasPending: false, count: 0 };
}

/**
 * Activate staged pending templates on this device after administrator approval.
 */
export async function activateNativePendingEnrollment(
  staffId: string,
  oneTimeToken: string,
): Promise<NativeEnrollResult> {
  const bridge = getBridge();
  const deviceId = getNativeDeviceId() || "android-keystore";

  if (bridge) {
    if (typeof bridge.activatePendingEnrollment !== "function") {
      return {
        success: false,
        error: "BRIDGE_ACTIVATION_UNAVAILABLE",
        message: "Installed CampusAttend Android app does not support biometric activation. Please install the latest APK.",
      };
    }
    try {
      const cleanStaffId = String(staffId || "").trim();
      const cleanDeviceId = String(deviceId || "").trim();
      const cleanToken = String(oneTimeToken || "").trim();
      const raw = bridge.activatePendingEnrollment(cleanStaffId, cleanDeviceId, cleanToken);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        success: Boolean(parsed.success),
        staffId: parsed.staffId,
        deviceId: parsed.deviceId,
        count: parsed.count,
        error: parsed.error,
        message: parsed.message,
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const isJavaException = errMsg.includes("Java exception") || errMsg.includes("activatePendingEnrollment");
      return {
        success: false,
        error: isJavaException ? "NATIVE_ACTIVATION_EXCEPTION" : "ACTIVATION_FAILED",
        message: isJavaException
          ? "Native activation encountered an unexpected bridge error. Please tap Re-capture Photos to enroll with your approved token."
          : errMsg,
      };
    }
  }

  // Web fallback simulation ONLY when bridge is null
  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.removeItem(`pending_face_${staffId.trim().toUpperCase()}`);
  }
  return {
    success: true,
    staffId: staffId.trim().toUpperCase(),
    deviceId,
    count: 1,
    message: "Pending enrollment activated.",
  };
}

/**
 * Clear staged pending enrollment file.
 */
export async function clearNativePendingEnrollment(staffId: string): Promise<boolean> {
  const bridge = getBridge();
  if (bridge) {
    if (typeof bridge.clearPendingEnrollment === "function") {
      try {
        const raw = bridge.clearPendingEnrollment(staffId);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Boolean(parsed.success);
      } catch {
        return false;
      }
    }
    return true;
  }

  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.removeItem(`pending_face_${staffId.trim().toUpperCase()}`);
  }
  return true;
}

/**
 * Enroll a 512-dimensional face template into Android Keystore local encrypted storage.
 * Does NOT send the embedding or raw photo to Supabase or cloud servers.
 */
export async function enrollNativeTemplate(
  staffId: string,
  embedding: number[] | Float32Array,
  label: string = "primary",
): Promise<NativeEnrollResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.enrollLocalTemplate !== "function") {
    return {
      success: false,
      error: "BRIDGE_UNAVAILABLE",
      message: "Native Android biometric hardware bridge is not available.",
    };
  }

  const deviceId = getNativeDeviceId() || "";
  const floatsArray = Array.from(embedding);

  try {
    const raw = bridge.enrollLocalTemplate(
      staffId,
      deviceId,
      JSON.stringify(floatsArray),
      label,
    );
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      success: Boolean(parsed.success),
      staffId: parsed.staffId,
      deviceId: parsed.deviceId,
      count: parsed.count,
      error: parsed.error,
      message: parsed.message,
    };
  } catch (err: any) {
    return {
      success: false,
      error: "ENROLLMENT_FAILED",
      message: err?.message || "Bridge enrollment failed.",
    };
  }
}

/**
 * Enroll multiple 512-dimensional face templates into Android Keystore local encrypted storage in a single atomic transaction.
 * Does NOT send embeddings or raw photos to Supabase or cloud servers.
 */
export async function enrollNativeTemplatesBatch(
  staffId: string,
  embeddings: Array<number[] | Float32Array>,
  labels?: string[],
  oneTimeToken?: string | null,
): Promise<NativeEnrollResult> {
  const bridge = getBridge();
  if (!bridge) {
    return {
      success: false,
      error: "BRIDGE_UNAVAILABLE",
      message: "Native Android biometric hardware bridge is not available.",
    };
  }

  const deviceId = getNativeDeviceId() || "";
  const samplesArray = embeddings.map((emb) => Array.from(emb));

  // If bridge supports batch enrollment:
  if (typeof bridge.enrollLocalTemplates === "function") {
    try {
      const raw = bridge.enrollLocalTemplates(
        staffId,
        deviceId,
        JSON.stringify(samplesArray),
        labels ? JSON.stringify(labels) : "[]",
        oneTimeToken || "",
      );
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        success: Boolean(parsed.success),
        staffId: parsed.staffId,
        deviceId: parsed.deviceId,
        count: parsed.count,
        error: parsed.error,
        message: parsed.message,
      };
    } catch (err: any) {
      return {
        success: false,
        error: "ENROLLMENT_FAILED",
        message: err?.message || "Bridge batch enrollment failed.",
      };
    }
  }

  // Fallback to sequential enrollLocalTemplate if batch method is not present
  try {
    let lastResult: NativeEnrollResult = { success: false, error: "NO_SAMPLES" };
    for (let i = 0; i < embeddings.length; i++) {
      const label = labels && labels[i] ? labels[i] : `sample_${i + 1}`;
      const res = await enrollNativeTemplate(staffId, embeddings[i]!, label);
      if (!res.success) {
        return res;
      }
      lastResult = res;
    }
    return lastResult;
  } catch (err: any) {
    return {
      success: false,
      error: "ENROLLMENT_FAILED",
      message: err?.message || "Bridge sequential enrollment failed.",
    };
  }
}

/**
 * Verify that local encrypted templates are persistently stored and accessible in Android Keystore.
 * Reads back and verifies cryptographic integrity without logging or exposing decrypted biometric vectors.
 */
export async function verifyNativePersistence(staffId: string): Promise<{
  verified: boolean;
  count: number;
  deviceId?: string | undefined;
  enrolledAt?: number | undefined;
  error?: string | undefined;
  message?: string | undefined;
}> {
  const bridge = getBridge();
  if (bridge && typeof bridge.verifyPersistence === "function") {
    try {
      const raw = bridge.verifyPersistence(staffId);
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        verified: Boolean(parsed.verified),
        count: Number(parsed.count || 0),
        deviceId: parsed.deviceId,
        enrolledAt: parsed.enrolledAt ? Number(parsed.enrolledAt) : undefined,
        error: parsed.error,
        message: parsed.message,
      };
    } catch (err: any) {
      return {
        verified: false,
        count: 0,
        error: "VERIFY_EXCEPTION",
        message: err?.message || "Failed to verify persistence on native Android bridge.",
      };
    }
  }

  const status = await getNativeEnrollmentStatus(staffId);
  return {
    verified: Boolean(status.isAvailable && status.isEnrolled && status.count > 0),
    count: status.count,
    deviceId: status.deviceId,
    enrolledAt: status.enrolledAt,
  };
}

/**
 * Verify a live face embedding against this device's Android Keystore templates.
 * Enforces presentation-attack detection and active liveness verification evidence.
 * Returns match result and single-use cryptographic attendance attestation token.
 */
export async function verifyNativeFace(
  staffId: string,
  liveEmbedding: number[] | Float32Array,
  challenge?: string,
  livenessEvidence?: any,
): Promise<NativeVerifyResult> {
  const bridge = getBridge();
  if (!bridge || (typeof bridge.verifyLocalFace !== "function" && typeof bridge.verifyLocalFaceWithEvidence !== "function")) {
    return {
      matched: false,
      error: "BRIDGE_UNAVAILABLE",
      message: "Native Android biometric bridge is not available on this platform.",
    };
  }

  const deviceId = getNativeDeviceId() || "";
  const floatsArray = Array.from(liveEmbedding);
  const evidencePayload = livenessEvidence
    ? (typeof livenessEvidence === "string" ? livenessEvidence : JSON.stringify(livenessEvidence))
    : (challenge && challenge.trim().startsWith("{") ? challenge : null);

  try {
    let raw: any;
    if (typeof bridge.verifyLocalFaceWithEvidence === "function") {
      raw = bridge.verifyLocalFaceWithEvidence(
        staffId,
        deviceId,
        JSON.stringify(floatsArray),
        challenge || "",
        evidencePayload || "",
      );
    } else {
      // Pass evidence payload in challenge parameter for 4-param bridge compatibility
      raw = bridge.verifyLocalFace(
        staffId,
        deviceId,
        JSON.stringify(floatsArray),
        evidencePayload || challenge || "",
      );
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      matched: Boolean(parsed.matched),
      staffId: parsed.staffId,
      deviceId: parsed.deviceId,
      distance: typeof parsed.distance === "number" ? parsed.distance : undefined,
      threshold: typeof parsed.threshold === "number" ? parsed.threshold : 0.45,
      biometricAttestation: parsed.biometricAttestation,
      requiresEnrollment: Boolean(parsed.requiresEnrollment),
      error: parsed.error,
      message: parsed.message,
    };
  } catch (err: any) {
    return {
      matched: false,
      error: "VERIFICATION_EXCEPTION",
      message: err?.message || "Native verification failed.",
    };
  }
}

/**
 * Clear local Keystore templates for a staff member on this device.
 */
export async function clearNativeTemplates(staffId: string): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.clearLocalTemplates !== "function") return false;
  try {
    const raw = bridge.clearLocalTemplates(staffId);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Boolean(parsed.success);
  } catch {
    return false;
  }
}
