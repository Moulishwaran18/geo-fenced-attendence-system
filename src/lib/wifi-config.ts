/**
 * Authoritative Campus Wi-Fi Verification Engine
 *
 * ONLY SSID NAME-BASED AUTHENTICATION:
 *
 * Condition 1 — "M" Network:
 * - The SSID must be exactly "M" or "m" (case-insensitive).
 * - "M" -> AUTHORIZED, "m" -> AUTHORIZED
 * - "M-WIFI", "MyWiFi", "Campus-M", "MY" -> UNAUTHORIZED
 *
 * Condition 2 — "SONA" Network:
 * - The SSID can contain the word "sona" anywhere in the name (case-insensitive).
 * - "SONA-WIFI", "Sona-Wifi", "sona-wifi", "SONA CAMPUS", "MY-SONA-NETWORK", "SONA" -> AUTHORIZED
 *
 * Empty / Unknown / Unavailable SSID:
 * - null, undefined, "", "Unknown", "Unavailable", "Hidden", "<unknown ssid>" -> UNAUTHORIZED
 * - Never automatically authorize an unavailable SSID.
 */

export interface WifiVerificationPayload {
  ssid?: string | null | undefined;
  state?: "connected" | "disconnected" | "unknown" | undefined;
  bssid?: string | undefined;
  signal?: string | undefined;
  band?: string | undefined;
  auth?: string | undefined;
  ip?: string | undefined;
  gateway?: string | undefined;
  dns?: string | undefined;
  dnsSuffix?: string | undefined;
  frequency?: number | undefined;
  clientIp?: string | undefined;
  clientPublicIp?: string | undefined;
  capabilities?: {
    hasWifi?: boolean | undefined;
    hasInternet?: boolean | undefined;
    notVpn?: boolean | undefined;
    validated?: boolean | undefined;
  } | undefined;
}

export interface WifiVerificationResult {
  authorized: boolean;
  stage:
    | "DISCONNECTED"
    | "SSID_CHECK_FAILED"
    | "BSSID_CHECK_FAILED"
    | "NETWORK_VALIDATION_FAILED"
    | "BACKEND_VALIDATION_FAILED"
    | "UNABLE_TO_VERIFY"
    | "VERIFIED";
  reason: string;
  ssid: string;
  networkSummary: string;
  timestamp: string;
  bssid?: string | undefined;
  bssidVerified?: boolean | undefined;
  bssidStatusMessage?: string | undefined;
  ip?: string | undefined;
  gateway?: string | undefined;
  dns?: string | undefined;
  band?: string | undefined;
  signal?: string | undefined;
  auth?: string | undefined;
  authMethod?: string | undefined;
  publicIp?: string | undefined;
}

export interface WifiStatus {
  isSonaWifi: boolean;
  authorized?: boolean | undefined;
  ssid: string;
  bssid?: string | undefined;
  signal?: string | undefined;
  ip?: string | undefined;
  gateway?: string | undefined;
  dns?: string | undefined;
  dnsSuffix?: string | undefined;
  auth?: string | undefined;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
  networkSummary?: string | undefined;
  stage?: WifiVerificationResult["stage"] | undefined;
  bssidStatusMessage?: string | undefined;
  authMethod?: string | undefined;
  publicIp?: string | undefined;
  band?: string | undefined;
  frequency?: number | undefined;
  linkSpeed?: number | undefined;
  rssi?: number | undefined;
}

export const AUTHORIZED_SSIDS = ["M", "SONA-WIFI"];

/**
 * Checks whether an SSID passes campus authorization rules:
 * - normalizedSsid === "m"
 * - OR normalizedSsid.includes("sona")
 */
export function isSsidAuthorized(ssid?: string | null | undefined): boolean {
  if (!ssid) return false;
  const trimmed = ssid.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return false;

  const normalizedSsid = trimmed.toLowerCase();

  // Reject unavailable, unknown, hidden placeholders
  if (
    normalizedSsid === "unknown" ||
    normalizedSsid === "unavailable" ||
    normalizedSsid === "hidden" ||
    normalizedSsid === "<unknown ssid>" ||
    normalizedSsid === "none" ||
    normalizedSsid === "ssid_unavailable"
  ) {
    return false;
  }

  // EXACT AUTHORIZATION RULE:
  // normalizedSsid === "m" || normalizedSsid.includes("sona")
  return normalizedSsid === "m" || normalizedSsid.includes("sona");
}

/**
 * Validates Wi-Fi connection using ONLY the SSID name-based rule.
 * Public IP, Gateway, DNS, BSSID, Subnets have NO effect.
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
      networkSummary: "Offline",
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 2. EMPTY / UNKNOWN / UNAVAILABLE SSID CHECK
  const normalized = rawSsid.toLowerCase();
  if (
    !rawSsid ||
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "hidden" ||
    normalized === "<unknown ssid>" ||
    normalized === "none" ||
    normalized === "ssid_unavailable"
  ) {
    return {
      authorized: false,
      stage: "UNABLE_TO_VERIFY",
      reason: "Wi-Fi SSID is unavailable or unknown. Please connect to an authorized network (M or SONA).",
      ssid: "Unavailable",
      networkSummary: "Unauthorized Wi-Fi network",
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 3. EXACT AUTHORIZATION RULE:
  // normalizedSsid === "m" || normalizedSsid.includes("sona")
  const wifiAuthorized = normalized === "m" || normalized.includes("sona");

  if (wifiAuthorized) {
    return {
      authorized: true,
      stage: "VERIFIED",
      reason: `Verified Campus Wi-Fi "${rawSsid}"`,
      ssid: rawSsid,
      networkSummary: "Authorized campus Wi-Fi",
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
    networkSummary: "Unauthorized Wi-Fi network",
    timestamp,
    signal: payload.signal,
    band: payload.band,
    auth: payload.auth,
  };
}
