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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { type UseGeofenceResult } from "@/hooks/use-geofence";
import { AUTHORIZED_GEOFENCE_POLYGON } from "@/lib/geofence/geofence-service";
import { formatIndiaDate, formatIndiaTime } from "@/lib/india-time";

interface GpsDiagnosticPanelProps {
  geofence: UseGeofenceResult;
  className?: string;
}

export function GpsDiagnosticPanel({ geofence, className = "" }: GpsDiagnosticPanelProps) {
  const [showCoords, setShowCoords] = useState(false);
  const { coords, evaluation, isInside, status, accuracy, isChecking, checkLocation, lastUpdated } =
    geofence;

  const getStatusBadge = () => {
    switch (status) {
      case "inside":
        return {
          label: "INSIDE AUTHORIZED GEOFENCE",
          color: "bg-success/15 text-success border-success/30",
          dot: "bg-success",
        };
      case "outside":
        return {
          label: "OUTSIDE GEOFENCE",
          color: "bg-destructive/15 text-destructive border-destructive/30",
          dot: "bg-destructive",
        };
      case "acquiring":
        return {
          label: "ACQUIRING GPS FIX",
          color: "bg-primary/15 text-primary border-primary/30",
          dot: "bg-primary animate-ping",
        };
      case "low_accuracy":
        return {
          label: "LOW ACCURACY FIX",
          color: "bg-warning/15 text-warning border-warning/30",
          dot: "bg-warning",
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
          label: "GPS UNAVAILABLE",
          color: "bg-destructive/15 text-destructive border-destructive/30",
          dot: "bg-destructive",
        };
      default:
        return {
          label: "INITIALIZING",
          color: "bg-muted text-muted-foreground border-border",
          dot: "bg-muted-foreground",
        };
    }
  };

  const badge = getStatusBadge();

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
              Developer GPS &amp; Geofence Diagnostics
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Authoritative 19-Point Campus Polygon Verification (C1 → C19 → C1)
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
            onClick={() => void checkLocation(true)}
            disabled={isChecking}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isChecking ? "animate-spin" : ""}`} />
            Check Current Location
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border text-xs">
        {/* Metric 1: Latitude */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Current Latitude
          </div>
          <div className="mt-1 font-mono font-bold text-foreground text-sm truncate">
            {coords ? `${coords.lat.toFixed(8)}° N` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">WGS84 coordinate</div>
        </div>

        {/* Metric 2: Longitude */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Current Longitude
          </div>
          <div className="mt-1 font-mono font-bold text-foreground text-sm truncate">
            {coords ? `${coords.lng.toFixed(8)}° E` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">WGS84 coordinate</div>
        </div>

        {/* Metric 3: Accuracy */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            GPS Accuracy
          </div>
          <div className="mt-1 font-mono font-bold text-sm">
            {accuracy !== null ? (
              <span
                className={
                  accuracy <= 25
                    ? "text-success font-semibold"
                    : accuracy <= 65
                      ? "text-primary font-semibold"
                      : "text-warning font-semibold"
                }
              >
                ±{accuracy.toFixed(1)} m
              </span>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {accuracy && accuracy <= 65 ? "High Precision Fix" : "Degraded Fix"}
          </div>
        </div>

        {/* Metric 4: Geofence State */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            19-Point Polygon Status
          </div>
          <div className="mt-1 font-semibold text-sm flex items-center gap-1.5">
            {isInside === true ? (
              <>
                <ShieldCheck className="size-4 text-success" />
                <span className="text-success">Inside Polygon</span>
              </>
            ) : isInside === false ? (
              <>
                <ShieldAlert className="size-4 text-destructive" />
                <span className="text-destructive">Outside Boundary</span>
              </>
            ) : (
              <>
                <AlertTriangle className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Acquiring Fix</span>
              </>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {evaluation ? `${evaluation.distanceToBoundaryMeters}m to perimeter` : "Ray-casting active"}
          </div>
        </div>
      </div>

      {/* Evaluation Diagnostic Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Relationship:</span>
          <span className="text-muted-foreground truncate">
            {evaluation ? evaluation.relationship : "Evaluating GPS against campus polygon…"}
          </span>
        </div>

        <div className="text-[11px] text-muted-foreground font-mono">
          Updated: {lastUpdated ? `${formatIndiaTime(lastUpdated)} (${lastUpdated.toISOString()})` : "—"}
        </div>
      </div>

      {/* Authoritative Polygon Coordinates Drawer */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowCoords((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <span>Authoritative Geofence Boundary (19 Vertices: C1 → C19 → C1)</span>
          {showCoords ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {showCoords && (
          <div className="p-3 bg-muted/30 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {AUTHORIZED_GEOFENCE_POLYGON.map((pt, i) => (
                <div key={i} className="rounded border border-border bg-card p-2 text-[10px] font-mono">
                  <div className="text-muted-foreground font-semibold">C{i + 1}</div>
                  <div>Lat: <span className="text-foreground">{pt.lat}</span></div>
                  <div>Lng: <span className="text-foreground">{pt.lng}</span></div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              * The attendance system evaluates point-in-polygon containment using the exact ray-casting Jordan Curve algorithm across all 19 vertices (C1 → C19 → C1).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
