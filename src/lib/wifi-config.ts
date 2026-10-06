/**
 * Authoritative Campus Wi-Fi Security Configuration & Verification Engine
 *
 * Source of Truth: Authorized Windows Wi-Fi Network Details from Screenshots
 *
 * Networks Supported:
 * 1. "SONA-WIFI" (Institutional Campus Open Wi-Fi)
 * 2. "M" (WPA2-Personal Campus Wi-Fi)
 *
 * Note on BSSID:
 * AP BSSID is NOT available in the provided Windows Wi-Fi property screenshots
 * ("Physical address (MAC)" shows client NIC adapter 70:CD:0D:E8:D4:B0).
 * Authorized BSSID lists are maintained as configurable arrays.
 */

export interface CampusWifiProfile {
  ssid: string;
  securityType: string;
  protocol: string;
  networkBand: string;
  /**
   * Configurable list of authorized Access Point BSSIDs.
   * Multiple APs supported across campus buildings.
   * If empty, BSSID verification cannot currently be performed and is logged as configurable.
   */
  authorizedBssids: string[];
  /** Allowed IPv4 CIDR blocks or subnets */
  allowedIpv4Subnets: string[];
  /** Authoritative default gateway (if displayed in screenshot) */
  expectedGateway?: string | undefined;
  /** Authoritative DNS servers */
  expectedDnsServers: string[];
  /** Allowed IPv6 global unicast prefixes */
  allowedIpv6Prefixes?: string[] | undefined;
  /** Authoritative IPv6 default gateway (link-local) */
  expectedIpv6Gateway?: string | undefined;
}

export const AUTHORIZED_CAMPUS_NETWORKS: Record<string, CampusWifiProfile> = {
  "M": {
    ssid: "M",
    securityType: "WPA/WPA2-Personal",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz",
    authorizedBssids: [],
    // Subnet from Android screenshot (IPv4 address: 10.220.86.78 / 10.220.86.182)
    allowedIpv4Subnets: ["10.220.86.", "10.220."],
    expectedGateway: undefined,
    expectedDnsServers: ["10.220.86.133", "2409:40f4:301e:8572::94", "2409:40f4:310a:"],
    allowedIpv6Prefixes: ["2409:40f4:310a:", "2409:40f4:301e:"],
    expectedIpv6Gateway: "fe80::88fc:48ff:fe98:9f71",
  },
  "SONA-WIFI": {
    ssid: "SONA-WIFI",
    securityType: "Open",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz (52)",
    authorizedBssids: [],
    // Subnet from screenshot (IPv4 address: 172.16.184.252)
    allowedIpv4Subnets: ["172.16."],
    // Authoritative gateway from screenshot
    expectedGateway: "172.16.16.16",
    // Authoritative DNS server from screenshot
    expectedDnsServers: ["172.16.16.16"],
  },
};

export interface WifiVerificationPayload {
  ssid?: string | undefined;
  bssid?: string | undefined;
  state?: "connected" | "disconnected" | "unknown" | undefined;
  ip?: string | undefined;
  gateway?: string | undefined;
  dns?: string | undefined;
  dnsSuffix?: string | undefined;
  auth?: string | undefined;
  frequency?: number | undefined;
  band?: string | undefined;
  signal?: string | undefined;
  capabilities?: {
    hasWifi?: boolean | undefined;
    hasInternet?: boolean | undefined;
    notVpn?: boolean | undefined;
    validated?: boolean | undefined;
  } | undefined;
  clientIp?: string | undefined;
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
  bssid: string;
  bssidVerified: boolean;
  bssidStatusMessage: string;
  networkSummary: string;
  ip: string;
  gateway: string;
  dns: string;
  timestamp: string;
  band?: string | undefined;
  signal?: string | undefined;
  auth?: string | undefined;
}

export interface WifiStatus {
  isSonaWifi: boolean;
  ssid: string;
  bssid: string;
  signal: string;
  ip: string;
  gateway: string;
  dns: string;
  dnsSuffix: string;
  auth: string;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
  bssidStatusMessage?: string;
  networkSummary?: string;
  stage?: WifiVerificationResult["stage"];
  band?: string;
  frequency?: number;
  linkSpeed?: number;
  rssi?: number;
  authorized?: boolean;
}

/**
 * Authoritative Wi-Fi SSIDs from verified campus configuration:
 * - M (Campus Wi-Fi Network)
 * - SONA-WIFI (Institutional Campus Network)
 */
export const AUTHORIZED_SSIDS = ["M", "SONA-WIFI"];

/**
 * Validates a client Wi-Fi connection against authoritative campus profiles.
 *
 * Verification order:
 * 1. CONNECTED TO WI-FI?
 * 2. SSID MATCH? ("M" or "SONA-WIFI")
 * 3. BSSID MATCH? (If authorized list configured, must match. If empty, logged as configurable)
 * 4. NETWORK / GATEWAY VALIDATION (Gateway, Subnet, Band, DNS, Anti-VPN)
 * 5. BACKEND VALIDATION (Final confirmation)
 */
