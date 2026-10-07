import { useCallback, useEffect, useState } from "react";
import { verifyCampusWifi, type WifiStatus } from "@/lib/wifi-config";
import {
  getNativeNetworkFingerprint,
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
      // Genuine source of connected network layer properties:
      // LinkProperties, ConnectivityManager, NetworkCapabilities, Routes, DNS
      // ==============================================================
      if (nativeAvailable) {
        const fp = getNativeNetworkFingerprint();
        const now = new Date().toISOString();

        // 1A. Cellular / Mobile data (Strictly rejected — not campus Wi-Fi)
        if (fp.transport === "cellular") {
          const mobileStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            networkType: "UNAUTHORIZED",
            state: "connected",
            reason: "Device is connected to mobile data, not campus Wi-Fi.",
            networkSummary: "Mobile Data",
            stage: "FINGERPRINT_CHECK_FAILED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(mobileStatus);
          setLastChecked(new Date());
          return mobileStatus;
        }

        // 1B. Disconnected from all networks
        if (fp.transport === "none" || (!fp.isWifi && fp.transport !== "wifi")) {
          const disconnectedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            networkType: "UNAVAILABLE",
            state: "disconnected",
            reason: "Device is disconnected from Wi-Fi. Please connect to M or SONA.",
            networkSummary: "Disconnected",
            stage: "DISCONNECTED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(disconnectedStatus);
          setLastChecked(new Date());
          return disconnectedStatus;
        }

        // 1C. Other non-Wi-Fi transports (e.g. bluetooth, ethernet)
        if (fp.transport !== "wifi") {
          const nonWifiStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            networkType: "UNAUTHORIZED",
            state: "connected",
            reason: "Network transport is not Wi-Fi. Please connect to M or SONA Wi-Fi.",
            networkSummary: fp.transport,
            stage: "FINGERPRINT_CHECK_FAILED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(nonWifiStatus);
          setLastChecked(new Date());
          return nonWifiStatus;
        }

        // 1D. Hardware Wi-Fi connected! Send observed network fingerprint to Vercel application
        try {
          const res = await fetch("/api/wifi-status", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              transport: fp.transport,
              isWifi: fp.isWifi,
              ipv4: fp.ipv4,
              ipv4Subnet: fp.ipv4Subnet,
              prefixLength: fp.prefixLength,
              gateway: fp.gateway,
              dnsServers: fp.dnsServers,
              hasInternet: fp.hasInternet,
              notVpn: fp.notVpn,
              state: "connected",
              isNativeBridge: true,
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
          // If network glitch contacting backend, use local authoritative verification
        }

        const clientVerification = verifyCampusWifi(fp);
        const resolvedStatus: WifiStatus = {
          isSonaWifi: clientVerification.authorized,
          authorized: clientVerification.authorized,
          networkType: clientVerification.networkType,
          networkSummary: clientVerification.networkSummary,
          reason: clientVerification.reason,
          state: "connected",
          stage: clientVerification.stage,
          timestamp: clientVerification.timestamp,
          ipv4: fp.ipv4 || undefined,
          gateway: fp.gateway || undefined,
          dnsServers: fp.dnsServers || undefined,
          ipv4Subnet: fp.ipv4Subnet || undefined,
          isNativeBridge: true,
        };
        setStatus(resolvedStatus);
        setLastChecked(new Date());
        return resolvedStatus;
      }

      // ==============================================================
      // 2. NORMAL ANDROID CHROME & DESKTOP BROWSER VERIFICATION
      // Normal Android Chrome does not use the APK native bridge.
      // The browser calls /api/wifi-status and Vercel determines
      // campus network authorization from the real incoming public egress IP.
      // ZERO CLIENT TRUST: The client provides NO authorization flag or spoofed IP.
      // ==============================================================
      const isOnline = typeof navigator !== "undefined" && navigator.onLine;

      if (!isOnline) {
        const offlineStatus: WifiStatus = {
          isSonaWifi: false,
          authorized: false,
          network: "Disconnected",
          networkType: "UNAVAILABLE",
          state: "disconnected",
          reason: "Device is offline. Connect to Wi-Fi to verify campus network.",
          networkSummary: "Disconnected",
          stage: "DISCONNECTED",
          timestamp: new Date().toISOString(),
          isNativeBridge: false,
        };
        setStatus(offlineStatus);
        setLastChecked(new Date());
        return offlineStatus;
      }

      try {
        const res = await fetch("/api/wifi-status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({}),
          cache: "no-store",
        });

        if (res.ok) {
          const serverStatus: WifiStatus = await res.json();
          serverStatus.isNativeBridge = false;
          setStatus(serverStatus);
          setLastChecked(new Date());
          return serverStatus;
        }
      } catch (networkErr) {
        console.warn("[useWifiStatus] Network check fetch error:", networkErr);
      }

      const browserFallback: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        network: "Unauthorized Network",
        networkType: "UNAUTHORIZED",
        state: "connected",
        reason: "Unable to verify campus network connection with verification server.",
        networkSummary: "Unable to verify network egress",
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
        network: "Unauthorized Network",
        networkType: "UNAVAILABLE",
        state: "unknown",
        reason: "Unable to verify campus network. Please check network connection.",
        timestamp: new Date().toISOString(),
        networkSummary: "Unable to verify network egress",
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
