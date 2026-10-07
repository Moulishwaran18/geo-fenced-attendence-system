/**
 * Network Detail Fingerprint Campus Wi-Fi Verification Engine
 *
 * AUTHENTICATION BASED ON STABLE NETWORK-LEVEL CHARACTERISTICS:
 * - DO NOT use SSID / Wi-Fi name
 * - DO NOT use BSSID or MAC address
 * - DO NOT use exact dynamic client IP
 *
 * REFERENCE CHARACTERISTICS DERIVED FROM VERIFIED CAMPUS NETWORKS:
 *
 * 1. SONA Campus Network:
 *    - Gateway: 172.16.16.16
 *    - DNS Servers: 172.16.16.16
 *    - Subnet: 172.16.0.0/12 (private institutional class B range)
 *    - Transport: Wi-Fi
 *
 * 2. M Institutional Network:
 *    - DNS Servers: 10.220.86.133 or IPv6 DNS 2409:40f4:311d:b23a::52
 *    - Subnet: 10.220.86.0/24 or 10.220.0.0/16
 *    - Gateway: 10.220.86.1 or 10.220.86.133 (within 10.220.86.x)
 *    - Transport: Wi-Fi
 *
 * 3. All other networks (Hotspots, Home Wi-Fi, Cellular, etc.) -> FAILED.
 */

export const AUTHORIZED_SSIDS = ["M", "SONA-WIFI"] as const;

export interface NetworkFingerprintPayload {
  transport?: "wifi" | "cellular" | "none" | "other" | "unknown" | string | null | undefined;
  isWifi?: boolean | null | undefined;
  ipv4?: string | null | undefined;
  ipv4Subnet?: string | null | undefined;
  prefixLength?: number | null | undefined;
  gateway?: string | null | undefined;
  dnsServers?: string[] | null | undefined;
  hasInternet?: boolean | null | undefined;
  notVpn?: boolean | null | undefined;
  state?: "connected" | "disconnected" | "unknown" | undefined;
  // Legacy compatibility fields
  ssid?: string | null | undefined;
  auth?: string | null | undefined;
  signal?: string | null | undefined;
  band?: string | null | undefined;
}

export interface WifiVerificationResult {
  authorized: boolean;
  networkType: "SONA" | "M" | "UNAUTHORIZED" | "UNAVAILABLE";
  networkSummary: string;
  reason: string;
  stage: "DISCONNECTED" | "FINGERPRINT_CHECK_FAILED" | "UNABLE_TO_VERIFY" | "VERIFIED";
  timestamp: string;
  ipv4?: string | undefined;
  gateway?: string | undefined;
  dnsServers?: string[] | undefined;
  ipv4Subnet?: string | undefined;
  ssid?: string | undefined;
  auth?: string | undefined;
  signal?: string | undefined;
  band?: string | undefined;
}

export interface WifiStatus {
  isSonaWifi: boolean;
  authorized: boolean;
  networkType?: "SONA" | "M" | "UNAUTHORIZED" | "UNAVAILABLE" | undefined;
  networkSummary: string;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
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
 * Parses IPv4 string into 32-bit unsigned integer.
 */
export function parseIpv4(ip?: string | null | undefined): number | null {
  if (!ip) return null;
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) + n;
  }
  return num >>> 0;
}

/**
 * Tests whether an IPv4 address belongs to a CIDR subnet prefix.
 */
export function isIpInSubnet(ip?: string | null | undefined, cidr?: string | null | undefined): boolean {
  if (!ip || !cidr) return false;
  const [subnetIp, prefixStr] = cidr.split("/");
  if (!subnetIp || !prefixStr) return false;
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = parseIpv4(ip);
  const subnetNum = parseIpv4(subnetIp);
  if (ipNum === null || subnetNum === null) return false;

  const mask = prefix === 0 ? 0 : ((-1 << (32 - prefix)) >>> 0);
  return (ipNum & mask) === (subnetNum & mask);
}

export interface CampusNetworkMatch {
  matched: boolean;
  networkId: "SONA" | "M" | "UNAUTHORIZED" | "UNAVAILABLE";
  networkName: string;
  reason: string;
}

/**
 * Validates observed network properties against authorized campus network fingerprints.
 * Strictly avoids SSID, BSSID, and client MAC matching.
 */
