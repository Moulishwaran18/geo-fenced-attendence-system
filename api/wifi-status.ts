/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * HYBRID CAMPUS NETWORK VERIFICATION ENGINE:
 * 1. Web Browsers (Android Chrome & Desktop Chrome):
 *    - Authenticates connection using REAL server-observed public egress IP.
 *    - Validates against authorized SONA-WIFI egress IPs (111.92.42.18, 115.247.87.98).
 *    - Anti-spoofing: Rejects forged client headers via trusted Vercel infrastructure extraction.
 *    - Zero Client Trust: Mints a cryptographically signed `networkAuthToken` for attendance gating.
 * 2. Native Android Bridge (Existing APK WebView compatibility):
 *    - Retains native network-layer LinkProperties & ConnectivityManager fingerprint validation.
 *
 * AUTHORIZED SONA-WIFI EGRESS IPS:
 * - 111.92.42.18 (Asianet Broadband - Dynamic IP warning applies)
 * - 115.247.87.98 (Reliance Jio Enterprise - AS55836)
 */

import {
  extractTrustedClientIp,
  isAuthorizedCampusEgressIp,
  parseIpv4,
  isIpInSubnet,
} from "../src/lib/wifi-config.ts";
import { createNetworkAuthToken } from "../src/server/network-auth.ts";

interface FingerprintEvaluation {
  authorized: boolean;
  networkType: "SONA" | "M" | "UNAUTHORIZED" | "UNAVAILABLE";
  networkSummary: string;
  reason: string;
  stage: "VERIFIED" | "FINGERPRINT_CHECK_FAILED" | "DISCONNECTED" | "UNABLE_TO_VERIFY";
}

function evaluateNetworkFingerprint(payload: any): FingerprintEvaluation {
  const transport = String(payload?.transport || "").toLowerCase();
  const isWifi = payload?.isWifi === true || transport === "wifi";

  // Check 1: Hardware Wi-Fi transport check
  if (!isWifi || transport === "cellular" || transport === "none") {
    if (transport === "cellular") {
      return {
        authorized: false,
        networkType: "UNAUTHORIZED",
        networkSummary: "Mobile Data",
        reason: "Device is connected to mobile data, not campus Wi-Fi.",
        stage: "FINGERPRINT_CHECK_FAILED",
      };
    }
    if (transport === "none" || payload?.state === "disconnected") {
      return {
        authorized: false,
        networkType: "UNAVAILABLE",
        networkSummary: "Disconnected",
        reason: "Device is disconnected from all networks.",
        stage: "DISCONNECTED",
      };
    }
    return {
      authorized: false,
      networkType: "UNAUTHORIZED",
      networkSummary: "Non-Wi-Fi Network",
      reason: "Network transport is not Wi-Fi.",
      stage: "FINGERPRINT_CHECK_FAILED",
    };
  }

  const ipv4 = String(payload?.ipv4 || "").trim();
  const gateway = String(payload?.gateway || "").trim();
  const rawDns = Array.isArray(payload?.dnsServers)
    ? payload.dnsServers
    : typeof payload?.dnsServers === "string"
      ? [payload.dnsServers]
      : [];
  const dnsServers = rawDns.map((d: any) => String(d).trim().toLowerCase());
  const ipv4Subnet = String(payload?.ipv4Subnet || "").trim();

  // If no network details are available
  if (!ipv4 && !gateway && dnsServers.length === 0) {
    return {
      authorized: false,
      networkType: "UNAVAILABLE",
      networkSummary: "Unable to verify network fingerprint",
      reason: "No network fingerprint telemetry returned from native network layer.",
      stage: "UNABLE_TO_VERIFY",
    };
  }

  // FINGERPRINT 1: SONA Campus Network
  const isSonaGateway = gateway === "172.16.16.16";
  const isSonaDns = dnsServers.includes("172.16.16.16");
  const isSonaSubnet =
    isIpInSubnet(ipv4, "172.16.0.0/12") ||
    (ipv4Subnet ? isIpInSubnet(ipv4Subnet.split("/")[0], "172.16.0.0/12") : false);

  if ((isSonaGateway || isSonaDns) && isSonaSubnet) {
    return {
      authorized: true,
      networkType: "SONA",
      networkSummary: "SONA Campus Network",
      reason: "Verified SONA campus network fingerprint (Gateway/DNS: 172.16.16.16, Subnet: 172.16.0.0/12)",
      stage: "VERIFIED",
    };
  }

  // FINGERPRINT 2: M Institutional Network (Preserved for APK)
  const isMDns =
    dnsServers.includes("10.220.86.133") ||
    dnsServers.some((d: string) => d.includes("2409:40f4:311d:b23a"));
  const isMSubnet =
    isIpInSubnet(ipv4, "10.220.86.0/24") ||
    isIpInSubnet(ipv4, "10.220.0.0/16") ||
    (ipv4Subnet ? isIpInSubnet(ipv4Subnet.split("/")[0], "10.220.0.0/16") : false);
  const isMGateway =
    gateway === "10.220.86.1" ||
    gateway === "10.220.86.133" ||
    gateway.startsWith("10.220.86.");

  if ((isMDns || isMGateway) && isMSubnet) {
    return {
      authorized: true,
      networkType: "M",
      networkSummary: "M Institutional Network",
      reason: "Verified M campus network fingerprint (DNS: 10.220.86.133, Subnet: 10.220.86.0/24)",
      stage: "VERIFIED",
    };
  }

  return {
    authorized: false,
    networkType: "UNAUTHORIZED",
    networkSummary: "Unauthorized Network",
    reason: `Network fingerprint rejected. Observed Gateway: ${gateway || "none"}, DNS: ${dnsServers.join(", ") || "none"}, IP: ${ipv4 || "none"} do not match authorized campus network fingerprints.`,
    stage: "FINGERPRINT_CHECK_FAILED",
  };
}

