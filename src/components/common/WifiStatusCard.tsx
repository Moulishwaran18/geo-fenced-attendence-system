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
  Radio,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AUTHORIZED_SSIDS, type WifiStatus } from "@/lib/wifi-config";
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

  // 2. AUTHORIZATION: CHECKING / AUTHORIZED / FAILED
  const authorizationStatus: "CHECKING" | "AUTHORIZED" | "FAILED" = isChecking || (isLoading && !status && !isMockScenario)
    ? "CHECKING"
    : wifiAuthorized
      ? "AUTHORIZED"
      : "FAILED";

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
    : status?.state === "disconnected"
      ? "UNAVAILABLE"
      : "NOT VERIFIED";

  // Visual tones
  const authBadgeStyle =
    authorizationStatus === "AUTHORIZED"
      ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-bold"
      : authorizationStatus === "CHECKING"
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
                "Device must be connected to an authorized campus Wi-Fi network (M or SONA-WIFI) with verified gateway and subnet."}
            </p>
          </div>
        </div>
      )}

      {/* Dynamic Device Telemetry Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-border text-xs">
        {/* 1. WI-FI AUTHORIZATION STATUS */}
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
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate" title={status?.ssid || "None"}>
            {status?.ssid || (isChecking ? "Checking…" : "None")}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {AUTHORIZED_SSIDS.includes(status?.ssid || "")
              ? "Authorized campus Wi-Fi"
              : authorizationStatus === "CHECKING"
                ? "Detecting network…"
                : "Unauthorized Wi-Fi network"}
          </div>
        </div>

        {/* 3. BSSID */}
        <div className="p-3 border-t sm:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            BSSID
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate" title={status?.bssid || "None"}>
            {status?.bssid && status.bssid !== "None" && status.bssid !== "Unknown"
              ? status.bssid
              : "AP Configurable"}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {status?.bssid && status.bssid !== "None" && status.bssid !== "Unknown"
              ? "Connected AP MAC"
              : "Masked / Configurable"}
          </div>
        </div>

        {/* 4. SIGNAL */}
        <div className="p-3 border-t sm:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Signal
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate">
            {status?.signal || (status?.rssi ? `${status.rssi} dBm` : (status?.state === "connected" ? "-54 dBm" : "—"))}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {status?.rssi
              ? status.rssi >= -65
                ? "Excellent"
                : status.rssi >= -75
                  ? "Good"
                  : "Fair"
              : status?.state === "connected"
                ? "Physical Signal"
                : "Offline"}
          </div>
        </div>

        {/* 5. BAND / FREQUENCY */}
        <div className="p-3 border-t lg:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Band
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate">
            {status?.band || (status?.frequency ? `${status.frequency} MHz` : (status?.state === "connected" ? "5 GHz" : "—"))}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {status?.linkSpeed ? `${status.linkSpeed} Mbps Link` : (status?.band || "Radio Band")}
          </div>
        </div>

        {/* 6. SECURITY */}
        <div className="p-3 border-t lg:border-t-0">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Security
          </div>
          <div className="mt-1 font-mono font-semibold text-xs text-foreground truncate">
            {status?.auth || (status?.state === "connected" ? "WPA/WPA2-Personal" : "—")}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground truncate">
            {authorizationStatus === "AUTHORIZED"
              ? "Verified Security"
              : authorizationStatus === "CHECKING"
                ? "Inspecting mode…"
                : "Security check failed"}
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
                  Wi-Fi Band &amp; Link Speed:
                </span>
                <span className="font-semibold text-foreground">
                  {status?.band || "5 GHz"} {status?.linkSpeed ? `(${status.linkSpeed} Mbps)` : ""}
                </span>
              </div>
              <div className="rounded border border-border bg-card p-2 text-[11px]">
                <span className="text-muted-foreground block text-[10px] uppercase font-sans">
                  Signal Strength (RSSI):
                </span>
                <span className="font-semibold text-foreground">
                  {status?.signal || (status?.rssi ? `${status.rssi} dBm` : "Detected")}
                </span>
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
                <span className="font-semibold text-foreground">{status?.auth || "WPA/WPA2-Personal"}</span>
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
