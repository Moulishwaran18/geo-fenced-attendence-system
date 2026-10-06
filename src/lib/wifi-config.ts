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
  clientPublicIp?: string | undefined;
  authorizedMPublicIp?: string | undefined;
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
  authMethod?: string | undefined;
  publicIp?: string | undefined;
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
  authMethod?: string;
  publicIp?: string;
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
 * Matches an IPv4 address against a CIDR block e.g. "203.0.113.0/24"
 */
function matchCidr(ip: string, cidr: string): boolean {
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

/**
 * Validates whether client's public source IP matches the authorized public IP configuration for campus Wi-Fi "M".
 * Supports:
 * - Single IP: "203.0.113.195"
 * - Comma-separated IPs: "203.0.113.195, 203.0.113.196"
 * - Subnet prefix: "203.0.113."
 * - CIDR: "203.0.113.0/24"
 */
export function isAuthorizedMPublicIp(clientIp?: string, configuredAuthorizedIp?: string): boolean {
  if (!clientIp) return false;
  const config =
    configuredAuthorizedIp?.trim() ||
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string).trim()
      : "");

  if (!config) return false;

  const cleanClient = clientIp.trim().toLowerCase().replace(/^::ffff:/, "");

  const allowedEntries = config
    .split(",")
    .map((e) => e.trim().toLowerCase().replace(/^::ffff:/, ""))
    .filter(Boolean);

  for (const entry of allowedEntries) {
    if (cleanClient === entry) return true;
    if (entry.endsWith(".") && cleanClient.startsWith(entry)) return true;
    if (entry.includes("/") && matchCidr(cleanClient, entry)) return true;
  }

  return false;
}

/**
 * Extracts the client's public source IP from request headers across Vercel, Node, and proxies.
 */
export function extractClientPublicIpFromHeaders(headers: {
  get?: (name: string) => string | null;
  [key: string]: any;
}): string {
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") {
      return headers.get(name) || "";
    }
    const val = headers[name.toLowerCase()] ?? headers[name];
    if (Array.isArray(val)) return val[0] || "";
    return typeof val === "string" ? val : "";
  };

  const raw =
    getHeader("x-forwarded-for") ||
    getHeader("x-real-ip") ||
    getHeader("x-vercel-forwarded-for") ||
    getHeader("cf-connecting-ip") ||
    getHeader("x-client-ip") ||
    "";

  if (!raw) return "";

  // The first IP in x-forwarded-for is the original client source IP
  const first = raw.split(",")[0]?.trim() ?? "";
  const unmapped = first.replace(/^::ffff:/, "");
  if (/^[0-9.]+:[0-9]+$/.test(unmapped)) {
    return unmapped.split(":")[0] ?? unmapped;
  }
  return unmapped;
}

/**
 * Validates a client Wi-Fi connection against authoritative campus profiles.
 *
 * Rules:
 * 1. Disconnected / Offline -> FAILED
 * 2. Anti-VPN / Rogue Hotspot -> FAILED
 * 3. SONA-WIFI -> STRICT unique institutional identity verification (Gateway 172.16.16.16, DNS 172.16.16.16, subnet 172.16.x.x, or AP BSSID)
 * 4. M -> If SSID explicitly "M", or if SSID is unavailable in browser and client Public IP matches AUTHORIZED_M_PUBLIC_IP -> AUTHORIZED
 * 5. Other explicitly detected SSID (e.g. Oppo K13) -> FAILED
 * 6. Unavailable SSID without authorized Public IP match -> FAILED (Never assume M)
 */
