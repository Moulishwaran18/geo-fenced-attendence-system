import { useCallback, useEffect, useState } from "react";
import { verifyCampusWifi, type WifiStatus } from "@/lib/wifi-config";
import {
  getNativeConnectedWifi,
  isNativeWifiBridgeAvailable,
  requestNativeWifiPermissions,
} from "@/lib/native-wifi-bridge";

export interface UseWifiStatusReturn {
  status: WifiStatus | null;
  isSonaWifi: boolean | null; // null during initial check
  isLoading: boolean;
  isChecking: boolean;
  lastChecked: Date | null;
  isNativeBridge: boolean;
  checkConnection: () => Promise<WifiStatus | null>;
  requestPermissions: () => boolean;
}

export function useWifiStatus(pollIntervalMs = 8000): UseWifiStatusReturn {
  const [status, setStatus] = useState<WifiStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [hasNativeBridge, setHasNativeBridge] = useState<boolean>(false);

  const fetchWifiStatus = useCallback(async (isManual = false): Promise<WifiStatus | null> => {
    if (isManual) {
      setIsChecking(true);
    }

    try {
      const nativeAvailable = isNativeWifiBridgeAvailable();
      setHasNativeBridge(nativeAvailable);

      // ==============================================================
      // 1. NATIVE ANDROID BRIDGE (App running on real Android device)
      // ==============================================================
      if (nativeAvailable) {
        const nativeWifi = getNativeConnectedWifi();
        const now = new Date().toISOString();

        // 1A. Cellular / Mobile data (Strictly rejected — not campus Wi-Fi)
        if (nativeWifi.transport === "cellular") {
          const mobileStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: "Mobile Data",
            state: "connected",
            reason: "Device is connected to mobile data, not campus Wi-Fi.",
            networkSummary: "Unauthorized Wi-Fi network",
            stage: "SSID_CHECK_FAILED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(mobileStatus);
          setLastChecked(new Date());
          return mobileStatus;
        }

        // 1B. Disconnected from all networks
        if (nativeWifi.transport === "none" || !nativeWifi.connected) {
          const disconnectedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: "None",
            state: "disconnected",
            reason: "Device is disconnected from Wi-Fi. Please connect to M or SONA.",
            networkSummary: "Offline",
            stage: "DISCONNECTED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(disconnectedStatus);
          setLastChecked(new Date());
          return disconnectedStatus;
        }

        // 1C. Other non-Wi-Fi transports (e.g. bluetooth, ethernet)
        if (nativeWifi.transport !== "wifi") {
          const nonWifiStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: nativeWifi.transport,
            state: "connected",
            reason: "Network transport is not Wi-Fi. Please connect to M or SONA Wi-Fi.",
            networkSummary: "Unauthorized Wi-Fi network",
            stage: "SSID_CHECK_FAILED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(nonWifiStatus);
          setLastChecked(new Date());
          return nonWifiStatus;
        }

        // 1D. Wi-Fi connected, but Android location/Wi-Fi permission is denied
        if (nativeWifi.permissionGranted === false) {
          const permDeniedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: "Unavailable",
            state: "connected",
            reason: "Wi-Fi permission required to identify the connected campus network.",
            networkSummary: "Unauthorized Wi-Fi network",
            stage: "UNABLE_TO_VERIFY",
            timestamp: now,
            permissionDenied: true,
            isNativeBridge: true,
          };
          setStatus(permDeniedStatus);
          setLastChecked(new Date());
          return permDeniedStatus;
        }

        // 1E. Wi-Fi connected, but device Location services are turned OFF
        if (nativeWifi.locationEnabled === false) {
          const locDisabledStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: "Unavailable",
            state: "connected",
            reason: "Please turn ON device location services to allow Wi-Fi SSID identification.",
            networkSummary: "Unauthorized Wi-Fi network",
            stage: "UNABLE_TO_VERIFY",
            timestamp: now,
            locationDisabled: true,
            isNativeBridge: true,
          };
          setStatus(locDisabledStatus);
          setLastChecked(new Date());
          return locDisabledStatus;
        }

        // 1F. Wi-Fi connected, but SSID could not be read / returned empty
        if (!nativeWifi.ssid || nativeWifi.ssid === "SSID_UNAVAILABLE") {
          const ssidUnavailStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            ssid: "Unavailable",
            state: "connected",
            reason: "Wi-Fi SSID is unavailable. Ensure Wi-Fi is connected and permissions are granted.",
            networkSummary: "Unauthorized Wi-Fi network",
            stage: "UNABLE_TO_VERIFY",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(ssidUnavailStatus);
          setLastChecked(new Date());
          return ssidUnavailStatus;
        }

        // 1G. Real Wi-Fi SSID acquired! Evaluate against authoritative rules
        const clientVerification = verifyCampusWifi({
          ssid: nativeWifi.ssid,
          state: "connected",
        });

        // Optionally challenge backend /api/wifi/verify for audit synchronization
        try {
          const res = await fetch("/api/wifi/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              ssid: nativeWifi.ssid,
              state: "connected",
            }),
            cache: "no-store",
          });

          if (res.ok) {
            const data: WifiStatus = await res.json();
            data.isNativeBridge = true;
            setStatus(data);
            setLastChecked(new Date());
            return data;
          }
        } catch {
          // If network glitch contacting backend, use client authoritative verification
        }

        const resolvedStatus: WifiStatus = {
          isSonaWifi: clientVerification.authorized,
          authorized: clientVerification.authorized,
          ssid: clientVerification.ssid,
          networkSummary: clientVerification.networkSummary,
          reason: clientVerification.reason,
          state: "connected",
          stage: clientVerification.stage,
          timestamp: clientVerification.timestamp,
          isNativeBridge: true,
        };
        setStatus(resolvedStatus);
        setLastChecked(new Date());
        return resolvedStatus;
      }

      // ==============================================================
      // 2. WEB BROWSER FALLBACK (Chrome on Android or Desktop)
      // Browsers cannot access Wi-Fi SSID directly. Never fabricate!
      // ==============================================================
      const isOnline = typeof navigator !== "undefined" && navigator.onLine;

      // Call backend /api/wifi-status
      let backendStatus: WifiStatus | null = null;
      try {
        const res = await fetch("/api/wifi-status", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (res.ok) {
          backendStatus = await res.json();
        }
      } catch {
        // backend unreachable
      }

      // If backend was able to identify an OS-level SSID (e.g. running on Windows dev server):
      if (backendStatus && backendStatus.ssid && backendStatus.ssid !== "Unavailable" && backendStatus.ssid !== "SSID_UNAVAILABLE") {
        backendStatus.isNativeBridge = false;
        setStatus(backendStatus);
        setLastChecked(new Date());
        return backendStatus;
      }

      // Standard browser cannot access client Wi-Fi SSID: Mark as FAILED / SSID_UNAVAILABLE
      const browserFallback: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        ssid: "Unavailable",
        state: isOnline ? "connected" : "disconnected",
        reason: isOnline
          ? "Browser cannot access the connected Wi-Fi SSID. Use the Android attendance app to verify campus Wi-Fi."
          : "Device is offline. Connect to Wi-Fi using the Android attendance app.",
        networkSummary: "Unauthorized Wi-Fi network",
        stage: "UNABLE_TO_VERIFY",
        timestamp: new Date().toISOString(),
        isNativeBridge: false,
      };

      setStatus(browserFallback);
      setLastChecked(new Date());
      return browserFallback;
    } catch {
      const errorStatus: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        ssid: "Unavailable",
        state: "unknown",
        reason: "Browser cannot access the connected Wi-Fi SSID. Use the Android attendance app to verify campus Wi-Fi.",
        timestamp: new Date().toISOString(),
        networkSummary: "Unauthorized Wi-Fi network",
        stage: "UNABLE_TO_VERIFY",
        isNativeBridge: false,
      };
      setStatus(errorStatus);
      setLastChecked(new Date());
      return errorStatus;
    } finally {
      setIsLoading(false);
      setIsChecking(false);
    }
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
    isNativeBridge: hasNativeBridge,
    checkConnection: () => fetchWifiStatus(true),
    requestPermissions: requestNativeWifiPermissions,
  };
}