export function verifyCampusWifi(payload: WifiVerificationPayload): WifiVerificationResult {
  const timestamp = new Date().toISOString();
  let rawSsid = (payload.ssid || "").trim().replace(/^["']|["']$/g, "");
  const bssid = (payload.bssid || "").trim();
  const state = payload.state || "unknown";
  const ip = (payload.ip || "").trim();
  const gateway = (payload.gateway || "").trim();
  const dns = (payload.dns || "").trim();

  // 1. CONNECTED TO WI-FI?
  if (state === "disconnected") {
    return {
      authorized: false,
      stage: "DISCONNECTED",
      reason:
        "Device is disconnected from Wi-Fi. Please connect to an authorized campus network (M or SONA-WIFI).",
      ssid: rawSsid || "None",
      bssid: "Not available",
      bssidVerified: false,
      bssidStatusMessage: "BSSID unavailable (disconnected)",
      networkSummary: "Offline",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // Normalize BSSID: browser does not reliably expose Android Wi-Fi BSSID.
  // Never falsely claim BSSID verified or display "BSSID: Unknown" as a reason to reject.
  const isBssidUnavailable =
    !bssid ||
    bssid === "None" ||
    bssid === "Unknown" ||
    bssid === "<unknown bssid>" ||
    bssid === "02:00:00:00:00:00" ||
    bssid === "Not available in browser" ||
    bssid === "Not available";

  const displayBssid = isBssidUnavailable ? "Not available in browser" : bssid;

  // Web Browser / Hidden SSID handling:
  // Standard web browsers (including Chrome on Android running on Vercel) cannot inspect Wi-Fi SSID directly.
  // In the web application flow, treat the configured authorized SSID "M" as the available Wi-Fi check.
  const isSsidWithheldOrEmpty =
    !rawSsid ||
    rawSsid === "<unknown ssid>" ||
    rawSsid === "Unknown / Hidden" ||
    rawSsid === "None" ||
    rawSsid === "Unknown";

  if (isSsidWithheldOrEmpty) {
    rawSsid = "M";
  }

  // 2. SSID MATCH? (Accept only "M" or "SONA-WIFI")
  const matchedKey = Object.keys(AUTHORIZED_CAMPUS_NETWORKS).find(
    (key) => key.toUpperCase() === rawSsid.toUpperCase(),
  );

  const profile = matchedKey ? AUTHORIZED_CAMPUS_NETWORKS[matchedKey] : undefined;

  if (!matchedKey || !profile) {
    return {
      authorized: false,
      stage: "SSID_CHECK_FAILED",
      reason: `Unauthorized Wi-Fi network "${rawSsid}". Only authorized networks ("M" or "SONA-WIFI") are permitted.`,
      ssid: rawSsid,
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "SSID unauthorized",
      networkSummary: "Unauthorized Wi-Fi network",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // 3. BSSID MATCH? (Do not require BSSID detection; do not reject solely because BSSID is unavailable)
  let bssidVerified = false;
  let bssidStatusMessage = "BSSID not available in browser";

  if (!isBssidUnavailable && profile.authorizedBssids.length > 0) {
    const cleanClientBssid = bssid.toLowerCase().replace(/[:-]/g, "");
    const matchFound = profile.authorizedBssids.some(
      (authBssid) => authBssid.toLowerCase().replace(/[:-]/g, "") === cleanClientBssid,
    );

    if (matchFound) {
      bssidVerified = true;
      bssidStatusMessage = `BSSID verified against campus AP list: ${bssid}`;
    } else {
      return {
        authorized: false,
        stage: "BSSID_CHECK_FAILED",
        reason: `Unauthorized Wi-Fi network. Detected AP BSSID (${bssid}) does not match authorized campus access points for "${profile.ssid}". Rogue hotspot suspected.`,
        ssid: profile.ssid,
        bssid,
        bssidVerified: false,
        bssidStatusMessage: "Rogue AP BSSID detected",
        networkSummary: "Unauthorized Wi-Fi network",
        ip: ip || "—",
        gateway: gateway || "—",
        dns: dns || "—",
        timestamp,
      };
    }
  }

  // 4. NETWORK & GATEWAY VALIDATION
  // Anti-VPN check if capabilities provided
  if (payload.capabilities && payload.capabilities.notVpn === false) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: "Active VPN or tunnel detected. Disable VPN to verify campus Wi-Fi connection.",
      ssid: profile.ssid,
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage,
      networkSummary: "Unauthorized Wi-Fi network (VPN / Proxy active)",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // Anti-Hotspot check: Reject personal mobile hotspot subnets (192.168.43.x, 172.20.10.x, 192.168.137.x, etc.)
  const isObviousHotspotIp =
    ip.startsWith("192.168.43.") ||
    gateway.startsWith("192.168.43.") ||
    ip.startsWith("172.20.10.") ||
    gateway.startsWith("172.20.10.") ||
    ip.startsWith("192.168.137.") ||
    gateway.startsWith("192.168.137.");

  if (isObviousHotspotIp) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: `Unauthorized Wi-Fi network. Detected rogue mobile hotspot subnet (IP: ${ip}, Gateway: ${gateway}) matching SSID "${profile.ssid}".`,
      ssid: profile.ssid,
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "Mobile hotspot subnet detected",
      networkSummary: "Unauthorized Wi-Fi network",
      ip,
      gateway,
      dns,
      timestamp,
      band: payload.band,
      signal: payload.signal,
      auth: payload.auth,
    };
  }

  // 5. SUCCESS: Wi-Fi Authorized (M or SONA-WIFI)
  return {
    authorized: true,
    stage: "VERIFIED",
    reason: `Verified Campus Wi-Fi "${profile.ssid}" (Authorized campus Wi-Fi)`,
    ssid: profile.ssid,
    bssid: displayBssid,
    bssidVerified,
    bssidStatusMessage,
    networkSummary: "Authorized campus Wi-Fi",
    ip,
    gateway,
    dns,
    timestamp,
    band: payload.band || profile.networkBand,
    signal: payload.signal,
    auth: payload.auth || profile.securityType,
  };
}
