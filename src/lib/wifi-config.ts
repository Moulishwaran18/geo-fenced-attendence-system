/**
 * Pure SSID Name-Based Campus Wi-Fi Verification Engine
 *
 * ONLY SSID NAME-BASED AUTHENTICATION:
 *
 * The ONLY factor used for Wi-Fi authorization is the ACTUAL connected
 * Wi-Fi SSID obtained from the Android native Wi-Fi bridge.
 *
 * Normalization:
 * 1. trim leading/trailing whitespace
 * 2. convert to lowercase
 *
 * Rules:
 * - RULE 1: normalized SSID === "m" -> AUTHORIZED
 *   Examples: "M", "m", " M " -> AUTHORIZED
 *   Rejections: "M-WIFI", "MY", "MM", "MY-M", "MyWiFi", "Campus-M" -> FAILED
 *
 * - RULE 2: normalized SSID contains "sona" -> AUTHORIZED
 *   Examples: "SONA", "sona", "SONA-WIFI", "Sona-Wifi", "sona wifi", "MY-SONA-NETWORK" -> AUTHORIZED
 *
 * - Everything else -> FAILED
 *   Examples: "Oppo K13", "Home WiFi", "JioFiber", "Airtel", "CampusGuest" -> FAILED
 *
 * - Unavailable / Unknown / Empty -> FAILED
 *   null, undefined, "", "Unknown", "Unavailable", "<unknown ssid>", "SSID_UNAVAILABLE" -> FAILED
 *   NEVER convert an unavailable SSID into M or SONA.
 */

export interface WifiVerificationPayload {
  ssid?: string | null | undefined;
  state?: "connected" | "disconnected" | "unknown" | undefined;
  signal?: string | undefined;
  band?: string | undefined;
  auth?: string | undefined;
}

export interface WifiVerificationResult {
  authorized: boolean;
  stage: "DISCONNECTED" | "SSID_CHECK_FAILED" | "UNABLE_TO_VERIFY" | "VERIFIED";
  reason: string;
  ssid: string;
  networkSummary: string;
  timestamp: string;
  signal?: string | undefined;
  band?: string | undefined;
  auth?: string | undefined;
}

export interface WifiStatus {
  isSonaWifi: boolean;
  authorized: boolean;
  ssid: string;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
  networkSummary: string;
  stage?: WifiVerificationResult["stage"] | undefined;
  signal?: string | undefined;
  band?: string | undefined;
  auth?: string | undefined;
  permissionDenied?: boolean | undefined;
  locationDisabled?: boolean | undefined;
  isNativeBridge?: boolean | undefined;
}

export const AUTHORIZED_SSIDS = ["M", "SONA-WIFI"];

/**
 * Validates whether an SSID passes pure campus name rules:
 * - normalized === "m"
 * - OR normalized.includes("sona")
 */
export function isSsidAuthorized(ssid?: string | null | undefined): boolean {
  if (ssid === null || ssid === undefined) return false;
  const trimmed = String(ssid).trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase();

  // Rejection of placeholder strings
  if (
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "hidden" ||
    normalized === "<unknown ssid>" ||
    normalized === "none" ||
    normalized === "ssid_unavailable" ||
    normalized === "unavailable in browser"
  ) {
    return false;
  }

  // RULE 1: normalized SSID === "m" -> AUTHORIZED
  if (normalized === "m") {
    return true;
  }

  // RULE 2: normalized SSID contains "sona" -> AUTHORIZED
  if (normalized.includes("sona")) {
    return true;
  }

  return false;
}

/**
 * Validates Wi-Fi connection using ONLY pure SSID name matching.
 * No IP, CIDR, gateway, DNS, or BSSID logic.
 */
export function verifyCampusWifi(payload: WifiVerificationPayload): WifiVerificationResult {
  const timestamp = new Date().toISOString();
  const rawSsid = (payload.ssid ?? "").trim().replace(/^["']|["']$/g, "");
  const state = payload.state || "unknown";

  // 1. DISCONNECTED CHECK
  if (state === "disconnected") {
    return {
      authorized: false,
      stage: "DISCONNECTED",
      reason: "Device is disconnected from Wi-Fi. Connect to an authorized campus network (M or SONA).",
      ssid: rawSsid || "None",
      networkSummary: "Unable to determine Wi-Fi name",
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 2. EMPTY / UNKNOWN / UNAVAILABLE CHECK
  const normalized = rawSsid.toLowerCase();
  const isMissing =
    !rawSsid ||
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "hidden" ||
    normalized === "<unknown ssid>" ||
    normalized === "none" ||
    normalized === "ssid_unavailable" ||
    normalized === "unavailable in browser";

  if (isMissing) {
    return {
      authorized: false,
      stage: "UNABLE_TO_VERIFY",
      reason: "Wi-Fi SSID is unavailable. Ensure device is connected to Wi-Fi with location permissions enabled in the Android attendance app.",
      ssid: "Unavailable",
      networkSummary: "Unable to determine Wi-Fi name",
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 3. AUTHORIZED SSID CHECK (RULE 1: exact "m", RULE 2: contains "sona")
  if (isSsidAuthorized(rawSsid)) {
    return {
      authorized: true,
      stage: "VERIFIED",
      reason: `Verified Campus Wi-Fi "${rawSsid}"`,
      ssid: rawSsid,
      networkSummary: rawSsid,
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 4. UNAUTHORIZED SSID
  return {
    authorized: false,
    stage: "SSID_CHECK_FAILED",
    reason: `Unauthorized Wi-Fi network "${rawSsid}". Only authorized campus networks (SSID "M" or containing "SONA") are permitted.`,
    ssid: rawSsid,
    networkSummary: rawSsid,
    timestamp,
    signal: payload.signal,
    band: payload.band,
    auth: payload.auth,
  };
}