export function verifyCampusWifi(payload: WifiVerificationPayload): WifiVerificationResult {
  const timestamp = new Date().toISOString();
  const rawSsid = (payload.ssid || "").trim().replace(/^["']|["']$/g, "");
  const bssid = (payload.bssid || "").trim();
  const state = payload.state || "unknown";
  const ip = (payload.ip || "").trim();
  const gateway = (payload.gateway || "").trim();
  const dns = (payload.dns || "").trim();
  const clientPublicIp = (payload.clientPublicIp || payload.clientIp || "").trim();
  const configuredAuthorizedIp =
    payload.authorizedMPublicIp ||
    (typeof process !== "undefined" && process?.env?.["AUTHORIZED_M_PUBLIC_IP"]
      ? (process.env["AUTHORIZED_M_PUBLIC_IP"] as string).trim()
      : "");

  // Normalize BSSID representation
  const isBssidUnavailable =
    !bssid ||
    bssid === "None" ||
    bssid === "Unknown" ||
    bssid === "<unknown bssid>" ||
    bssid === "02:00:00:00:00:00" ||
    bssid === "Not available in browser" ||
    bssid === "Not available";

  const displayBssid = isBssidUnavailable ? "Not available in browser" : bssid;

  // 1. DISCONNECTED CHECK
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
      publicIp: clientPublicIp || undefined,
    };
  }

  // 2. ANTI-VPN CHECK
  if (payload.capabilities && payload.capabilities.notVpn === false) {
    return {
      authorized: false,
      stage: "NETWORK_VALIDATION_FAILED",
      reason: "Active VPN or tunnel detected. Disable VPN to verify campus Wi-Fi connection.",
      ssid: rawSsid || "Unavailable",
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "VPN detected",
      networkSummary: "Unauthorized Wi-Fi network (VPN / Proxy active)",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
      publicIp: clientPublicIp || undefined,
    };
  }

  // 3. ANTI-HOTSPOT CHECK: Reject rogue mobile hotspot subnets
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
      reason: `Unauthorized Wi-Fi network. Detected rogue mobile hotspot subnet (IP: ${ip}, Gateway: ${gateway}) matching SSID "${rawSsid}".`,
      ssid: rawSsid || "Unavailable",
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "Mobile hotspot subnet detected",
      networkSummary: "Unauthorized Wi-Fi network",
      ip,
      gateway,
      dns,
      timestamp,
      publicIp: clientPublicIp || undefined,
      band: payload.band,
      signal: payload.signal,
      auth: payload.auth,
    };
  }

  // =========================================================================
  // NETWORK 1: SONA-WIFI — STRICT UNIQUE IDENTITY AUTHENTICATION
  // =========================================================================
  if (rawSsid.toUpperCase() === "SONA-WIFI") {
    const profile = AUTHORIZED_CAMPUS_NETWORKS["SONA-WIFI"];
    if (!profile) {
      return {
        authorized: false,
        stage: "SSID_CHECK_FAILED",
        reason: 'Configuration missing for "SONA-WIFI"',
        ssid: "SONA-WIFI",
        bssid: displayBssid,
        bssidVerified: false,
        bssidStatusMessage: "Configuration error",
        networkSummary: "Unauthorized Wi-Fi network",
        ip: ip || "—",
        gateway: gateway || "—",
        dns: dns || "—",
        timestamp,
        publicIp: clientPublicIp || undefined,
      };
    }

    // BSSID Check (if authorized AP list configured)
    let bssidVerified = false;
    if (!isBssidUnavailable && profile.authorizedBssids.length > 0) {
      const cleanClientBssid = bssid.toLowerCase().replace(/[:-]/g, "");
      const matchFound = profile.authorizedBssids.some(
        (authBssid) => authBssid.toLowerCase().replace(/[:-]/g, "") === cleanClientBssid,
      );
      if (matchFound) {
        bssidVerified = true;
      } else {
        return {
          authorized: false,
          stage: "BSSID_CHECK_FAILED",
          reason: `Unauthorized Wi-Fi network. Detected AP BSSID (${bssid}) does not match authorized campus access points for "SONA-WIFI". Rogue hotspot suspected.`,
          ssid: "SONA-WIFI",
          bssid,
          bssidVerified: false,
          bssidStatusMessage: "Rogue AP BSSID detected",
          networkSummary: "Unauthorized Wi-Fi network",
          ip: ip || "—",
          gateway: gateway || "—",
          dns: dns || "—",
          timestamp,
          publicIp: clientPublicIp || undefined,
        };
      }
    }

    // Stable Network Infrastructure Identity Verification:
    // Gateway 172.16.16.16 OR (DNS 172.16.16.16 AND Subnet 172.16.x.x) OR BSSID verified
    const matchesGateway = gateway.includes("172.16.16.16");
    const matchesDns = dns.includes("172.16.16.16");
    const matchesSubnet = ip.startsWith("172.16.");

    const hasUniqueIdentity = matchesGateway || (matchesDns && matchesSubnet) || bssidVerified;

    if (!hasUniqueIdentity) {
      return {
        authorized: false,
        stage: "NETWORK_VALIDATION_FAILED",
        reason: `Unauthorized Wi-Fi network. Connected to "SONA-WIFI", but unique network identity could not be verified (authoritative gateway/DNS 172.16.16.16 on subnet 172.16.x.x required).`,
        ssid: "SONA-WIFI",
        bssid: displayBssid,
        bssidVerified: false,
        bssidStatusMessage: "Unique network identity verification failed",
        networkSummary: "Unauthorized Wi-Fi network",
        ip: ip || "—",
        gateway: gateway || "—",
        dns: dns || "—",
        timestamp,
        publicIp: clientPublicIp || undefined,
      };
    }

    return {
      authorized: true,
      stage: "VERIFIED",
      reason: `Verified Campus Wi-Fi "SONA-WIFI" (Unique institutional network identity verified)`,
      ssid: "SONA-WIFI",
      bssid: displayBssid,
      bssidVerified,
      bssidStatusMessage: bssidVerified
        ? `BSSID verified against campus AP list: ${bssid}`
        : "Institutional network gateway/DNS identity verified",
      networkSummary: "Authorized campus Wi-Fi",
      authMethod: "Institutional gateway/DNS verified",
      ip,
      gateway,
      dns,
      timestamp,
      publicIp: clientPublicIp || undefined,
      band: payload.band || profile.networkBand,
      signal: payload.signal,
      auth: payload.auth || profile.securityType,
    };
  }

  // =========================================================================
  // NETWORK 2: M (Explicit SSID match e.g. Native Bridge or Local OS)
  // =========================================================================
  if (rawSsid === "M") {
    const profile = AUTHORIZED_CAMPUS_NETWORKS["M"];
    return {
      authorized: true,
      stage: "VERIFIED",
      reason: `Verified Campus Wi-Fi "M" (Authorized campus Wi-Fi)`,
      ssid: "M",
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "BSSID not required for M",
      networkSummary: "Authorized campus Wi-Fi",
      authMethod: "SSID verified",
      ip: ip || clientPublicIp || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
      publicIp: clientPublicIp || undefined,
      band: payload.band || profile?.networkBand,
      signal: payload.signal,
      auth: payload.auth || profile?.securityType,
    };
  }

  // =========================================================================
  // EXPLICIT OTHER SSID (e.g. Oppo K13, unauthorized networks)
  // =========================================================================
  const isExplicitSsid =
    rawSsid &&
    rawSsid !== "<unknown ssid>" &&
    rawSsid !== "Unknown / Hidden" &&
    rawSsid !== "None" &&
    rawSsid !== "Unknown" &&
    rawSsid !== "Unavailable";

  if (isExplicitSsid) {
    return {
      authorized: false,
      stage: "SSID_CHECK_FAILED",
      reason: `Unauthorized Wi-Fi network "${rawSsid}". Only authorized campus networks ("M" or "SONA-WIFI") are permitted.`,
      ssid: rawSsid,
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "SSID unauthorized",
      networkSummary: "Unauthorized Wi-Fi network",
      ip: ip || "—",
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
      publicIp: clientPublicIp || undefined,
    };
  }

  // =========================================================================
  // SSID UNAVAILABLE IN BROWSER / VERCEL: SERVER-SIDE PUBLIC IP VERIFICATION
  // =========================================================================
  const matchesMPublicIp = isAuthorizedMPublicIp(clientPublicIp, configuredAuthorizedIp);

  if (matchesMPublicIp) {
    return {
      authorized: true,
      stage: "VERIFIED",
      reason: `Verified Campus Wi-Fi "M" (Campus network IP verified: ${clientPublicIp})`,
      ssid: "M",
      bssid: displayBssid,
      bssidVerified: false,
      bssidStatusMessage: "Campus network IP verified",
      networkSummary: "Campus public network verified",
      authMethod: "Campus public network verified",
      ip: clientPublicIp,
      gateway: gateway || "—",
      dns: dns || "—",
      timestamp,
      publicIp: clientPublicIp,
      band: "Campus Network",
      auth: "Campus Public Network Verification",
    };
  }

  // Public IP does NOT match or AUTHORIZED_M_PUBLIC_IP is not configured
  // NEVER assume M! Wi-Fi authentication MUST FAIL!
  return {
    authorized: false,
    stage: "UNABLE_TO_VERIFY",
    reason: configuredAuthorizedIp
      ? `Unauthorized campus network. Client public IP (${clientPublicIp || "unknown"}) does not match authorized campus network for M, and SSID is unavailable in browser.`
      : `Wi-Fi cannot be verified. Campus public IP verification is pending configuration (AUTHORIZED_M_PUBLIC_IP). Client IP: ${clientPublicIp || "unknown"}.`,
    ssid: "Unavailable",
    bssid: displayBssid,
    bssidVerified: false,
    bssidStatusMessage: "Public IP not authorized",
    networkSummary: "Unauthorized campus network",
    authMethod: "Unverified",
    ip: ip || clientPublicIp || "—",
    gateway: gateway || "—",
    dns: dns || "—",
    timestamp,
    publicIp: clientPublicIp || undefined,
  };
}
