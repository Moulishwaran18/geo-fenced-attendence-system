import { useCallback, useEffect, useState } from "react";
import { verifyCampusWifi, type WifiStatus } from "@/lib/wifi-config";
import {
  getNativeConnectedWifi,
  isNativeWifiBridgeAvailable,
  requestNativeWifiPermissions,
  waitForNativeWifiBridge,
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

export function useWifiStatus(pollIntervalMs = 6000): UseWifiStatusReturn {
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
      // 1. Ensure bridge is initialized in native APK environment to eliminate startup race conditions
      await waitForNativeWifiBridge(1500);
      const nativeAvailable = isNativeWifiBridgeAvailable();
      setHasNativeBridge(nativeAvailable);

      const now = new Date().toISOString();

      // ==============================================================
      // 1. NATIVE ANDROID BRIDGE (App running in Android APK)
      // Genuine source of real connected Wi-Fi SSID from Android OS
      // ==============================================================
      if (nativeAvailable) {
        const nativeWifi = getNativeConnectedWifi();

        // 1A. Permission Denied
        if (nativeWifi.permissionGranted === false) {
          const permDeniedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Permission Denied",
            networkType: "UNAVAILABLE",
            state: "connected",
            reason: "Location/Wi-Fi permission denied. Please grant permissions to allow reading the Wi-Fi network name.",
            networkSummary: "Permission Denied",
            stage: "UNABLE_TO_VERIFY",
            errorCode: "PERMISSION_DENIED",
            permissionDenied: true,
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(permDeniedStatus);
          setLastChecked(new Date());
          return permDeniedStatus;
        }

        // 1B. Location Services Disabled on device
        if (nativeWifi.locationEnabled === false) {
          const locDisabledStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Location Disabled",
            networkType: "UNAVAILABLE",
            state: "connected",
            reason: "Device location is turned off. Android requires location to be enabled to read Wi-Fi network SSID.",
            networkSummary: "Location Disabled",
            stage: "UNABLE_TO_VERIFY",
            errorCode: "LOCATION_SERVICES_DISABLED",
            locationDisabled: true,
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(locDisabledStatus);
          setLastChecked(new Date());
          return locDisabledStatus;
        }

        // 1C. Cellular / Mobile data (Strictly rejected)
        if (nativeWifi.transport === "cellular") {
          const mobileStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Mobile Data",
            networkType: "UNAUTHORIZED",
            state: "connected",
            reason: "Device is connected to mobile data, not campus Wi-Fi. Connect to a Wi-Fi network containing 'sona'.",
            networkSummary: "Mobile Data",
            stage: "FINGERPRINT_CHECK_FAILED",
            errorCode: "CELLULAR_DATA",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(mobileStatus);
          setLastChecked(new Date());
          return mobileStatus;
        }

        // 1D. Disconnected from all networks
        if (nativeWifi.transport === "none" || (!nativeWifi.connected && nativeWifi.transport !== "wifi")) {
          const disconnectedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Disconnected",
            networkType: "UNAVAILABLE",
            state: "disconnected",
            reason: "Device is disconnected from Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
            networkSummary: "Disconnected",
            stage: "DISCONNECTED",
            errorCode: "DISCONNECTED",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(disconnectedStatus);
          setLastChecked(new Date());
          return disconnectedStatus;
        }

        // 1E. Other non-Wi-Fi transports (e.g. bluetooth, ethernet)
        if (nativeWifi.transport !== "wifi") {
          const nonWifiStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: nativeWifi.transport || "Non-Wi-Fi",
            networkType: "UNAUTHORIZED",
            state: "connected",
            reason: "Network transport is not Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
            networkSummary: nativeWifi.transport || "Non-Wi-Fi",
            stage: "FINGERPRINT_CHECK_FAILED",
            errorCode: "NOT_WIFI",
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(nonWifiStatus);
          setLastChecked(new Date());
          return nonWifiStatus;
        }

        // 1F. Wi-Fi connected: submit real native SSID to Vercel API for authoritative authorization & token minting
        try {
          const res = await fetch("/api/wifi-status", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              isNativeBridge: true,
              ssid: nativeWifi.ssid,
              transport: nativeWifi.transport,
              connected: nativeWifi.connected,
              permissionGranted: nativeWifi.permissionGranted,
              locationEnabled: nativeWifi.locationEnabled,
              reason: nativeWifi.reason,
            }),
            cache: "no-store",
          });

          if (res.ok) {
            const data: WifiStatus = await res.json();
            data.isNativeBridge = true;
            setStatus(data);
            setLastChecked(new Date());
            return data;
          } else {
            const errData: any = await res.json().catch(() => ({}));
            const failStatus: WifiStatus = {
              isSonaWifi: false,
              authorized: false,
              network: nativeWifi.ssid || "Unauthorized Network",
              networkType: "UNAUTHORIZED",
              state: "connected",
              reason: errData?.reason || `Verification server returned HTTP ${res.status}`,
              networkSummary: nativeWifi.ssid || "Unauthorized Network",
              stage: "FINGERPRINT_CHECK_FAILED",
              errorCode: errData?.errorCode || `HTTP_${res.status}`,
              timestamp: now,
              isNativeBridge: true,
            };
            setStatus(failStatus);
            setLastChecked(new Date());
            return failStatus;
          }
        } catch {
          // Fallback to local client verification if network glitch contacting /api/wifi-status
          const clientVerification = verifyCampusWifi({
            ssid: nativeWifi.ssid,
            transport: nativeWifi.transport,
            connected: nativeWifi.connected,
            permissionGranted: nativeWifi.permissionGranted,
            locationEnabled: nativeWifi.locationEnabled,
            isNativeBridge: true,
          });

          const resolvedStatus: WifiStatus = {
            isSonaWifi: clientVerification.authorized,
            authorized: clientVerification.authorized,
            network: clientVerification.network || nativeWifi.ssid || undefined,
            networkType: clientVerification.networkType,
            networkSummary: clientVerification.networkSummary,
            reason: clientVerification.reason,
            state: "connected",
            stage: clientVerification.stage,
            timestamp: clientVerification.timestamp,
            ssid: nativeWifi.ssid || undefined,
            errorCode: clientVerification.errorCode,
            isNativeBridge: true,
          };
          setStatus(resolvedStatus);
          setLastChecked(new Date());
          return resolvedStatus;
        }
      }

      // ==============================================================
      // 2. NORMAL ANDROID CHROME & DESKTOP BROWSER ENVIRONMENT
      // Standard web browsers cannot access Wi-Fi SSID for security/privacy.
      // Do NOT falsely claim the browser read the SSID.
      // Report explicit BROWSER_SSID_UNAVAILABLE without bypasses.
      // ==============================================================
      const isOnline = typeof navigator !== "undefined" && navigator.onLine;

      if (!isOnline) {
        const offlineStatus: WifiStatus = {
          isSonaWifi: false,
          authorized: false,
          network: "Disconnected",
          networkType: "UNAVAILABLE",
          state: "disconnected",
          reason: "Device is offline. Connect to Wi-Fi to verify network.",
          networkSummary: "Disconnected",
          stage: "DISCONNECTED",
          errorCode: "DISCONNECTED",
          timestamp: now,
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
          body: JSON.stringify({ isNativeBridge: false }),
          cache: "no-store",
        });

        if (res.ok) {
          const serverStatus: WifiStatus = await res.json();
          serverStatus.isNativeBridge = false;
          setStatus(serverStatus);
          setLastChecked(new Date());
          return serverStatus;
        } else {
          const errData: any = await res.json().catch(() => ({}));
          const httpErrStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Browser Sandbox",
            networkType: "UNAVAILABLE",
            state: "connected",
            reason: errData?.reason || "Standard browsers cannot detect Wi-Fi network name. Please open CampusAttend in the Android APK.",
            networkSummary: "Browser Sandbox",
            stage: "UNABLE_TO_VERIFY",
            errorCode: errData?.errorCode || "BROWSER_SSID_UNAVAILABLE",
            timestamp: now,
            isNativeBridge: false,
          };
          setStatus(httpErrStatus);
          setLastChecked(new Date());
          return httpErrStatus;
        }
      } catch (networkErr) {
        console.warn("[useWifiStatus] Network check fetch error:", networkErr);
      }

      const browserFallback: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        network: "Browser Sandbox",
        networkType: "UNAVAILABLE",
        state: "connected",
        reason: "Standard web browsers cannot detect Wi-Fi SSID. Please open CampusAttend in the Android APK to verify your Wi-Fi connection.",
        networkSummary: "Browser Sandbox",
        stage: "UNABLE_TO_VERIFY",
        errorCode: "BROWSER_SSID_UNAVAILABLE",
        timestamp: now,
        isNativeBridge: false,
      };

      setStatus(browserFallback);
      setLastChecked(new Date());
      return browserFallback;
    } catch {
      const errorStatus: WifiStatus = {
        isSonaWifi: false,
        authorized: false,
        network: "Unavailable",
        networkType: "UNAVAILABLE",
        state: "unknown",
        reason: "Unable to verify campus network. Please check network connection.",
        timestamp: new Date().toISOString(),
        networkSummary: "Verification Error",
        stage: "UNABLE_TO_VERIFY",
        errorCode: "CLIENT_EXCEPTION",
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
