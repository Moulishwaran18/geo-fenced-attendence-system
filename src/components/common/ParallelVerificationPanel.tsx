import React from "react";
import {
  Wifi,
  MapPin,
  ScanFace,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ParallelVerificationReport,
  SingleFactorResult,
  FactorStatus,
} from "@/lib/parallel-verification";
import { REGISTERED_CAMPUS_BSSID } from "@/lib/wifi-config";

interface ParallelVerificationPanelProps {
  report: ParallelVerificationReport;
  isVerifying?: boolean;
  onRecheckWifi?: () => void;
  onRefreshGps?: () => void;
  onScanFace?: () => void;
  isWifiChecking?: boolean;
  isGpsChecking?: boolean;
  className?: string;
}

function getBadgeVariant(status: FactorStatus): {
  bg: string;
  text: string;
  border: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  switch (status) {
    case "PASS":
      return {
        bg: "bg-emerald-500/15 dark:bg-emerald-500/25",
        text: "text-emerald-700 dark:text-emerald-300 font-bold",
        border: "border-emerald-500/40",
        icon: CheckCircle2,
      };
    case "FAIL":
      return {
        bg: "bg-rose-500/15 dark:bg-rose-500/25",
        text: "text-rose-700 dark:text-rose-300 font-bold",
        border: "border-rose-500/40",
        icon: XCircle,
      };
    case "TIMEOUT":
    case "UNAVAILABLE":
      return {
        bg: "bg-amber-500/15 dark:bg-amber-500/25",
        text: "text-amber-800 dark:text-amber-300 font-semibold",
        border: "border-amber-500/40",
        icon: AlertTriangle,
      };
    case "PENDING":
    default:
      return {
        bg: "bg-muted",
        text: "text-muted-foreground font-medium",
        border: "border-border",
        icon: Clock,
      };
  }
}

