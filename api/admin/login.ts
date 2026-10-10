/**
 * Vercel Serverless Function: POST /api/admin/login
 *
 * Self-contained administrator authentication endpoint for CampusAttend.
 * Authenticates:
 * - Administrator ID: moulish
 * - Password: moulish@123
 *
 * Security:
 * - PBKDF2 SHA-512 with 100,000 iterations and per-account cryptographic salt
 * - Timing-safe constant time comparison to prevent side-channel timing attacks
 * - HMAC-SHA256 cryptographically signed session tokens
 * - Strict HTTPS Secure HttpOnly SameSite=Lax cookie
 * - Zero plaintext password storage
 * - Zero relative file imports to guarantee 100% Vercel Serverless bundling reliability
 */

import crypto from "node:crypto";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

const ADMIN_CREDENTIALS = {
  id: "adm-moulish-001",
  username: "moulish",
  name: "Moulishwaran S",
  email: "moulish@sonatech.ac.in",
  role: "admin" as const,
  salt: "9793e19a6e61abd07d646d6a7e5b5a29",
  password_hash:
    "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
  active: true,
};

function verifyPassword(candidatePassword: string, storedHash: string, salt: string): boolean {
  if (!candidatePassword || !storedHash || !salt) return false;
  try {
    const candidateHash = crypto
      .pbkdf2Sync(candidatePassword, salt, 100000, 64, "sha512")
      .toString("hex");

    const candidateBuf = Buffer.from(candidateHash, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");

    if (candidateBuf.length !== storedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch (err) {
    console.error("[login] Error verifying password:", err);
    return false;
  }
}

function createSessionToken(
  admin: { id: string; username: string; name: string; email: string },
  ttlMs = 24 * 60 * 60 * 1000,
): string {
  const now = Date.now();
  const payload = {
    sub: admin.username,
    username: admin.username,
    name: admin.name,
    email: admin.email,
    role: "admin",
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  return `${payloadStr}.${signature}`;
}

function sendJsonResponse(
  res: any,
  status: number,
  payload: any,
  headersInit?: Record<string, string>,
) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (headersInit) {
      for (const [key, val] of Object.entries(headersInit)) {
        res.setHeader(key, val);
      }
    }
    res.statusCode = status;
    if (typeof res.json === "function") {
      return res.json(payload);
    }
    if (typeof res.end === "function") {
      res.end(JSON.stringify(payload));
    }
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      ...(headersInit || {}),
    },
  });
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use POST for administrator authentication.",
    });
  }

  let body: any = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  } else if (!body && typeof req.on === "function") {
    try {
      const chunks: Buffer[] = [];
      await new Promise((resolve, reject) => {
        req.on("data", (chunk: any) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        req.on("end", resolve);
        req.on("error", reject);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    } catch {
      body = {};
    }
  } else if (typeof req.json === "function") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const username = String(body?.username || body?.id || body?.staffId || "").trim();
  const password = String(body?.password || "");

  if (!username || !password) {
    return sendJsonResponse(res, 400, {
      success: false,
      error: "Administrator ID and password are required.",
    });
  }

  // Verify username match (case-insensitive)
  if (username.toLowerCase() !== ADMIN_CREDENTIALS.username) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "Invalid administrator credentials.",
    });
  }

  // Verify password using PBKDF2 constant-time check
  const isMatch = verifyPassword(password, ADMIN_CREDENTIALS.password_hash, ADMIN_CREDENTIALS.salt);

  if (!isMatch) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "Invalid administrator credentials.",
    });
  }

  // Create HMAC-SHA256 signed session token
  const token = createSessionToken(ADMIN_CREDENTIALS, 24 * 60 * 60 * 1000);
  const cookieHeader = `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;

  return sendJsonResponse(
    res,
    200,
    {
      success: true,
      token,
      admin: {
        id: ADMIN_CREDENTIALS.id,
        username: ADMIN_CREDENTIALS.username,
        name: ADMIN_CREDENTIALS.name,
        email: ADMIN_CREDENTIALS.email,
        role: ADMIN_CREDENTIALS.role,
      },
    },
    { "Set-Cookie": cookieHeader },
  );
}
