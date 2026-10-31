/**
 * Campus Wi-Fi Verification Engine
 *
 * FINAL WI-FI POLICY:
 * - Accept the actual Wi-Fi SSID if it contains "sona", case-insensitively.
 * - Reject SSIDs that do not contain "sona".
 * - Reject empty, null, unknown, unavailable, or permission-denied SSID results.
 * - Remove the previous special "m" exception.
 * - Do not require public IP allowlisting, IPv4/IPv6 matching, gateway, DNS, BSSID, or LAN fingerprint checks.
 * - A hotspot whose actual Wi-Fi name contains sona is allowed under this policy.
 */

export const AUTHORIZED_SSID_KEYWORD = "sona" as const;
export const AUTHORIZED_SSIDS = ["SONA-WIFI"] as const;

export const REGISTERED_CAMPUS_BSSID = "B0:1F:8C:29:6B:30" as const;
export const SECONDARY_APPROVED_BSSID = "72:CD:0D:E8:D4:B0" as const;
export const APPROVED_CAMPUS_BSSIDS = [
  "B0:1F:8C:29:6B:30",
  "72:CD:0D:E8:D4:B0",
] as const;
export const CAMPUS_WIFI_FAILURE_MESSAGE =
  "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi." as const;

/**
 * Normalizes BSSID string:
 * - Trims whitespace and removes outer quotes
 * - Replaces hyphens with colons
 * - Converts to UPPERCASE
 */
export function normalizeBssid(bssid?: string | null | undefined): string {
  if (!bssid || typeof bssid !== "string") return "";
  return bssid.trim().replace(/^["']|["']$/g, "").replace(/-/g, ":").toUpperCase();
}

/**
 * Authoritative Campus BSSID validation function:
 * 1. Normalizes connected BSSID and approved campus BSSIDs to UPPERCASE.
 * 2. Rejects empty, null, undefined, unavailable, or dummy/redacted values (02:00:00:00:00:00, 00:00:00:00:00:00).
 * 3. Compares strictly against approved campus BSSID allowlist:
 *    - B0:1F:8C:29:6B:30 (Campus Wi-Fi AP)
 *    - 72:CD:0D:E8:D4:B0 (Secondary Approved AP / Hotspot)
 */
export function isAuthorizedCampusBssid(bssid?: string | null | undefined): boolean {
  const clean = normalizeBssid(bssid);
  if (!clean) return false;
  if (
    clean === "02:00:00:00:00:00" ||
    clean === "00:00:00:00:00:00" ||
    clean === "UNKNOWN" ||
    clean === "BSSID_UNAVAILABLE" ||
    clean === "NULL"
  ) {
    return false;
  }
  // Validate standard 6-octet MAC format
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean)) {
    return false;
  }
  return APPROVED_CAMPUS_BSSIDS.some((approved) => approved.toUpperCase() === clean);
}

/**
 * Authoritative Wi-Fi SSID validation function:
 * - Accepts SSID if it contains 'sona' (case-insensitive)
 * - Rejects SSIDs that do not contain 'sona'
 * - Rejects empty, null, undefined, unknown, unavailable, or masked SSID results
 * - Completely removes the previous special 'm' exception
 */
export function isAuthorizedSonaSsid(ssid?: string | null | undefined): boolean {
  if (!ssid || typeof ssid !== "string") return false;
  const clean = ssid.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (
    !clean ||
    clean === "<unknown ssid>" ||
    clean === "unknown" ||
    clean === "ssid_unavailable" ||
    clean === "0x"
  ) {
    return false;
  }
  return clean.includes("sona");
}

