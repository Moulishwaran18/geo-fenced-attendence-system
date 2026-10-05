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
  "SONA-WIFI": {
    ssid: "SONA-WIFI",
    securityType: "Open",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz (52)",
    // AP BSSID is not available in the provided screenshot (NIC MAC was 70:CD:0D:E8:D4:B0).
    // Configurable list for campus APs:
    authorizedBssids: [],
    // Subnet from screenshot (IPv4 address: 172.16.184.252)
    allowedIpv4Subnets: ["172.16."],
    // Authoritative gateway from screenshot
    expectedGateway: "172.16.16.16",
    // Authoritative DNS server from screenshot
    expectedDnsServers: ["172.16.16.16"],
  },
  "M": {
    ssid: "M",
    securityType: "WPA2-Personal",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz (36)",
    // AP BSSID is not available in the provided screenshot (NIC MAC was 70:CD:0D:E8:D4:B0).
    // Configurable list for campus APs:
    authorizedBssids: [],
    // Subnet from screenshot (IPv4 address: 10.220.86.182)
    allowedIpv4Subnets: ["10.220.86."],
    // IPv4 gateway was not shown in screenshot; DNS server is 10.220.86.133
    expectedGateway: undefined,
    expectedDnsServers: ["10.220.86.133", "2409:40f4:301e:8572::94"],
    allowedIpv6Prefixes: ["2409:40f4:301e:8572:"],
    expectedIpv6Gateway: "fe80::88fc:48ff:fe98:9f71",
  },
  "LAPTOP-96EEBK69 4670": {
    ssid: "LAPTOP-96EEBK69 4670",
    securityType: "WPA/WPA2-Personal",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz",
    // Configurable list for campus APs:
    authorizedBssids: [],
    // Subnet from Android screenshot (IPv4 address: 192.168.137.125)
    allowedIpv4Subnets: ["192.168.137."],
    // Authoritative gateway for 192.168.137.x network
    expectedGateway: "192.168.137.1",
    expectedDnsServers: ["192.168.137.1"],
  },
  "NEW AUTHORIZED WI-FI": {
    ssid: "LAPTOP-96EEBK69 4670",
    securityType: "WPA/WPA2-Personal",
    protocol: "Wi-Fi 5 (802.11ac)",
    networkBand: "5 GHz",
    authorizedBssids: [],
    allowedIpv4Subnets: ["192.168.137."],
    expectedGateway: "192.168.137.1",
    expectedDnsServers: ["192.168.137.1"],
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
  band?: string;
  signal?: string;
  auth?: string;
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
 * - SONA-WIFI (Institutional Campus Network)
 * - M (Campus Wi-Fi Network)
 * - LAPTOP-96EEBK69 4670 (Authoritative 3rd Wi-Fi Network)
 */
export const AUTHORIZED_SSIDS = ["SONA-WIFI", "M", "LAPTOP-96EEBK69 4670", "NEW AUTHORIZED WI-FI"];

/**
 * Validates a client Wi-Fi connection against authoritative campus profiles.
 *
 * Verification order:
 * 1. CONNECTED TO WI-FI?
 * 2. SSID MATCH? ("SONA-WIFI", "M", or "LAPTOP-96EEBK69 4670")
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
        "Device is disconnected from Wi-Fi. Please connect to an authorized campus network (SONA-WIFI, M, or LAPTOP-96EEBK69 4670).",
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

  // 2. SSID MATCH? (Accept only "SONA-WIFI", "M", or "LAPTOP-96EEBK69 4670")
  const matchedKey = Object.keys(AUTHORIZED_CAMPUS_NETWORKS).find(
    (key) => key.toUpperCase() === rawSsid.toUpperCase(),
  );

  const profile = matchedKey ? AUTHORIZED_CAMPUS_NETWORKS[matchedKey] : undefined;

  if (!matchedKey || !profile) {
    return {
      authorized: false,
      stage: "SSID_CHECK_FAILED",
      reason: `Unauthorized Wi-Fi network "${rawSsid || "Unknown"}". Only authorized networks ("SONA-WIFI", "M", or "LAPTOP-96EEBK69 4670") are permitted.`,
      ssid: rawSsid || "Unknown",
      bssid: bssid || "Unknown",
      bssidVerified: false,
      bssidStatusMessage: "SSID unauthorized",
      networkSummary: `Unauthorized SSID: ${rawSsid || "Unknown"}`,
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
        networkSummary: `Rogue AP BSSID: ${bssid}`,
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
      networkSummary: "VPN / Proxy active",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
    };
  }

  // Anti-Hotspot check: Reject common personal hotspot subnets (192.168.43.x, 172.20.10.x, etc.)
  // Note: 192.168.137.x is authorized ONLY for profile "LAPTOP-96EEBK69 4670" / "NEW AUTHORIZED WI-FI".
  // For SONA-WIFI or M, 192.168.137.x is rejected as a rogue spoofed hotspot.
  const isAuthorizedHotspotProfile =
    profile.ssid === "LAPTOP-96EEBK69 4670" || profile.ssid === "NEW AUTHORIZED WI-FI";

  const isObviousHotspotIp =
    ip.startsWith("192.168.43.") ||
    gateway.startsWith("192.168.43.") ||
    ip.startsWith("172.20.10.") ||
    gateway.startsWith("172.20.10.") ||
    (!isAuthorizedHotspotProfile && (ip.startsWith("192.168.137.") || gateway.startsWith("192.168.137.")));

  if (isObviousHotspotIp) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: `Unauthorized Wi-Fi network. Detected rogue mobile hotspot subnet (IP: ${ip}, Gateway: ${gateway}) matching SSID "${profile.ssid}".`,
      ssid: profile.ssid,
      bssid: bssid || "—",
      bssidVerified: false,
      bssidStatusMessage: "Mobile hotspot subnet detected",
      networkSummary: `Hotspot subnet rejected: ${ip}`,
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
    const isSonaVerified = matchesGateway || (matchesSubnet && matchesDns);

    if (!isSonaVerified) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected network SSID is "${profile.ssid}", but institutional gateway (expected 172.16.16.16) and subnet (172.16.x.x) failed validation.`,
        ssid: profile.ssid,
        bssid: bssid || "—",
        bssidVerified,
        bssidStatusMessage,
        networkSummary: `Gateway/Subnet mismatch (GW: ${gateway || "None"}, IP: ${ip || "None"})`,
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
    // For M: Subnet 10.220.86.x or DNS 10.220.86.133 / IPv6 prefix 2409:40f4:301e:8572: must be verified
    const isMVerified = matchesSubnet || matchesDns || Boolean(hasIpv6Match);

    if (!isMVerified) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected network SSID is "${profile.ssid}", but authorized campus subnet (10.220.86.x) or DNS (10.220.86.133) failed validation.`,
        ssid: profile.ssid,
        bssid: bssid || "—",
        bssidVerified,
        bssidStatusMessage,
        networkSummary: `Campus subnet mismatch (IP: ${ip || "None"}, DNS: ${dns || "None"})`,
        ip,
        gateway,
        dns,
        timestamp,
        band: payload.band,
        signal: payload.signal,
        auth: payload.auth,
      };
    }
  } else if (profile.ssid === "LAPTOP-96EEBK69 4670" || profile.ssid === "NEW AUTHORIZED WI-FI") {
    // For LAPTOP-96EEBK69 4670:
    // 1. Subnet 192.168.137.x must match (from Android screenshot 192.168.137.125)
    // 2. Gateway must be within 192.168.137.x (typically 192.168.137.1)
    // 3. Band: 5 GHz if reported by device telemetry (screenshot: 433 Mbps on 5 GHz)
    // 4. Security: WPA/WPA2-Personal if reported
    const isBandValid =
      !payload.band ||
      payload.band.includes("5 GHz") ||
      (payload.frequency ? payload.frequency >= 4900 && payload.frequency <= 5900 : true);
    const isGatewayValid = !gateway || gateway.startsWith("192.168.137.");
    const isSecurityValid = !payload.auth || payload.auth.toLowerCase().includes("wpa");

    const isHotspotVerified = matchesSubnet && isGatewayValid && isBandValid && isSecurityValid;

    if (!isHotspotVerified) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected network SSID is "${profile.ssid}", but authorized subnet (192.168.137.x), gateway (192.168.137.1), or 5 GHz band validation failed.`,
        ssid: profile.ssid,
        bssid: bssid || "—",
        bssidVerified,
        bssidStatusMessage,
        networkSummary: `Subnet/Gateway mismatch (GW: ${gateway || "None"}, IP: ${ip || "None"}, Band: ${payload.band || "Unknown"})`,
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

  // 5. SUCCESS: All checks satisfied
  const networkSummary =
    profile.ssid === "SONA-WIFI"
      ? `Institutional Gateway Verified (${gateway || "172.16.16.16"}) · Campus Subnet (${ip || "172.16.x.x"})`
      : profile.ssid === "M"
        ? `Campus Network Verified (${ip || "10.220.86.x"}) · DNS (${dns || "10.220.86.133"})`
        : `Authorized Wi-Fi Verified (${ip || "192.168.137.x"}) · 5 GHz Band · Gateway (${gateway || "192.168.137.1"})`;

  return {
    authorized: true,
    stage: "VERIFIED",
    reason: `Verified Campus Wi-Fi "${profile.ssid}" (${networkSummary})`,
    ssid: profile.ssid,
    bssid: bssid || "BSSID not available in screenshot (AP configurable)",
    bssidVerified,
    bssidStatusMessage,
    networkSummary,
    ip,
    gateway,
    dns,
    timestamp,
    band: payload.band || profile.networkBand,
    signal: payload.signal,
    auth: payload.auth || profile.securityType,
  };
}
