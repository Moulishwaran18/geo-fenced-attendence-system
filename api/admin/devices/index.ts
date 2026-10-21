/**
 * Vercel Serverless Function: GET /api/admin/devices
 *
 * Administrator endpoint to list all registered faculty devices, their attestation status,
 * cryptographic key IDs, and lifecycle states.
 */

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import type { DeviceRecord } from "../../../src/server/device-binding.ts";

const ADMIN_TOKEN_SECRET =
  (typeof process !== "undefined" &&
    (process.env["CAMPUS_ADMIN_SECRET"] ||
      process.env["CAMPUS_AUTH_SECRET"] ||
      process.env["ADMIN_SECRET_KEY"])) ||
  "campusattend-admin-sec-key-moulish-2026-auth-token";

const LOCAL_STORE_PATH = path.resolve(process.cwd(), "data", "staff-db.json");

function getSupabase() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) ||
    "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  if (!url || !key) return null;
  return createClient(url, key);
}

function verifyAdminToken(token?: string | null): { valid: boolean; payload?: any; error?: string } {
  if (!token || typeof token !== "string") return { valid: false, error: "MISSING_TOKEN" };
  const parts = token.trim().split(".");
  if (parts.length !== 2) return { valid: false, error: "INVALID_FORMAT" };
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return { valid: false, error: "INVALID_FORMAT" };
  try {
    const expectedSig = crypto.createHmac("sha256", ADMIN_TOKEN_SECRET).update(payloadB64).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (payload.expiresAt && Date.now() > payload.expiresAt) {
      return { valid: false, error: "TOKEN_EXPIRED" };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message || "DECODE_FAILED" };
  }
}

function extractAdminToken(req: any): string | null {
  if (!req) return null;
  const headers = req.headers || {};
  const getHeader = (name: string): string => {
    if (typeof headers.get === "function") return headers.get(name) || "";
    const lower = name.toLowerCase();
    return headers[name] || headers[lower] || "";
  };
  const authHeader = getHeader("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (authHeader && !authHeader.includes(" ")) {
    return authHeader.trim();
  }
  const customHeader = getHeader("x-admin-token");
  if (customHeader) return customHeader.trim();

  const cookieHeader = getHeader("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") return chained.json(payload);
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") res.end(JSON.stringify(payload));
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

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "GET") {
    return sendJsonResponse(res, 405, {
      success: false,
      error: "Method not allowed. Use GET /api/admin/devices.",
    });
  }

  // 1. Authenticate administrator session
  const token = extractAdminToken(req);
  const adminAuth = verifyAdminToken(token);
  const role = String(adminAuth.payload?.role || "").toLowerCase();
  if (!adminAuth.valid || !adminAuth.payload || (role !== "admin" && role !== "superadmin")) {
    return sendJsonResponse(res, 401, {
      success: false,
      error: "UNAUTHORIZED",
      message: "Administrator privilege required to inspect registered devices.",
    });
  }

  try {
    const supabase = getSupabase();
    let devices: any[] = [];

    if (supabase) {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .order("registered_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        devices = data;
      }
    }

    // Merge with local store if available
    try {
      if (fs.existsSync(LOCAL_STORE_PATH)) {
        const content = fs.readFileSync(LOCAL_STORE_PATH, "utf-8");
        const store = JSON.parse(content);
        if (Array.isArray(store.devices)) {
          const ids = new Set(devices.map((d) => d.id));
          for (const d of store.devices) {
            if (!ids.has(d.id)) {
              devices.push(d);
            }
          }
        }
      }
    } catch {}

    return sendJsonResponse(res, 200, {
      success: true,
      count: devices.length,
      devices: devices.map((d: any) => ({
        id: d.id,
        staffId: d.staff_id,
        staffCode: d.staff_code,
        staffName: d.staff_name,
        model: d.model,
        os: d.os,
        platform: d.platform || "android",
        attestationStatus: d.attestation_status || "Verified",
        keyAlgorithm: d.key_algorithm || "ECDSA_P256",
        status: d.status,
        registeredAt: d.registered_at,
        lastVerifiedAt: d.last_verified_at,
        revokedAt: d.revoked_at,
        revocationReason: d.revocation_reason,
        revokedBy: d.revoked_by,
      })),
    });
  } catch (err: any) {
    console.error("[api/admin/devices] Error:", err);
    return sendJsonResponse(res, 500, {
      success: false,
      error: "SERVER_ERROR",
      message: err?.message || "Internal server error retrieving registered devices.",
    });
  }
}
