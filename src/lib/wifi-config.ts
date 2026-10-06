/**
 * Authoritative Campus Network Verification Engine
 *
 * Supports dual verification paths:
 * 1. Mobile Chrome / Web: Server-Side Public Egress IP / CIDR Verification
 *    (SSID is "Unavailable in browser", backend verifies campus network egress)
 * 2. Android Native Bridge: SSID Name-Based Verification
 *    (SSID must be "M" case-insensitively or contain "SONA" case-insensitively)
 *
 * Semantic Rules:
 * - "M" / "m" -> AUTHORIZED
 * - Contains "sona" -> AUTHORIZED
 * - Verified campus egress public IP -> AUTHORIZED (SSID: "Unavailable in browser")
 * - Unverified network / mobile data / other Wi-Fi -> UNAUTHORIZED (attendance blocked)
 * - Empty / Unavailable SSID without campus IP match -> UNAUTHORIZED
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
  authorizedMPublicIp?: string | undefined;
  authorizedSonaPublicIp?: string | undefined;
  authorizedCampusIp?: string | undefined;
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
  permissionDenied?: boolean | undefined;
  locationDisabled?: boolean | undefined;
  isNativeBridge?: boolean | undefined;
}

export const AUTHORIZED_SSIDS = ["M", "SONA-WIFI"];

// Helper to check IPv4 CIDR matching
export function matchCidr(ip: string, cidr: string): boolean {
  try {
    const parts = cidr.split("/");
    const range = parts[0];
    const bitsStr = parts[1];
    if (!range || !bitsStr) return false;

    const bits = parseInt(bitsStr, 10);
    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    const ipParts = ip.split(".").map(Number);
    const rangeParts = range.split(".").map(Number);
    if (ipParts.length !== 4 || rangeParts.length !== 4) return false;
    if (ipParts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
    if (rangeParts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;

    const ip0 = ipParts[0] ?? 0;
    const ip1 = ipParts[1] ?? 0;
    const ip2 = ipParts[2] ?? 0;
    const ip3 = ipParts[3] ?? 0;

    const r0 = rangeParts[0] ?? 0;
    const r1 = rangeParts[1] ?? 0;
    const r2 = rangeParts[2] ?? 0;
    const r3 = rangeParts[3] ?? 0;

    const ipNum = ((ip0 << 24) | (ip1 << 16) | (ip2 << 8) | ip3) >>> 0;
    const rangeNum = ((r0 << 24) | (r1 << 16) | (r2 << 8) | r3) >>> 0;

    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

export function matchesIpPattern(clientIp: string, pattern: string): boolean {
  if (!clientIp || clientIp === "unknown" || !pattern) return false;
  const cleanClient = clientIp.trim().toLowerCase().replace(/^::ffff:/, "");
  const cleanPattern = pattern.trim().toLowerCase().replace(/^::ffff:/, "");

  if (cleanClient === cleanPattern) return true;
  if (cleanPattern.endsWith(".") && cleanClient.startsWith(cleanPattern)) return true;
  if (cleanPattern.endsWith(":") && cleanClient.startsWith(cleanPattern)) return true;
  if (cleanPattern.includes("/") && matchCidr(cleanClient, cleanPattern)) return true;

  return false;
}

export function extractClientPublicIpFromHeaders(headers: any): string {
  const getHeader = (name: string): string => {
    if (!headers) return "";
    if (typeof headers.get === "function") {
      return headers.get(name) || "";
    }
    const val = headers[name.toLowerCase()] ?? headers[name];
    if (Array.isArray(val)) return val[0] || "";
    if (typeof val === "string") return val;
    return "";
  };

  const raw =
    getHeader("x-forwarded-for") ||
    getHeader("x-real-ip") ||
    getHeader("x-vercel-forwarded-for") ||
    getHeader("cf-connecting-ip") ||
    getHeader("x-client-ip") ||
    "";

  if (!raw) return "unknown";

  const first = raw.split(",")[0]?.trim() ?? "";
  const unmapped = first.replace(/^::ffff:/, "");
  if (/^[0-9.]+:[0-9]+$/.test(unmapped)) {
    return unmapped.split(":")[0] ?? unmapped;
  }
  return unmapped || "unknown";
}

export function isAuthorizedCampusNetwork(
  clientIp?: string,
  options?: {
    authorizedMPublicIp?: string | undefined;
    authorizedSonaPublicIp?: string | undefined;
    authorizedCampusIp?: string | undefined;
  },
): { authorized: boolean; matchedNetwork: string | null; reason: string } {
  if (!clientIp || clientIp === "unknown") {
    return {
      authorized: false,
      matchedNetwork: null,
      reason: "Client public IP could not be detected.",
    };
  }

  const envM =
    options?.authorizedMPublicIp ??
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string)
      : "");

  const envSona =
    options?.authorizedSonaPublicIp ??
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_SONA_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_SONA_PUBLIC_IP"] as string)
      : "");

  const envCampus =
    options?.authorizedCampusIp ??
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_CAMPUS_IPS"]
      ? (process.env["AUTHORIZED_CAMPUS_IPS"] as string)
      : "");

  if (envM) {
    const entries = envM.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "M",
          reason: "Verified via authorized campus network egress (M).",
        };
      }
    }
  }

  if (envSona) {
    const entries = envSona.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "SONA-WIFI",
          reason: "Verified via authorized campus network egress (SONA-WIFI).",
        };
      }
    }
  }

  if (envCampus) {
    const entries = envCampus.split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (matchesIpPattern(clientIp, entry)) {
        return {
          authorized: true,
          matchedNetwork: "CAMPUS",
          reason: "Verified via authorized campus network egress.",
        };
      }
    }
  }

  return {
    authorized: false,
    matchedNetwork: null,
    reason: `Unauthorized network. Client public IP (${clientIp}) does not match authorized campus network egress signatures.`,
  };
}

export function isAuthorizedMPublicIp(clientIp?: string, configuredAuthorizedIp?: string): boolean {
  if (!clientIp || clientIp === "unknown") return false;
  const config =
    configuredAuthorizedIp?.trim() ||
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string).trim()
      : "");

  if (!config) return false;
  return config.split(",").some((entry) => matchesIpPattern(clientIp, entry.trim()));
}

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
    normalizedSsid === "ssid_unavailable" ||
    normalizedSsid === "unavailable in browser"
  ) {
    return false;
  }

  return normalizedSsid === "m" || normalizedSsid.includes("sona");
}

/**
 * Validates Wi-Fi connection using authoritative campus rules:
 * 1. If valid SSID is provided (Android Native Bridge): checks SSID rules.
 * 2. If SSID is unavailable (Mobile Chrome / Web): checks server-observable egress IP.
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

  // Anti-VPN check if capabilities provided
  if (payload.capabilities && payload.capabilities.notVpn === false) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: "Active VPN or tunnel detected. Disable VPN to verify campus Wi-Fi connection.",
      ssid: rawSsid || "Unavailable in browser",
      networkSummary: "VPN / Proxy active",
      timestamp,
    };
  }

  const normalized = rawSsid.toLowerCase();
  const isSsidMissing =
    !rawSsid ||
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "hidden" ||
    normalized === "<unknown ssid>" ||
    normalized === "none" ||
    normalized === "ssid_unavailable" ||
    normalized === "unavailable in browser";

  // 2. WEB BROWSER PATH (SSID is unavailable in browser)
  if (isSsidMissing) {
    if (payload.clientPublicIp) {
      const ipCheck = isAuthorizedCampusNetwork(payload.clientPublicIp, {
        authorizedMPublicIp: payload.authorizedMPublicIp,
        authorizedSonaPublicIp: payload.authorizedSonaPublicIp,
        authorizedCampusIp: payload.authorizedCampusIp,
      });

      if (ipCheck.authorized) {
        return {
          authorized: true,
          stage: "VERIFIED",
          reason: ipCheck.reason,
          ssid: "Unavailable in browser",
          networkSummary: "Authorized campus network",
          authMethod: "Campus public network verified",
          publicIp: payload.clientPublicIp,
          timestamp,
          signal: payload.signal,
          band: payload.band,
          auth: payload.auth,
        };
      }

      return {
        authorized: false,
        stage: "UNABLE_TO_VERIFY",
        reason: ipCheck.reason,
        ssid: "Unavailable in browser",
        networkSummary: "Unauthorized Wi-Fi network",
        publicIp: payload.clientPublicIp,
        timestamp,
        signal: payload.signal,
        band: payload.band,
        auth: payload.auth,
      };
    }

    return {
      authorized: false,
      stage: "UNABLE_TO_VERIFY",
      reason: "Wi-Fi SSID is unavailable and client public IP could not be verified.",
      ssid: "Unavailable in browser",
      networkSummary: "Unauthorized Wi-Fi network",
      timestamp,
      signal: payload.signal,
      band: payload.band,
      auth: payload.auth,
    };
  }

  // 3. NATIVE / EXPLICIT SSID PATH
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
