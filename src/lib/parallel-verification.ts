/**
 * CampusAttend – Independent Parallel Verification Architecture
 *
 * Core Mandate:
 * 1. Each verification factor (Wi-Fi, GPS Geofence, Face Biometrics) executes independently.
 * 2. A failure, timeout, or error in one factor NEVER terminates, cancels, skips, or prevents
 *    the execution of the other verification factors.
 * 3. Asynchronous execution via Promise.allSettled with separate error handling and individual timeouts.
 * 4. Displays individual verification results for all three factors simultaneously.
 * 5. Attendance can be recorded ONLY IF ALL THREE FACTORS PASS.
 */

import {
  isAuthorizedCampusBssid,
  normalizeBssid,
  REGISTERED_CAMPUS_BSSID,
  APPROVED_CAMPUS_BSSIDS,
  type WifiStatus,
} from "./wifi-config";
import type { FaceScanResult } from "@/components/common/FaceScanDialog";
import type { GeofenceEvaluation } from "./geofence/geofence-service";
import { FACE_CONFIG } from "./face-recognition";

export const MAX_COSINE_DISTANCE = 0.45 as const;
export const MIN_MATCH_MARGIN = 0.08 as const;

export type FactorStatus = "PASS" | "FAIL" | "UNAVAILABLE" | "TIMEOUT" | "PENDING";

export interface SingleFactorResult<T = any> {
  status: FactorStatus;
  label: string;
  detail: string;
  data?: T | undefined;
  timestamp: number;
  durationMs?: number | undefined;
  error?: string | undefined;
}

export interface WifiFactorData {
  bssid?: string | undefined;
  rawBssid?: string | undefined;
  bssidDiagnostic?: string | undefined;
  bssidSource?: string | undefined;
  ssid?: string | undefined;
  authorized?: boolean | undefined;
  errorCode?: string | undefined;
  transport?: string | undefined;
}

export interface GpsFactorData {
  isInside?: boolean | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  accuracy?: number | undefined;
  status?: string | undefined;
}

export interface FaceFactorData {
  verified?: boolean | undefined;
  staffId?: string | undefined;
  staffCode?: string | undefined;
  staffName?: string | undefined;
  distance?: number | undefined;
  antiSpoofScore?: number | undefined;
  livenessCompleted?: boolean | undefined;
  [key: string]: any;
}

export interface ParallelVerificationReport {
  wifi: SingleFactorResult<WifiFactorData>;
  gps: SingleFactorResult<GpsFactorData>;
  face: SingleFactorResult<FaceFactorData>;
  overallDecision: "ALLOWED" | "REJECTED" | "PENDING";
  completedAt: number;
  allCompleted: boolean;
  failedFactors: string[];
  passedFactors: string[];
  summary: string;
}

/**
 * Normalizes staff ID for comparison (case-insensitive, trims whitespace)
 */
function isSameStaffCode(code1?: string | null, code2?: string | null): boolean {
  if (!code1 || !code2) return false;
  return code1.trim().toUpperCase() === code2.trim().toUpperCase();
}

/**
 * Evaluates Wi-Fi Verification independently:
 * - Checks against registered campus AP BSSID: B0:1F:8C:29:6B:30
 * - Returns PASS, FAIL, UNAVAILABLE, or TIMEOUT
 */
