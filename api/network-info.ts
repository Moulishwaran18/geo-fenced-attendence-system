/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Notice: Wi-Fi authentication uses PURE NETWORK-DETAIL FINGERPRINTING.
 * SSID name, MAC address, BSSID, and client IP matching are completely prohibited.
 *
 * Fingerprints verified:
 * - SONA: Gateway/DNS 172.16.16.16 + Subnet 172.16.0.0/12
 * - M: DNS 10.220.86.133 + Subnet 10.220.86.0/24 (or 10.220.0.0/16)
 */

export default async function handler(req: any, res?: any) {
  const payload = {
    authModel: "NETWORK_DETAIL_FINGERPRINT_AUTHENTICATION",
    message:
      "Wi-Fi authentication verifies stable network-level properties (transport, subnet, gateway, DNS servers) obtained by Android native bridge and validated on Vercel.",
    rules: {
      sona: {
        gateway: "172.16.16.16",
        dns: "172.16.16.16",
        subnet: "172.16.0.0/12",
      },
      m: {
        dns: "10.220.86.133",
        ipv6Dns: "2409:40f4:311d:b23a::52",
        subnet: "10.220.86.0/24 or 10.220.0.0/16",
      },
      source: "Android ConnectivityManager & LinkProperties via AndroidWifiBridge.kt",
    },
    timestamp: new Date().toISOString(),
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(payload);
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}
