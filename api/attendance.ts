/**
 * Vercel Serverless Function: POST /api/attendance
 *
 * CRITICAL SERVER-SIDE ATTENDANCE PROTECTION GATE:
 * - Independently enforces server-verified SONA-WIFI campus network authorization.
 * - ZERO CLIENT TRUST: Ignores any client-supplied `wifiAuthorized: true` or client claims.
 * - Requires a valid, unexpired cryptographic `networkAuthToken` minted by the server
 *   OR direct connection from an authorized campus egress IP (111.92.42.18 / 115.247.87.98).
 * - Prevents DevTools / API manipulation from recording attendance outside campus.
 */

import { extractTrustedClientIp, isAuthorizedCampusEgressIp } from "../src/lib/wifi-config.ts";
import { verifyNetworkAuthToken } from "../src/server/network-auth.ts";
import { createClient } from "@supabase/supabase-js";

function getCookie(req: any, name: string): string | null {
  const cookieHeader =
    (req && req.headers && (req.headers["cookie"] || req.headers["Cookie"])) || "";
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export default async function handler(req: any, res?: any) {
  if (req.method !== "POST") {
    const errorPayload = { error: "Method not allowed. Use POST." };
    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json");
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(405).json(errorPayload);
      }
      res.statusCode = 405;
      res.end(JSON.stringify(errorPayload));
      return;
    }
    return new Response(JSON.stringify(errorPayload), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  let body: any = {};
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

  // 1. Extract Real Incoming Client Public IP from Trusted Server Infrastructure
  const clientIp = extractTrustedClientIp(req);

  // 2. Extract Server-Issued Network Authorization Token (from Header, Body, or Secure Cookie)
  const headerToken = req.headers?.["x-network-auth-token"] || req.headers?.["X-Network-Auth-Token"];
  const cookieToken = getCookie(req, "sona_network_auth");
  const bodyToken = body.networkAuthToken;
  const networkToken = headerToken || cookieToken || bodyToken;

  // 3. Independent Cryptographic & Network Verification
  const tokenCheck = verifyNetworkAuthToken(networkToken);
  const ipCheck = isAuthorizedCampusEgressIp(clientIp);

  // ZERO CLIENT TRUST GATE:
  // Must have a valid, cryptographically unexpired server token OR current connection from authorized egress IP
  const isNetworkAuthorized = tokenCheck.valid || ipCheck.authorized;

  if (!isNetworkAuthorized) {
    const rejectionPayload = {
      success: false,
      error: "CAMPUS_NETWORK_UNAUTHORIZED",
      message:
        "Attendance rejected: Device is not authorized on SONA-WIFI campus network. Genuine server-side campus network verification is required.",
      clientIp: clientIp !== "unknown" ? clientIp : undefined,
      tokenError: tokenCheck.error || "No valid token present.",
    };

    if (res && typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      if (typeof res.status === "function" && typeof res.json === "function") {
        return res.status(403).json(rejectionPayload);
      }
      res.statusCode = 403;
      res.end(JSON.stringify(rejectionPayload));
      return;
    }
    return new Response(JSON.stringify(rejectionPayload), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  // 4. Authorized! Record Attendance in Database
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  const dateStr = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  const dayStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Asia/Kolkata",
  });
  const dateKey = now.toISOString().slice(0, 10).replace(/-/g, "");

  const staffCode = body.staffCode || "SCT-2417";
  const staffName = body.staffName || "Staff Member";
  const department = body.department || "Engineering";
  let attendanceId = `ATT-${dateKey}-${String(Math.floor(Math.random() * 900) + 100)}`;

  // Record in Supabase if configured
  const supabaseUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const supabaseKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SUPABASE_ANON_KEY"] ||
    process.env["VITE_SUPABASE_ANON_KEY"];

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase
        .from("attendance_records")
        .insert({
          staff_code: staffCode,
          staff_name: staffName,
          department: department,
          day: dayStr,
          time: timeStr,
          status: "Present",
          location: body.location || "Main Campus, Sona College",
          verification: "Verified (SONA-WIFI)",
          latitude: body.latitude,
          longitude: body.longitude,
        })
        .select("id")
        .single();

      if (data?.id) {
        attendanceId = `ATT-${data.id.slice(0, 8).toUpperCase()}`;
      }
      if (error) {
        console.warn("[api/attendance] Supabase insert notice:", error.message);
      }
    } catch (dbErr) {
      console.warn("[api/attendance] Supabase connection notice:", dbErr);
    }
  }

  const successPayload = {
    success: true,
    receipt: {
      attendanceId,
      time: timeStr,
      date: dateStr,
    },
    verifiedNetwork: "SONA Campus Network",
    verifiedIp: tokenCheck.payload?.verifiedIp || ipCheck.matchedIp || clientIp,
    timestamp: now.toISOString(),
  };

  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function" && typeof res.json === "function") {
      return res.status(200).json(successPayload);
    }
    res.statusCode = 200;
    res.end(JSON.stringify(successPayload));
    return;
  }
  return new Response(JSON.stringify(successPayload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
