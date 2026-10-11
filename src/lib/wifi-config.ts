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
  auth?: string | undefined;
  signal?: string | undefined;
  band?: string | undefined;
  permissionDenied?: boolean | undefined;
  locationDisabled?: boolean | undefined;
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

  // 6. Authoritative SSID evaluation
  const rawSsid = payload.ssid ? String(payload.ssid).trim().replace(/^["']|["']$/g, "") : "";

  if (isAuthorizedSonaSsid(rawSsid)) {
    return {
      authorized: true,
      networkType: "SONA",
      networkSummary: rawSsid,
      network: rawSsid,
      reason: `Authorized Wi-Fi network detected: ${rawSsid}`,
      stage: "VERIFIED",
      verificationMethod: payload.isNativeBridge ? "NATIVE_BRIDGE" : "SIMULATION",
      timestamp,
      ssid: rawSsid,
    };
  }

  // 7. Missing, masked, or unavailable SSID
  if (
    !rawSsid ||
    rawSsid === "SSID_UNAVAILABLE" ||
    rawSsid === "<unknown ssid>" ||
    rawSsid === "0x" ||
    rawSsid === "Unavailable"
  ) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "SSID Unavailable",
      network: "SSID Unavailable",
      reason: "Unable to detect Wi-Fi network name. Please ensure location services are enabled and permissions are granted.",
      stage: "UNABLE_TO_VERIFY",
      errorCode: "SSID_UNAVAILABLE",
      timestamp,
      ssid: undefined,
    };
  }

  // 8. Rejection: SSID does not contain "sona"
  return {
    authorized: false,
    networkType: "UNAUTHORIZED",
    networkSummary: rawSsid,
    network: rawSsid,
    reason: `Unauthorized Wi-Fi network (${rawSsid}). Network name must contain "sona" (case-insensitive).`,
    stage: "FINGERPRINT_CHECK_FAILED",
    errorCode: "UNAUTHORIZED_SSID",
    timestamp,
    ssid: rawSsid,
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
