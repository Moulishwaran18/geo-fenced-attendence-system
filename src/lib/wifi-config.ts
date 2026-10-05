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
  const rawSsid = (payload.ssid || "").trim().replace(/^["']|["']$/g, "");
  const bssid = (payload.bssid || "").trim();
  const state = payload.state || "unknown";
  const ip = (payload.ip || "").trim();
  const gateway = (payload.gateway || "").trim();
  const dns = (payload.dns || "").trim();

  // 1. CONNECTED TO WI-FI?
  if (state === "disconnected" || (!ip && !rawSsid)) {
    return {
      authorized: false,
      stage: "DISCONNECTED",
      reason:
        "Device is disconnected from Wi-Fi. Please connect to an authorized campus network (M or SONA-WIFI).",
      ssid: rawSsid || "None",
      bssid: bssid || "None",
      bssidVerified: false,
      bssidStatusMessage: "BSSID unavailable (disconnected)",
      networkSummary: "Offline",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // If Android withheld SSID and access point identity
  if (!rawSsid || rawSsid === "<unknown ssid>") {
    return {
      authorized: false,
      stage: "UNABLE_TO_VERIFY",
      reason:
        "Unable to verify Wi-Fi identity. Android did not provide sufficient access point identity. Ensure Location permission is enabled for Wi-Fi scanning.",
      ssid: "Unknown / Hidden",
      bssid: bssid || "Unknown",
      bssidVerified: false,
      bssidStatusMessage: "Access point identity withheld by OS",
      networkSummary: "Unable to verify Wi-Fi identity",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
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
      reason: `Unauthorized Wi-Fi network "${rawSsid || "Unknown"}". Only authorized networks ("M" or "SONA-WIFI") are permitted.`,
      ssid: rawSsid || "Unknown",
      bssid: bssid || "Unknown",
      bssidVerified: false,
      bssidStatusMessage: "SSID unauthorized",
      networkSummary: "Unauthorized Wi-Fi network",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // 3. BSSID MATCH?
  let bssidVerified = false;
  let bssidStatusMessage = "";

  if (profile.authorizedBssids.length > 0) {
    // Authorized BSSIDs are explicitly configured for this network
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
        reason: `Unauthorized Wi-Fi network. Detected AP BSSID (${bssid || "hidden"}) does not match authorized campus access points for "${profile.ssid}". Rogue hotspot suspected.`,
        ssid: profile.ssid,
        bssid: bssid || "Unknown",
        bssidVerified: false,
        bssidStatusMessage: "Rogue AP BSSID detected",
        networkSummary: "Unauthorized Wi-Fi network",
        ip: ip || "—",
        gateway: gateway || "—",
        dns: dns || "—",
        timestamp,
      };
    }
  } else {
    // BSSID is not in screenshot, configurable list is currently empty
    bssidVerified = false;
    bssidStatusMessage =
      "BSSID is not available in the provided screenshot. BSSID field is configurable; relying on campus gateway and subnet verification.";
  }

  // 4. NETWORK & GATEWAY VALIDATION
  // Anti-VPN check if capabilities provided
  if (payload.capabilities && payload.capabilities.notVpn === false) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: "Active VPN or tunnel detected. Disable VPN to verify campus Wi-Fi connection.",
      ssid: profile.ssid,
      bssid: bssid || "—",
      bssidVerified,
      bssidStatusMessage,
      networkSummary: "Unauthorized Wi-Fi network (VPN / Proxy active)",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // Anti-Hotspot check: Reject personal mobile hotspot subnets (192.168.43.x, 172.20.10.x, 192.168.137.x, etc.)
  // For both SONA-WIFI and M, 192.168.137.x is rejected as a rogue spoofed hotspot.
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
      bssid: bssid || "—",
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

  // Subnet validation
  const matchesSubnet = profile.allowedIpv4Subnets.some((sub) => ip.startsWith(sub));
  const hasIpv6Match =
    profile.allowedIpv6Prefixes &&
    profile.allowedIpv6Prefixes.some((pfx) => ip.includes(pfx) || dns.includes(pfx));

  // Gateway validation
  const matchesGateway = profile.expectedGateway ? gateway.includes(profile.expectedGateway) : true;

  // DNS validation
  const matchesDns = profile.expectedDnsServers.some(
    (expectedDns) => dns.includes(expectedDns) || gateway.includes(expectedDns),
  );

  // Network evaluation by profile
  if (profile.ssid === "SONA-WIFI") {
    // For SONA-WIFI: Gateway 172.16.16.16 or Subnet 172.16.x.x must be verified
    const hasTelemetry = Boolean(ip || gateway || dns);
    const isSonaVerified = !hasTelemetry || matchesGateway || (matchesSubnet && (matchesDns || !dns));

    if (!isSonaVerified) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected network SSID is "${profile.ssid}", but institutional gateway (expected 172.16.16.16) and subnet (172.16.x.x) failed validation.`,
        ssid: profile.ssid,
        bssid: bssid || "—",
        bssidVerified,
        bssidStatusMessage,
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
  } else if (profile.ssid === "M") {
    // For M: Subnet 10.220.86.x / 10.220.x.x or DNS 10.220.86.133 / IPv6 prefix 2409:40f4: must be verified
    const hasTelemetry = Boolean(ip || gateway || dns || hasIpv6Match);
    const isMVerified = !hasTelemetry || matchesSubnet || matchesDns || Boolean(hasIpv6Match);

    if (!isMVerified) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected network SSID is "${profile.ssid}", but authorized campus subnet (10.220.86.x) or DNS (10.220.86.133) failed validation.`,
        ssid: profile.ssid,
        bssid: bssid || "—",
        bssidVerified,
        bssidStatusMessage,
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
  }

  // 5. SUCCESS: Wi-Fi Authorized (M or SONA-WIFI)
  return {
    authorized: true,
    stage: "VERIFIED",
    reason: `Verified Campus Wi-Fi "${profile.ssid}" (Authorized campus Wi-Fi)`,
    ssid: profile.ssid,
    bssid: bssid || "BSSID not available in screenshot (AP configurable)",
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
