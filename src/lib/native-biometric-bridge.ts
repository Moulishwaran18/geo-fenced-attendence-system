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
 * Verify a live face embedding against this device's Android Keystore templates.
 * Returns match result and single-use cryptographic attendance attestation token.
 */
export async function verifyNativeFace(
  staffId: string,
  liveEmbedding: number[] | Float32Array,
  challenge?: string,
): Promise<NativeVerifyResult> {
  const bridge = getBridge();
  if (!bridge || typeof bridge.verifyLocalFace !== "function") {
    return {
      matched: false,
      error: "BRIDGE_UNAVAILABLE",
      message: "Native Android biometric bridge is not available on this platform.",
    };
  }

  const deviceId = getNativeDeviceId() || "";
  const floatsArray = Array.from(liveEmbedding);

  try {
    const raw = bridge.verifyLocalFace(
      staffId,
      deviceId,
      JSON.stringify(floatsArray),
      challenge || "",
    );
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
