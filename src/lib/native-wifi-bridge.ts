/**
 * Native Android Wi-Fi Bridge Client Interface
 *
 * Facilitates communication with Android native Wi-Fi services:
 * - Checks if running inside the Android Native attendance application
 * - Waits for native bridge initialization to avoid race conditions
 * - Requests real connected Wi-Fi SSID
 * - Distinguishes between Wi-Fi, Cellular, and Offline connections
 * - Handles runtime permission checks and device location requirements
 */

import { isAuthorizedCampusBssid } from "./wifi-config";

export interface NativeConnectedWifi {
  connected: boolean;
  transport: "wifi" | "cellular" | "ethernet" | "none" | "other" | "unknown";
  ssid: string | null;
  bssid: string | null;
  bssidVerified?: boolean | undefined;
  permissionGranted: boolean;
  locationEnabled?: boolean | undefined;
  apiLevel?: number | undefined;
  hasFineLocation?: boolean | undefined;
  hasNearbyWifi?: boolean | undefined;
  ssidSource?: string | undefined;
  bssidSource?: string | undefined;
  reason:
    | "SUCCESS"
    | "CELLULAR_DATA"
    | "DISCONNECTED"
    | "NOT_WIFI"
    | "PERMISSION_DENIED"
    | "LOCATION_SERVICES_DISABLED"
    | "SSID_UNAVAILABLE"
    | "BSSID_UNAVAILABLE"
    | "UNAUTHORIZED_BSSID"
    | "NO_NATIVE_BRIDGE"
    | string;
}

export interface NativeNetworkFingerprint {
  transport: "wifi" | "cellular" | "ethernet" | "none" | "other" | "unknown";
  isWifi: boolean;
  ssid?: string | null;
  bssid?: string | null;
  bssidVerified?: boolean | undefined;
  bssidSource?: string | undefined;
  ipv4?: string | null;
  ipv4Subnet?: string | null;
  prefixLength?: number;
  gateway?: string | null;
  dnsServers?: string[];
  hasInternet?: boolean;
  notVpn?: boolean;
  reason?: string;
  isNativeBridge?: boolean;
}

/**
 * Checks whether the current runtime environment is the native Android APK.
 * Detects either already injected bridge or custom UserAgent token set by MainActivity.
 */
export function isNativeAppEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as any).AndroidWifiBridge) return true;
  if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.includes("CampusAttendNative")) {
    return true;
  }
  return false;
}

/**
 * Waits for AndroidWifiBridge to become ready if running inside the native APK.
 * Eliminates startup race conditions where React mounts before WebView finishes JavaScript interface injection.
 */
export async function waitForNativeWifiBridge(maxWaitMs = 1500): Promise<any | null> {
  if (typeof window === "undefined") return null;
  if ((window as any).AndroidWifiBridge) return (window as any).AndroidWifiBridge;

  if (!isNativeAppEnvironment()) return null;

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if ((window as any).AndroidWifiBridge) {
      return (window as any).AndroidWifiBridge;
    }
  }
  return (window as any).AndroidWifiBridge || null;
}

/**
 * Checks whether the native Android Wi-Fi bridge is accessible right now.
 */
export function isNativeWifiBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as any).AndroidWifiBridge;
  return Boolean(
    bridge &&
      (typeof bridge.getConnectedWifi === "function" ||
        typeof bridge.getWifiSsid === "function" ||
        typeof bridge.getNetworkFingerprint === "function" ||
        typeof bridge.isAvailable === "function" ||
        typeof bridge.getWifiDetails === "function")
  );
}

/**
 * Prompts the native Android Activity to request Wi-Fi / Location permissions.
 */