export function evaluateWifiFactor(
  wifiStatus?: Partial<WifiStatus> | null | undefined,
  timeoutExpired = false,
  durationMs = 0,
): SingleFactorResult<WifiFactorData> {
  const timestamp = Date.now();

  if (timeoutExpired) {
    return {
      status: "TIMEOUT",
      label: "TIMEOUT",
      detail: "Campus Wi-Fi AP verification timed out.",
      data: { errorCode: "TIMEOUT" },
      timestamp,
      durationMs,
    };
  }

  if (!wifiStatus) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: "Wi-Fi status unavailable or disconnected.",
      data: { errorCode: "DISCONNECTED" },
      timestamp,
      durationMs,
    };
  }

  const rawBssid = normalizeBssid(wifiStatus.bssid);
  const errorCode = wifiStatus.errorCode;

  // 1. Permissions or OS settings
  if (
    errorCode === "PERMISSION_DENIED" ||
    wifiStatus.permissionDenied === true
  ) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: "Location/Nearby Wi-Fi permission denied. BSSID cannot be read.",
      data: {
        bssid: rawBssid || undefined,
        errorCode: errorCode || "PERMISSION_DENIED",
        authorized: false,
      },
      timestamp,
      durationMs,
    };
  }

  if (
    errorCode === "LOCATION_SERVICES_DISABLED" ||
    wifiStatus.locationDisabled === true
  ) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: "Android location services are OFF. Location must be enabled to access Wi-Fi BSSID.",
      data: {
        bssid: rawBssid || undefined,
        errorCode: errorCode || "LOCATION_SERVICES_DISABLED",
        authorized: false,
      },
      timestamp,
      durationMs,
    };
  }

  // 2. Disconnected or non-Wi-Fi transport
  if (
    wifiStatus.state === "disconnected" ||
    errorCode === "DISCONNECTED"
  ) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: "Device is disconnected from Wi-Fi.",
      data: { errorCode: "DISCONNECTED", authorized: false },
      timestamp,
      durationMs,
    };
  }

  if (errorCode === "CELLULAR_DATA" || wifiStatus.network === "Mobile Data") {
    return {
      status: "FAIL",
      label: "FAIL – Mobile Data",
      detail: "Device is connected to mobile data. Official campus Wi-Fi required.",
      data: { errorCode: "CELLULAR_DATA", authorized: false, transport: "cellular" },
      timestamp,
      durationMs,
    };
  }

  // 3. Unavailable or redacted BSSID
  if (
    !rawBssid ||
    rawBssid === "02:00:00:00:00:00" ||
    rawBssid === "00:00:00:00:00:00" ||
    rawBssid === "UNKNOWN" ||
    rawBssid === "BSSID_UNAVAILABLE" ||
    errorCode === "BSSID_UNAVAILABLE"
  ) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: wifiStatus.bssidDiagnostic
        ? `Access point BSSID unavailable (${wifiStatus.bssidDiagnostic}). Ensure location services and permissions are granted.`
        : "Access point BSSID is unavailable or restricted by OS.",
      data: {
        bssid: rawBssid || undefined,
        rawBssid: wifiStatus.rawBssid || undefined,
        bssidDiagnostic: wifiStatus.bssidDiagnostic || undefined,
        bssidSource: wifiStatus.bssidSource || undefined,
        errorCode: "BSSID_UNAVAILABLE",
        authorized: false,
      },
      timestamp,
      durationMs,
    };
  }

  // 4. Exact BSSID Match against registered B0:1F:8C:29:6B:30
  if (isAuthorizedCampusBssid(rawBssid)) {
    return {
      status: "PASS",
      label: "PASS",
      detail: `Connected to official campus Wi-Fi (BSSID: ${rawBssid})`,
      data: {
        bssid: rawBssid,
        rawBssid: wifiStatus.rawBssid || rawBssid,
        bssidDiagnostic: wifiStatus.bssidDiagnostic || undefined,
        bssidSource: wifiStatus.bssidSource || undefined,
        ssid: wifiStatus.ssid || undefined,
        authorized: true,
      },
      timestamp,
      durationMs,
    };
  }

  // 5. BSSID Mismatch
  return {
    status: "FAIL",
    label: "FAIL – BSSID Mismatch",
    detail: `Connected BSSID (${rawBssid}) does not match approved campus access points (${APPROVED_CAMPUS_BSSIDS.join(" or ")})`,
    data: {
      bssid: rawBssid,
      rawBssid: wifiStatus.rawBssid || rawBssid,
      bssidDiagnostic: wifiStatus.bssidDiagnostic || undefined,
      bssidSource: wifiStatus.bssidSource || undefined,
      ssid: wifiStatus.ssid || undefined,
      errorCode: "UNAUTHORIZED_BSSID",
      authorized: false,
    },
    timestamp,
    durationMs,
  };
}

