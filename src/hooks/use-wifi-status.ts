import { useCallback, useEffect, useState } from "react";
import type { WifiStatus } from "@/lib/wifi-detection";

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
      const res = await fetch("/api/wifi-status", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data: WifiStatus = await res.json();
        setStatus(data);
        setLastChecked(new Date());
        return data;
      }
    } catch {
      // If endpoint couldn't be reached (e.g. device completely disconnected from any network)
      const offlineStatus: WifiStatus = {
        isSonaWifi: false,
        ssid: "",
        bssid: "",
        signal: "",
        ip: "",
        gateway: "",
        dns: "",
        dnsSuffix: "",
        auth: "",
        state: "disconnected",
        reason: "Network offline or disconnected. Please connect to SONA-WIFI or authorized Wi-Fi.",
        timestamp: new Date().toISOString(),
      };
      setStatus(offlineStatus);
      setLastChecked(new Date());
      return offlineStatus;
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