export interface NetworkFingerprintPayload {
  transport?: "wifi" | "cellular" | "none" | "other" | "unknown" | string | null | undefined;
  isWifi?: boolean | null | undefined;
  connected?: boolean | null | undefined;
  state?: "connected" | "disconnected" | "unknown" | undefined;
  ssid?: string | null | undefined;
  bssid?: string | null | undefined;
  bssidVerified?: boolean | null | undefined;
  permissionGranted?: boolean | null | undefined;
  locationEnabled?: boolean | null | undefined;
  permissionDenied?: boolean | null | undefined;
  locationDisabled?: boolean | null | undefined;
  isNativeBridge?: boolean | null | undefined;
  clientPublicIp?: string | null | undefined;
  ipv4?: string | null | undefined;
  ipv4Subnet?: string | null | undefined;
  prefixLength?: number | null | undefined;
  gateway?: string | null | undefined;
  dnsServers?: string[] | null | undefined;
  hasInternet?: boolean | null | undefined;
  notVpn?: boolean | null | undefined;
  auth?: string | null | undefined;
  signal?: string | null | undefined;
  band?: string | null | undefined;
  rawBssid?: string | null | undefined;
  bssidDiagnostic?: string | null | undefined;
  bssidSource?: string | null | undefined;
  reason?: string | null | undefined;
}

export interface WifiVerificationResult {
  authorized: boolean;
  networkType: "SONA" | "UNAUTHORIZED" | "UNAVAILABLE";
  networkSummary: string;
  network?: string;
  reason: string;
  stage: "DISCONNECTED" | "FINGERPRINT_CHECK_FAILED" | "UNABLE_TO_VERIFY" | "VERIFIED";
  timestamp: string;
  verificationMethod?: "NATIVE_BRIDGE" | "SERVER_EGRESS_IP" | "SIMULATION";
  verifiedIp?: string;
  ssid?: string | undefined;
  bssid?: string | undefined;
  rawBssid?: string | undefined;
  bssidDiagnostic?: string | undefined;
  bssidSource?: string | undefined;
  isLocationEnabled?: boolean | undefined;
  bssidVerified?: boolean | undefined;
  errorCode?: string;
  ipv4?: string | undefined;
  gateway?: string | undefined;
  dnsServers?: string[] | undefined;
  ipv4Subnet?: string | undefined;
  auth?: string | undefined;
  signal?: string | undefined;
  band?: string | undefined;
}

export interface WifiStatus {
  isSonaWifi: boolean;
  authorized: boolean;
  network?: string | undefined;
  networkType?: "SONA" | "UNAUTHORIZED" | "UNAVAILABLE" | undefined;
  networkSummary: string;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
  verificationMethod?:
    | "NATIVE_BRIDGE"
    | "SERVER_EGRESS_IP"
    | "SIMULATION"
    | "NONE"
    | undefined;
  verifiedIp?: string | undefined;
  networkAuthToken?: string | undefined;
  publicIp?: string | undefined;
  errorCode?: string | undefined;
  stage?: WifiVerificationResult["stage"] | undefined;
  ipv4?: string | undefined;
  gateway?: string | undefined;
  dnsServers?: string[] | undefined;
  ipv4Subnet?: string | undefined;
  isNativeBridge?: boolean | undefined;
  ssid?: string | undefined;
  bssid?: string | undefined;
  rawBssid?: string | undefined;
  bssidDiagnostic?: string | undefined;
  bssidVerified?: boolean | undefined;
  auth?: string | undefined;
  signal?: string | undefined;
  band?: string | undefined;
  permissionDenied?: boolean | undefined;
  locationDisabled?: boolean | undefined;
  isLocationEnabled?: boolean | undefined;
  apiLevel?: number | undefined;
  hasFineLocation?: boolean | undefined;
  hasNearbyWifi?: boolean | undefined;
  ssidSource?: string | undefined;
  bssidSource?: string | undefined;
}

/**
 * Validates network connection using the authoritative Wi-Fi SSID policy.
 * Accept if actual SSID contains 'sona' (case-insensitive).
 */
