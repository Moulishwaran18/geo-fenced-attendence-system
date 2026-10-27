import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Bluetooth,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Eye,
  Loader2,
  MapPin,
  RefreshCw,
  Satellite,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Timer,
  Wifi,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { VerificationCard } from "@/components/common/VerificationCard";
import { WifiStatusCard } from "@/components/common/WifiStatusCard";
import { FaceScanDialog } from "@/components/common/FaceScanDialog";
import type { FaceScanResult } from "@/components/common/FaceScanDialog";
import { GeofenceMap } from "@/components/common/GeofenceMap";
import { GpsDiagnosticPanel } from "@/components/common/GpsDiagnosticPanel";
import { AlertBanner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSnapshot,
  markAttendance,
  scenarioLabels,
  type AttendanceReceipt,
  type VerificationScenario,
  type VerificationSignal,
} from "@/mocks/attendance-service";
import { currentStaff } from "@/mocks/data";
import { useActiveStaff } from "@/lib/staff-auth";
import { formatIndiaDate, formatIndiaTime, useIndiaTime } from "@/lib/india-time";
import { FACE_CONFIG } from "@/lib/face-recognition";
import { useGeofence } from "@/hooks/use-geofence";
import { useWifiStatus } from "@/hooks/use-wifi-status";
import {
  fetchDeviceRegistrationStatus,
  registerCurrentDevice,
  type DeviceStatusResponse,
} from "@/lib/device-registration-client";

export const Route = createFileRoute("/mark-attendance")({
  head: () => ({
    meta: [
      { title: "Mark Attendance — CampusAttend" },
      {
        name: "description",
        content:
          "Authoritative 3-Factor Presence Verification: Wi-Fi, Campus Geofence Polygon, and Biometric Identity Verification.",
      },
      { property: "og:title", content: "Mark Attendance — CampusAttend" },
      { property: "og:description", content: "3-Factor Presence Authorization (Wi-Fi + GPS + ArcFace)." },
    ],
  }),
  component: MarkAttendancePage,
});

const icons = {
  wifi: Wifi,
  location: MapPin,
  identity: ScanFace,
  decision: ShieldCheck,
} as const;

const titles = {
  wifi: "1. CAMPUS NETWORK AUTHORIZATION",
  location: "2. GPS POLYGON GEOFENCE",
  identity: "3. FACE RECOGNITION",
  decision: "4. ATTENDANCE DECISION",
} as const;

function isSameIndividual(expectedStaffCode: string, recognizedStaffCode?: string | null): boolean {
  if (!recognizedStaffCode) return false;
  const exp = expectedStaffCode.trim().toUpperCase();
  const rec = recognizedStaffCode.trim().toUpperCase();
  return exp === rec;
}