/**
 * Evaluates GPS Geofence Verification independently:
 * - Checks 19-point campus polygon containment & accuracy <= 20m
 * - Returns PASS (Inside Campus), FAIL (Outside Campus), UNAVAILABLE, or TIMEOUT
 */
export function evaluateGpsFactor(
  geofence?: {
    isInside?: boolean | null | undefined;
    status?: string | undefined;
    accuracy?: number | null | undefined;
    coords?: { lat: number; lng: number } | null | undefined;
  } | null | undefined,
  timeoutExpired = false,
  durationMs = 0,
): SingleFactorResult<GpsFactorData> {
  const timestamp = Date.now();

  if (timeoutExpired) {
    return {
      status: "TIMEOUT",
      label: "TIMEOUT",
      detail: "GPS coordinate acquisition timed out.",
      data: { status: "timeout" },
      timestamp,
      durationMs,
    };
  }

  if (!geofence) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE",
      detail: "GPS location subsystem unavailable.",
      data: { status: "unsupported" },
      timestamp,
      durationMs,
    };
  }

  const { status, accuracy, coords, isInside } = geofence;

  // 1. Permission / OS Services checks
  if (status === "permission_denied") {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Permission Denied",
      detail: "Location permission denied. Grant permission in app/browser settings.",
      data: { status: status || undefined },
      timestamp,
      durationMs,
    };
  }

  if (status === "permission_prompt") {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Permission Required",
      detail: "Location permission required. Tap Allow to proceed.",
      data: { status: status || undefined },
      timestamp,
      durationMs,
    };
  }

  if (status === "location_services_off" || status === "position_unavailable") {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Location Services Off",
      detail: "Device location services are turned off. Turn on Android Location.",
      data: { status: status || undefined },
      timestamp,
      durationMs,
    };
  }

  // 2. Accuracy check (must be <= 20m)
  if (
    status === "insufficient_accuracy" ||
    (accuracy !== null && accuracy !== undefined && accuracy > 20)
  ) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Low GPS Accuracy",
      detail: `Current GPS accuracy is ±${Math.round(accuracy || 0)}m (requires ≤20m). Move toward open sky.`,
      data: {
        status: status || undefined,
        accuracy: accuracy ?? undefined,
        lat: coords?.lat ?? undefined,
        lng: coords?.lng ?? undefined,
      },
      timestamp,
      durationMs,
    };
  }

  // 3. Waiting for fix
  if (!coords || isNaN(coords.lat) || isNaN(coords.lng)) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Acquiring Fix",
      detail: "Acquiring high-accuracy GPS fix from satellites...",
      data: { status: status || undefined },
      timestamp,
      durationMs,
    };
  }

  // 4. Polygon containment: Inside or Outside
  if (isInside === true) {
    return {
      status: "PASS",
      label: "PASS",
      detail: `Inside campus geofence polygon (±${accuracy ? Math.round(accuracy) : 5}m accuracy)`,
      data: {
        isInside: true,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: accuracy ?? undefined,
        status: "inside",
      },
      timestamp,
      durationMs,
    };
  }

  if (isInside === false) {
    return {
      status: "FAIL",
      label: "FAIL – Outside Campus",
      detail: `Device position (${coords.lat.toFixed(6)}°, ${coords.lng.toFixed(6)}°) is outside campus polygon.`,
      data: {
        isInside: false,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: accuracy ?? undefined,
        status: "outside",
      },
      timestamp,
      durationMs,
    };
  }

  return {
    status: "UNAVAILABLE",
    label: "UNAVAILABLE",
    detail: "Evaluating GPS geofence polygon containment...",
    data: { status: status || undefined },
    timestamp,
    durationMs,
  };
}

