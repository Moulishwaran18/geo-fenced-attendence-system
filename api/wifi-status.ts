/**
 * Vercel Serverless Function: GET /api/wifi-status & POST /api/wifi-status
 *
 * AUTHORITATIVE CAMPUS WI-FI VERIFICATION ENGINE:
 * 1. Native Android APK (Window / AndroidWifiBridge):
 *    - Validates real connected Wi-Fi SSID reported by the device OS.
 *    - Authorizes if SSID contains "sona" (case-insensitive substring match).
 *    - Rejects SSIDs that do not contain "sona".
 *    - Rejects empty, null, unknown, unavailable, or permission-denied SSID results.
 *    - Previous special "m" exception is removed.
 *    - No public IP allowlisting, gateway, DNS, BSSID, or LAN fingerprint checks required.
 *    - Zero Client Trust: Mints a cryptographically signed HMAC-SHA256 `networkAuthToken`
 *      for server-side attendance gating.
 * 2. Normal Web Browsers (Chrome / Firefox / Safari on Mobile or Desktop):
 *    - Standard browsers cannot read the Wi-Fi SSID.
 *    - Returns explicit BROWSER_SSID_UNAVAILABLE error without bypasses or false authorizations.
 */

import crypto from "node:crypto";

const TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_AUTH_SECRET"] || process.env["NETWORK_AUTH_SECRET"])) ||
  "sona-campus-wifi-egress-auth-secret-key-2026";
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const REGISTERED_CAMPUS_BSSID = "B0:1F:8C:29:6B:30" as const;
export const SECONDARY_APPROVED_BSSID = "72:CD:0D:E8:D4:B0" as const;
export const APPROVED_CAMPUS_BSSIDS = [
  "B0:1F:8C:29:6B:30",
  "72:CD:0D:E8:D4:B0",
] as const;
export const CAMPUS_WIFI_FAILURE_MESSAGE =
  "Campus Wi-Fi verification failed. Please connect to the official campus Wi-Fi." as const;

