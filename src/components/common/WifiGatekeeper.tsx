import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  Loader2,
  RefreshCw,
  Router,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useWifiStatus } from "@/hooks/use-wifi-status";
import { Button } from "@/components/ui/button";

interface WifiGatekeeperProps {
  children: ReactNode;
}

export function WifiGatekeeper({ children }: WifiGatekeeperProps) {
  const { status, isSonaWifi, isLoading, isChecking, checkConnection } = useWifiStatus(5000);
  const [justChecked, setJustChecked] = useState(false);

  const handleManualCheck = async () => {
    setJustChecked(true);
    await checkConnection();
    setTimeout(() => setJustChecked(false), 2000);
  };

  // Initial loading state
  if (isLoading && isSonaWifi === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="relative">
            <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
              <GraduationCap className="size-8" aria-hidden />
            </span>
            <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
              <Loader2 className="size-3.5 animate-spin" />
            </span>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">CampusAttend</h1>
            <p className="mt-1 text-xs text-muted-foreground">Verifying Sona Wi-Fi Connection…</p>
          </div>
        </div>
      </div>
    );
  }

  // If connected to Sona Wi-Fi, render the website normally
  if (isSonaWifi) {
    return <>{children}</>;
  }

  // Otherwise, render the Sona Wi-Fi lock screen
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top institution bar */}
      <header className="border-b border-border bg-card/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-accent-foreground">
              <GraduationCap className="size-5.5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">CampusAttend</p>
              <p className="text-[11px] text-muted-foreground">Sona Group of Institutions</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-destructive/20 bg-danger-soft px-3 py-1 text-xs font-medium text-destructive">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
            <span>Network Restricted</span>
          </div>
        </div>
      </header>

      {/* Main Lock Screen Card */}
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-lg space-y-6">
          <div className="overflow-hidden rounded-2xl border border-destructive/25 bg-card p-6 shadow-[var(--shadow-raised)] sm:p-8">
            {/* Header Icon */}
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-4">
                <span className="grid size-20 place-items-center rounded-2xl bg-danger-soft text-destructive shadow-sm ring-8 ring-destructive/10">
                  <WifiOff className="size-10 stroke-[2.2]" aria-hidden />
                </span>
                <span className="absolute -bottom-2 -right-2 grid size-7 place-items-center rounded-full bg-destructive text-destructive-foreground shadow">
                  <ShieldAlert className="size-4" aria-hidden />
                </span>
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Access Restricted
              </h1>
              <p className="mt-1.5 text-sm font-medium text-destructive">
                Sona Wi-Fi Connection Required
              </p>
              <p className="mt-2.5 max-w-md text-sm text-muted-foreground leading-relaxed">
                CampusAttend is protected by institutional network security. This system can only be
                accessed when your device is connected to the authorized campus Wi-Fi (
                <strong className="text-foreground">SONA-WIFI</strong>).
              </p>
            </div>

            {/* Diagnostic Network Info */}
            <div className="mt-6 rounded-xl border border-border bg-muted/50 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Connection Diagnostics
              </h2>
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Active Wi-Fi SSID:</span>
                  <span className="font-semibold text-foreground">
                    {status?.ssid ? (
                      <span className="text-destructive">{status.ssid} (Unauthorized)</span>
                    ) : (
                      <span className="text-muted-foreground">None / Disconnected</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Required Wi-Fi:</span>
                  <span className="font-semibold text-primary">SONA-WIFI (Institutional)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Required Security:</span>
                  <span className="font-semibold text-foreground">Open (No Hotspot WPA)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Authorized Gateway:</span>
                  <span className="font-mono text-foreground">172.16.16.16</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Authorized Subnet:</span>
                  <span className="font-mono text-muted-foreground">172.16.0.0 / 16</span>
                </div>
                {status?.ip && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Assigned IP:</span>
                    <span className="font-mono text-muted-foreground">{status.ip}</span>
                  </div>
                )}
                {status?.gateway && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Detected Gateway:</span>
                    <span className="font-mono text-muted-foreground">{status.gateway}</span>
                  </div>
                )}
                {status?.auth && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Security Mode:</span>
                    <span className="font-mono text-muted-foreground">{status.auth}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-border/60">
                  <span className="text-muted-foreground">Diagnostics:</span>
                  <span className="flex items-center gap-1.5 font-medium text-destructive">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    <span className="truncate">{status?.reason || "Restricted to genuine SONA-WIFI only"}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="mt-5 space-y-3 rounded-xl border border-border bg-card p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Router className="size-4 text-primary" />
                How to connect:
              </h3>
              <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside pl-1">
                <li>Open your device Wi-Fi settings.</li>
                <li>
                  Select and connect to <strong className="text-foreground">SONA-WIFI</strong>.
                </li>
                <li>
                  Once connected, this page will <strong className="text-foreground">automatically unlock</strong>, or click below to re-check.
                </li>
              </ol>
            </div>

            {/* Actions */}
            <div className="mt-6 flex flex-col gap-2.5">
              <Button
                size="lg"
                className="w-full font-medium"
                disabled={isChecking}
                onClick={handleManualCheck}
              >
                {isChecking ? (
                  <>
                    <Loader2 className="mr-2 size-4.5 animate-spin" />
                    Checking Sona Wi-Fi Connection…
                  </>
                ) : justChecked ? (
                  <>
                    <CheckCircle2 className="mr-2 size-4.5" />
                    Connection Checked
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 size-4.5" />
                    Check Connection
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-muted-foreground">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                <span>Auto-detecting connection in background…</span>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            © 2026 Sona Group of Institutions · Institutional Attendance Gateway
          </p>
        </div>
      </main>
    </div>
  );
}
