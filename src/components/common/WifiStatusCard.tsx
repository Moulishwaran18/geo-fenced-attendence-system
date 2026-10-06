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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type WifiStatus } from "@/lib/wifi-config";
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
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // 1. Connection State: Connected / Disconnected / Unknown
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

  // 2. Authorization: CHECKING / AUTHORIZED / FAILED
  const authorizationStatus: "CHECKING" | "AUTHORIZED" | "FAILED" = isChecking || (isLoading && !status && !isMockScenario)
    ? "CHECKING"
    : wifiAuthorized
      ? "AUTHORIZED"
      : "FAILED";

  // Visual tones
  const authBadgeStyle =
    authorizationStatus === "AUTHORIZED"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold"
      : authorizationStatus === "CHECKING"
        ? "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-bold"
        : "border-destructive/40 text-destructive bg-destructive/10 font-bold";

  // SSID Display Value
  const rawSsid = status?.ssid?.trim() || "";
  const displaySsid = isChecking
    ? "Checking…"
    : rawSsid && rawSsid !== "Unavailable" && rawSsid !== "Unknown"
      ? rawSsid
      : wifiAuthorized
        ? "M"
        : rawSsid || "Unavailable";

  // Network Display Value
  const displayNetwork = wifiAuthorized
    ? "Authorized campus Wi-Fi"
    : isChecking
      ? "Verifying network…"
      : "Unauthorized Wi-Fi network";

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
              Campus Wi-Fi SSID authorization · Real-time connectivity check
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[11px] px-2.5 py-0.5 tracking-wide ${authBadgeStyle}`}>
            <span
              className={`size-1.5 rounded-full mr-1.5 ${
                authorizationStatus === "AUTHORIZED"
                  ? "bg-emerald-500"
                  : authorizationStatus === "CHECKING"
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
      {!wifiAuthorized && authorizationStatus !== "CHECKING" && (
        <div className="flex items-start gap-2.5 border-b border-destructive/20 bg-danger-soft px-4 py-2.5 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <p className="font-semibold">
              Unauthorized Wi-Fi network.
            </p>
            <p className="text-[11px] opacity-90">
              {status?.reason ||
                "Device must be connected to an authorized campus Wi-Fi network (SSID \"M\" or containing \"SONA\")."}
            </p>
          </div>
        </div>
      )}

      {/* SSID Name-Based Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border text-xs">
        {/* 1. Status */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Wi-Fi Authorization
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[11px] font-bold px-2 py-0.5 ${authBadgeStyle}`}>
              {authorizationStatus}
            </Badge>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {authorizationStatus === "AUTHORIZED"
              ? "Factor 1 Satisfied"
              : authorizationStatus === "CHECKING"
                ? "Verifying network…"
                : "Factor 1 Rejected"}
          </div>
        </div>

        {/* 2. SSID */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            SSID
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate" title={displaySsid}>
            {displaySsid}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {authorizationStatus === "AUTHORIZED"
              ? "Authorized campus network"
              : authorizationStatus === "CHECKING"
                ? "Detecting SSID…"
                : "Unauthorized SSID"}
          </div>
        </div>

        {/* 3. Network */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Network
          </div>
          <div className="mt-1 font-medium text-xs text-foreground truncate" title={displayNetwork}>
            {displayNetwork}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {wifiAuthorized ? "Campus authorization passed" : "Attendance blocked"}
          </div>
        </div>

        {/* 4. Connection State */}
        <div className="p-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Connection State
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate">
            {wifiStatusText}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {wifiStatusText === "Connected"
              ? "Wi-Fi link active"
              : wifiStatusText === "Disconnected"
                ? "No network connection"
                : "Awaiting link status"}
          </div>
        </div>
      </div>

      {/* Browser Limitation Note */}
      <div className="flex items-start gap-2 border-t border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
        <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
        <p className="leading-normal">
          <strong className="text-foreground">Browser Limitation Notice:</strong> Standard web browsers do not expose client Wi-Fi SSID directly. If the Wi-Fi SSID is unavailable to the browser, verification reports <code className="font-mono text-[10px]">SSID_UNAVAILABLE</code> and authorization fails.
        </p>
      </div>

      {/* Collapsible Diagnostics */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setShowDiagnostics((s) => !s)}
          className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Network className="size-3.5" />
            <span>Wi-Fi Diagnostic Details</span>
          </span>
          {showDiagnostics ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>

        {showDiagnostics && (
          <div className="p-3 bg-muted/30 border-t border-border text-xs space-y-2 font-mono">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Detected SSID:
                </span>
                <span className="font-semibold text-foreground">{displaySsid}</span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Authorization Status:
                </span>
                <span className="font-semibold text-foreground">{authorizationStatus}</span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Network Classification:
                </span>
                <span className="font-semibold text-foreground">{displayNetwork}</span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Last Checked:
                </span>
                <span className="font-semibold text-foreground">
                  {lastChecked
                    ? formatIndiaTime(lastChecked)
                    : status?.timestamp
                      ? formatIndiaTime(new Date(status.timestamp))
                      : "—"}
                </span>
              </div>
            </div>

            <div className="rounded border border-border bg-card p-2 text-[11px]">
              <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                Evaluation Reason:
              </span>
              <span className="text-foreground">{status?.reason || "Awaiting evaluation"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
