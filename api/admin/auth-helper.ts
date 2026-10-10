/**
 * Self-Contained Administrator Authentication Helper for Vercel Serverless Functions
 *
 * Placed within api/admin/ so Vercel's Serverless Function bundler (@vercel/node)
 * includes it directly in the Lambda deployment package.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export interface AdminUserRecord {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin";
  password_hash: string;
  salt: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSessionPayload {
  sub: string;
  username: string;
  name: string;
  email: string;
  role: "admin";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

export const DEFAULT_ADMIN_RECORD: AdminUserRecord = {
  id: "adm-moulish-001",
  username: "moulish",
  name: "Moulishwaran S",
  email: "moulish@sonatech.ac.in",
  role: "admin",
  password_hash:
    "c45a92fc6997d8557b6f4cda99cdf8aef412d742dba52506aeefb96e2850fd8b1054309744e4ffe8644bb2e744c944b09be1d0a9e894e007638554a069d61d50",
  salt: "9793e19a6e61abd07d646d6a7e5b5a29",
  active: true,
  created_at: "2026-10-10T05:42:11.916Z",
  updated_at: "2026-10-10T05:42:11.916Z",
};

export function hashPassword(
  password: string,
  existingSalt?: string,
): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString("hex");
  const hashBuffer = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");
  const hash = hashBuffer.toString("hex");
  return { hash, salt };
}

export function verifyPassword(
  candidatePassword: string,
  storedHash: string,
  salt: string,
): boolean {
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
    console.error("[auth-helper] Error verifying password:", err);
    return false;
  }
}

export function createAdminSessionToken(
  admin: Pick<AdminUserRecord, "id" | "username" | "name" | "email">,
  ttlMs = 24 * 60 * 60 * 1000,
): string {
  const now = Date.now();
  const payload: AdminSessionPayload = {
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

export function verifyAdminSessionToken(tokenStr?: string | null): {
  valid: boolean;
  payload?: AdminSessionPayload;
  error?: string;
} {
  if (!tokenStr || typeof tokenStr !== "string") {
    return { valid: false, error: "Missing administrator session token." };
  }

  const parts = tokenStr.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed administrator session token." };
  }

  const [payloadStr, signature] = parts;
  if (!payloadStr || !signature) {
    return { valid: false, error: "Invalid token components." };
  }

  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return { valid: false, error: "Invalid administrator session signature." };
  }

  try {
    const jsonStr = Buffer.from(payloadStr, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as AdminSessionPayload;

    if (payload.role !== "admin" || payload.username !== "moulish") {
      return { valid: false, error: "Token does not possess administrator privileges." };
    }

    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: "Administrator session has expired." };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to decode administrator session token." };
  }
}

export function extractAdminToken(req: any): string | null {
  if (!req) return null;

  let authHeader = "";
  if (typeof req.headers?.get === "function") {
    authHeader = req.headers.get("authorization") || req.headers.get("x-admin-token") || "";
  } else if (req.headers) {
    authHeader = req.headers["authorization"] || req.headers["x-admin-token"] || "";
  }

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }

  let cookieHeader = "";
  if (typeof req.headers?.get === "function") {
    cookieHeader = req.headers.get("cookie") || "";
  } else if (req.headers) {
    cookieHeader = req.headers["cookie"] || "";
  }

  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

export async function authenticateAdmin(
  usernameCandidate: string,
  passwordCandidate: string,
): Promise<{
  success: boolean;
  token?: string;
  admin?: {
    id: string;
    username: string;
    name: string;
    email: string;
    role: "admin";
  };
  error?: string;
}> {
  if (!usernameCandidate || !passwordCandidate) {
    return { success: false, error: "Administrator ID and password are required." };
  }

  const normalized = usernameCandidate.trim().toLowerCase();
  const admin = DEFAULT_ADMIN_RECORD;

  if (admin.username.toLowerCase() !== normalized) {
    return { success: false, error: "Invalid administrator credentials." };
  }

  if (!admin.active) {
    return { success: false, error: "Administrator account is inactive." };
  }

  const isValidPassword = verifyPassword(passwordCandidate, admin.password_hash, admin.salt);
  if (!isValidPassword) {
    return { success: false, error: "Invalid administrator credentials." };
  }

  const token = createAdminSessionToken(admin, 24 * 60 * 60 * 1000);

  return {
    success: true,
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      email: admin.email,
      role: "admin",
    },
  };
}