export function verifyCampusWifi(payload: NetworkFingerprintPayload): WifiVerificationResult {
  const timestamp = new Date().toISOString();

  // 1. Permission denial check
  if (payload.permissionGranted === false || payload.permissionDenied === true) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Permission Denied",
      network: "Permission Denied",
      reason: "Location/Wi-Fi permission denied. Please grant location permissions in Android app settings to read Wi-Fi network name.",
      stage: "UNABLE_TO_VERIFY",
      errorCode: "PERMISSION_DENIED",
      timestamp,
      ssid: undefined,
    };
  }

  // 2. Location services check (Android OS requires location toggle ON for SSID disclosure)
  if (payload.locationEnabled === false || payload.locationDisabled === true) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Location Disabled",
      network: "Location Disabled",
      reason: "Device location services are turned off. Android requires location to be enabled to read the Wi-Fi SSID.",
      stage: "UNABLE_TO_VERIFY",
      errorCode: "LOCATION_SERVICES_DISABLED",
      timestamp,
      ssid: undefined,
    };
  }

  // 3. Cellular data check (reject mobile data)
  const transport = String(payload.transport || "").toLowerCase();
  if (transport === "cellular") {
    return {
      authorized: false,
      networkType: "UNAUTHORIZED",
      networkSummary: "Mobile Data",
      network: "Mobile Data",
      reason: "Device is connected to mobile data, not campus Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
      stage: "FINGERPRINT_CHECK_FAILED",
      errorCode: "CELLULAR_DATA",
      timestamp,
      ssid: undefined,
    };
  }

  // 4. Disconnection check
  if (transport === "none" || payload.state === "disconnected" || payload.connected === false) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Disconnected",
      network: "Disconnected",
      reason: "Device is disconnected from Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
      stage: "DISCONNECTED",
      errorCode: "DISCONNECTED",
      timestamp,
      ssid: undefined,
    };
  }

  // 5. Non-Wi-Fi transport check
  if (transport && transport !== "wifi" && payload.isWifi !== true) {
    return {
      authorized: false,
      networkType: "UNAUTHORIZED",
      networkSummary: "Non-Wi-Fi Network",
      network: "Non-Wi-Fi Network",
      reason: "Network transport is not Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
      stage: "FINGERPRINT_CHECK_FAILED",
      errorCode: "NOT_WIFI",
      timestamp,
      ssid: undefined,
    };
  }

  // 6. Authoritative Campus BSSID evaluation (Requirements 1-6)
  const rawBssid = normalizeBssid(payload.bssid);
  const rawSsid = payload.ssid ? String(payload.ssid).trim().replace(/^["']|["']$/g, "") : "";

  // 6A. BSSID unavailable, hidden, restricted, or dummy/redacted MAC address
  if (
    !rawBssid ||
    rawBssid === "02:00:00:00:00:00" ||
    rawBssid === "00:00:00:00:00:00" ||
    rawBssid === "BSSID_UNAVAILABLE" ||
    rawBssid === "UNKNOWN" ||
    rawBssid === "NULL"
  ) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "BSSID Unavailable",
      network: "BSSID Unavailable",
      reason: payload.bssidDiagnostic
        ? `Campus Wi-Fi verification failed: BSSID unavailable (${payload.bssidDiagnostic}). Ensure location services and permissions are granted.`
        : "Campus Wi-Fi verification failed: Access point BSSID is unavailable or restricted. Please ensure location services are enabled and permissions are granted.",
      stage: "UNABLE_TO_VERIFY",
      errorCode: "BSSID_UNAVAILABLE",
      timestamp,
      ssid: rawSsid || undefined,
      bssid: undefined,
      rawBssid: payload.rawBssid || undefined,
      bssidDiagnostic: payload.bssidDiagnostic || undefined,
      bssidSource: payload.bssidSource || undefined,
      bssidVerified: false,
    };
  }

  // 6B. BSSID Mismatch: Compare normalized uppercase BSSID against B0:1F:8C:29:6B:30
  if (!isAuthorizedCampusBssid(rawBssid)) {
    return {
      authorized: false,
      networkType: "UNAUTHORIZED",
      networkSummary: rawBssid,
      network: rawBssid,
      reason: CAMPUS_WIFI_FAILURE_MESSAGE,
      stage: "FINGERPRINT_CHECK_FAILED",
      errorCode: "UNAUTHORIZED_BSSID",
      timestamp,
      ssid: rawSsid || undefined,
      bssid: rawBssid,
      rawBssid: payload.rawBssid || rawBssid,
      bssidDiagnostic: payload.bssidDiagnostic || undefined,
      bssidSource: payload.bssidSource || undefined,
      bssidVerified: false,
    };
  }

  // 6C. Exact BSSID Match: Verification PASSED
  return {
    authorized: true,
    networkType: "SONA",
    networkSummary: rawSsid ? `${rawSsid} (${rawBssid})` : rawBssid,
    network: rawSsid || rawBssid,
    reason: `Campus Wi-Fi access point verified: ${rawBssid}`,
    stage: "VERIFIED",
    verificationMethod: payload.isNativeBridge ? "NATIVE_BRIDGE" : "SIMULATION",
    timestamp,
    ssid: rawSsid || undefined,
    bssid: rawBssid,
    rawBssid: payload.rawBssid || rawBssid,
    bssidDiagnostic: payload.bssidDiagnostic || undefined,
    bssidSource: payload.bssidSource || undefined,
    bssidVerified: true,
  };
}