export function matchNetworkFingerprint(fp: NetworkFingerprintPayload): CampusNetworkMatch {
  // If no network details are provided at all
  if (
    !fp.transport &&
    fp.isWifi === undefined &&
    !fp.ipv4 &&
    !fp.gateway &&
    (!fp.dnsServers || fp.dnsServers.length === 0)
  ) {
    return {
      matched: false,
      networkId: "UNAVAILABLE",
      networkName: "Unable to verify network fingerprint",
      reason: "No network information provided.",
    };
  }

  // 1. Must be connected over hardware Wi-Fi transport
  const isWifiTransport =
    fp.transport === "wifi" ||
    (fp.isWifi === true && fp.transport !== "cellular" && fp.transport !== "none");

  if (!isWifiTransport) {
    if (fp.transport === "cellular") {
      return {
        matched: false,
        networkId: "UNAUTHORIZED",
        networkName: "Mobile Data",
        reason: "Device is connected to cellular/mobile data, not campus Wi-Fi.",
      };
    }
    if (fp.transport === "none" || fp.state === "disconnected") {
      return {
        matched: false,
        networkId: "UNAVAILABLE",
        networkName: "Disconnected",
        reason: "Device is disconnected from all networks.",
      };
    }
    return {
      matched: false,
      networkId: "UNAUTHORIZED",
      networkName: "Non-Wi-Fi Network",
      reason: "Network transport is not Wi-Fi.",
    };
  }

  const ipv4 = (fp.ipv4 || "").trim();
  const gateway = (fp.gateway || "").trim();
  const rawDns = Array.isArray(fp.dnsServers)
    ? fp.dnsServers
    : typeof fp.dnsServers === "string"
      ? [fp.dnsServers]
      : [];
  const dnsServers = rawDns.map((s) => String(s).trim().toLowerCase());

  // If no network details are available at all
  if (!ipv4 && !gateway && dnsServers.length === 0) {
    return {
      matched: false,
      networkId: "UNAVAILABLE",
      networkName: "Unable to verify network fingerprint",
      reason: "No network fingerprint telemetry returned from native network layer.",
    };
  }

  // -------------------------------------------------------------
  // FINGERPRINT 1: SONA-WIFI (Institutional Campus Network)
  // Stable characteristics (from reference network audit):
  // - IPv4 default gateway: 172.16.16.16
  // - IPv4 DNS server: 172.16.16.16
  // - IPv4 Subnet: 172.16.0.0/12 (Institutional Class B)
  // -------------------------------------------------------------
  const isSonaGateway = gateway === "172.16.16.16";
  const isSonaDns = dnsServers.includes("172.16.16.16");
  const isSonaSubnet =
    isIpInSubnet(ipv4, "172.16.0.0/12") ||
    (fp.ipv4Subnet ? isIpInSubnet(fp.ipv4Subnet.split("/")[0], "172.16.0.0/12") : false);

  if ((isSonaGateway || isSonaDns) && isSonaSubnet) {
    return {
      matched: true,
      networkId: "SONA",
      networkName: "SONA Campus Network",
      reason: `Verified SONA campus network fingerprint (Gateway/DNS: 172.16.16.16, Subnet: 172.16.0.0/12)`,
    };
  }

  // -------------------------------------------------------------
  // FINGERPRINT 2: M (Institutional Campus Network)
  // Stable characteristics (from reference network audit):
  // - IPv4 DNS server: 10.220.86.133
  // - IPv6 DNS server: 2409:40f4:311d:b23a::52
  // - IPv4 Subnet: 10.220.86.0/24 or 10.220.0.0/16
  // - Gateway: 10.220.86.1 or 10.220.86.133 (within 10.220.86.x)
  // -------------------------------------------------------------
  const isMDns =
    dnsServers.includes("10.220.86.133") ||
    dnsServers.some((d) => d.includes("2409:40f4:311d:b23a"));
  const isMSubnet =
    isIpInSubnet(ipv4, "10.220.86.0/24") ||
    isIpInSubnet(ipv4, "10.220.0.0/16") ||
    (fp.ipv4Subnet ? isIpInSubnet(fp.ipv4Subnet.split("/")[0], "10.220.0.0/16") : false);
  const isMGateway =
    gateway === "10.220.86.1" ||
    gateway === "10.220.86.133" ||
    gateway.startsWith("10.220.86.");

  if ((isMDns || isMGateway) && isMSubnet) {
    return {
      matched: true,
      networkId: "M",
      networkName: "M Institutional Network",
      reason: `Verified M campus network fingerprint (DNS: 10.220.86.133, Subnet: 10.220.86.0/24)`,
    };
  }

  // -------------------------------------------------------------
  // FAILED: Any other network (Oppo K13, Home Wi-Fi, JioFiber, Airtel, etc.)
  // -------------------------------------------------------------
  return {
    matched: false,
    networkId: "UNAUTHORIZED",
    networkName: "Unauthorized Network",
    reason: `Network fingerprint rejected. Observed Gateway: ${gateway || "none"}, DNS: ${dnsServers.join(", ") || "none"}, IP: ${ipv4 || "none"} do not match authorized campus network fingerprints.`,
  };
}

/**
 * Validates network connection using ONLY pure network fingerprinting.
 * Central authority for client and server.
 */
export function verifyCampusWifi(payload: NetworkFingerprintPayload): WifiVerificationResult {
  const timestamp = new Date().toISOString();
  const match = matchNetworkFingerprint(payload);

  if (match.matched) {
    return {
      authorized: true,
      networkType: match.networkId as "SONA" | "M",
      networkSummary: match.networkName,
      reason: match.reason,
      stage: "VERIFIED",
      timestamp,
      ipv4: payload.ipv4 || undefined,
      gateway: payload.gateway || undefined,
      dnsServers: payload.dnsServers ? [...payload.dnsServers] : undefined,
      ipv4Subnet: payload.ipv4Subnet || undefined,
      ssid: match.networkName,
    };
  }

  const stage =
    match.networkId === "UNAVAILABLE"
      ? payload.state === "disconnected"
        ? "DISCONNECTED"
        : "UNABLE_TO_VERIFY"
      : "FINGERPRINT_CHECK_FAILED";

  return {
    authorized: false,
    networkType: match.networkId as "UNAUTHORIZED" | "UNAVAILABLE",
    networkSummary: match.networkName,
    reason: match.reason,
    stage,
    timestamp,
    ipv4: payload.ipv4 || undefined,
    gateway: payload.gateway || undefined,
    dnsServers: payload.dnsServers ? [...payload.dnsServers] : undefined,
    ipv4Subnet: payload.ipv4Subnet || undefined,
    ssid: match.networkName,
  };
}
