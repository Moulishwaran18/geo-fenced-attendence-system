/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * PURE SSID NAME-BASED VERIFICATION
 *
 * The ONLY factor used for Wi-Fi authorization is the ACTUAL connected
 * Wi-Fi SSID obtained from the Android native Wi-Fi bridge.
 *
 * All IP, CIDR, gateway, DNS, and proxy-based verification is completely removed.
 *
 * If requested by an ordinary web browser without native bridge SSID telemetry:
 * -> returns authorized: false, ssid: "Unavailable", networkSummary: "Unable to determine Wi-Fi name"
 */

function isSsidAuthorized(ssid?: string | null | undefined): boolean {
  if (ssid === null || ssid === undefined) return false;
  const trimmed = String(ssid).trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return false;

  const normalized = trimmed.toLowerCase();

  if (
    normalized === "unknown" ||
    normalized === "unavailable" ||
    normalized === "hidden" ||
    normalized === "<unknown ssid>" ||
    normalized === "none" ||
    normalized === "ssid_unavailable" ||
    normalized === "unavailable in browser"
  ) {
    return false;
  }

  // RULE 1: normalized SSID === "m" -> AUTHORIZED
  if (normalized === "m") {
    return true;
  }

  // RULE 2: normalized SSID contains "sona" -> AUTHORIZED
  if (normalized.includes("sona")) {
    return true;
  }

  return false;
}

export default async function handler(req: any, res?: any) {
  let body: any = {};

  if (req.method === "POST") {
    try {
      if (typeof req.json === "function") {
        body = await req.json();
      } else if (req.body) {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      }
    } catch {
      body = {};
    }
  }

  const timestamp = new Date().toISOString();

  // Pure SSID evaluation from native bridge
  if (body.isNativeBridge === true && body.ssid) {
    const rawSsid = String(body.ssid).trim().replace(/^["']|["']$/g, "");
    const authorized = isSsidAuthorized(rawSsid);

    const payload = {
      isSonaWifi: authorized,
      authorized,
      ssid: rawSsid,
      networkSummary: rawSsid,
      reason: authorized
        ? `Verified Campus Wi-Fi "${rawSsid}" via Android native bridge`
        : `Unauthorized Wi-Fi network "${rawSsid}". Only authorized campus networks (M or SONA) are permitted.`,
      state: "connected",
      stage: authorized ? "VERIFIED" : "SSID_CHECK_FAILED",
      timestamp,
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(200).json(payload);
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  // Ordinary browser fallback (Chrome without native bridge)
  // Standard browsers cannot access Android Wi-Fi SSID directly.
  const browserPayload = {
    isSonaWifi: false,
    authorized: false,
    ssid: "Unavailable",
    networkSummary: "Unable to determine Wi-Fi name",
    reason: "Browser cannot access Android Wi-Fi SSID directly. Open via the Android attendance app to verify campus Wi-Fi.",
    state: "connected",
    stage: "UNABLE_TO_VERIFY",
    timestamp,
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(browserPayload);
  }

  return new Response(JSON.stringify(browserPayload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
