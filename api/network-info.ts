/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Notice: SONA-WIFI Campus Network Authorization uses SERVER-SIDE DUAL-EGRESS
 * VERIFICATION (Option B) for normal Android Chrome and desktop browsers, alongside
 * native Android bridge compatibility for the existing APK.
 *
 * Authorized SONA-WIFI Egress IPs:
 * - 111.92.42.18 (Asianet Broadband - Dynamic lease)
 * - 115.247.87.98 (Reliance Jio Enterprise - AS55836)
 */

import { getAuthorizedCampusEgressIps, extractTrustedClientIp } from "../src/lib/wifi-config.ts";

export default async function handler(req: any, res?: any) {
  const clientIp = extractTrustedClientIp(req);
  const authorizedIps = getAuthorizedCampusEgressIps();
  const isMatch = authorizedIps.includes(clientIp);

  const payload = {
    authModel: "SONA_CAMPUS_DUAL_EGRESS_IP_AUTHENTICATION",
    network: "SONA-WIFI",
    targetBrowsers: "Android Chrome, Laptop/Desktop Chrome, Edge, Safari",
    clientPublicIp: clientIp !== "unknown" ? clientIp : undefined,
    isAuthorized: isMatch,
    authorizedEgressIps: authorizedIps,
    message:
      "Normal Android Chrome connects directly without APK or native bridge. Vercel independently inspects the real incoming public egress IP.",
    dynamicIpNotice:
      "111.92.42.18 is dynamic Asianet and SONA-WIFI uses Multi-WAN load-balancing. IPs are configurable via AUTHORIZED_CAMPUS_EGRESS_IPS environment variable.",
    timestamp: new Date().toISOString(),
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