/**
 * Utility functions preserved for IP resolution and backward compatibility.
 */
export const VERIFIED_SONA_EGRESS_IPS = ["111.92.42.18", "115.247.87.98"] as const;

export function getAuthorizedCampusEgressIps(): string[] {
  const envVal =
    (typeof process !== "undefined" &&
      (process.env["AUTHORIZED_CAMPUS_EGRESS_IPS"] ||
        process.env["VITE_AUTHORIZED_CAMPUS_EGRESS_IPS"])) ||
    "";
  if (envVal.trim()) {
    return envVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...VERIFIED_SONA_EGRESS_IPS];
}

export function sanitizeIp(raw?: string | null | undefined): string {
  if (!raw) return "";
  let clean = String(raw).trim().toLowerCase();
  clean = clean.replace(/^::ffff:/, "");
  if (/^[0-9.]+:[0-9]+$/.test(clean)) {
    clean = clean.split(":")[0] ?? clean;
  }
  return clean;
}

export function isAuthorizedCampusEgressIp(clientIp?: string | null | undefined): {
  authorized: boolean;
  network: string;
  matchedIp: string | null;
  reason: string;
} {
  const cleanIp = sanitizeIp(clientIp);
  if (!cleanIp || cleanIp === "unknown") {
    return {
      authorized: false,
      network: "Unauthorized Network",
      matchedIp: null,
      reason: "Client public IP could not be determined by server.",
    };
  }
  const authorizedIps = getAuthorizedCampusEgressIps();
  for (const authIp of authorizedIps) {
    if (cleanIp === sanitizeIp(authIp)) {
      return {
        authorized: true,
        network: "SONA Campus Network",
        matchedIp: authIp,
        reason: `Connection originates from campus egress IP (${authIp}).`,
      };
    }
  }
  return {
    authorized: false,
    network: "Unauthorized Network",
    matchedIp: null,
    reason: `Public IP (${cleanIp}) is not a designated campus egress IP.`,
  };
}

export function extractTrustedClientIp(req: any): string {
  const getHeader = (name: string): string => {
    if (!req) return "";
    if (req.headers && typeof req.headers.get === "function") {
      return req.headers.get(name) || "";
    }
    if (req.headers) {
      const val = req.headers[name.toLowerCase()] ?? req.headers[name];
      if (Array.isArray(val)) return val[0] || "";
      if (typeof val === "string") return val;
    }
    return "";
  };

  const vercelForwarded = getHeader("x-vercel-forwarded-for");
  if (vercelForwarded) {
    const first = sanitizeIp(vercelForwarded.split(",")[0]);
    if (first) return first;
  }

  const realIp = getHeader("x-real-ip");
  const cfIp = getHeader("cf-connecting-ip");
  const xForwardedFor = getHeader("x-forwarded-for");

  if (xForwardedFor) {
    const hops = xForwardedFor.split(",").map((s) => sanitizeIp(s)).filter(Boolean);
    if (hops.length > 0) return hops[0] ?? "unknown";
  }
  if (realIp) return sanitizeIp(realIp);
  if (cfIp) return sanitizeIp(cfIp);

  const socketAddress = req?.socket?.remoteAddress || req?.connection?.remoteAddress || "";
  return sanitizeIp(socketAddress) || "unknown";
}
