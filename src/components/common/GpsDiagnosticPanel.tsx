import { useState } from "react";
import {
  Compass,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Radio,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Activity,
  Timer,
  Satellite,
  SignalHigh,
  SignalMedium,
  SignalLow,
  SignalZero,
  Smartphone,
  Info,
  Check,
  Database,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  type UseGeofenceResult,
  type GpsQuality,
  type PositionStability,
  type GpsReading,
} from "@/hooks/use-geofence";
import { AUTHORIZED_GEOFENCE_POLYGON } from "@/lib/geofence/geofence-service";
import { formatIndiaTime } from "@/lib/india-time";

interface GpsDiagnosticPanelProps {
  geofence: UseGeofenceResult;
  className?: string;
}

export function GpsDiagnosticPanel({ geofence, className = "" }: GpsDiagnosticPanelProps) {
  const [showCoords, setShowCoords] = useState(false);
  const [showReadingsLog, setShowReadingsLog] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(true);

  const {
    coords,
    evaluation,
    isInside,
    isInsidePolygon,
    isAcceptableAccuracy,
    status,
    statusMessage,
    instructionMessage,
    accuracy,
    bestAccuracy,
    gpsQuality,
    positionStability,
    readingsCollected,
    readingsHistory,
    acquisitionTimer,
    maxAcquisitionSeconds,
    isStable,
    consecutiveGoodCount,
    isChecking,
    refreshLocation,
    lastUpdated,
  } = geofence;

  const getStatusBadge = () => {
    switch (status) {
      case "inside":
        return {
          label: "INSIDE AUTHORIZED GEOFENCE (READY)",
          color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
          dot: "bg-emerald-500",
        };
      case "outside":
        return {
          label: "OUTSIDE AUTHORIZED GEOFENCE",
          color: "bg-destructive/15 text-destructive border-destructive/30",
          dot: "bg-destructive",
        };
      case "acquiring":
        return {
          label: `ACQUIRING GPS FIX (${acquisitionTimer}s / ${maxAcquisitionSeconds}s)`,
          color: "bg-primary/15 text-primary border-primary/30",
          dot: "bg-primary animate-ping",
        };
      case "insufficient_accuracy":
      case "low_accuracy":
        return {
          label: "GPS ACCURACY INSUFFICIENT",
          color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
          dot: "bg-amber-500",
        };
      case "permission_denied":
        return {
          label: "PERMISSION DENIED",
          color: "bg-destructive/15 text-destructive border-destructive/30",
          dot: "bg-destructive",
        };
      case "position_unavailable":
      case "timeout":
        return {
          label: status === "timeout" ? "GPS TIMED OUT" : "GPS UNAVAILABLE",
          color: "bg-destructive/15 text-destructive border-destructive/30",
          dot: "bg-destructive",
        };
      default:
        return {
          label: "INITIALIZING GPS",
          color: "bg-muted text-muted-foreground border-border",
          dot: "bg-muted-foreground",
        };
    }
  };

  const getQualityBadge = (quality: GpsQuality) => {
    switch (quality) {
      case "EXCELLENT":
        return {
          icon: SignalHigh,
          label: "EXCELLENT (≤ 10 m)",
          color: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        };
      case "GOOD":
        return {
          icon: SignalMedium,
          label: "GOOD (≤ 20 m)",
          color: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10",
        };
      case "ACQUIRING / WAIT":
        return {
          icon: SignalLow,
          label: "ACQUIRING / WAIT (≤ 50 m)",
          color: "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
        };
      case "UNRELIABLE":
        return {
          icon: SignalZero,
          label: "UNRELIABLE (> 50 m)",
          color: "border-destructive/40 text-destructive bg-destructive/10",
        };
      default:
        return {
          icon: Activity,
          label: "UNKNOWN",
          color: "border-border text-muted-foreground bg-muted/40",
        };
    }
  };

  const getStabilityBadge = (stab: PositionStability) => {
    switch (stab) {
      case "STABLE":
        return {
          label: "STABLE (≤ 15 m displacement)",
          color: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        };
      case "UNSTABLE":
        return {
          label: "UNSTABLE (> 15 m jitter)",
          color: "border-destructive/40 text-destructive bg-destructive/10",
        };
      case "MEASURING":
      default:
        return {
          label: `MEASURING (${consecutiveGoodCount}/2 good samples)`,
          color: "border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10",
        };
    }
  };

  const badge = getStatusBadge();
  const qualityBadge = getQualityBadge(gpsQuality);
  const stabilityBadge = getStabilityBadge(positionStability);
  const isPoorAccuracy = accuracy !== null && accuracy > 20;
  const isInsuff = status === "insufficient_accuracy" || status === "low_accuracy";

  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Compass className="size-4" />
          </span>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Live GPS Telemetry &amp; 5-Point Polygon Verification
            </h3>
            <p className="text-[11px] text-muted-foreground">
              15s fresh watchPosition window · Quality &amp; Stability filter · Strict 5-point polygon check
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${badge.color}`}
          >
            <span className={`size-1.5 rounded-full ${badge.dot}`} />
            {badge.label}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshLocation()}
            disabled={isChecking}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isChecking ? "animate-spin" : ""}`} />
            Refresh Location
          </Button>
        </div>
      </div>

      {/* Poor Accuracy & Acquisition Guidance Alert Banner */}
      {(isChecking || isInsuff || isPoorAccuracy || status === "timeout") && (
        <div className="flex items-start gap-2.5 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 space-y-0.5">
            <p className="font-semibold">
              {status === "acquiring"
                ? "Waiting for accurate GPS location..."
                : isInsuff
                  ? `GPS accuracy insufficient — Current accuracy: ±${accuracy ? accuracy.toFixed(1) : "—"} m`
                  : statusMessage}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400/90">
              {instructionMessage || "Move to open sky / enable Precise Location"}
            </p>
          </div>
          {isChecking && (
            <div className="flex items-center gap-1 text-[11px] font-mono text-amber-700 dark:text-amber-300">
              <Timer className="size-3.5 animate-spin" />
              {acquisitionTimer}s / {maxAcquisitionSeconds}s
            </div>
          )}
        </div>
      )}

      {/* 8 Primary Required Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border text-xs">
        {/* 1. GPS STATUS */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            1. GPS Status
          </div>
          <div className="mt-1 font-semibold text-xs truncate capitalize text-foreground">
            {status.replace(/_/g, " ")}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {isChecking ? "Collecting fresh fixes…" : "Acquisition settled"}
          </div>
        </div>

        {/* 2. CURRENT ACCURACY */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            2. Current Accuracy
          </div>
          <div className="mt-1 font-mono font-bold text-xs">
            {accuracy !== null ? (
              <span
                className={
                  accuracy <= 10
                    ? "text-emerald-600 dark:text-emerald-400"
                    : accuracy <= 20
                      ? "text-blue-600 dark:text-blue-400"
                      : accuracy <= 50
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                }
              >
                ±{accuracy.toFixed(1)} m
              </span>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">Reported by device GNSS</div>
        </div>

        {/* 3. BEST ACCURACY */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            3. Best Accuracy
          </div>
          <div className="mt-1 font-mono font-bold text-xs">
            {bestAccuracy !== null ? (
              <span
                className={
                  bestAccuracy <= 10
                    ? "text-emerald-600 dark:text-emerald-400"
                    : bestAccuracy <= 20
                      ? "text-blue-600 dark:text-blue-400"
                      : bestAccuracy <= 50
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                }
              >
                ±{bestAccuracy.toFixed(1)} m
              </span>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">Smallest real reported fix</div>
        </div>

        {/* 4. READINGS COLLECTED */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            4. Readings Collected
          </div>
          <div className="mt-1 font-mono font-bold text-xs text-foreground flex items-center gap-1.5">
            <Satellite className="size-3.5 text-primary" />
            {readingsCollected} reading{readingsCollected !== 1 ? "s" : ""}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Good fixes (≤20m): {consecutiveGoodCount}/2 req.
          </div>
        </div>

        {/* 5. ACQUISITION TIMER */}
        <div className="p-3 border-t">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            5. Acquisition Timer
          </div>
          <div className="mt-1 font-mono font-bold text-xs text-foreground flex items-center gap-1.5">
            <Timer className="size-3.5 text-primary" />
            {acquisitionTimer}s / {maxAcquisitionSeconds}s
          </div>
          <div className="text-[10px] text-muted-foreground">
            {isChecking ? "Live watchPosition active" : "Window completed"}
          </div>
        </div>

        {/* 6. GPS QUALITY */}
        <div className="p-3 border-t">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            6. GPS Quality
          </div>
          <div className="mt-1">
            <Badge variant="outline" className={`text-[10px] font-bold px-1.5 py-0 ${qualityBadge.color}`}>
              {gpsQuality}
            </Badge>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {gpsQuality === "EXCELLENT"
              ? "≤10m Preferred Fix"
              : gpsQuality === "GOOD"
                ? "≤20m Acceptable Fix"
                : gpsQuality === "ACQUIRING / WAIT"
                  ? "≤50m Acquiring GNSS"
                  : "Unreliable (>50m)"}
          </div>
        </div>

        {/* 7. POSITION STABILITY */}
        <div className="p-3 border-t">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            7. Position Stability
          </div>
          <div className="mt-1">
            <Badge variant="outline" className={`text-[10px] font-bold px-1.5 py-0 ${stabilityBadge.color}`}>
              {positionStability}
            </Badge>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {isStable ? "Displacement ≤15m (Stable)" : "Awaiting ≥2 consecutive fixes"}
          </div>
        </div>

        {/* 8. GEOFENCE STATUS (5-PT POLYGON) */}
        <div className="p-3 border-t">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            8. Geofence Status
          </div>
          <div className="mt-1 font-semibold text-xs flex items-center gap-1.5">
            {isInside === true ? (
              <>
                <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  INSIDE (AUTHORIZED)
                </span>
              </>
            ) : isInside === false ? (
              <>
                <ShieldAlert className="size-4 text-destructive shrink-0" />
                <span className="text-destructive font-bold">OUTSIDE (BLOCKED)</span>
              </>
            ) : (
              <>
                <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {status === "acquiring"
                    ? "Acquiring Fix…"
                    : isInsuff
                      ? "Blocked (Accuracy Insufficient)"
                      : "Pending Valid Fix"}
                </span>
              </>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {evaluation ? `${evaluation.distanceToBoundaryMeters}m to 5-pt perimeter` : "5-point Ray-casting"}
          </div>
        </div>
      </div>

      {/* Lat/Lng Quick Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-mono text-muted-foreground">
            Lat: <strong className="text-foreground">{coords ? `${coords.lat.toFixed(7)}° N` : "—"}</strong>
          </span>
          <span className="font-mono text-muted-foreground">
            Lng: <strong className="text-foreground">{coords ? `${coords.lng.toFixed(7)}° E` : "—"}</strong>
          </span>
        </div>

        <div className="text-[11px] text-muted-foreground font-mono">
          Last GNSS Sample: {lastUpdated ? `${formatIndiaTime(lastUpdated)} IST` : "—"}
        </div>
      </div>

      {/* Android Location Accuracy Optimization Guide */}
      <div className="border-t border-border bg-primary/5 p-3.5">
        <div className="flex items-start gap-2.5">
          <Smartphone className="size-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-foreground">
                Android High-Accuracy GPS Instructions (Fix for ±200m Coarse Accuracy)
              </h4>
              <button
                type="button"
                onClick={() => setShowAndroidGuide((s) => !s)}
                className="text-[11px] text-primary hover:underline"
              >
                {showAndroidGuide ? "Hide Guide" : "Show Guide"}
              </button>
            </div>

            {showAndroidGuide && (
              <div className="space-y-2 text-[11px] text-muted-foreground">
                <p>
                  If Android Chrome reports ±100m–250m accuracy, the browser is receiving cellular/Wi-Fi triangulation instead of hardware GNSS satellite locks. Please ensure:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div className="rounded-lg border border-primary/20 bg-background/80 p-2 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Check className="size-3.5 text-primary" />
                      1. Location ON
                    </div>
                    <p className="text-[10px]">
                      Enable device <strong>Location</strong> in the Android Quick Settings pull-down menu.
                    </p>
                  </div>

                  <div className="rounded-lg border border-primary/20 bg-background/80 p-2 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Check className="size-3.5 text-primary" />
                      2. Precise Location ON
                    </div>
                    <p className="text-[10px]">
                      Enable <strong>Google Location Accuracy</strong> and set Chrome permission to <strong>Precise Location</strong>.
                    </p>
                  </div>

                  <div className="rounded-lg border border-primary/20 bg-background/80 p-2 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Check className="size-3.5 text-primary" />
                      3. Move to Open Sky
                    </div>
                    <p className="text-[10px]">
                      Step near a window or outdoors so the GNSS antenna acquires unobstructed satellite lines of sight.
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic pt-0.5">
                  * Note: Web browsers access geolocation through the standard W3C Geolocation API. The browser cannot arbitrarily manufacture a ≤20m lock until the device hardware achieves a true satellite fix.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Developer Diagnostic: Every Collected Reading Log Table */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowReadingsLog((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <History className="size-3.5 text-primary" />
            Developer Diagnostic: Every Collected Reading ({readingsHistory.length} Samples in Window)
          </span>
          {showReadingsLog ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {showReadingsLog && (
          <div className="p-3 bg-muted/20 border-t border-border space-y-2">
            <div className="text-[10px] text-muted-foreground flex items-center justify-between">
              <span>Raw GNSS fixes captured in current 15s acquisition window:</span>
              <span className="font-mono">Total Samples: {readingsHistory.length}</span>
            </div>

            {readingsHistory.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No GPS readings captured yet. Click "Refresh Location" to start acquisition.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-border bg-card">
                <table className="w-full text-[11px] text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/60 text-muted-foreground text-[10px] uppercase font-mono">
                      <th className="px-2.5 py-1.5">#</th>
                      <th className="px-2.5 py-1.5">Timestamp (IST)</th>
                      <th className="px-2.5 py-1.5">Latitude</th>
                      <th className="px-2.5 py-1.5">Longitude</th>
                      <th className="px-2.5 py-1.5">Accuracy</th>
                      <th className="px-2.5 py-1.5">Quality Tier</th>
                      <th className="px-2.5 py-1.5">Displacement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-[10px]">
                    {readingsHistory.map((r, i) => {
                      const date = new Date(r.timestamp);
                      const timeStr = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
                      return (
                        <tr key={i} className="hover:bg-muted/30">
                          <td className="px-2.5 py-1 text-muted-foreground">{r.sampleIndex || i + 1}</td>
                          <td className="px-2.5 py-1 text-foreground">{timeStr}</td>
                          <td className="px-2.5 py-1 text-foreground">{r.lat.toFixed(7)}°</td>
                          <td className="px-2.5 py-1 text-foreground">{r.lng.toFixed(7)}°</td>
                          <td className="px-2.5 py-1">
                            <span
                              className={
                                r.accuracy <= 10
                                  ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                  : r.accuracy <= 20
                                    ? "text-blue-600 dark:text-blue-400 font-bold"
                                    : r.accuracy <= 50
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-destructive"
                              }
                            >
                              ±{r.accuracy.toFixed(1)} m
                            </span>
                          </td>
                          <td className="px-2.5 py-1">
                            <span
                              className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                                r.quality === "EXCELLENT"
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : r.quality === "GOOD"
                                    ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                                    : r.quality === "ACQUIRING / WAIT"
                                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                      : "bg-destructive/15 text-destructive"
                              }`}
                            >
                              {r.quality}
                            </span>
                          </td>
                          <td className="px-2.5 py-1 text-muted-foreground">
                            {r.displacementFromPrev !== undefined ? `${r.displacementFromPrev.toFixed(1)} m` : "— (Initial)"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Authoritative Polygon Coordinates Drawer */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowCoords((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <span>Authoritative Geofence Boundary (5 Vertices: C1 → C5 → C1)</span>
          {showCoords ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {showCoords && (
          <div className="p-3 bg-muted/30 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {AUTHORIZED_GEOFENCE_POLYGON.map((pt, i) => (
                <div key={i} className="rounded border border-border bg-card p-2 text-[10px] font-mono">
                  <div className="text-muted-foreground font-semibold">C{i + 1}</div>
                  <div>
                    Lat: <span className="text-foreground">{pt.lat}</span>
                  </div>
                  <div>
                    Lng: <span className="text-foreground">{pt.lng}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              * The attendance system evaluates point-in-polygon containment using the exact ray-casting Jordan Curve algorithm across all 5 vertices (C1 → C5 → C1).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
