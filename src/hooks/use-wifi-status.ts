import { useCallback, useEffect, useState } from "react";
import type { WifiStatus } from "@/lib/wifi-config";

export interface UseWifiStatusReturn {
  status: WifiStatus | null;
  isSonaWifi: boolean | null; // null during initial check
  isLoading: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  checkConnection: () => Promise<WifiStatus | null>;
}

export function useWifiStatus(pollIntervalMs = 8000): UseWifiStatusReturn {
  const [status, setStatus] = useState<WifiStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchWifiStatus = useCallback(async (isManual = false): Promise<WifiStatus | null> => {
    if (isManual) {
      setIsChecking(true);
    }
    try {
      // 1. Check if running inside Android WebView with Native Wi-Fi Bridge
      let nativeDetails: any = null;
      if (typeof window !== "undefined") {
        const wifiBridge = (window as any).AndroidWifiBridge;
        const locBridge = (window as any).AndroidLocationBridge;

        if (wifiBridge && typeof wifiBridge.getWifiDetails === "function") {
          try {
            const raw = wifiBridge.getWifiDetails();
            nativeDetails = typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch (e) {
            console.warn("Failed to parse AndroidWifiBridge details:", e);
          }
        } else if (locBridge && typeof locBridge.getWifiDetails === "function") {
          try {
            const raw = locBridge.getWifiDetails();
            nativeDetails = typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch (e) {
            console.warn("Failed to parse AndroidLocationBridge wifi details:", e);
          }
        }
      }

      // 2. Perform Backend Challenge / Verification
      let res: Response;
      if (nativeDetails) {
        // Send Android native Wi-Fi telemetry to backend challenge endpoint
        res = await fetch("/api/wifi/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(nativeDetails),
          cache: "no-store",
        });
      } else {
        // Standard endpoint (inspects server-side / OS Wi-Fi adapter or client IP)
        res = await fetch("/api/wifi-status", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
      }

      if (res.ok) {
        const data: WifiStatus = await res.json();
        if (!data.bssid || data.bssid === "None" || data.bssid === "Unknown" || data.bssid === "<unknown bssid>") {
          data.bssid = "Not available in browser";
        }
        setStatus(data);
        setLastChecked(new Date());
        return data;
      }
    } catch {
      // If endpoint couldn't be reached or SSID is unavailable
      const isOnline = typeof navigator !== "undefined" && navigator.onLine;
      const errorStatus: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        ssid: "Unavailable",
        state: isOnline ? "unknown" : "disconnected",
        reason: isOnline
          ? "Unauthorized Wi-Fi network. Device must be connected to an authorized campus Wi-Fi network (M or SONA)."
          : "Network offline or disconnected. Please connect to M or SONA.",
        timestamp: new Date().toISOString(),
        networkSummary: isOnline ? "Unauthorized Wi-Fi network" : "Offline",
        stage: isOnline ? "UNABLE_TO_VERIFY" : "DISCONNECTED",
      };
      setStatus(errorStatus);
      setLastChecked(new Date());
      return errorStatus;
    } finally {
      setIsLoading(false);
      setIsChecking(false);
    }
    return null;
  }, []);

  useEffect(() => {
    void fetchWifiStatus(false);

    const interval = setInterval(() => {
      void fetchWifiStatus(false);
    }, pollIntervalMs);

    const handleFocusOrOnline = () => {
      void fetchWifiStatus(false);
    };

    window.addEventListener("focus", handleFocusOrOnline);
    window.addEventListener("online", handleFocusOrOnline);
    window.addEventListener("offline", handleFocusOrOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocusOrOnline);
      window.removeEventListener("online", handleFocusOrOnline);
      window.removeEventListener("offline", handleFocusOrOnline);
    };
  }, [fetchWifiStatus, pollIntervalMs]);

  return {
    status,
    isSonaWifi: status ? status.isSonaWifi : null,
    isLoading,
    isChecking,
    lastChecked,
    checkConnection: () => fetchWifiStatus(true),
  };
}
