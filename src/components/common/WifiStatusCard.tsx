import { useState } from "react";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Network,
  Info,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WifiStatus } from "@/lib/wifi-detection";
import { formatIndiaTime } from "@/lib/india-time";

interface WifiStatusCardProps {
  status: WifiStatus | null;
  wifiAuthorized: boolean;
  isLoading: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  onRecheck: () => void | Promise<unknown>;
  isMockScenario?: boolean;
  className?: string;
}

export function WifiStatusCard({
  status,
  wifiAuthorized,
  isLoading,
  isChecking,
  lastChecked,
  onRecheck,
  isMockScenario = false,
  className = "",
}: WifiStatusCardProps) {
  const [showTelemetry, setShowTelemetry] = useState(false);

  // 1. WIFI STATUS: Connected / Disconnected / Unknown
  const wifiStatusText: "Connected" | "Disconnected" | "Unknown" = isMockScenario
    ? wifiAuthorized
      ? "Connected"
      : status?.state === "disconnected"
        ? "Disconnected"
        : "Connected"
    : status?.state === "connected"
      ? "Connected"
      : status?.state === "disconnected"
        ? "Disconnected"
        : "Unknown";

  // 2. AUTHORIZATION: AUTHORIZED / UNAUTHORIZED / UNAVAILABLE
  const authorizationStatus: "AUTHORIZED" | "UNAUTHORIZED" | "UNAVAILABLE" = wifiAuthorized
    ? "AUTHORIZED"
    : status?.state === "disconnected" || (!wifiAuthorized && !status?.ip)
      ? "UNAVAILABLE"
      : "UNAUTHORIZED";

  // 3. CHECK STATUS: Checking... / Checked at: timestamp
  const checkStatusDisplay =
    isChecking || (isLoading && !status && !isMockScenario)
      ? "Checking..."
      : lastChecked
        ? `Checked at: ${formatIndiaTime(lastChecked)}`
        : status?.timestamp
          ? `Checked at: ${formatIndiaTime(new Date(status.timestamp))}`
          : "Checked";

  // 4. NETWORK EVIDENCE: VERIFIED / NOT VERIFIED / UNAVAILABLE
  const networkEvidenceText: "VERIFIED" | "NOT VERIFIED" | "UNAVAILABLE" = wifiAuthorized
    ? "VERIFIED"
    : status?.state === "disconnected" || authorizationStatus === "UNAVAILABLE"
      ? "UNAVAILABLE"
      : "NOT VERIFIED";

  // Visual tones
  const authBadgeStyle =
    authorizationStatus === "AUTHORIZED"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold"
      : authorizationStatus === "UNAVAILABLE"
        ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-bold"
        : "border-destructive/40 text-destructive bg-destructive/10 font-bold";

  const wifiBadgeStyle =
    wifiStatusText === "Connected"
      ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : wifiStatusText === "Disconnected"
        ? "border-destructive/30 text-destructive bg-destructive/10"
        : "border-border text-muted-foreground bg-muted";

  const evidenceBadgeStyle =
    networkEvidenceText === "VERIFIED"
      ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold"
      : networkEvidenceText === "UNAVAILABLE"
        ? "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-bold"
        : "border-destructive/30 text-destructive bg-destructive/10 font-bold";

  return (
    <div
      className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-all ${className}`}
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid size-8 place-items-center rounded-lg ${
              wifiAuthorized
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-danger-soft text-destructive"
            }`}
          >
            {wifiAuthorized ? <Wifi className="size-4.5" /> : <WifiOff className="size-4.5" />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Institutional Wi-Fi Verification
              </h3>
              <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                Factor 1 of 3
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Campus network gateway inspection · Subnet authorization · Real-time connectivity check
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[11px] px-2.5 py-0.5 tracking-wide ${authBadgeStyle}`}>
            <span
              className={`size-1.5 rounded-full mr-1.5 ${
                authorizationStatus === "AUTHORIZED"
                  ? "bg-emerald-500"
                  : authorizationStatus === "UNAVAILABLE"
                    ? "bg-amber-500"
                    : "bg-destructive"
              }`}
            />
            {authorizationStatus}
          </Badge>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void onRecheck()}
            disabled={isChecking}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isChecking ? "animate-spin" : ""}`} />
            Recheck Wi-Fi
          </Button>
        </div>
      </div>

      {/* Unauthorized Warning Banner if Wi-Fi fails */}
      {!wifiAuthorized && (
        <div className="flex items-start gap-2.5 border-b border-destructive/20 bg-danger-soft px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <p className="font-semibold">
              {authorizationStatus === "UNAVAILABLE"
                ? "Institutional Wi-Fi Connection Unavailable"
                : "Connected Network Is Not Authorized"}
            </p>
            <p className="text-[11px] opacity-90">
              {status?.reason ||
                "Device must be connected to an authorized campus Wi-Fi network (SONA-WIFI / Institutional Gateway) to authorize attendance. Other diagnostics remain accessible."}
            </p>
          </div>
        </div>
      )}

      {/* Core 4 Required Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border text-xs">
        {/* 1. WIFI STATUS */}
        <div className="p-3.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            1. Wi-Fi Status
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[11px] font-bold px-2 py-0.5 ${wifiBadgeStyle}`}>
              {wifiStatusText}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {wifiStatusText === "Connected"
              ? "Physical/OS link active"
              : wifiStatusText === "Disconnected"
                ? "No network link"
                : "Awaiting link status"}
          </div>
        </div>

        {/* 2. AUTHORIZATION */}
        <div className="p-3.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            2. Authorization
          </div>
          <div className="mt-1">
            <Badge variant="outline" className={`text-[11px] px-2 py-0.5 ${authBadgeStyle}`}>
              {authorizationStatus}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {authorizationStatus === "AUTHORIZED"
              ? "Factor 1 Satisfied"
              : "Factor 1 Rejected"}
          </div>
        </div>

        {/* 3. CHECK STATUS */}
        <div className="p-3.5 border-t sm:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            3. Check Status
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground flex items-center gap-1.5 truncate">
            <Activity className={`size-3.5 text-primary shrink-0 ${isChecking ? "animate-spin" : ""}`} />
            <span className="truncate">{checkStatusDisplay}</span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {isChecking ? "Active evaluation" : "Polled automatically"}
          </div>
        </div>

        {/* 4. NETWORK EVIDENCE */}
        <div className="p-3.5 border-t sm:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            4. Network Evidence
          </div>
          <div className="mt-1">
            <Badge variant="outline" className={`text-[11px] px-2 py-0.5 ${evidenceBadgeStyle}`}>
              {networkEvidenceText}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {status?.gateway ? `Gateway: ${status.gateway}` : "Campus telemetry"}
          </div>
        </div>
      </div>

      {/* Browser Limitation Note */}
      <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
        <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
        <p className="leading-normal">
          <strong className="text-foreground">Browser Limitation Notice:</strong> Standard web browsers (including Android Chrome) do not expose client Wi-Fi SSID directly. Network authorization is verified via institutional gateway, IP subnet range, and campus network telemetry.
        </p>
      </div>

      {/* Collapsible Network Diagnostics */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowTelemetry((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Network className="size-3.5" />
            <span>Network Diagnostic Telemetry &amp; Evidence</span>
          </span>
          {showTelemetry ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {showTelemetry && (
          <div className="p-3 bg-muted/30 border-t border-border text-xs space-y-2 font-mono">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Assigned IPv4 Address:
                </span>
                <span className="font-semibold text-foreground">{status?.ip || "—"}</span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Detected Default Gateway:
                </span>
                <span className="font-semibold text-foreground">{status?.gateway || "—"}</span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  DNS Server / Domain Suffix:
                </span>
                <span className="font-semibold text-foreground">
                  {status?.dnsSuffix || status?.dns || "—"}
                </span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Security Mode / Protocol:
                </span>
                <span className="font-semibold text-foreground">{status?.auth || "WPA2-Enterprise / Standard"}</span>
              </div>
            </div>

            <div className="rounded border border-border bg-card p-2 text-[11px]">
              <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                Verification Diagnostic Summary:
              </span>
              <span className="text-foreground">{status?.reason || "Awaiting evaluation"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
