/**
 * Server-Side Network Authorization Token Engine
 *
 * Implements cryptographically signed, short-lived network authorization receipts
 * for genuine SONA-WIFI campus network connections.
 *
 * ZERO CLIENT TRUST:
 * - Tokens can only be minted server-side when the incoming request's TCP socket / Vercel edge IP
 *   matches authorized campus egress IPs (111.92.42.18 or 115.247.87.98).
 * - Tokens are signed using HMAC-SHA256 with a server secret.
 * - Tokens have a strict 5-minute TTL to prevent replay attacks.
 * - Attendance registration API independently validates the cryptographic signature.
 */

import crypto from "crypto";

const TOKEN_SECRET =
  (typeof process !== "undefined" && process.env["CAMPUS_AUTH_SECRET"]) ||
  "sona-campus-wifi-egress-auth-secret-key-2026";

export interface NetworkAuthTokenPayload {
  authorized: boolean;
  network: "SONA Campus Network";
  verifiedIp: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

/**
 * Creates a cryptographically signed, short-lived network authorization token.
 */
export function createNetworkAuthToken(verifiedIp: string, ttlMs = 5 * 60 * 1000): string {
  const now = Date.now();
  const payload: NetworkAuthTokenPayload = {
    authorized: true,
    network: "SONA Campus Network",
    verifiedIp,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${signature}`;
}

/**
 * Verifies the authenticity, freshness, and authorization of a network authorization token.
 */
export function verifyNetworkAuthToken(tokenStr?: string | null): {
  valid: boolean;
  payload?: NetworkAuthTokenPayload;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing network authorization token." };
  }

  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed network authorization token structure." };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "Missing token component." };
  }

  const expectedSignature = crypto
    .createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: "Invalid token cryptographic signature." };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as NetworkAuthTokenPayload;

    if (!payload.authorized || payload.network !== "SONA Campus Network") {
      return { valid: false, error: "Token does not grant SONA campus authorization." };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Network authorization token has expired." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode token payload." };
  }
}