export default async function handler(req: any, res?: any) {
  let body: any = {};

  if (req.method === "POST") {
    try {
      if (typeof req.json === "function") {
        body = await req.json();
      } else if (req.body) {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } else if (typeof req.on === "function") {
        const chunks: Buffer[] = [];
        await new Promise((resolve) => {
          req.on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on("end", resolve);
          req.on("error", resolve);
        });
        const str = Buffer.concat(chunks).toString("utf-8");
        body = str ? JSON.parse(str) : {};
      }
    } catch {
      body = {};
    }
  }

  const timestamp = new Date().toISOString();

  // 1. Native Android Bridge network fingerprint evaluation (Preserves APK compatibility)
  if (body && body.isNativeBridge === true && (body.transport || body.ipv4 || body.gateway || body.dnsServers)) {
    const result = evaluateNetworkFingerprint(body);
    const networkAuthToken = result.authorized ? createNetworkAuthToken("native-bridge") : undefined;

    const payload = {
      isSonaWifi: result.authorized,
      authorized: result.authorized,
      network: result.networkSummary,
      networkType: result.networkType,
      networkSummary: result.networkSummary,
      verificationMethod: "NATIVE_BRIDGE",
      reason: result.reason,
      state: result.stage === "DISCONNECTED" ? "disconnected" : "connected",
      stage: result.stage,
      timestamp,
      ipv4: body.ipv4 || null,
      ipv4Subnet: body.ipv4Subnet || null,
      gateway: body.gateway || null,
      dnsServers: body.dnsServers || [],
      networkAuthToken,
      isNativeBridge: true,
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(200).json(payload);
      }
      res.statusCode = 200;
      res.end(JSON.stringify(payload));
      return;
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // 2. Normal Android Chrome & Laptop / Desktop Browser Verification
  // Server inspects trusted incoming public egress IP from Vercel edge
  const clientIp = extractTrustedClientIp(req);
  const egressResult = isAuthorizedCampusEgressIp(clientIp);

  if (egressResult.authorized) {
    const verifiedIp = egressResult.matchedIp || clientIp;
    const networkAuthToken = createNetworkAuthToken(verifiedIp);

    const authorizedPayload = {
      authorized: true,
      network: "SONA Campus Network",
      verificationMethod: "SERVER_EGRESS_IP",
      verifiedIp,
      isSonaWifi: true,
      networkType: "SONA",
      networkSummary: "SONA Campus Network",
      reason: egressResult.reason,
      state: "connected",
      stage: "VERIFIED",
      networkAuthToken,
      timestamp,
      isNativeBridge: false,
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader(
        "Set-Cookie",
        `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=300`
      );
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(200).json(authorizedPayload);
      }
      res.statusCode = 200;
      res.end(JSON.stringify(authorizedPayload));
      return;
    }
    return new Response(JSON.stringify(authorizedPayload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        "set-cookie": `sona_network_auth=${networkAuthToken}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=300`,
      },
    });
  }

  // Unauthorized Network Response
  const unauthorizedPayload = {
    authorized: false,
    network: "Unauthorized Network",
    verificationMethod: "SERVER_EGRESS_IP",
    verifiedIp: clientIp !== "unknown" ? clientIp : undefined,
    isSonaWifi: false,
    networkType: "UNAUTHORIZED",
    networkSummary: "Unauthorized Network",
    reason: egressResult.reason,
    state: "connected",
    stage: "FINGERPRINT_CHECK_FAILED",
    timestamp,
    isNativeBridge: false,
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(unauthorizedPayload);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(unauthorizedPayload));
    return;
  }
  return new Response(JSON.stringify(unauthorizedPayload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
