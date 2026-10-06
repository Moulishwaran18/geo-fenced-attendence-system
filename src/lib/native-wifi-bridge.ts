/**
 * Native Android Wi-Fi Bridge Client Interface
 *
 * Facilitates communication with Android native Wi-Fi services:
 * - Checks if running inside the Android Native attendance application
 * - Requests real connected Wi-Fi SSID
 * - Distinguishes between Wi-Fi, Cellular, and Offline connections
 * - Handles runtime permission checks and device location requirements
 */

export interface NativeConnectedWifi {
  connected: boolean;
  transport: "wifi" | "cellular" | "ethernet" | "none" | "other" | "unknown";
  ssid: string | null;
  permissionGranted: boolean;
  locationEnabled?: boolean;
  reason:
    | "SUCCESS"
    | "CELLULAR_DATA"
    | "DISCONNECTED"
    | "NOT_WIFI"
    | "PERMISSION_DENIED"
    | "LOCATION_SERVICES_DISABLED"
    | "SSID_UNAVAILABLE"
    | "NO_NATIVE_BRIDGE"
    | string;
}

/**
 * Checks whether the native Android Wi-Fi bridge is accessible in the current execution environment.
 */
export function isNativeWifiBridgeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as any).AndroidWifiBridge;
  return Boolean(
    bridge &&
      (typeof bridge.getWifiSsid === "function" ||
        typeof bridge.getConnectedWifi === "function" ||
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
      permissionGranted: false,
      reason: "NO_NATIVE_BRIDGE",
    };
  }

  // 1. Try modern getConnectedWifi()
  if (typeof bridge.getConnectedWifi === "function") {
    try {
      const raw = bridge.getConnectedWifi();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        return {
          connected: Boolean(parsed.connected),
          transport: parsed.transport || (parsed.connected ? "wifi" : "unknown"),
          ssid: parsed.ssid || null,
          permissionGranted: parsed.permissionGranted ?? true,
          locationEnabled: parsed.locationEnabled ?? true,
          reason: parsed.reason || (parsed.ssid ? "SUCCESS" : "SSID_UNAVAILABLE"),
        };
      }
    } catch (e) {
      console.warn("[NativeWifiBridge] Failed to parse getConnectedWifi:", e);
    }
  }

  // 2. Fallback to getWifiDetails()
  if (typeof bridge.getWifiDetails === "function") {
    try {
      const raw = bridge.getWifiDetails();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        const isWifi = Boolean(parsed.isWifi ?? (parsed.state === "connected"));
        const rawSsid = parsed.ssid
          ? String(parsed.ssid).trim().replace(/^["']|["']$/g, "")
          : null;
        const validSsid =
          rawSsid && rawSsid !== "<unknown ssid>" && rawSsid !== "0x" ? rawSsid : null;
        return {
          connected: isWifi,
          transport: isWifi ? "wifi" : "unknown",
          ssid: validSsid,
          permissionGranted: true,
          locationEnabled: true,
          reason: validSsid ? "SUCCESS" : "SSID_UNAVAILABLE",
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
    permissionGranted: false,
    reason: "SSID_UNAVAILABLE",
  };
}

/**
 * Asynchronous/promise-safe helper to obtain the native SSID.
 * Follows: window.AndroidWifiBridge.getWifiSsid()
 */
export async function getNativeWifiSsid(): Promise<string | null> {
  if (!isNativeWifiBridgeAvailable()) {
    return null;
  }
  const wifi = getNativeConnectedWifi();
  return wifi.connected && wifi.transport === "wifi" ? wifi.ssid : null;
}