function MarkAttendancePage() {
  const [scenario, setScenario] = useState<VerificationScenario>("ready");
  const [status, setStatus] = useState<"idle" | "verifying" | "success">("idle");
  const [receipt, setReceipt] = useState<AttendanceReceipt | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [faceResult, setFaceResult] = useState<FaceScanResult | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const now = useIndiaTime();

  // Live Wi-Fi Status tracker
  const {
    status: wifiStatus,
    isLoading: isWifiLoading,
    isChecking: isWifiChecking,
    lastChecked: wifiLastChecked,
    checkConnection: checkWifiConnection,
    requestPermissions: requestWifiPermissions,
    openLocationSettings: openWifiLocationSettings,
  } = useWifiStatus(5000);

  // Determine real or mock location state
  const isUsingMockScenario = scenario !== "ready";
  const mockSnapshot = getSnapshot(scenario);

  // ---------------------------------------------------------------------------
  // 4 MANDATORY ATTENDANCE VERIFICATION STAGES:
  // 1. Wi-Fi Authentication (FIRST - gates GPS)
  // 2. GPS / Location Verification (LOCKED until Wi-Fi verification succeeds)
  // 3. Face Recognition + Liveness (LOCKED until Wi-Fi + GPS succeed)
  // 4. Attendance Registration (LOCKED until all required verification succeeds)
  // ---------------------------------------------------------------------------

  const wifiAuthorized = isUsingMockScenario
    ? mockSnapshot.signals.find((s) => s.key === "wifi")?.state === "verified"
    : Boolean(wifiStatus?.authorized ?? wifiStatus?.isSonaWifi);

  // High-accuracy live GPS geofence tracker & readiness check: explicitly initiated when entering Mark Attendance
  const geofence = useGeofence(true);

  const gpsInsideGeofence = isUsingMockScenario
    ? mockSnapshot.signals.find((s) => s.key === "location")?.state === "verified"
    : geofence.isInside === true;

  const loggedInStaff = useActiveStaff();

  // One Faculty–One Registered Device state
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusResponse | null>(null);
  const [isDeviceChecking, setIsDeviceChecking] = useState(false);
  const [isRegisteringDevice, setIsRegisteringDevice] = useState(false);
  const isSubmittingRef = useRef(false);

  const checkDeviceStatus = useCallback(async () => {
    if (!loggedInStaff?.staffId) return;
    setIsDeviceChecking(true);
    try {
      const res = await fetchDeviceRegistrationStatus(loggedInStaff.token, loggedInStaff.staffId);
      setDeviceStatus(res);
    } catch {
      // ignore
    } finally {
      setIsDeviceChecking(false);
    }
  }, [loggedInStaff?.staffId, loggedInStaff?.token]);

  useEffect(() => {
    void checkDeviceStatus();
  }, [checkDeviceStatus]);

  const handleRegisterDevice = async () => {
    if (!loggedInStaff?.staffId) return;
    setIsRegisteringDevice(true);
    try {
      const res = await registerCurrentDevice(loggedInStaff.staffId, loggedInStaff.token);
      if (res.success) {
        toast.success("Device Registered Successfully!", {
          description: `Bound to ${res.device?.model || "this device"} (${res.device?.attestationStatus}). You can now mark attendance.`,
        });
        await checkDeviceStatus();
      } else {
        toast.error("Device Registration Failed", {
          description: res.error || "Could not register device.",
        });
      }
    } catch (err: any) {
      toast.error("Registration Error", {
        description: err?.message || "Device registration encountered an error.",
      });
    } finally {
      setIsRegisteringDevice(false);
    }
  };

  // Identity match check: recognized face must match the authenticated individual
  const isIdentityMatched = Boolean(
    loggedInStaff &&
    faceResult?.verified &&
    isSameIndividual(loggedInStaff.staffId, faceResult.staffCode || faceResult.staffId)
  );

  const isWrongPerson = Boolean(
    loggedInStaff &&
    faceResult?.verified && !isIdentityMatched
  );

  const faceAuthenticated = Boolean(
    loggedInStaff &&
      faceResult &&
      faceResult.verified &&
      isIdentityMatched &&
      faceResult.distance !== undefined &&
      faceResult.distance <= FACE_CONFIG.MATCH_THRESHOLD &&
      faceResult.livenessCompleted === true &&
      typeof faceResult.antiSpoofScore === "number" &&
      faceResult.antiSpoofScore >= 0.70 &&
      faceResult.attemptNonce,
  );

  // FINAL DECISION RULE:
  // wifiAuthorized && gpsInsideGeofence && faceAuthenticated && isDeviceReady -> ALLOWED
  // otherwise -> REJECTED
  const isDeviceReady = Boolean(isUsingMockScenario || (deviceStatus?.hasActiveDevice ?? true));
  const canMarkAttendance = Boolean(loggedInStaff && wifiAuthorized && gpsInsideGeofence && faceAuthenticated && isDeviceReady);

  // Final Attendance Status Text
  const finalAttendanceStatus = useMemo(() => {
    if (status === "success" && receipt) {
      return {
        label: "ALLOWED & RECORDED",
        tone: "success" as const,
        detail: `Receipt: ${receipt.attendanceId} recorded at ${receipt.time}`,
      };
    }
    if (canMarkAttendance) {
      return {
        label: "ALLOWED",
        tone: "success" as const,
        detail: "All 3 Security Factors (Wi-Fi, Campus Geofence Polygon, Face Recognition) Passed",
      };
    }
    if (isWrongPerson) {
      return {
        label: "REJECTED (Identity Mismatch)",
        tone: "error" as const,
        detail: `Recognized identity (${faceResult?.staffCode || faceResult?.staffId}) does not match authenticated user (${loggedInStaff?.staffId || "Staff"}).`,
      };
    }
    if (!wifiAuthorized && !gpsInsideGeofence) {
      return {
        label: "REJECTED",
        tone: "error" as const,
        detail: "Attendance requires Wi-Fi + GPS + Face verification.",
      };
    }
    if (!wifiAuthorized) {
      return {
        label: "REJECTED (Wi-Fi Unauthorized)",
        tone: "error" as const,
        detail: "Device must be connected to authorized institutional Wi-Fi network",
      };
    }
    if (!isUsingMockScenario && (geofence.status === "location_services_off" || geofence.status === "position_unavailable")) {
      return {
        label: "REJECTED (Location Services OFF)",
        tone: "error" as const,
        detail: "Turn on Android Location and try again.",
      };
    }
    if (!isUsingMockScenario && geofence.status === "permission_prompt") {
      return {
        label: "REJECTED (Location Permission Required)",
        tone: "warning" as const,
        detail: "Please allow location access to continue.",
      };
    }
    if (!isUsingMockScenario && geofence.status === "permission_denied") {
      return {
        label: "REJECTED (Location Permission Denied)",
        tone: "error" as const,
        detail: "Enable location permission for Chrome and try again.",
      };
    }
    if (!isUsingMockScenario && geofence.status === "acquiring" && !geofence.isAcceptableAccuracy) {
      return {
        label: "REJECTED (Acquiring GPS Fix)",
        tone: "warning" as const,
        detail: `Waiting for accurate GPS location (${geofence.acquisitionTimer}s / ${geofence.maxAcquisitionSeconds}s)…`,
      };
    }
    if (
      !isUsingMockScenario &&
      geofence.accuracy !== null &&
      geofence.accuracy > 20 &&
      !geofence.isAcceptableAccuracy
    ) {
      return {
        label: `REJECTED (GPS Accuracy Insufficient: ±${geofence.accuracy.toFixed(1)}m)`,
        tone: "error" as const,
        detail: `GPS ACCURACY INSUFFICIENT — Current accuracy: ±${geofence.accuracy.toFixed(1)}m. Acquiring a better GPS fix...`,
      };
    }
    if (!gpsInsideGeofence) {
      return {
        label: "REJECTED (Outside Campus Polygon)",
        tone: "error" as const,
        detail: "Device GPS coordinates are outside the authoritative campus polygon boundary",
      };
    }
    if (faceResult && !faceAuthenticated) {
      return {
        label: "REJECTED (Face Unauthorized)",
        tone: "error" as const,
        detail: `Biometric distance (${faceResult.distance?.toFixed(4) || "—"}) exceeds threshold (${FACE_CONFIG.MATCH_THRESHOLD})`,
      };
    }
    return {
      label: "REJECTED (Face Scan Pending)",
      tone: "warning" as const,
      detail: "Live face recognition required to complete 3-factor verification",
    };
  }, [status, receipt, canMarkAttendance, isWrongPerson, wifiAuthorized, isUsingMockScenario, geofence, gpsInsideGeofence, faceResult, faceAuthenticated, loggedInStaff?.staffId]);

  // Live Location Signal computation
  const liveLocationSignal = useMemo((): VerificationSignal => {
    if (isUsingMockScenario) {
      return mockSnapshot.signals.find((s) => s.key === "location") || {
        key: "location",
        value: "Mock Location",
        detail: "Mock scenario active",
        state: "verified",
      };
    }

    if (geofence.status === "location_services_off" || geofence.status === "position_unavailable") {
      return {
        key: "location",
        value: "Location services are OFF",
        detail: "Turn on Android Location and try again.",
        state: "error",
      };
    }

    if (geofence.status === "permission_prompt") {
      return {
        key: "location",
        value: "Location permission required",
        detail: "Please allow location access to continue.",
        state: "warning",
      };
    }

    if (geofence.status === "permission_denied") {
      return {
        key: "location",
        value: "Location permission denied",
        detail: "Enable location permission for Chrome and try again.",
        state: "error",
      };
    }

    if (geofence.status === "acquiring") {
      return {
        key: "location",
        value: "Acquiring GPS Fix…",
        detail: `Waiting for accurate GPS location (${geofence.acquisitionTimer}s / ${geofence.maxAcquisitionSeconds}s)`,
        state: "pending",
      };
    }

    if (geofence.status === "timeout") {
      return {
        key: "location",
        value: "GPS Request Timed Out",
        detail: "Move to open sky / enable Precise Location",
        state: "error",
      };
    }

    if (geofence.isInside === true || (geofence.accuracy !== null && geofence.accuracy <= 20 && geofence.isInsidePolygon === true)) {
      const acc = geofence.accuracy ?? 0;
      const isTarget = acc < 10;
      return {
        key: "location",
        value: isTarget ? "GPS ACCURACY EXCELLENT" : "GPS ACCURACY ACCEPTED",
        detail: isTarget
          ? `Current accuracy: ±${acc.toFixed(1)}m`
          : `Current accuracy: ±${acc.toFixed(1)}m · Improving GPS accuracy toward <10m...`,
        state: "verified",
      };
    }

    if (geofence.accuracy !== null && geofence.accuracy <= 20 && geofence.isInsidePolygon === false) {
      return {
        key: "location",
        value: "Outside Campus Polygon",
        detail: `${geofence.distanceToBoundary}m from authorized perimeter (±${geofence.accuracy.toFixed(1)}m)`,
        state: "error",
      };
    }

    if (!geofence.isAcceptableAccuracy && ((geofence.status as string) === "acquiring" || geofence.isChecking)) {
      return {
        key: "location",
        value: "Acquiring GPS Fix…",
        detail: `Waiting for accurate GPS location (${geofence.acquisitionTimer}s / ${geofence.maxAcquisitionSeconds}s)`,
        state: "pending",
      };
    }

    return {
      key: "location",
      value: "GPS ACCURACY INSUFFICIENT",
      detail: `Current accuracy: ±${geofence.accuracy ? geofence.accuracy.toFixed(1) : "—"}m · Acquiring a better GPS fix...`,
      state: "warning",
    };
  }, [isUsingMockScenario, mockSnapshot, geofence]);

  // 4 Primary Verification Overview Cards
  const wifiCardStatus: "CHECKING" | "VERIFIED" | "FAILED" =
    isWifiChecking || (isWifiLoading && !wifiStatus && !isUsingMockScenario)
      ? "CHECKING"
      : wifiAuthorized
        ? "VERIFIED"
        : "FAILED";

  const signals = useMemo((): Array<{
    key: "wifi" | "location" | "identity" | "decision";
    value: string;
    detail: React.ReactNode;
    state: "verified" | "warning" | "error" | "pending";
  }> => {
    // 1. CAMPUS NETWORK AUTHORIZATION
    const displayNetwork =
      wifiCardStatus === "VERIFIED"
        ? (wifiStatus?.network || wifiStatus?.networkSummary || "SONA Campus Network")
        : wifiCardStatus === "CHECKING"
          ? "Verifying campus network…"
          : (wifiStatus?.network || "Unauthorized Network");

    const displayVerification =
      wifiCardStatus === "VERIFIED"
        ? (wifiStatus?.verificationMethod === "NATIVE_BRIDGE"
            ? "Native Bridge Verified"
            : wifiStatus?.verificationMethod === "SIMULATION"
              ? "Simulated Network"
              : "Server Verified")
        : wifiCardStatus === "CHECKING"
          ? "Verifying…"
          : wifiStatus?.errorCode
            ? `Rejected: ${wifiStatus.errorCode}`
            : "Server Rejected";

    const wifiSignal = {
      key: "wifi" as const,
      value: `Status: ${wifiCardStatus === "VERIFIED" ? "VERIFIED" : wifiCardStatus}`,
      detail: (
        <div className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
          <div>
            <span className="font-sans font-medium uppercase text-[10px] text-foreground/70">
              Network:
            </span>{" "}
            <span className="font-semibold text-foreground">
              {displayNetwork}
            </span>
          </div>
          <div className="truncate">
            <span className="font-sans font-medium uppercase text-[10px] text-foreground/70">
              Verification:
            </span>{" "}
            <span>
              {displayVerification}
            </span>
          </div>
          {wifiStatus?.apiLevel && (
            <div className="pt-0.5 text-[10px] text-muted-foreground/80 leading-tight truncate">
              Device: API {wifiStatus.apiLevel} · Fine: {wifiStatus.hasFineLocation ? "✓" : "✗"} · Nearby: {wifiStatus.hasNearbyWifi ? "✓" : "✗"} · Source: {wifiStatus.ssidSource || "NONE"}
            </div>
          )}
          {wifiCardStatus !== "VERIFIED" && wifiStatus?.reason && (
            <div className="pt-0.5 text-[10px] text-destructive leading-tight truncate">
              {wifiStatus.reason}
            </div>
          )}
        </div>
      ),
      state: (wifiCardStatus === "VERIFIED" ? "verified" : wifiCardStatus === "CHECKING" ? "warning" : "error") as "verified" | "warning" | "error",
    };

    // 2. GPS POLYGON GEOFENCE (Visible for diagnostics even if Wi-Fi fails)
    const locationSignal = {
      key: "location" as const,
      value: gpsInsideGeofence ? liveLocationSignal.value : "NOT VERIFIED",
      detail: liveLocationSignal.detail,
      state: liveLocationSignal.state,
    };

    // 3. FACE RECOGNITION (Available for independent testing even if Wi-Fi or GPS fails)
    const identitySignal = {
      key: "identity" as const,
      value: faceAuthenticated
        ? `Verified · ${faceResult?.staffName || faceResult?.staffCode || "Staff"}`
        : isWrongPerson
          ? `Mismatch · ${faceResult?.staffCode || "Other Person"}`
          : faceResult
            ? "Unknown Face"
            : "READY / AVAILABLE",
      detail:
        faceAuthenticated && faceResult?.distance !== undefined
          ? `Match distance: ${faceResult.distance.toFixed(4)} (≤ ${FACE_CONFIG.MATCH_THRESHOLD})`
          : isWrongPerson
            ? `Face does not match ${loggedInStaff?.staffId || "authenticated staff"}`
            : faceResult
              ? "Biometric match rejected"
              : "Camera & ArcFace ready — Click Scan to test",
      state: (faceAuthenticated
        ? "verified"
        : isWrongPerson || (faceResult && !faceResult.verified)
          ? "error"
          : "pending") as "verified" | "error" | "pending",
    };

    // 4. ATTENDANCE DECISION
    let decisionSignal: {
      key: "decision";
      value: string;
      detail: React.ReactNode;
      state: "verified" | "warning" | "error" | "pending";
    };

    if (canMarkAttendance || (status === "success" && receipt)) {
      decisionSignal = {
        key: "decision",
        value: status === "success" ? "RECORDED" : "ALLOWED",
        detail: status === "success" ? `Recorded at ${receipt?.time}` : "All 3 Security Factors Passed",
        state: "verified",
      };
    } else if (isWrongPerson) {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Identity Mismatch: Recognized face does not match authenticated staff member",
        state: "error",
      };
    } else if (wifiCardStatus === "FAILED" && !gpsInsideGeofence) {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Attendance requires Wi-Fi + GPS + Face verification.",
        state: "error",
      };
    } else if (wifiCardStatus === "FAILED") {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Factor 1 (Wi-Fi) Failed: Unauthorized Wi-Fi network",
        state: "error",
      };
    } else if (geofence.status === "location_services_off" || geofence.status === "position_unavailable") {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Factor 2 (GPS) Blocked: Location services are OFF",
        state: "error",
      };
    } else if (geofence.status === "permission_denied") {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Factor 2 (GPS) Blocked: Location permission denied",
        state: "error",
      };
    } else if (geofence.status === "permission_prompt") {
      decisionSignal = {
        key: "decision",
        value: "LOCKED",
        detail: "Factor 2 (GPS) Pending: Location permission required",
        state: "warning",
      };
    } else if (!gpsInsideGeofence) {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Factor 2 (GPS) Failed: Device is outside campus polygon",
        state: "error",
      };
    } else if (!faceAuthenticated) {
      decisionSignal = {
        key: "decision",
        value: faceResult ? "REJECTED" : "LOCKED",
        detail: faceResult
          ? "Factor 3 (Face) Failed: Face verification rejected"
          : "Factor 3 (Face) Pending: Scan face to complete 3-factor verification",
        state: faceResult ? "error" : "pending",
      };
    } else {
      decisionSignal = {
        key: "decision",
        value: "REJECTED",
        detail: "Attendance requires Wi-Fi + GPS + Face verification.",
        state: "error",
      };
    }

    return [wifiSignal, locationSignal, identitySignal, decisionSignal];
  }, [
    wifiCardStatus,
    wifiStatus,
    liveLocationSignal,
    gpsInsideGeofence,
    faceAuthenticated,
    faceResult,
    canMarkAttendance,
    status,
  ]);

  const run = async (overrideFace?: FaceScanResult) => {
    if (isSubmittingRef.current || status === "verifying") {
      return;
    }

    if (!loggedInStaff) {
      toast.error("Staff Authentication Required", {
        description: "You must be signed in with a registered staff account to mark attendance.",
      });
      return;
    }

    if (!wifiAuthorized) {
      toast.error("Wi-Fi Verification Failed", {
        description: "You must be connected to an authorized campus Wi-Fi network to mark attendance.",
      });
      return;
    }

    if (!gpsInsideGeofence) {
      toast.error("GPS Geofence Verification Failed", {
        description:
          geofence.status === "insufficient_accuracy" || (geofence.accuracy !== null && geofence.accuracy > 20)
            ? `GPS ACCURACY INSUFFICIENT — Current accuracy: ±${geofence.accuracy ? geofence.accuracy.toFixed(1) : "—"}m. Acquiring a better GPS fix...`
            : "Your device GPS position is outside the authoritative campus polygon.",
      });
      return;
    }

    const currentFace = overrideFace || faceResult;
    const isMismatch = Boolean(
      currentFace &&
      loggedInStaff &&
      !isSameIndividual(loggedInStaff.staffId, currentFace.staffCode || currentFace.staffId)
    );

    if (isMismatch) {
      toast.error("Identity Mismatch", {
        description: `Recognized identity (${currentFace?.staffCode || currentFace?.staffId}) does not match authenticated staff (${loggedInStaff.staffId}). Attendance rejected.`,
      });
      return;
    }

    if (!currentFace || !currentFace.verified) {
      toast.error("Identity Verification Required", {
        description: "Please complete face recognition first.",
      });
      setScanOpen(true);
      return;
    }

    isSubmittingRef.current = true;
    setStatus("verifying");
    try {
      const activeDevId = deviceStatus?.device?.id || currentFace?.deviceId || undefined;
      const result = await markAttendance({
        staffCode: loggedInStaff.staffId,
        staffName: currentFace?.staffName || loggedInStaff.name,
        department: loggedInStaff.department,
        token: loggedInStaff.token,
        location: "Main Campus, Sona College",
        latitude: (geofence.bestCoords ?? geofence.coords)?.lat ?? undefined,
        longitude: (geofence.bestCoords ?? geofence.coords)?.lng ?? undefined,
        accuracy: (geofence.bestAccuracy ?? geofence.accuracy) ?? undefined,
        verification: "Verified",
        networkAuthToken: wifiStatus?.networkAuthToken,
        faceVerified: true,
        recognizedStaffCode: currentFace?.staffCode || currentFace?.staffId || loggedInStaff.staffId,
        faceMatchDistance: currentFace?.distance,
        livenessPassed: currentFace?.livenessCompleted === true,
        antiSpoofScore: currentFace?.antiSpoofScore,
        auditId: currentFace?.auditId || currentFace?.verification?.auditId,
        biometricAttestation: currentFace?.biometricAttestation,
        deviceId: activeDevId,
        sessionNonce: currentFace?.attemptNonce,
        attemptNonce: currentFace?.attemptNonce,
        livenessEvidence: currentFace?.livenessEvidence,
      });
      setReceipt(result);
      setStatus("success");
      toast.success("Attendance Recorded Successfully!", {
        description: `${currentFace?.staffName || loggedInStaff.name} · ${result.time} · ${result.date}`,
      });
    } catch (err: any) {
      setStatus("idle");
      toast.error("Attendance Rejected by Server", {
        description: err?.message || "Server rejected attendance verification.",
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleFaceVerified = useCallback(
    async (result: FaceScanResult) => {
      setFace(result.snapshot ?? null);
      setFaceResult(result);
      setScanOpen(false);

      if (!result.verified) {
        toast.error("Face Unrecognized", {
          description: "Biometric identity could not be verified against PostgreSQL staff database.",
        });
        return;
      }

      const matchedIdentity = Boolean(
        loggedInStaff &&
          isSameIndividual(loggedInStaff.staffId, result.staffCode || result.staffId),
      );
      if (!matchedIdentity) {
        toast.error("Identity Mismatch", {
          description: `Recognized identity (${result.staffCode || result.staffId || "Unknown"}) does not match logged-in staff (${loggedInStaff?.staffId || "None"}). Attendance rejected.`,
        });
        return;
      }

      toast.success("Face Recognized", {
        description: `Identity confirmed: ${result.staffName || "Staff"} (${result.staffId || "Authorized"}). Ready to mark attendance.`,
      });

      // If all three factors pass, submit directly through run()
      if (loggedInStaff && wifiAuthorized && gpsInsideGeofence) {
        void run(result);
      } else {
        const reasons: string[] = [];
        if (!wifiAuthorized) reasons.push("Authorized Campus Wi-Fi");
        if (!gpsInsideGeofence) reasons.push("GPS Polygon Containment");
        toast.warning("Attendance Blocked: Required Factors Not Satisfied", {
          description: `Face verified, but missing: ${reasons.join(", ")}. Attendance requires Wi-Fi + GPS + Face verification.`,
        });
      }
    },
    [loggedInStaff, wifiAuthorized, gpsInsideGeofence, isWrongPerson, wifiStatus, geofence, deviceStatus]
  );

  return (
    <AppShell nav={staffNav} role="staff">
      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        expectedStaffCode={loggedInStaff?.staffId || ""}
        onVerified={handleFaceVerified}
      />

      {status === "success" && receipt ? (
        <SuccessPanel
          receipt={receipt}
          staffCode={receipt.staffCode || loggedInStaff?.staffId || "SCT-001"}
          staffName={receipt.staffName || loggedInStaff?.name}
          onReset={() => {
            setStatus("idle");
          }}
        />
      ) : (
        <>
          <PageHeader
            title="Mark Attendance"
            description="3-Factor Presence Verification: Wi-Fi Authorization + 19-Point GPS Polygon + ArcFace Biometric Recognition."
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void checkWifiConnection()}
                  disabled={isWifiChecking}
                  className="h-9 gap-1.5"
                >
                  <Wifi className={`size-3.5 ${isWifiChecking ? "animate-spin" : ""}`} />
                  Recheck Wi-Fi
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void geofence.refreshLocation()}
                  disabled={geofence.isChecking}
                  className="h-9 gap-1.5"
                >
                  <RefreshCw className={`size-3.5 ${geofence.isChecking ? "animate-spin" : ""}`} />
                  Refresh Location
                </Button>
                <div className="flex items-center gap-2">
                  <label htmlFor="scenario" className="text-xs text-muted-foreground">
                    Demo state
                  </label>
                  <Select
                    value={scenario}
                    onValueChange={(v) => {
                      setScenario(v as VerificationScenario);
                      setStatus("idle");
                    }}
                  >
                    <SelectTrigger id="scenario" className="w-44 bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(scenarioLabels).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            }
          />

          <div className="space-y-6">
            {/* Conditional Status Banners */}
            {!loggedInStaff && (
              <AlertBanner
                tone="error"
                icon={ShieldAlert}
                title="Staff Authentication Required"
              description="You are not currently logged in. Attendance marking requires an authenticated, registered staff account."
              action={
                <Button variant="outline" size="sm" asChild className="mt-2 h-8 gap-1.5">
                  <Link to="/">Sign In with Staff ID</Link>
                </Button>
              }
            />
          )}

          {/* One Faculty–One Registered Device Policy Banner */}
          {!isUsingMockScenario &&
            loggedInStaff &&
            !isDeviceChecking &&
            deviceStatus?.success === true &&
            deviceStatus.hasActiveDevice === false && (
            <AlertBanner
              tone="error"
              icon={Smartphone}
              title="Device Registration Required (Policy Enforcement)"
              description="One Faculty–One Registered Device policy requires binding your physical device before marking attendance. Hardware-backed keys protect your identity from proxy attendance."
              action={
                <Button
                  size="sm"
                  onClick={() => void handleRegisterDevice()}
                  disabled={isRegisteringDevice}
                  className="mt-2 h-8 gap-1.5"
                >
                  {isRegisteringDevice ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  Register This Device Now
                </Button>
              }
            />
          )}

          {!isUsingMockScenario && loggedInStaff && deviceStatus?.success === true && deviceStatus.hasActiveDevice === true && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              <span>
                <strong>Bound Device:</strong> {deviceStatus.device?.model} ({deviceStatus.device?.attestationStatus}) · Hardware-bound cryptographic attendance active
              </span>
            </div>
          )}

          {!isUsingMockScenario && (geofence.status === "location_services_off" || geofence.status === "position_unavailable") ? (
            <AlertBanner
              tone="error"
              icon={MapPin}
              title="Location services are OFF"
              description="Turn on Android Location and try again. Enable device location services in quick settings or Android Settings to acquire GPS coordinates."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void geofence.refreshLocation()}
                  className="mt-2 h-8 gap-1.5"
                >
                  <RefreshCw className="size-3.5" /> Retry Location
                </Button>
              }
            />
          ) : !isUsingMockScenario && geofence.status === "permission_prompt" ? (
            <AlertBanner
              tone="warning"
              icon={MapPin}
              title="Location permission required"
              description="Please allow location access to continue. Tap 'Allow' on the Chrome location permission prompt."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void geofence.refreshLocation()}
                  className="mt-2 h-8 gap-1.5"
                >
                  <Compass className="size-3.5" /> Request Location Access
                </Button>
              }
            />
          ) : !isUsingMockScenario && geofence.status === "permission_denied" ? (
            <AlertBanner
              tone="error"
              icon={ShieldAlert}
              title="Location permission denied"
              description="Enable location permission for Chrome and try again. Check Chrome Site Settings or Android Settings > Apps > Chrome > Permissions."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void geofence.refreshLocation()}
                  className="mt-2 h-8 gap-1.5"
                >
                  <RefreshCw className="size-3.5" /> Check Permission Again
                </Button>
              }
            />
          ) : !isUsingMockScenario && isWifiLoading && !wifiStatus ? (
            <AlertBanner
              tone="warning"
              icon={Wifi}
              title="Verifying Campus Wi-Fi…"
              description="Verifying connection against authorized campus Wi-Fi network containing 'sona'..."
            />
          ) : !wifiAuthorized ? (
            <AlertBanner
              tone="error"
              icon={Wifi}
              title="Attendance Blocked — Wi-Fi Not Authorized"
              description={
                wifiStatus?.reason
                  ? wifiStatus.reason
                  : "Device is not connected to an authorized campus Wi-Fi network. Connect to a Wi-Fi network containing 'sona' (e.g. SONA-WIFI) to satisfy Factor 1. (GPS & Face diagnostics remain accessible below)."
              }
              action={
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {(wifiStatus?.errorCode === "PERMISSION_DENIED" || wifiStatus?.errorCode === "SSID_UNAVAILABLE") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => requestWifiPermissions()}
                      className="h-8 gap-1.5"
                    >
                      <ShieldAlert className="size-3.5" /> Grant Wi-Fi Permissions
                    </Button>
                  )}
                  {wifiStatus?.errorCode === "LOCATION_SERVICES_DISABLED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openWifiLocationSettings()}
                      className="h-8 gap-1.5"
                    >
                      <AlertTriangle className="size-3.5" /> Turn On Location Services
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => void checkWifiConnection()}
                    disabled={isWifiChecking}
                    className="h-8 gap-1.5"
                  >
                    <RefreshCw className={`size-3.5 ${isWifiChecking ? "animate-spin" : ""}`} /> Check Connection Again
                  </Button>
                </div>
              }
            />
          ) : !isUsingMockScenario && geofence.status === "acquiring" ? (
            <AlertBanner
              tone="warning"
              icon={Timer}
              title="Waiting for Accurate GPS Location…"
              description={`Acquiring fresh high-accuracy GPS fix (${geofence.acquisitionTimer}s / ${geofence.maxAcquisitionSeconds}s). Move to open sky if possible.`}
            />
          ) : !isUsingMockScenario && (geofence.accuracy !== null && geofence.accuracy > 20 && geofence.status !== "inside") ? (
            <AlertBanner
              tone="warning"
              icon={AlertTriangle}
              title="Attendance Blocked — GPS Accuracy Insufficient"
              description={`Current GPS accuracy is ±${Math.round(geofence.accuracy || 0)}m (requires ≤20m precision). Instruction: Move to open sky / enable Precise Location.`}
            />
          ) : !gpsInsideGeofence ? (
            <AlertBanner
              tone="error"
              icon={ShieldAlert}
              title="Attendance Blocked — Outside Geofence Polygon"
              description="Your device GPS coordinates are outside the authoritative campus polygon boundary. You must be physically inside the designated perimeter."
            />
          ) : !faceAuthenticated ? (
            <AlertBanner
              tone="info"
              icon={ShieldCheck}
              title="Wi-Fi &amp; GPS Verified — Face Recognition Required"
              description="Wi-Fi and campus GPS polygon checks passed. Complete live face scan to satisfy Factor 3 and record attendance."
            />
          ) : (
            <AlertBanner
              tone="success"
              icon={ShieldCheck}
              title="All 3 Security Factors Verified (Wi-Fi + GPS + Face)"
              description="All three mandatory factors are satisfied. Attendance is ALLOWED and ready to record."
            />
          )}

          {/* Verification Cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {signals.map((s) => (
              <VerificationCard
                key={s.key}
                title={titles[s.key]}
                value={s.value}
                detail={s.detail}
                state={s.state}
                icon={icons[s.key]}
              />
            ))}
          </div>

          {/* Dedicated Institutional Wi-Fi Status & Diagnostic Card */}
          <WifiStatusCard
            status={wifiStatus}
            wifiAuthorized={wifiAuthorized}
            isLoading={isWifiLoading}
            isChecking={isWifiChecking}
            lastChecked={wifiLastChecked}
            onRecheck={checkWifiConnection}
            isMockScenario={isUsingMockScenario}
          />

          {/* Developer GPS Diagnostic Panel */}
          <GpsDiagnosticPanel geofence={geofence} />

          {/* Map and Mandatory Telemetry & Verification Grid */}
          <div className="grid gap-6 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              title="Authoritative Campus Geofence Boundary"
              description={
                geofence.isInside === true
                  ? "Real GPS fix: Inside authoritative campus polygon (C1 → C19 → C1)"
                  : geofence.isInside === false
                    ? "Real GPS fix: Outside authoritative campus polygon"
                    : geofence.status === "acquiring"
                      ? "Acquiring live GPS coordinates…"
                      : "GPS fix pending or insufficient accuracy"
              }
            >
              <div className="p-4">
                <GeofenceMap geofence={geofence} height="h-[360px]" />
              </div>
            </Section>

            <Section title="Attendance Decision Matrix">
              <div className="space-y-4 p-5">
                <dl className="space-y-2 text-xs">
                  {/* 1. RAW POSITION */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Compass className="size-3.5 text-primary" /> 1. Raw Position (W3C)
                    </dt>
                    <dd className="font-mono font-bold text-right text-foreground text-xs">
                      {geofence.rawCoords
                        ? `${geofence.rawCoords.lat.toFixed(6)}°, ${geofence.rawCoords.lng.toFixed(6)}°`
                        : geofence.coords
                          ? `${geofence.coords.lat.toFixed(6)}°, ${geofence.coords.lng.toFixed(6)}°`
                          : "—"}
                    </dd>
                  </div>

                  {/* 2. FILTERED POSITION (KALMAN) */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Sparkles className="size-3.5 text-primary" /> 2. Filtered Position (Kalman)
                    </dt>
                    <dd className="font-mono font-bold text-right text-primary text-xs">
                      {geofence.filteredCoords
                        ? `${geofence.filteredCoords.lat.toFixed(6)}°, ${geofence.filteredCoords.lng.toFixed(6)}°`
                        : "—"}
                    </dd>
                  </div>

                  {/* 3. RAW ACCURACY */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <MapPin className="size-3.5 text-primary" /> 3. Raw Accuracy
                    </dt>
                    <dd className="font-mono font-bold text-right">
                      {geofence.accuracy !== null ? (
                        <span
                          className={
                            geofence.accuracy < 10
                              ? "text-emerald-600 dark:text-emerald-400"
                              : geofence.accuracy <= 20
                                ? "text-blue-600 dark:text-blue-400"
                                : geofence.accuracy <= 50
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-red-600 dark:text-red-400"
                          }
                        >
                          ±{geofence.accuracy.toFixed(1)} m
                        </span>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>

                  {/* 5. KALMAN FILTER STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Activity className="size-3.5 text-primary" /> 5. Kalman Status
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          geofence.kalmanStatus === "SETTLED"
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-bold"
                            : geofence.kalmanStatus === "ACTIVE"
                              ? "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10 text-[10px] font-bold"
                              : "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] font-bold"
                        }
                      >
                        {geofence.kalmanStatus}
                      </Badge>
                    </dd>
                  </div>

                  {/* 6. GPS QUALITY */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Sparkles className="size-3.5 text-primary" /> 6. GPS Quality
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          geofence.gpsQuality === "EXCELLENT"
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-bold"
                            : geofence.gpsQuality === "GOOD"
                              ? "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10 text-[10px] font-bold"
                              : geofence.gpsQuality === "ACQUIRING / WAIT"
                                ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] font-bold"
                                : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-bold"
                        }
                      >
                        {geofence.gpsQuality}
                      </Badge>
                    </dd>
                  </div>

                  {/* 7. POSITION STABILITY */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Satellite className="size-3.5 text-primary" /> 7. Position Stability
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          geofence.positionStability === "STABLE"
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-bold"
                            : geofence.positionStability === "UNSTABLE"
                              ? "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-bold"
                              : "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10 text-[10px] font-bold"
                        }
                      >
                        {geofence.positionStability}
                      </Badge>
                    </dd>
                  </div>

                  {/* 8. GEOFENCE STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <ShieldCheck className="size-3.5 text-emerald-500" /> 8. Geofence Status
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          gpsInsideGeofence
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-semibold"
                            : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-semibold"
                        }
                      >
                        {gpsInsideGeofence
                          ? "INSIDE CAMPUS POLYGON"
                          : geofence.status === "location_services_off" || geofence.status === "position_unavailable"
                            ? "LOCATION SERVICES OFF"
                            : geofence.status === "permission_prompt"
                              ? "PERMISSION REQUIRED"
                              : geofence.status === "permission_denied"
                                ? "PERMISSION DENIED"
                                : geofence.status === "insufficient_accuracy" || (geofence.accuracy !== null && geofence.accuracy > 20)
                                  ? "BLOCKED (ACCURACY INSUFFICIENT)"
                                  : "OUTSIDE CAMPUS POLYGON"}
                      </Badge>
                    </dd>
                  </div>

                  {/* 9. WIFI STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <Wifi className="size-3.5 text-primary" /> 9. Wi-Fi Status
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          wifiAuthorized
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-semibold"
                            : wifiStatus?.state === "disconnected"
                              ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 text-[10px] font-semibold"
                              : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-semibold"
                        }
                      >
                        {wifiAuthorized
                          ? "AUTHORIZED"
                          : wifiStatus?.state === "disconnected"
                            ? "UNAVAILABLE"
                            : "UNAUTHORIZED"}
                      </Badge>
                    </dd>
                  </div>

                  {/* 10. FACE STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[10px]">
                      <ScanFace className="size-3.5 text-primary" /> 10. Face Status
                    </dt>
                    <dd className="text-right truncate">
                      {faceAuthenticated ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-semibold"
                        >
                          {faceResult?.staffCode || "PERSON_001"} (Dist: {faceResult?.distance?.toFixed(3)})
                        </Badge>
                      ) : faceResult ? (
                        <Badge
                          variant="outline"
                          className="border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-semibold"
                        >
                          UNKNOWN FACE
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Live Scan Required</span>
                      )}
                    </dd>
                  </div>

                  {/* 11. FINAL ATTENDANCE STATUS */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <dt className="flex items-center gap-1.5 font-bold text-foreground uppercase tracking-wider text-[11px]">
                      <ShieldCheck className="size-3.5 text-primary" /> Final Decision
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          finalAttendanceStatus.tone === "success"
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 font-bold text-[11px]"
                            : finalAttendanceStatus.tone === "warning"
                              ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/15 font-semibold text-[10px]"
                              : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/15 font-bold text-[11px]"
                        }
                      >
                        {finalAttendanceStatus.label}
                      </Badge>
                    </dd>
                  </div>
                </dl>

                {/* Face verification thumbnail & trigger */}
                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    {face ? (
                      <img
                        src={face}
                        alt="Live face capture used for verification"
                        className="size-12 rounded-lg object-cover border border-border"
                      />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <ScanFace className="size-5" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {faceResult && faceResult.verified
                          ? `✓ ${faceResult.staffName || "Staff"} (${faceResult.staffCode || "PERSON_001"})`
                          : faceResult
                            ? "✗ Unknown Face"
                            : "Live face scan required"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {faceResult && faceResult.distance !== undefined
                          ? `Match Distance: ${faceResult.distance.toFixed(4)} (≤ ${FACE_CONFIG.MATCH_THRESHOLD})`
                          : face
                            ? "Captured on this device"
                            : "Camera only — InsightFace ArcFace"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setScanOpen(true);
                      }}
                    >
                      {face ? "Rescan" : "Scan"}
                    </Button>
                  </div>
                </div>

                {/* Face verification debug telemetry */}
                {faceResult && (
                  <div>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => setShowDebug((d) => !d)}
                    >
                      <Eye className="size-3" /> {showDebug ? "Hide" : "Show"} biometric verification details
                    </button>
                    {showDebug && (
                      <div className="mt-1.5 space-y-1 rounded-lg bg-muted p-2 font-mono text-[10px]">
                        <p>Staff: {faceResult.staffId || "—"} · {faceResult.staffName || "—"}</p>
                        <p>
                          Distance: {faceResult.distance !== undefined ? faceResult.distance.toFixed(4) : "—"} (threshold: {FACE_CONFIG.MATCH_THRESHOLD})
                        </p>
                        <p>Audit ID: {faceResult.verification?.auditId || faceResult.auditId || "—"}</p>
                        <p>Token: {faceResult.verification?.attendanceToken || "—"}</p>
                        <p>PostgreSQL Match: {faceResult.verification?.matched ? "Yes" : "No"}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Submission CTA Button */}
                <Button
                  id="mark-attendance-btn"
                  size="lg"
                  className="w-full"
                  disabled={
                    status === "verifying" ||
                    isSubmittingRef.current ||
                    isWrongPerson ||
                    (!canMarkAttendance &&
                      geofence.status !== "location_services_off" &&
                      geofence.status !== "position_unavailable" &&
                      geofence.status !== "permission_prompt" &&
                      geofence.status !== "permission_denied" &&
                      !(wifiAuthorized && gpsInsideGeofence && !faceAuthenticated))
                  }
                  onClick={() => {
                    if (geofence.status === "location_services_off" || geofence.status === "position_unavailable") {
                      toast.error("Location services are OFF", {
                        description: "Turn on Android Location and try again.",
                      });
                      void geofence.refreshLocation();
                      return;
                    }
                    if (geofence.status === "permission_prompt") {
                      toast.info("Location permission required", {
                        description: "Please allow location access to continue.",
                      });
                      void geofence.refreshLocation();
                      return;
                    }
                    if (geofence.status === "permission_denied") {
                      toast.error("Location permission denied", {
                        description: "Enable location permission for Chrome and try again.",
                      });
                      void geofence.refreshLocation();
                      return;
                    }
                    if (isWrongPerson) {
                      toast.error("Identity Mismatch", {
                        description: `Recognized face does not match authenticated user (${loggedInStaff?.staffId || "Staff"}). Attendance rejected.`,
                      });
                      return;
                    }
                    if (!wifiAuthorized) {
                      toast.error("Wi-Fi Verification Blocked", {
                        description: "You must be connected to an authorized campus Wi-Fi network.",
                      });
                      return;
                    }
                    if (!gpsInsideGeofence) {
                      toast.error("Outside Geofence", {
                        description:
                          geofence.status === "insufficient_accuracy" || (geofence.accuracy !== null && geofence.accuracy > 20)
                            ? `GPS accuracy is insufficient (±${Math.round(geofence.accuracy || 0)}m). Move to open sky to achieve ≤20m precision.`
                            : "Your GPS coordinates must be inside the authoritative campus polygon.",
                      });
                      return;
                    }
                    if (!face || !faceAuthenticated) {
                      setScanOpen(true);
                    } else {
                      void run();
                    }
                  }}
                >
                  {status === "verifying" ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" /> Verifying and recording attendance…
                    </>
                  ) : isWrongPerson ? (
                    <>
                      <XCircle className="mr-2 size-5" /> Identity Mismatch — Attendance Blocked
                    </>
                  ) : geofence.status === "location_services_off" || geofence.status === "position_unavailable" ? (
                    <>
                      <AlertTriangle className="mr-2 size-5" /> Location Services OFF — Turn on Location
                    </>
                  ) : geofence.status === "permission_prompt" ? (
                    <>
                      <MapPin className="mr-2 size-5" /> Location Permission Required — Allow Access
                    </>
                  ) : geofence.status === "permission_denied" ? (
                    <>
                      <ShieldAlert className="mr-2 size-5" /> Location Permission Denied — Enable in Settings
                    </>
                  ) : !wifiAuthorized ? (
                    <>
                      <Wifi className="mr-2 size-5" /> Unauthorized Wi-Fi — Marking Blocked
                    </>
                  ) : !gpsInsideGeofence ? (
                    <>
                      <AlertTriangle className="mr-2 size-5" />
                      {geofence.status === "insufficient_accuracy" || (geofence.accuracy !== null && geofence.accuracy > 20)
                        ? "GPS Accuracy Insufficient — Blocked"
                        : "Outside Campus Polygon — Blocked"}
                    </>
                  ) : !faceAuthenticated ? (
                    <>
                      <ScanFace className="mr-2 size-5" /> Scan Face to Continue
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 size-5" /> Mark Attendance
                    </>
                  )}
                </Button>

                {!canMarkAttendance && (
                  <p className="text-center text-xs text-muted-foreground">
                    {!wifiAuthorized
                      ? "Device must be connected to authorized institutional Wi-Fi."
                      : !gpsInsideGeofence
                        ? geofence.status === "insufficient_accuracy" || (geofence.accuracy !== null && geofence.accuracy > 20)
                          ? "GPS accuracy ≤20m is required to authorize attendance."
                          : "Device must be inside the authoritative campus GPS polygon."
                        : "Face recognition is required to confirm your identity."}
                  </p>
                )}
              </div>
            </Section>
          </div>
        </div>
      </>
    )}
    </AppShell>
  );
}

function SuccessPanel({
  receipt,
  staffCode,
  staffName,
  onReset,
}: {
  receipt: AttendanceReceipt;
  staffCode?: string | undefined;
  staffName?: string | undefined;
  onReset: () => void;
}) {
  const displayFacultyId = receipt.staffCode || staffCode || "SCT-001";
  return (
    <div className="flex justify-center py-4 px-2 sm:px-4" id="attendance-success-screen">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-sm p-6 sm:p-8 flex flex-col items-center text-center">
        {/* Top green circular success icon */}
        <div className="grid size-20 place-items-center rounded-full bg-[#D4F4E2] text-[#0D6832]">
          <CheckCircle2 className="size-11" aria-hidden />
        </div>

        {/* Heading & Greeting */}
        <h2 className="mt-6 text-2xl font-bold tracking-tight text-foreground">
          Attendance Recorded
        </h2>
        <p className="mt-1 text-base font-medium text-foreground">
          Welcome, {displayFacultyId}
        </p>

        {/* Recorded Time & Date matching Screenshot 2 */}
        <p className="mt-2 text-4xl font-bold tabular-nums text-[#0D6832]">
          {receipt.time}
        </p>
        <p className="mt-1 text-sm text-muted-foreground font-normal">
          {receipt.date}
        </p>

        {/* Verification status rows */}
        <ul className="mt-8 w-full space-y-2.5 text-left">
          {[
            { icon: MapPin, label: "GPS Geofence polygon verified (Inside Campus)" },
            { icon: ScanFace, label: `Identity verified — ${displayFacultyId}` },
            { icon: Smartphone, label: "Device verified" },
            { icon: CheckCircle2, label: "Attendance successfully recorded" },
          ].map((item) => (
            <li
              key={item.label}
              className="flex items-center gap-3.5 rounded-xl border border-[#B9E9C9] bg-[#E8F8EE] px-4 py-3 text-xs sm:text-sm font-medium text-[#0D6832]"
            >
              <item.icon className="size-4 shrink-0 text-[#0D6832]" aria-hidden />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>

        {/* Attendance ID section */}
        <div
          className="mt-6 w-full rounded-xl bg-muted/60 border border-border/40 px-4 py-3 font-mono text-xs text-muted-foreground break-all text-center"
          id="attendance-record-id"
        >
          Attendance ID: {receipt.attendanceId}
        </div>

        {/* Navigation buttons matching Screenshot 2 */}
        <div className="mt-8 w-full flex flex-col gap-3">
          <Button
            asChild
            id="back-to-dashboard-btn"
            className="w-full h-12 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-medium text-base shadow-sm"
          >
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
          <Button
            variant="outline"
            onClick={onReset}
            id="view-verification-panel-btn"
            className="w-full h-12 rounded-xl bg-background hover:bg-muted text-foreground border border-border font-medium text-base shadow-sm"
          >
            View verification panel
          </Button>
        </div>
      </div>
    </div>
  );
}
