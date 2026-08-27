import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bluetooth,
  CheckCircle2,
  Eye,
  Fingerprint,
  Loader2,
  MapPin,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Wifi,
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

export const Route = createFileRoute("/mark-attendance")({
  head: () => ({
    meta: [
      { title: "Mark Attendance — CampusAttend" },
      {
        name: "description",
        content:
          "Verify campus GPS polygon geofence, institutional network, and biometric identity, then mark your college staff attendance.",
      },
      { property: "og:title", content: "Mark Attendance — CampusAttend" },
      { property: "og:description", content: "Authoritative GPS Polygon & Biometric Presence Verification." },
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

  // High-accuracy live GPS geofence tracker
  const geofence = useGeofence(true);

  // Determine real or mock location state
  const isUsingMockScenario = scenario !== "ready";
  const mockSnapshot = getSnapshot(scenario);

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
        value: "Inside Campus Polygon",
        detail: `Accuracy: ±${Math.round(geofence.accuracy || 0)}m · ${geofence.distanceToBoundary}m from boundary`,
        state: "verified",
      };
    }

    return {
      key: "location",
      value: "Outside Campus Geofence",
      detail: `${geofence.distanceToBoundary}m from authorized perimeter`,
      state: "error",
    };
  }, [isUsingMockScenario, mockSnapshot, geofence]);

  // Combined Location Authorization Check
  const isLocationAuthorized = isUsingMockScenario
    ? mockSnapshot.signals.find((s) => s.key === "location")?.state === "verified"
    : geofence.isInside === true;

  // Identity verification check
  const isIdentityAuthorized = Boolean(
    faceResult && (faceResult.distance === undefined || faceResult.distance <= FACE_CONFIG.MATCH_THRESHOLD),
  );

  // Both factors must be satisfied
  const canMarkAttendance = isLocationAuthorized && isIdentityAuthorized;

  // Signals Array
  const signals = useMemo((): VerificationSignal[] => {
    return [
      liveLocationSignal,
      {
        key: "wifi",
        value: "Campus Network",
        detail: "Authorized Wi-Fi · Connected",
        state: "verified",
      },
      {
        key: "bluetooth",
        value: "Campus Beacon",
        detail: "BLE-GATE-02 · Detected",
        state: "verified",
      },
      {
        key: "identity",
        value: isIdentityAuthorized
          ? `Verified · ${faceResult?.staffName || "Staff"}`
          : faceResult
            ? "Unknown Face"
            : "Live Face Scan",
        detail: isIdentityAuthorized && faceResult?.distance !== undefined
          ? `Match distance: ${faceResult.distance.toFixed(4)} (≤ ${FACE_CONFIG.MATCH_THRESHOLD})`
          : "Biometric match required",
        state: isIdentityAuthorized ? "verified" : faceResult ? "error" : "pending",
      },
    ];
  }, [liveLocationSignal, isIdentityAuthorized, faceResult]);

  const run = async () => {
    if (!isLocationAuthorized) {
      toast.error("Attendance Blocked", {
        description: "You must be inside the authorized campus GPS polygon to mark attendance.",
      });
      return;
    }

    if (!isIdentityAuthorized) {
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
          toast.success("Face Recognized", {
            description: `Identity confirmed: ${result.staffName || "Staff"} (${result.staffId || "Authorized"})`,
          });

          // Check if location is already inside before marking
          if (isLocationAuthorized) {
            setStatus("verifying");
            const attendanceReceipt = await markAttendance();
            setReceipt(attendanceReceipt);
            setStatus("success");
            toast.success(`Attendance Marked Successfully!`, {
              description: `${result.staffName || "Staff"} · ${attendanceReceipt.time} (${attendanceReceipt.attendanceId})`,
            });
          } else {
            toast.warning("Location Check Pending / Outside", {
              description: "Face verified, but GPS location must be inside the campus polygon to mark attendance.",
            });
          }
        }}
      />

      <PageHeader
        title="Mark Attendance"
        description="Presence requires both High-Precision GPS Geofence &amp; Biometric Identity Verification."
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
              <SelectTrigger id="scenario" className="w-56 bg-card">
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
          onReset={() => setStatus("idle")}
        />
      ) : (
        <div className="space-y-6">
          {/* Geofence & Identity Status Banner */}
          {!isLocationAuthorized ? (
            <AlertBanner
              tone="error"
              icon={ShieldAlert}
              title="Attendance Blocked — Outside Authorized Geofence"
              description="Your current device GPS position is outside the authorized campus polygon boundary. You must be physically present inside the designated campus area to mark attendance."
            />
          ) : !isIdentityAuthorized ? (
            <AlertBanner
              tone="info"
              icon={ShieldCheck}
              title="GPS Geofence Verified — Inside Campus"
              description="Your GPS location has been verified inside the authorized polygon. Complete the live face recognition scan to record attendance."
            />
          ) : (
            <AlertBanner
              tone="success"
              icon={ShieldCheck}
              title="Multi-Factor Verification Ready"
              description="Both your GPS geofence location and biometric identity are confirmed. Ready to submit attendance."
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

          {/* Map and Action Summary Grid */}
          <div className="grid gap-6 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              title="Campus Geofence Boundary"
              description={
                geofence.isInside === true
                  ? "Real GPS fix: Inside authorized attendance region"
                  : geofence.isInside === false
                    ? "Real GPS fix: Outside authorized boundary"
                    : "Acquiring live GPS coordinates…"
              }
            >
              <div className="p-4">
                <GeofenceMap geofence={geofence} height="h-[360px]" />
              </div>
            </Section>

            <Section title="Verification summary">
              <div className="space-y-4 p-5">
                <dl className="space-y-3 text-sm">
                  {[
                    ["Staff ID", faceResult ? faceResult.staffId : "—"],
                    ["Staff Name", faceResult ? faceResult.staffName : "Scan required"],
                    [
                      "GPS Status",
                      geofence.isInside === true
                        ? "Inside Geofence"
                        : geofence.isInside === false
                          ? "Outside Geofence"
                          : "Acquiring…",
                    ],
                    [
                      "GPS Accuracy",
                      geofence.accuracy ? `± ${geofence.accuracy.toFixed(1)} m` : "—",
                    ],
                    ["Current time (IST)", now ? formatIndiaTime(now) : "—"],
                    ["Date", now ? formatIndiaDate(now, false) : "—"],
                    ["Attendance window", "8:45 AM – 9:10 AM"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium text-right truncate">{v}</dd>
                    </div>
                  ))}
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
                        {faceResult
                          ? `✓ ${faceResult.staffName || "Staff"}`
                          : face
                            ? "Face matched"
                            : "Live face scan required"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {faceResult && faceResult.distance !== undefined
                          ? `Match Distance: ${faceResult.distance.toFixed(4)}`
                          : face
                            ? "Captured on this device"
                            : "Camera only — no photo uploads"}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                      {face ? "Rescan" : "Scan"}
                    </Button>
                  </div>
                </div>

                {/* Face verification debug info */}
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
                        <p>Distance: {faceResult.distance !== undefined ? faceResult.distance.toFixed(4) : "—"} (threshold: {FACE_CONFIG.MATCH_THRESHOLD})</p>
                        <p>Audit ID: {faceResult.verification?.auditId || faceResult.auditId || "—"}</p>
                        <p>Token: {faceResult.verification?.attendanceToken || "—"}</p>
                        <p>Server accepted: {faceResult.verification?.accepted ? "Yes" : "No"}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Submission CTA Button */}
                <Button
                  size="lg"
                  className="w-full"
                  disabled={!canMarkAttendance || status === "verifying"}
                  onClick={() => (face ? void run() : setScanOpen(true))}
                >
                  {status === "verifying" ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" /> Verifying presence…
                    </>
                  ) : !isLocationAuthorized ? (
                    <>
                      <AlertTriangle className="mr-2 size-5" /> Outside Geofence — Marking Blocked
                    </>
                  ) : !isIdentityAuthorized ? (
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
                    {!isLocationAuthorized
                      ? "Device must be inside the authorized GPS geofence."
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
