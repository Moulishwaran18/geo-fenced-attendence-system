import { useCallback, useEffect, useState } from "react";
import { verifyCampusWifi, isAuthorizedCampusBssid, type WifiStatus } from "@/lib/wifi-config";
import {
  getNativeConnectedWifi,
  isNativeWifiBridgeAvailable,
  requestNativeWifiPermissions,
  openNativeLocationSettings,
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
  openLocationSettings: () => boolean;
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
      // Genuine source of real connected Wi-Fi SSID & BSSID from Android OS
      // ==============================================================
      if (nativeAvailable) {
        let nativeWifi = getNativeConnectedWifi();

        // Warmup retry: if connected to Wi-Fi with permissions, wait briefly for Android NetworkCallback to deliver BSSID & SSID
        if (
          (!nativeWifi.bssid || !nativeWifi.ssid) &&
          nativeWifi.connected &&
          nativeWifi.transport === "wifi" &&
          nativeWifi.permissionGranted !== false &&
          nativeWifi.locationEnabled !== false
        ) {
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            const retry = getNativeConnectedWifi();
            if (retry.bssid || retry.ssid) {
              nativeWifi = retry;
              if (retry.bssid) break;
            }
          }
        }

        // 1A. Permission Denied
        if (nativeWifi.permissionGranted === false) {
          // Proactively prompt user via native Activity permission request
          requestNativeWifiPermissions();
          const permDeniedStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "Permission Denied",
            networkType: "UNAVAILABLE",
            state: "connected",
            reason: "Location/Wi-Fi permission denied. Please grant permissions to allow reading the Wi-Fi network name and BSSID.",
            networkSummary: "Permission Denied",
            stage: "UNABLE_TO_VERIFY",
            errorCode: "PERMISSION_DENIED",
            permissionDenied: true,
            apiLevel: nativeWifi.apiLevel,
            hasFineLocation: nativeWifi.hasFineLocation,
            hasNearbyWifi: nativeWifi.hasNearbyWifi,
            ssidSource: nativeWifi.ssidSource,
            bssidSource: nativeWifi.bssidSource,
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
            reason: "Device location is turned off. Android requires location to be enabled to read Wi-Fi network BSSID and SSID.",
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
            reason: "Device is connected to mobile data, not campus Wi-Fi. Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
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
            reason: "Device is disconnected from Wi-Fi. Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
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
            reason: "Network transport is not Wi-Fi. Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
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

        // 1F. BSSID Unavailable / Hidden / Restricted
        if (
          !nativeWifi.bssid ||
          nativeWifi.bssid === "02:00:00:00:00:00" ||
          nativeWifi.bssid === "BSSID_UNAVAILABLE" ||
          nativeWifi.bssid === "00:00:00:00:00:00"
        ) {
          const bssidUnavailableStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: "BSSID Unavailable",
            networkType: "UNAVAILABLE",
            state: "connected",
            reason: nativeWifi.bssidDiagnostic
              ? `Campus Wi-Fi verification failed: BSSID unavailable (${nativeWifi.bssidDiagnostic}). Ensure location services and permissions are granted.`
              : "Campus Wi-Fi verification failed: Access point BSSID is unavailable or restricted. Please ensure location services are enabled and permissions are granted.",
            networkSummary: "BSSID Unavailable",
            stage: "UNABLE_TO_VERIFY",
            errorCode: "BSSID_UNAVAILABLE",
            bssid: undefined,
            rawBssid: nativeWifi.rawBssid || undefined,
            bssidDiagnostic: nativeWifi.bssidDiagnostic || undefined,
            bssidVerified: false,
            apiLevel: nativeWifi.apiLevel,
            hasFineLocation: nativeWifi.hasFineLocation,
            hasNearbyWifi: nativeWifi.hasNearbyWifi,
            isLocationEnabled: nativeWifi.locationEnabled,
            ssidSource: nativeWifi.ssidSource,
            bssidSource: nativeWifi.bssidSource,
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(bssidUnavailableStatus);
          setLastChecked(new Date());
          return bssidUnavailableStatus;
        }

        // 1G. BSSID Mismatch check (Compare normalized uppercase BSSID against approved campus BSSIDs)
        const cleanBssid = nativeWifi.bssid.trim().replace(/^["']|["']$/g, "").toUpperCase();
        if (!isAuthorizedCampusBssid(cleanBssid)) {
          const bssidMismatchStatus: WifiStatus = {
            isSonaWifi: false,
            authorized: false,
            network: cleanBssid,
            networkType: "UNAUTHORIZED",
            state: "connected",
            reason: "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
            networkSummary: cleanBssid,
            stage: "FINGERPRINT_CHECK_FAILED",
            errorCode: "UNAUTHORIZED_BSSID",
            bssid: cleanBssid,
            rawBssid: nativeWifi.rawBssid || cleanBssid,
            bssidDiagnostic: nativeWifi.bssidDiagnostic || undefined,
            bssidVerified: false,
            apiLevel: nativeWifi.apiLevel,
            hasFineLocation: nativeWifi.hasFineLocation,
            hasNearbyWifi: nativeWifi.hasNearbyWifi,
            isLocationEnabled: nativeWifi.locationEnabled,
            ssidSource: nativeWifi.ssidSource,
            bssidSource: nativeWifi.bssidSource,
            timestamp: now,
            isNativeBridge: true,
          };
          setStatus(bssidMismatchStatus);
          setLastChecked(new Date());
          return bssidMismatchStatus;
        }

        // 1H. Wi-Fi connected with matching BSSID: submit to Vercel API for authoritative authorization & token minting
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
              bssid: cleanBssid,
              rawBssid: nativeWifi.rawBssid,
              bssidDiagnostic: nativeWifi.bssidDiagnostic,
              transport: nativeWifi.transport,
              connected: nativeWifi.connected,
              permissionGranted: nativeWifi.permissionGranted,
              locationEnabled: nativeWifi.locationEnabled,
              reason: nativeWifi.reason,
              apiLevel: nativeWifi.apiLevel,
              hasFineLocation: nativeWifi.hasFineLocation,
              hasNearbyWifi: nativeWifi.hasNearbyWifi,
              ssidSource: nativeWifi.ssidSource,
              bssidSource: nativeWifi.bssidSource,
            }),
            cache: "no-store",
          });

          if (res.ok) {
            const data: WifiStatus = await res.json();
            data.isNativeBridge = true;
            data.bssid = cleanBssid;
            data.rawBssid = nativeWifi.rawBssid || cleanBssid;
            data.bssidDiagnostic = nativeWifi.bssidDiagnostic;
            data.bssidSource = nativeWifi.bssidSource;
            data.isLocationEnabled = nativeWifi.locationEnabled;
            data.bssidVerified = data.authorized;
            setStatus(data);
            setLastChecked(new Date());
            return data;
          } else {
            const errData: any = await res.json().catch(() => ({}));
            const failStatus: WifiStatus = {
              isSonaWifi: false,
              authorized: false,
              network: cleanBssid,
              networkType: "UNAUTHORIZED",
              state: "connected",
              reason: errData?.reason || "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi.",
              networkSummary: cleanBssid,
              stage: "FINGERPRINT_CHECK_FAILED",
              errorCode: errData?.errorCode || `HTTP_${res.status}`,
              bssid: cleanBssid,
              bssidVerified: false,
              apiLevel: nativeWifi.apiLevel,
              hasFineLocation: nativeWifi.hasFineLocation,
              hasNearbyWifi: nativeWifi.hasNearbyWifi,
              ssidSource: nativeWifi.ssidSource,
              bssidSource: nativeWifi.bssidSource,
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
            bssid: cleanBssid,
            transport: nativeWifi.transport,
            connected: nativeWifi.connected,
            permissionGranted: nativeWifi.permissionGranted,
            locationEnabled: nativeWifi.locationEnabled,
            isNativeBridge: true,
          });

          const resolvedStatus: WifiStatus = {
            isSonaWifi: clientVerification.authorized,
            authorized: clientVerification.authorized,
            network: clientVerification.network || cleanBssid,
            networkType: clientVerification.networkType,
            networkSummary: clientVerification.networkSummary,
            reason: clientVerification.reason,
            state: "connected",
            stage: clientVerification.stage,
            timestamp: clientVerification.timestamp,
            ssid: nativeWifi.ssid || undefined,
            bssid: cleanBssid,
            bssidVerified: clientVerification.authorized,
            errorCode: clientVerification.errorCode,
            apiLevel: nativeWifi.apiLevel,
            hasFineLocation: nativeWifi.hasFineLocation,
            hasNearbyWifi: nativeWifi.hasNearbyWifi,
            ssidSource: nativeWifi.ssidSource,
            bssidSource: nativeWifi.bssidSource,
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

    const handleNativeUpdate = () => {
      void fetchWifiStatus(true);
    };

    if (typeof window !== "undefined") {
      (window as any).__onAndroidPermissionsChanged = handleNativeUpdate;
      (window as any).__onAndroidResume = handleNativeUpdate;
    }

    window.addEventListener("focus", handleFocusOrOnline);
    window.addEventListener("online", handleFocusOrOnline);
    window.addEventListener("offline", handleFocusOrOnline);

    return () => {
      clearInterval(interval);
      if (typeof window !== "undefined") {
        delete (window as any).__onAndroidPermissionsChanged;
        delete (window as any).__onAndroidResume;
      }
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
    openLocationSettings: openNativeLocationSettings,
  };
}