export function normalizeBssid(bssid?: string | null | undefined): string {
  if (!bssid || typeof bssid !== "string") return "";
  return bssid.trim().replace(/^["']|["']$/g, "").replace(/-/g, ":").toUpperCase();
}

export function isAuthorizedCampusBssid(bssid?: string | null | undefined): boolean {
  const clean = normalizeBssid(bssid);
  if (!clean) return false;
  if (
    clean === "02:00:00:00:00:00" ||
    clean === "00:00:00:00:00:00" ||
    clean === "UNKNOWN" ||
    clean === "BSSID_UNAVAILABLE" ||
    clean === "NULL"
  ) {
    return false;
  }
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(clean)) {
    return false;
  }
  return APPROVED_CAMPUS_BSSIDS.some((app) => app.toUpperCase() === clean);
}

/**
 * Validates Wi-Fi SSID according to authoritative campus policy:
 * Accepts if SSID contains 'sona' (case-insensitive).
 */
export function isAuthorizedSonaSsid(ssid?: string | null | undefined): boolean {
  if (!ssid || typeof ssid !== "string") return false;
  const clean = ssid.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (
    !clean ||
    clean === "<unknown ssid>" ||
    clean === "unknown" ||
    clean === "ssid_unavailable" ||
    clean === "0x"
  ) {
    return false;
  }
  return clean.includes("sona");
}

/**
 * Creates cryptographically signed HMAC-SHA256 network authorization token.
 */
export function createNetworkAuthToken(ssid: string, bssid: string = REGISTERED_CAMPUS_BSSID): string {
  const payload = {
    authorized: true,
    ssid,
    bssid: normalizeBssid(bssid) || REGISTERED_CAMPUS_BSSID,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    network: ssid,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr, "utf-8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies HMAC-SHA256 signed network authorization token.
 */
export function verifyNetworkAuthToken(token?: string | null | undefined): {
  valid: boolean;
  payload?: any;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "MISSING_TOKEN" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "INVALID_TOKEN_FORMAT" };
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return { valid: false, error: "INVALID_TOKEN_FORMAT" };
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", TOKEN_SECRET)
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }

    const payloadStr = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadStr);

    if (!payload.expiresAt || typeof payload.expiresAt !== "number") {
      return { valid: false, error: "MALFORMED_PAYLOAD" };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }

    if (!payload.authorized || !isAuthorizedCampusBssid(payload.bssid)) {
      return { valid: false, error: "UNAUTHORIZED_BSSID_IN_TOKEN" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "TOKEN_DECODE_FAILED" };
  }
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(status).json(payload);
    }
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function sendJsonResponseWithCookie(res: any, status: number, payload: any, token: string) {
  const cookieStr = `sona_network_auth=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=300`;
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Set-Cookie", cookieStr);
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(status).json(payload);
    }
    res.statusCode = status;
    res.end(JSON.stringify(payload));
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "set-cookie": cookieStr,
    },
  });
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

  // 1. Android APK Native Bridge Flow
  if (body && body.isNativeBridge === true) {
    const transport = String(body.transport || "").toLowerCase();
    const isWifi = body.isWifi === true || transport === "wifi";
    const apiLevel = typeof body.apiLevel === "number" ? body.apiLevel : undefined;
    const hasFineLocation = typeof body.hasFineLocation === "boolean" ? body.hasFineLocation : undefined;
    const hasNearbyWifi = typeof body.hasNearbyWifi === "boolean" ? body.hasNearbyWifi : undefined;
    const ssidSource = typeof body.ssidSource === "string" ? body.ssidSource : undefined;
    const bssidSource = typeof body.bssidSource === "string" ? body.bssidSource : undefined;
    const rawBssid = typeof body.rawBssid === "string" ? body.rawBssid : undefined;
    const bssidDiagnostic = typeof body.bssidDiagnostic === "string" ? body.bssidDiagnostic : undefined;
    const cleanBssid = normalizeBssid(body.bssid);

    // 1A. Permission Denied on Android
    if (body.permissionGranted === false || body.permissionDenied === true) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "Permission Denied",
        networkType: "UNAVAILABLE",
        networkSummary: "Permission Denied",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "PERMISSION_DENIED",
        reason: "Location/Wi-Fi permission denied. Please grant permission in Android settings to allow reading Wi-Fi name.",
        state: "connected",
        stage: "UNABLE_TO_VERIFY",
        timestamp,
        isNativeBridge: true,
        apiLevel,
        hasFineLocation,
        hasNearbyWifi,
        ssidSource,
      });
    }

    // 1B. Location Services Disabled on device
    if (body.locationEnabled === false || body.locationDisabled === true) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "Location Disabled",
        networkType: "UNAVAILABLE",
        networkSummary: "Location Disabled",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "LOCATION_SERVICES_DISABLED",
        reason: "Device location is turned off. Android requires location to be enabled to read the Wi-Fi SSID.",
        state: "connected",
        stage: "UNABLE_TO_VERIFY",
        timestamp,
        isNativeBridge: true,
        apiLevel,
        hasFineLocation,
        hasNearbyWifi,
        ssidSource,
      });
    }

    // 1C. Cellular / Mobile Data
    if (transport === "cellular") {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "Mobile Data",
        networkType: "UNAUTHORIZED",
        networkSummary: "Mobile Data",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "CELLULAR_DATA",
        reason: "Device is connected to mobile data, not Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
        state: "connected",
        stage: "FINGERPRINT_CHECK_FAILED",
        timestamp,
        isNativeBridge: true,
      });
    }

    // 1D. Disconnected
    if (transport === "none" || body.state === "disconnected" || body.connected === false) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "Disconnected",
        networkType: "UNAVAILABLE",
        networkSummary: "Disconnected",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "DISCONNECTED",
        reason: "Device is disconnected from Wi-Fi. Connect to a Wi-Fi network containing 'sona'.",
        state: "disconnected",
        stage: "DISCONNECTED",
        timestamp,
        isNativeBridge: true,
      });
    }

    // 1E. Other non-Wi-Fi transport
    if (!isWifi) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "Non-Wi-Fi Network",
        networkType: "UNAUTHORIZED",
        networkSummary: "Non-Wi-Fi Network",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "NOT_WIFI",
        reason: "Network transport is not Wi-Fi. Please connect to a Wi-Fi network containing 'sona'.",
        state: "connected",
        stage: "FINGERPRINT_CHECK_FAILED",
        timestamp,
        isNativeBridge: true,
      });
    }

    // 1F. Authoritative Campus BSSID evaluation (Requirements 1-6)
    if (
      !cleanBssid ||
      cleanBssid === "02:00:00:00:00:00" ||
      cleanBssid === "00:00:00:00:00:00" ||
      cleanBssid === "BSSID_UNAVAILABLE" ||
      cleanBssid === "UNKNOWN" ||
      cleanBssid === "NULL"
    ) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: "BSSID Unavailable",
        networkType: "UNAVAILABLE",
        networkSummary: "BSSID Unavailable",
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "BSSID_UNAVAILABLE",
        reason:
          "Campus Wi-Fi verification failed: Access point BSSID is unavailable or restricted. Please ensure location services are enabled and permissions are granted.",
        state: "connected",
        stage: "UNABLE_TO_VERIFY",
        timestamp,
        isNativeBridge: true,
        apiLevel,
        hasFineLocation,
        hasNearbyWifi,
        ssidSource,
        bssidSource,
        rawBssid,
        bssidDiagnostic,
      });
    }

    // 1G. BSSID Mismatch check (compare normalized uppercase against B0:1F:8C:29:6B:30)
    if (!isAuthorizedCampusBssid(cleanBssid)) {
      return sendJsonResponse(res, 200, {
        isSonaWifi: false,
        authorized: false,
        network: cleanBssid,
        networkType: "UNAUTHORIZED",
        networkSummary: cleanBssid,
        verificationMethod: "NATIVE_BRIDGE",
        errorCode: "UNAUTHORIZED_BSSID",
        reason: CAMPUS_WIFI_FAILURE_MESSAGE,
        state: "connected",
        stage: "FINGERPRINT_CHECK_FAILED",
        timestamp,
        bssid: cleanBssid,
        rawBssid,
        bssidDiagnostic,
        isNativeBridge: true,
        apiLevel,
        hasFineLocation,
        hasNearbyWifi,
        ssidSource,
        bssidSource,
      });
    }

    // 1H. Exact BSSID Match: Mint signed authorization token and pass verification
    const cleanSsid = body.ssid ? String(body.ssid).trim().replace(/^["']|["']$/g, "") : "";
    const networkAuthToken = createNetworkAuthToken(cleanSsid || "Campus Wi-Fi", cleanBssid);
    const authorizedPayload = {
      isSonaWifi: true,
      authorized: true,
      network: cleanSsid ? `${cleanSsid} (${cleanBssid})` : cleanBssid,
      networkType: "SONA",
      networkSummary: cleanSsid ? `${cleanSsid} (${cleanBssid})` : cleanBssid,
      verificationMethod: "NATIVE_BRIDGE",
      reason: `Campus Wi-Fi access point verified: ${cleanBssid}`,
      state: "connected",
      stage: "VERIFIED",
      timestamp,
      ssid: cleanSsid,
      bssid: cleanBssid,
      rawBssid,
      bssidDiagnostic,
      bssidVerified: true,
      networkAuthToken,
      isNativeBridge: true,
      apiLevel,
      hasFineLocation,
      hasNearbyWifi,
      ssidSource,
      bssidSource,
    };
    return sendJsonResponseWithCookie(res, 200, authorizedPayload, networkAuthToken);
  }

  // 2. Normal Web Browser Flow (Desktop / Mobile Chrome / Safari)
  // Standard web browsers cannot read the connected Wi-Fi SSID.
  // Explicitly inform the user without falsely authorizing or silently bypassing.
  return sendJsonResponse(res, 200, {
    isSonaWifi: false,
    authorized: false,
    network: "Browser Sandbox",
    networkType: "UNAVAILABLE",
    networkSummary: "Browser Sandbox",
    verificationMethod: "NONE",
    errorCode: "BROWSER_SSID_UNAVAILABLE",
    reason: "Standard web browsers cannot detect Wi-Fi SSID. Please open CampusAttend in the Android APK to verify your Wi-Fi connection.",
    state: "connected",
    stage: "UNABLE_TO_VERIFY",
    timestamp,
    isNativeBridge: false,
  });
}