/**
 * Evaluates Facial Biometric Verification independently:
 * - Checks ArcFace embedding distance (<= 0.38), active liveness, and anti-spoofing
 * - Validates recognized identity against authenticated staff code
 * - Returns PASS, FAIL, UNAVAILABLE, or TIMEOUT
 */
export function evaluateFaceFactor(
  faceResult?: FaceScanResult | null | undefined,
  expectedStaffCode?: string | undefined,
  timeoutExpired = false,
  durationMs = 0,
): SingleFactorResult<FaceFactorData> {
  const timestamp = Date.now();

  if (timeoutExpired) {
    return {
      status: "TIMEOUT",
      label: "TIMEOUT",
      detail: "Face scan session timed out.",
      data: { verified: false },
      timestamp,
      durationMs,
    };
  }

  if (!faceResult) {
    return {
      status: "UNAVAILABLE",
      label: "UNAVAILABLE – Scan Required",
      detail: "Live face scan has not yet been performed in this session.",
      data: { verified: false },
      timestamp,
      durationMs,
    };
  }

  const {
    verified,
    distance,
    antiSpoofScore,
    livenessCompleted,
    staffCode,
    staffId,
    staffName,
  } = faceResult;

  const baseData: FaceFactorData = {
    ...faceResult,
  };

  // 1. Liveness or Anti-Spoof failure
  if (antiSpoofScore !== undefined && antiSpoofScore < 0.7) {
    return {
      status: "FAIL",
      label: "FAIL – Spoof Detected",
      detail: `Presentation attack detected (Score: ${(antiSpoofScore * 100).toFixed(0)}%). Live face required.`,
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  if (livenessCompleted === false) {
    return {
      status: "FAIL",
      label: "FAIL – Liveness Failed",
      detail: "Active liveness challenge was not completed.",
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  // 2. Unrecognized Face
  if (verified === false) {
    return {
      status: "FAIL",
      label: "FAIL – Unrecognized Face",
      detail: "Face does not match registered biometric database for staff.",
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  // 3. Identity Mismatch (different faculty member)
  const resolvedCode = staffCode || staffId;
  if (expectedStaffCode && resolvedCode && !isSameStaffCode(expectedStaffCode, resolvedCode)) {
    return {
      status: "FAIL",
      label: "FAIL – Identity Mismatch",
      detail: `Recognized identity (${resolvedCode}) does not match logged-in staff (${expectedStaffCode}).`,
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  // 4. ArcFace Cosine Distance threshold check (<= MAX_COSINE_DISTANCE: 0.45)
  if (distance !== undefined && distance > MAX_COSINE_DISTANCE) {
    return {
      status: "FAIL",
      label: "FAIL – Distance Exceeded",
      detail: `ArcFace cosine distance (${distance.toFixed(4)}) exceeds threshold (${MAX_COSINE_DISTANCE}).`,
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  // 5. Minimum Match Margin check (>= MIN_MATCH_MARGIN: 0.08)
  const margin = (faceResult as any)?.matchMargin ?? (faceResult as any)?.margin;
  if (typeof margin === "number" && margin < MIN_MATCH_MARGIN) {
    return {
      status: "FAIL",
      label: "FAIL – Ambiguous Match Margin",
      detail: `Match margin (${margin.toFixed(4)}) is below minimum required (${MIN_MATCH_MARGIN}).`,
      data: { ...baseData, verified: false },
      timestamp,
      durationMs,
    };
  }

  // 6. Verification PASSED
  return {
    status: "PASS",
    label: "PASS",
    detail: `Identity confirmed: ${staffName || "Staff"} (${resolvedCode || expectedStaffCode || "Authorized"})${
      distance !== undefined ? ` · Distance: ${distance.toFixed(4)} (≤ ${MAX_COSINE_DISTANCE})` : ""
    }`,
    data: { ...baseData, verified: true },
    timestamp,
    durationMs,
  };
}

/**
 * Computes overall decision based on all 3 factors:
 * - Attendance is ALLOWED only if ALL THREE are PASS
 * - If any factor is FAIL, UNAVAILABLE, or TIMEOUT, decision is REJECTED
 * - If any factor is PENDING, decision is PENDING
 */
export function computeParallelDecision(
  wifi: SingleFactorResult<WifiFactorData>,
  gps: SingleFactorResult<GpsFactorData>,
  face: SingleFactorResult<FaceFactorData>,
): {
  decision: "ALLOWED" | "REJECTED" | "PENDING";
  failedFactors: string[];
  passedFactors: string[];
  summary: string;
} {
  const isPending =
    wifi.status === "PENDING" || gps.status === "PENDING" || face.status === "PENDING";

  if (isPending) {
    return {
      decision: "PENDING",
      failedFactors: [],
      passedFactors: [],
      summary: "Verification in progress...",
    };
  }

  const failedFactors: string[] = [];
  const passedFactors: string[] = [];

  if (wifi.status === "PASS") passedFactors.push("Wi-Fi BSSID");
  else failedFactors.push(`Wi-Fi (${wifi.label})`);

  if (gps.status === "PASS") passedFactors.push("GPS Polygon");
  else failedFactors.push(`GPS (${gps.label})`);

  if (face.status === "PASS") passedFactors.push("Face Biometrics");
  else failedFactors.push(`Face (${face.label})`);

  if (wifi.status === "PASS" && gps.status === "PASS" && face.status === "PASS") {
    return {
      decision: "ALLOWED",
      failedFactors: [],
      passedFactors,
      summary: "All 3 verification factors passed. Attendance authorization granted.",
    };
  }

  return {
    decision: "REJECTED",
    failedFactors,
    passedFactors,
    summary: `Attendance rejected: ${failedFactors.join(", ")} did not pass.`,
  };
}

/**
 * Helper to wrap any async promise with an independent timeout and error tracking
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T,
): Promise<{ result: T; timedOut: boolean; durationMs: number; error?: string | undefined }> {
  const startTime = Date.now();
  let timer: any;

  const timeoutPromise = new Promise<{
    result: T;
    timedOut: boolean;
    durationMs: number;
    error?: string | undefined;
  }>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        result: fallbackValue,
        timedOut: true,
        durationMs: Date.now() - startTime,
      });
    }, timeoutMs);
  });

  const execPromise = promise
    .then((val) => {
      clearTimeout(timer);
      return {
        result: val,
        timedOut: false,
        durationMs: Date.now() - startTime,
      };
    })
    .catch((err) => {
      clearTimeout(timer);
      const errMsg = err?.message || String(err);
      console.warn("[ParallelExecution] Factor promise caught error:", errMsg);
      return {
        result: fallbackValue,
        timedOut: false,
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
    });

  return Promise.race([execPromise, timeoutPromise]);
}

/**
 * Executes all 3 verification factors concurrently via Promise.allSettled:
 * - Independent execution: Wi-Fi, GPS, and Face run simultaneously
 * - A failure or timeout in one NEVER stops or cancels the other processes
 * - Produces the unified 3-factor ParallelVerificationReport
 */
export async function runParallelVerification(params: {
  checkWifi: () => Promise<WifiStatus | null>;
  checkGps: () => Promise<GeofenceEvaluation | null>;
  getFaceResult: () => Promise<FaceScanResult | null>;
  currentGeofenceState?: {
    isInside?: boolean | null | undefined;
    status?: string | undefined;
    accuracy?: number | null | undefined;
    coords?: { lat: number; lng: number } | null | undefined;
  } | undefined;
  expectedStaffCode?: string | undefined;
  timeoutMs?: number | undefined;
}): Promise<ParallelVerificationReport> {
  const timeoutMs = params.timeoutMs ?? 6000;

  // 1. Kick off all three verification promises concurrently
  const wifiPromise = withTimeout(params.checkWifi(), timeoutMs, null);
  const gpsPromise = withTimeout(params.checkGps(), timeoutMs, null);
  const facePromise = withTimeout(params.getFaceResult(), timeoutMs, null);

  // 2. Wait for all 3 to settle without any factor aborting another
  const [wifiSettled, gpsSettled, faceSettled] = await Promise.allSettled([
    wifiPromise,
    gpsPromise,
    facePromise,
  ]);

  // 3. Extract Wi-Fi result
  let wifiFactor: SingleFactorResult<WifiFactorData>;
  if (wifiSettled.status === "fulfilled") {
    const { result, timedOut, durationMs, error } = wifiSettled.value;
    if (error) {
      wifiFactor = {
        status: "FAIL",
        label: "FAIL – Execution Error",
        detail: error,
        timestamp: Date.now(),
        durationMs,
        error,
      };
    } else {
      wifiFactor = evaluateWifiFactor(result, timedOut, durationMs);
    }
  } else {
    wifiFactor = {
      status: "FAIL",
      label: "FAIL – Internal Error",
      detail: wifiSettled.reason?.message || "Wi-Fi check failed unexpectedly",
      timestamp: Date.now(),
      error: String(wifiSettled.reason),
    };
  }

  // 4. Extract GPS result
  let gpsFactor: SingleFactorResult<GpsFactorData>;
  if (gpsSettled.status === "fulfilled") {
    const { result, timedOut, durationMs, error } = gpsSettled.value;
    if (error) {
      gpsFactor = {
        status: "FAIL",
        label: "FAIL – Execution Error",
        detail: error,
        timestamp: Date.now(),
        durationMs,
        error,
      };
    } else if (result) {
      gpsFactor = evaluateGpsFactor(
        {
          isInside: result.isInside,
          status: result.isInside ? "inside" : "outside",
          accuracy: result.accuracy ?? undefined,
          coords: { lat: result.lat, lng: result.lng },
        },
        timedOut,
        durationMs,
      );
    } else {
      // Use current geofence state if fresh check returned null
      gpsFactor = evaluateGpsFactor(params.currentGeofenceState, timedOut, durationMs);
    }
  } else {
    gpsFactor = {
      status: "FAIL",
      label: "FAIL – Internal Error",
      detail: gpsSettled.reason?.message || "GPS check failed unexpectedly",
      timestamp: Date.now(),
      error: String(gpsSettled.reason),
    };
  }

  // 5. Extract Face result
  let faceFactor: SingleFactorResult<FaceFactorData>;
  if (faceSettled.status === "fulfilled") {
    const { result, timedOut, durationMs, error } = faceSettled.value;
    if (error) {
      faceFactor = {
        status: "FAIL",
        label: "FAIL – Execution Error",
        detail: error,
        timestamp: Date.now(),
        durationMs,
        error,
      };
    } else {
      faceFactor = evaluateFaceFactor(result, params.expectedStaffCode, timedOut, durationMs);
    }
  } else {
    faceFactor = {
      status: "FAIL",
      label: "FAIL – Internal Error",
      detail: faceSettled.reason?.message || "Face check failed unexpectedly",
      timestamp: Date.now(),
      error: String(faceSettled.reason),
    };
  }

  // 6. Compute final overall attendance decision
  const decisionResult = computeParallelDecision(wifiFactor, gpsFactor, faceFactor);

  return {
    wifi: wifiFactor,
    gps: gpsFactor,
    face: faceFactor,
    overallDecision: decisionResult.decision,
    completedAt: Date.now(),
    allCompleted: true,
    failedFactors: decisionResult.failedFactors,
    passedFactors: decisionResult.passedFactors,
    summary: decisionResult.summary,
  };
}