export function ParallelVerificationPanel({
  report,
  isVerifying = false,
  onRecheckWifi,
  onRefreshGps,
  onScanFace,
  isWifiChecking = false,
  isGpsChecking = false,
  className,
}: ParallelVerificationPanelProps) {
  const { wifi, gps, face, overallDecision, failedFactors, passedFactors } = report;

  const wifiBadge = getBadgeVariant(wifi.status);
  const gpsBadge = getBadgeVariant(gps.status);
  const faceBadge = getBadgeVariant(face.status);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all",
        className,
      )}
      id="parallel-verification-panel"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-4" />
            </span>
            <h3 className="text-base font-bold tracking-tight text-foreground">
              3-Factor Parallel Verification Results
            </h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Independent execution architecture: Wi-Fi, GPS, and Face factors evaluate concurrently without sequential blocking.
          </p>
        </div>

        {/* Real-time Decision Pill */}
        <div className="shrink-0">
          {overallDecision === "ALLOWED" ? (
            <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" />
              <span>ALLOWED (All 3 Passed)</span>
            </div>
          ) : overallDecision === "REJECTED" ? (
            <div className="flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-700 dark:text-rose-300">
              <XCircle className="size-3.5" />
              <span>REJECTED (Missing Factors)</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              <Clock className="size-3.5" />
              <span>VERIFICATION PENDING</span>
            </div>
          )}
        </div>
      </div>

      {/* The 3 Factors Grid */}
      <div className="grid gap-3.5 sm:grid-cols-3">
        {/* Factor 1: Wi-Fi */}
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Wifi className="size-3.5 text-primary" />
                <span>1. Campus Wi-Fi</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  wifiBadge.bg,
                  wifiBadge.text,
                  wifiBadge.border,
                )}
              >
                <wifiBadge.icon className="size-3" />
                {wifi.label}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">{wifi.detail}</p>
              <div className="font-mono text-[10px] text-muted-foreground/90 space-y-0.5 pt-1">
                <p>Target BSSID: {REGISTERED_CAMPUS_BSSID}</p>
                <p>Connected: {wifi.data?.bssid || "Unavailable"}</p>
                {wifi.data?.ssid && <p>SSID: {wifi.data.ssid}</p>}
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-border/40">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRecheckWifi}
              disabled={isWifiChecking}
              className="w-full h-7 text-xs gap-1.5 justify-center hover:bg-muted"
            >
              <RefreshCw className={cn("size-3", isWifiChecking && "animate-spin")} />
              {isWifiChecking ? "Checking..." : "Recheck Wi-Fi"}
            </Button>
          </div>
        </div>

        {/* Factor 2: GPS Geofence */}
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="size-3.5 text-primary" />
                <span>2. GPS Geofence</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  gpsBadge.bg,
                  gpsBadge.text,
                  gpsBadge.border,
                )}
              >
                <gpsBadge.icon className="size-3" />
                {gps.label}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">{gps.detail}</p>
              <div className="font-mono text-[10px] text-muted-foreground/90 space-y-0.5 pt-1">
                <p>
                  Coords:{" "}
                  {gps.data?.lat && gps.data?.lng
                    ? `${gps.data.lat.toFixed(5)}°, ${gps.data.lng.toFixed(5)}°`
                    : "Acquiring..."}
                </p>
                <p>
                  Accuracy: {gps.data?.accuracy ? `±${Math.round(gps.data.accuracy)}m (≤20m req)` : "—"}
                </p>
                <p>Containment: {gps.data?.isInside ? "Inside Polygon" : "Outside Polygon"}</p>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-border/40">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshGps}
              disabled={isGpsChecking}
              className="w-full h-7 text-xs gap-1.5 justify-center hover:bg-muted"
            >
              <RefreshCw className={cn("size-3", isGpsChecking && "animate-spin")} />
              {isGpsChecking ? "Acquiring..." : "Refresh Location"}
            </Button>
          </div>
        </div>

        {/* Factor 3: Face Biometrics */}
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <ScanFace className="size-3.5 text-primary" />
                <span>3. Face Recognition</span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  faceBadge.bg,
                  faceBadge.text,
                  faceBadge.border,
                )}
              >
                <faceBadge.icon className="size-3" />
                {face.label}
              </span>
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">{face.detail}</p>
              <div className="font-mono text-[10px] text-muted-foreground/90 space-y-0.5 pt-1">
                <p>
                  Distance:{" "}
                  {face.data?.distance !== undefined
                    ? `${face.data.distance.toFixed(4)} (≤0.45)`
                    : "Not evaluated"}
                </p>
                <p>
                  Liveness:{" "}
                  {face.data?.livenessCompleted ? "Passed (Active Challenge)" : "Pending"}
                </p>
                {face.data?.staffCode && <p>Staff: {face.data.staffCode}</p>}
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={onScanFace}
              className="w-full h-7 text-xs gap-1.5 justify-center font-semibold text-primary border-primary/30 hover:bg-primary/5"
            >
              <ScanFace className="size-3" />
              {face.status === "PASS" ? "Rescan Face" : "Scan Face Now"}
            </Button>
          </div>
        </div>
      </div>

      {/* Decision Summary Footer */}
      <div
        className={cn(
          "mt-4 rounded-xl border p-3.5 text-xs transition-colors",
          overallDecision === "ALLOWED"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
            : overallDecision === "REJECTED"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-200"
              : "border-border/70 bg-muted/50 text-muted-foreground",
        )}
      >
        <div className="flex items-start gap-2.5">
          {overallDecision === "ALLOWED" ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          ) : overallDecision === "REJECTED" ? (
            <ShieldAlert className="size-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          ) : (
            <Clock className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          )}

          <div className="flex-1 space-y-1">
            <p className="font-semibold text-foreground">
              {overallDecision === "ALLOWED"
                ? "Attendance Authorization Granted"
                : overallDecision === "REJECTED"
                  ? "Attendance Authorization Rejected"
                  : "Attendance Authorization Pending"}
            </p>
            <p className="leading-relaxed">
              {overallDecision === "ALLOWED"
                ? "All 3 independent verification factors have passed (Wi-Fi AP B0:1F:8C:29:6B:30 + GPS Geofence Polygon + Face Biometrics). Attendance can now be recorded."
                : overallDecision === "REJECTED"
                  ? `Attendance requires all 3 factors to pass. Currently missing: ${failedFactors.join(", ")}. (${passedFactors.length > 0 ? `Passed: ${passedFactors.join(", ")}` : "No factors passed yet"}).`
                  : "Please initiate verification or complete missing checks to evaluate attendance eligibility."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

