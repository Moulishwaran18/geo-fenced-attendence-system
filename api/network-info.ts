/**
 * Vercel Serverless Function: GET /api/network-info
 *
 * Notice: All IP-based Wi-Fi authentication has been permanently removed.
 * Campus authorization uses ONLY SSID name-based verification from the Android native bridge:
 * - "M" (exact match, case-insensitive)
 * - Contains "SONA" (substring match, case-insensitive)
 */

export default async function handler(req: any, res?: any) {
  const payload = {
    authModel: "PURE_SSID_NAME_AUTHENTICATION",
    message:
      "All IP, CIDR, gateway, DNS, and BSSID-based Wi-Fi verification has been removed. Campus authorization uses ONLY SSID name-based verification from the Android native bridge (exact 'M' or containing 'SONA').",
    rules: {
      rule1: "exact match 'm' (case-insensitive)",
      rule2: "contains 'sona' (case-insensitive)",
      source: "Android native Wi-Fi bridge (AndroidWifiBridge.kt)",
      browserNotice:
        "Normal Google Chrome cannot access Android Wi-Fi APIs directly. Use the Android attendance app to verify campus Wi-Fi.",
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
