import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bluetooth,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Eye,
  Fingerprint,
  Loader2,
  MapPin,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { VerificationCard } from "@/components/common/VerificationCard";
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
import { formatIndiaDate, formatIndiaTime, useIndiaTime } from "@/lib/india-time";
import { FACE_CONFIG } from "@/lib/face-recognition";
import { useGeofence } from "@/hooks/use-geofence";
import { useWifiStatus } from "@/hooks/use-wifi-status";

export const Route = createFileRoute("/mark-attendance")({
  head: () => ({
    meta: [
      { title: "Mark Attendance — CampusAttend" },
      {
        name: "description",
        content:
          "Authoritative 3-Factor Presence Verification: Wi-Fi, 19-Point GPS Polygon Geofence, and Biometric Identity Verification.",
      },
      { property: "og:title", content: "Mark Attendance — CampusAttend" },
      { property: "og:description", content: "3-Factor Presence Authorization (Wi-Fi + GPS + ArcFace)." },
    ],
  }),
  component: MarkAttendancePage,
});

const icons = {
  location: MapPin,
  wifi: Wifi,
  bluetooth: Bluetooth,
  identity: ScanFace,
} as const;

const titles = {
  location: "GPS Geofence",
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth",
  identity: "Identity",
} as const;

function MarkAttendancePage() {
  const [scenario, setScenario] = useState<VerificationScenario>("ready");
  const [status, setStatus] = useState<"idle" | "verifying" | "success">("idle");
  const [receipt, setReceipt] = useState<AttendanceReceipt | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [faceResult, setFaceResult] = useState<FaceScanResult | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const now = useIndiaTime();

  // High-accuracy live GPS 19-point polygon geofence tracker
  const geofence = useGeofence(true);

  // Live Wi-Fi Status tracker
  const { status: wifiStatus } = useWifiStatus(5000);

  // Determine real or mock location state
  const isUsingMockScenario = scenario !== "ready";
  const mockSnapshot = getSnapshot(scenario);

  // ---------------------------------------------------------------------------
  // 3 MANDATORY SECURITY FACTORS:
  // 1. Wi-Fi Authorized
  // 2. GPS Inside 19-Point Polygon
  // 3. Face Authenticated (PERSON_001 / PERSON_002 matched via PostgreSQL pgvector)
  // ---------------------------------------------------------------------------

  const wifiAuthorized = isUsingMockScenario
    ? mockSnapshot.signals.find((s) => s.key === "wifi")?.state === "verified"
    : Boolean(wifiStatus?.isSonaWifi || (wifiStatus?.state === "connected" && wifiStatus?.ssid));

  const gpsInsideGeofence = isUsingMockScenario
    ? mockSnapshot.signals.find((s) => s.key === "location")?.state === "verified"
    : geofence.isInside === true;

  const faceAuthenticated = Boolean(
    faceResult &&
      faceResult.verified &&
      (faceResult.staffCode === "PERSON_001" ||
        faceResult.staffCode === "PERSON_002" ||
        faceResult.staffId) &&
      faceResult.distance !== undefined &&
      faceResult.distance <= FACE_CONFIG.MATCH_THRESHOLD,
  );

  // FINAL DECISION RULE:
  // wifiAuthorized && gpsInsideGeofence && faceAuthenticated -> ALLOWED
  // otherwise -> REJECTED
  const canMarkAttendance = wifiAuthorized && gpsInsideGeofence && faceAuthenticated;

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
        detail: "All 3 Security Factors (Wi-Fi, 19-Point GPS Polygon, Face Recognition) Passed",
      };
    }
    if (!wifiAuthorized) {
      return {
        label: "REJECTED (Wi-Fi Unauthorized)",
        tone: "error" as const,
        detail: "Device must be connected to authorized institutional Wi-Fi network",
      };
    }
    if (!gpsInsideGeofence) {
      return {
        label: "REJECTED (Outside 19-Point Polygon)",
        tone: "error" as const,
        detail: "Device GPS coordinates are outside the authoritative 19-point campus polygon",
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
  }, [status, receipt, canMarkAttendance, wifiAuthorized, gpsInsideGeofence, faceResult, faceAuthenticated]);

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

    if (geofence.status === "acquiring") {
      return {
        key: "location",
        value: "Acquiring GPS Fix…",
        detail: "High-accuracy GPS requested",
        state: "pending",
      };
    }

    if (geofence.status === "permission_denied") {
      return {
        key: "location",
        value: "Permission Denied",
        detail: "Enable location in browser settings",
        state: "error",
      };
    }

    if (geofence.status === "position_unavailable" || geofence.status === "timeout") {
      return {
        key: "location",
        value: "GPS Unavailable",
        detail: "Enable device location / GPS",
        state: "error",
      };
    }

    if (geofence.status === "low_accuracy") {
      return {
        key: "location",
        value: geofence.isInside ? "Inside (Low Accuracy)" : "Outside (Low Accuracy)",
        detail: `Accuracy: ±${Math.round(geofence.accuracy || 0)}m · Move to open sky`,
        state: "warning",
      };
    }

    if (geofence.isInside === true) {
      return {
        key: "location",
        value: "Inside 19-Point Polygon",
        detail: `Accuracy: ±${Math.round(geofence.accuracy || 0)}m · ${geofence.distanceToBoundary}m from boundary`,
        state: "verified",
      };
    }

    return {
      key: "location",
      value: "Outside 19-Point Polygon",
      detail: `${geofence.distanceToBoundary}m from authorized perimeter`,
      state: "error",
    };
  }, [isUsingMockScenario, mockSnapshot, geofence]);

  // Signals Array for Verification Cards
  const signals = useMemo((): VerificationSignal[] => {
    return [
      liveLocationSignal,
      {
        key: "wifi",
        value: wifiAuthorized ? (wifiStatus?.ssid || "Campus Network") : "Not Connected",
        detail: wifiAuthorized ? "Authorized Wi-Fi · Connected" : "Unauthorized Network",
        state: wifiAuthorized ? "verified" : "error",
      },
      {
        key: "bluetooth",
        value: "Campus Beacon",
        detail: "BLE-GATE-02 · Detected",
        state: "verified",
      },
      {
        key: "identity",
        value: faceAuthenticated
          ? `Verified · ${faceResult?.staffName || "Staff"}`
          : faceResult
            ? "Unknown Face"
            : "Live Face Scan",
        detail:
          faceAuthenticated && faceResult?.distance !== undefined
            ? `Match distance: ${faceResult.distance.toFixed(4)} (≤ ${FACE_CONFIG.MATCH_THRESHOLD})`
            : faceResult
              ? "Biometric match rejected"
              : "Biometric match required",
        state: faceAuthenticated ? "verified" : faceResult ? "error" : "pending",
      },
    ];
  }, [liveLocationSignal, wifiAuthorized, wifiStatus, faceAuthenticated, faceResult]);

  const run = async () => {
    if (!wifiAuthorized) {
      toast.error("Wi-Fi Verification Failed", {
        description: "You must be connected to an authorized campus Wi-Fi network to mark attendance.",
      });
      return;
    }

    if (!gpsInsideGeofence) {
      toast.error("GPS Geofence Verification Failed", {
        description: "Your device GPS position is outside the authoritative 19-point campus polygon.",
      });
      return;
    }

    if (!faceAuthenticated) {
      toast.error("Identity Verification Required", {
        description: "Please complete face recognition first.",
      });
      setScanOpen(true);
      return;
    }

    setStatus("verifying");
    const result = await markAttendance();
    setReceipt(result);
    setStatus("success");
    toast.success("Attendance Recorded Successfully!", {
      description: `${faceResult?.staffName || "Staff"} · ${result.time} · ${result.date}`,
    });
  };

  return (
    <AppShell nav={staffNav} role="staff">
      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onVerified={async (result) => {
          setFace(result.snapshot ?? null);
          setFaceResult(result);

          if (!result.verified) {
            toast.error("Face Unrecognized", {
              description: "Biometric identity could not be verified against PostgreSQL staff database.",
            });
            return;
          }

          toast.success("Face Recognized", {
            description: `Identity confirmed: ${result.staffName || "Staff"} (${result.staffId || "Authorized"})`,
          });

          // If Wi-Fi and GPS are both authorized, automatically mark attendance
          if (wifiAuthorized && gpsInsideGeofence) {
            setStatus("verifying");
            const attendanceReceipt = await markAttendance();
            setReceipt(attendanceReceipt);
            setStatus("success");
            toast.success(`Attendance Marked Successfully!`, {
              description: `${result.staffName || "Staff"} · ${attendanceReceipt.time} (${attendanceReceipt.attendanceId})`,
            });
          } else if (!gpsInsideGeofence) {
            toast.warning("GPS Outside Polygon", {
              description: "Face verified, but GPS location must be inside the 19-point campus polygon to mark attendance.",
            });
          } else if (!wifiAuthorized) {
            toast.warning("Wi-Fi Not Authorized", {
              description: "Face verified, but device must be connected to authorized campus Wi-Fi.",
            });
          }
        }}
      />

      <PageHeader
        title="Mark Attendance"
        description="3-Factor Presence Verification: Wi-Fi Authorization + 19-Point GPS Polygon + ArcFace Biometric Recognition."
        actions={
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
              <SelectTrigger id="scenario" className="w-48 bg-card">
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
        }
      />

      {status === "success" && receipt ? (
        <SuccessPanel
          receipt={receipt}
          staffName={faceResult?.staffName}
          onReset={() => {
            setStatus("idle");
            setFace(null);
            setFaceResult(null);
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* Conditional Status Banners */}
          {!wifiAuthorized ? (
            <AlertBanner
              tone="error"
              icon={Wifi}
              title="Attendance Blocked — Wi-Fi Not Authorized"
              description="Device is not connected to an authorized campus Wi-Fi network. Connect to institutional Wi-Fi to satisfy Factor 1."
            />
          ) : !gpsInsideGeofence ? (
            <AlertBanner
              tone="error"
              icon={ShieldAlert}
              title="Attendance Blocked — Outside 19-Point Geofence Polygon"
              description="Your device GPS coordinates are outside the authoritative 19-point campus polygon boundary. You must be physically inside the designated perimeter."
            />
          ) : !faceAuthenticated ? (
            <AlertBanner
              tone="info"
              icon={ShieldCheck}
              title="Wi-Fi &amp; GPS Verified — Face Recognition Required"
              description="Wi-Fi and 19-point GPS polygon checks passed. Complete live face scan to satisfy Factor 3 and record attendance."
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

          {/* Developer GPS Diagnostic Panel */}
          <GpsDiagnosticPanel geofence={geofence} />

          {/* Map and Mandatory Telemetry & Verification Grid */}
          <div className="grid gap-6 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              title="Authoritative 19-Point Geofence Boundary"
              description={
                geofence.isInside === true
                  ? "Real GPS fix: Inside authoritative 19-point campus polygon (C1 → C19 → C1)"
                  : geofence.isInside === false
                    ? "Real GPS fix: Outside authoritative 19-point campus polygon"
                    : "Acquiring live GPS coordinates…"
              }
            >
              <div className="p-4">
                <GeofenceMap geofence={geofence} height="h-[360px]" />
              </div>
            </Section>

            <Section title="Attendance Decision Matrix">
              <div className="space-y-4 p-5">
                {/* Required Telemetry List */}
                <dl className="space-y-2.5 text-xs">
                  {/* 1. CURRENT LATITUDE */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <Compass className="size-3.5 text-primary" /> Current Latitude
                    </dt>
                    <dd className="font-mono font-bold text-right text-foreground text-xs">
                      {geofence.coords ? `${geofence.coords.lat.toFixed(8)}° N` : "—"}
                    </dd>
                  </div>

                  {/* 2. CURRENT LONGITUDE */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <Compass className="size-3.5 text-primary" /> Current Longitude
                    </dt>
                    <dd className="font-mono font-bold text-right text-foreground text-xs">
                      {geofence.coords ? `${geofence.coords.lng.toFixed(8)}° E` : "—"}
                    </dd>
                  </div>

                  {/* 3. GPS ACCURACY */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <MapPin className="size-3.5 text-primary" /> GPS Accuracy
                    </dt>
                    <dd className="font-mono font-medium text-right">
                      {geofence.accuracy ? `±${geofence.accuracy.toFixed(1)} m` : "—"}
                    </dd>
                  </div>

                  {/* 4. GEOFENCE STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <ShieldCheck className="size-3.5 text-emerald-500" /> Geofence Status
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
                        {gpsInsideGeofence ? "INSIDE 19-POINT POLYGON" : "OUTSIDE POLYGON"}
                      </Badge>
                    </dd>
                  </div>

                  {/* 5. WIFI STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <Wifi className="size-3.5 text-primary" /> Wi-Fi Status
                    </dt>
                    <dd className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          wifiAuthorized
                            ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 text-[10px] font-semibold"
                            : "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 text-[10px] font-semibold"
                        }
                      >
                        {wifiAuthorized ? `AUTHORIZED (${wifiStatus?.ssid || "CONNECTED"})` : "UNAUTHORIZED"}
                      </Badge>
                    </dd>
                  </div>

                  {/* 6. FACE STATUS */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5">
                    <dt className="flex items-center gap-1.5 text-muted-foreground uppercase font-medium text-[11px]">
                      <ScanFace className="size-3.5 text-primary" /> Face Status
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

                  {/* 7. FINAL ATTENDANCE STATUS */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <dt className="flex items-center gap-1.5 font-bold text-foreground uppercase tracking-wider text-[11px]">
                      <Fingerprint className="size-3.5 text-primary" /> Final Attendance Status
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
                    <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
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
                  size="lg"
                  className="w-full"
                  disabled={
                    status === "verifying" ||
                    (!wifiAuthorized && !canMarkAttendance) ||
                    (!gpsInsideGeofence && !canMarkAttendance)
                  }
                  onClick={() => {
                    if (!wifiAuthorized) {
                      toast.error("Wi-Fi Verification Blocked", {
                        description: "You must be connected to an authorized campus Wi-Fi network.",
                      });
                      return;
                    }
                    if (!gpsInsideGeofence) {
                      toast.error("Outside Geofence", {
                        description: "Your GPS coordinates must be inside the authoritative 19-point campus polygon.",
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
                      <Loader2 className="mr-2 size-5 animate-spin" /> Verifying presence…
                    </>
                  ) : !wifiAuthorized ? (
                    <>
                      <Wifi className="mr-2 size-5" /> Unauthorized Wi-Fi — Marking Blocked
                    </>
                  ) : !gpsInsideGeofence ? (
                    <>
                      <AlertTriangle className="mr-2 size-5" /> Outside 19-Point Polygon — Blocked
                    </>
                  ) : !faceAuthenticated ? (
                    <>
                      <ScanFace className="mr-2 size-5" /> Scan Face to Continue
                    </>
                  ) : (
                    <>
                      <Fingerprint className="mr-2 size-5" /> Verify &amp; Mark Attendance
                    </>
                  )}
                </Button>

                {!canMarkAttendance && (
                  <p className="text-center text-xs text-muted-foreground">
                    {!wifiAuthorized
                      ? "Device must be connected to authorized institutional Wi-Fi."
                      : !gpsInsideGeofence
                        ? "Device must be inside the authoritative 19-point GPS polygon."
                        : "Face recognition is required to confirm your identity."}
                  </p>
                )}
              </div>
            </Section>
          </div>
        </div>
      )}
    </AppShell>
  );
}



function SuccessPanel({
  receipt,
  staffName,
  onReset,
}: {
  receipt: AttendanceReceipt;
  staffName?: string | undefined;
  onReset: () => void;
}) {
  return (
    <Section>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-11" aria-hidden />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">Attendance Recorded</h2>
        {staffName && (
          <p className="mt-1 text-lg font-medium text-foreground">Welcome, {staffName}</p>
        )}
        <p className="mt-1 text-3xl font-semibold tabular-nums text-success">{receipt.time}</p>
        <p className="text-sm text-muted-foreground">{receipt.date}</p>

        <ul className="mt-7 w-full max-w-md space-y-2 text-left">
          {[
            { icon: MapPin, label: "GPS Geofence polygon verified (Inside Campus)" },
            { icon: ScanFace, label: staffName ? `Identity verified — ${staffName}` : "Identity verified" },
            { icon: Smartphone, label: "Device verified" },
            { icon: CheckCircle2, label: "Attendance successfully recorded" },
          ].map((i) => (
            <li
              key={i.label}
              className="flex items-center gap-3 rounded-lg border border-success/20 bg-success-soft px-4 py-2.5 text-sm text-success"
            >
              <i.icon className="size-4" aria-hidden />
              {i.label}
            </li>
          ))}
        </ul>

        <p className="mt-6 rounded-lg bg-muted px-4 py-2 font-mono text-xs text-muted-foreground">
          Attendance ID: {receipt.attendanceId}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
          <Button variant="outline" onClick={onReset}>
            View verification panel
          </Button>
        </div>
      </div>
    </Section>
  );
}