export function requestNativeWifiPermissions(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as any).AndroidWifiBridge;
  if (bridge && typeof bridge.requestWifiPermissions === "function") {
    try {
      return Boolean(bridge.requestWifiPermissions());
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Prompts the native Android Activity to open system Location settings if disabled.
 */
export function openNativeLocationSettings(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as any).AndroidWifiBridge;
  if (bridge && typeof bridge.openLocationSettings === "function") {
    try {
      return Boolean(bridge.openLocationSettings());
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Obtains the real connected Wi-Fi information from the native Android bridge.
 * If running in a standard web browser (Chrome on Android or Desktop),
 * reports NO_NATIVE_BRIDGE / SSID_UNAVAILABLE without fabricating values.
 */
export function getNativeConnectedWifi(): NativeConnectedWifi {
  if (typeof window === "undefined") {
    return {
      connected: false,
      transport: "unknown",
      ssid: null,
      bssid: null,
      permissionGranted: false,
      reason: "NO_NATIVE_BRIDGE",
    };
  }

  const bridge = (window as any).AndroidWifiBridge;
  if (!bridge) {
    return {
      connected: false,
      transport: "unknown",
      ssid: null,
      bssid: null,
      permissionGranted: false,
      reason: "NO_NATIVE_BRIDGE",
    };
  }

  // 1. Primary: modern getConnectedWifi()
  if (typeof bridge.getConnectedWifi === "function") {
    try {
      const raw = bridge.getConnectedWifi();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        const rawSsid = parsed.ssid ? String(parsed.ssid).trim().replace(/^["']|["']$/g, "") : null;
        const validSsid = rawSsid && rawSsid !== "<unknown ssid>" && rawSsid !== "0x" && rawSsid !== "SSID_UNAVAILABLE" ? rawSsid : null;
        
        let rawBssid = parsed.bssid ? String(parsed.bssid).trim().replace(/^["']|["']$/g, "").toUpperCase() : null;
        if (!rawBssid && typeof bridge.getWifiBssid === "function") {
          try {
            const b = String(bridge.getWifiBssid()).trim().replace(/^["']|["']$/g, "").toUpperCase();
            if (b && b !== "BSSID_UNAVAILABLE") rawBssid = b;
          } catch {}
        }
        if (
          !rawBssid ||
          rawBssid === "02:00:00:00:00:00" ||
          rawBssid === "00:00:00:00:00:00" ||
          rawBssid === "UNKNOWN" ||
          rawBssid === "BSSID_UNAVAILABLE" ||
          rawBssid === "NULL"
        ) {
          rawBssid = null;
        }

        const isBssidMatched = isAuthorizedCampusBssid(rawBssid);

        return {
          connected: Boolean(parsed.connected),
          transport: parsed.transport || (parsed.connected ? "wifi" : "unknown"),
          ssid: validSsid,
          bssid: rawBssid,
          bssidVerified: parsed.bssidVerified ?? isBssidMatched,
          bssidSource: parsed.bssidSource ?? undefined,
          permissionGranted: parsed.permissionGranted ?? true,
          locationEnabled: parsed.locationEnabled ?? true,
          apiLevel: parsed.apiLevel ?? undefined,
          hasFineLocation: parsed.hasFineLocation ?? undefined,
          hasNearbyWifi: parsed.hasNearbyWifi ?? undefined,
          ssidSource: parsed.ssidSource ?? undefined,
          reason: parsed.reason || (isBssidMatched ? "SUCCESS" : (rawBssid ? "UNAUTHORIZED_BSSID" : "BSSID_UNAVAILABLE")),
        };
      }
    } catch (e) {
      console.warn("[NativeWifiBridge] Failed to parse getConnectedWifi:", e);
    }
  }

  // 2. Direct string query getWifiSsid() & getWifiBssid()
  if (typeof bridge.getWifiSsid === "function" || typeof bridge.getWifiBssid === "function") {
    try {
      const raw = typeof bridge.getWifiSsid === "function" ? String(bridge.getWifiSsid()).trim().replace(/^["']|["']$/g, "") : "";
      const valid = raw && raw !== "SSID_UNAVAILABLE" && raw !== "<unknown ssid>" && raw !== "0x" ? raw : null;

      let directBssid: string | null = null;
      if (typeof bridge.getWifiBssid === "function") {
        try {
          const b = String(bridge.getWifiBssid()).trim().replace(/^["']|["']$/g, "").toUpperCase();
          if (b && b !== "BSSID_UNAVAILABLE" && b !== "02:00:00:00:00:00") directBssid = b;
        } catch {}
      }

      if (valid || directBssid) {
        const isBssidMatched = isAuthorizedCampusBssid(directBssid);
        return {
          connected: true,
          transport: "wifi",
          ssid: valid,
          bssid: directBssid,
          bssidVerified: isBssidMatched,
          permissionGranted: true,
          locationEnabled: true,
          reason: isBssidMatched ? "SUCCESS" : (directBssid ? "UNAUTHORIZED_BSSID" : "BSSID_UNAVAILABLE"),
        };
      }
    } catch (e) {
      console.warn("[NativeWifiBridge] Failed to call getWifiSsid/getWifiBssid:", e);
    }
  }

  // 3. Fallback: getWifiDetails()
  if (typeof bridge.getWifiDetails === "function") {
    try {
      const raw = bridge.getWifiDetails();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        const isWifi = Boolean(parsed.isWifi ?? (parsed.state === "connected"));
        const rawSsid = parsed.ssid ? String(parsed.ssid).trim().replace(/^["']|["']$/g, "") : null;
        const validSsid = rawSsid && rawSsid !== "<unknown ssid>" && rawSsid !== "0x" ? rawSsid : null;
        let rawBssid = parsed.bssid ? String(parsed.bssid).trim().replace(/^["']|["']$/g, "").toUpperCase() : null;
        if (rawBssid === "02:00:00:00:00:00" || rawBssid === "00:00:00:00:00:00") rawBssid = null;
        const isBssidMatched = isAuthorizedCampusBssid(rawBssid);

        return {
          connected: isWifi,
          transport: isWifi ? "wifi" : "unknown",
          ssid: validSsid,
          bssid: rawBssid,
          bssidVerified: isBssidMatched,
          permissionGranted: true,
          locationEnabled: true,
          reason: isBssidMatched ? "SUCCESS" : (rawBssid ? "UNAUTHORIZED_BSSID" : "BSSID_UNAVAILABLE"),
        };
      }
    } catch (e) {
      console.warn("[NativeWifiBridge] Failed to parse getWifiDetails:", e);
    }
  }

  return {
    connected: false,
    transport: "unknown",
    ssid: null,
    bssid: null,
    permissionGranted: false,
    reason: "BSSID_UNAVAILABLE",
  };
}

/**
 * Asynchronous/promise-safe helper to obtain the native SSID.
 */
export async function getNativeWifiSsid(): Promise<string | null> {
  await waitForNativeWifiBridge(1000);
  if (!isNativeWifiBridgeAvailable()) {
    return null;
  }
  const wifi = getNativeConnectedWifi();
  return wifi.connected && wifi.transport === "wifi" ? wifi.ssid : null;
}

/**
 * Asynchronous/promise-safe helper to obtain the native BSSID.
 */
export async function getNativeWifiBssid(): Promise<string | null> {
  await waitForNativeWifiBridge(1000);
  if (!isNativeWifiBridgeAvailable()) {
    return null;
  }
  const wifi = getNativeConnectedWifi();
  return wifi.connected && wifi.transport === "wifi" ? wifi.bssid : null;
}

/**
 * Obtains the real connected network-level fingerprint from the native Android bridge.
 */
export function getNativeNetworkFingerprint(): NativeNetworkFingerprint {
  if (typeof window === "undefined") {
    return {
      transport: "unknown",
      isWifi: false,
      reason: "NO_NATIVE_BRIDGE",
      isNativeBridge: false,
    };
  }

  const bridge = (window as any).AndroidWifiBridge;
  if (!bridge) {
    return {
      transport: "unknown",
      isWifi: false,
      reason: "NO_NATIVE_BRIDGE",
      isNativeBridge: false,
    };
  }

  if (typeof bridge.getNetworkFingerprint === "function") {
    try {
      const raw = bridge.getNetworkFingerprint();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        let bssid = parsed.bssid ? String(parsed.bssid).trim().replace(/^["']|["']$/g, "").toUpperCase() : null;
        if (bssid === "02:00:00:00:00:00" || bssid === "00:00:00:00:00:00") bssid = null;
        return {
          transport: parsed.transport || "unknown",
          isWifi: Boolean(parsed.isWifi),
          ssid: parsed.ssid || null,
          bssid: bssid || null,
          bssidVerified: Boolean(parsed.bssidVerified ?? isAuthorizedCampusBssid(bssid)),
          bssidSource: parsed.bssidSource || undefined,
          ipv4: parsed.ipv4 || null,
          ipv4Subnet: parsed.ipv4Subnet || null,
          prefixLength: parsed.prefixLength || 0,
          gateway: parsed.gateway || null,
          dnsServers: Array.isArray(parsed.dnsServers) ? parsed.dnsServers : [],
          hasInternet: Boolean(parsed.hasInternet),
          notVpn: Boolean(parsed.notVpn ?? true),
          reason: parsed.reason || "SUCCESS",
          isNativeBridge: true,
        };
      }
    } catch (e) {
      console.warn("[NativeWifiBridge] Failed to parse getNetworkFingerprint:", e);
    }
  }

  const conn = getNativeConnectedWifi();
  return {
    transport: conn.transport,
    isWifi: conn.transport === "wifi",
    ssid: conn.ssid,
    bssid: conn.bssid,
    bssidVerified: conn.bssidVerified,
    bssidSource: conn.bssidSource,
    reason: conn.reason,
    isNativeBridge: true,
  };
}
