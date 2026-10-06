import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { getWifiStatus } from "./lib/wifi-detection";
import {
  verifyCampusWifi,
  extractClientPublicIpFromHeaders,
  isAuthorizedMPublicIp,
} from "./lib/wifi-config";
import { handleStaffApi } from "./server/api/staff-handler";
import { handleFaceVerifyApi } from "./server/api/face-search-handler";
import { handleFaceDetectionLogApi } from "./server/api/audit-log-handler";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);

      // Diagnostic endpoint to discover client's public IP
      if (url.pathname === "/api/network-info") {
        const clientIp = extractClientPublicIpFromHeaders({
          get: (header: string) => request.headers.get(header),
        });
        const configuredIp = (
          process.env["AUTHORIZED_M_PUBLIC_IP"] ||
          (env as any)?.AUTHORIZED_M_PUBLIC_IP ||
          ""
        ).trim();
        const isMatch = isAuthorizedMPublicIp(clientIp, configuredIp);

        let networkCheck = "UNAUTHORIZED (Does not match AUTHORIZED_M_PUBLIC_IP)";
        if (!configuredIp) {
          networkCheck = "NOT_CONFIGURED (Please set AUTHORIZED_M_PUBLIC_IP in environment)";
        } else if (isMatch) {
          networkCheck = "AUTHORIZED (Matches AUTHORIZED_M_PUBLIC_IP)";
        }

        return new Response(
          JSON.stringify({
            publicIp: clientIp || "unknown",
            networkCheck,
            configuredAuthorizedIp: configuredIp ? "[CONFIGURED]" : "[NOT SET]",
            isAuthorized: isMatch,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          },
        );
      }

      // REST API Routes
      if (url.pathname === "/api/face-detection-log" || url.pathname === "/api/admin/face-detection-logs") {
        return await handleFaceDetectionLogApi(request, url.pathname);
      }

      if (url.pathname.startsWith("/api/admin/")) {
        return await handleStaffApi(request, url.pathname);
      }

      if (url.pathname === "/api/face/verify") {
        return await handleFaceVerifyApi(request);
      }

      if (url.pathname === "/api/wifi/verify" || (url.pathname === "/api/wifi-status" && request.method === "POST")) {
        let body: any = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }

        const clientPublicIp = extractClientPublicIpFromHeaders({
          get: (header: string) => request.headers.get(header),
        });
        const configuredAuthorizedIp = (
          process.env["AUTHORIZED_M_PUBLIC_IP"] ||
          (env as any)?.AUTHORIZED_M_PUBLIC_IP ||
          ""
        ).trim();

        const verification = verifyCampusWifi({
          ...body,
          clientPublicIp: clientPublicIp || body.clientPublicIp || body.clientIp || body.ip,
          authorizedMPublicIp: configuredAuthorizedIp,
        });

        const responsePayload = {
          isSonaWifi: verification.authorized,
          authorized: verification.authorized,
          ssid: verification.ssid,
          bssid: verification.bssid,
          ip: verification.ip,
          publicIp: clientPublicIp,
          gateway: verification.gateway,
          dns: verification.dns,
          state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
          reason: verification.reason,
          stage: verification.stage,
          bssidStatusMessage: verification.bssidStatusMessage,
          networkSummary: verification.networkSummary,
          authMethod: verification.authMethod,
          timestamp: verification.timestamp,
          signal: body.signal || (body.rssi ? `${body.rssi} dBm` : verification.signal || ""),
          band: body.band || (body.frequency ? (body.frequency >= 4900 ? "5 GHz" : "2.4 GHz") : verification.band) || "",
          auth: body.auth || body.security || verification.auth || "",
          frequency: body.frequency,
          linkSpeed: body.linkSpeed,
          rssi: body.rssi,
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      if (url.pathname === "/api/wifi-status") {
        const clientPublicIp = extractClientPublicIpFromHeaders({
          get: (header: string) => request.headers.get(header),
        });
        const configuredAuthorizedIp = (
          process.env["AUTHORIZED_M_PUBLIC_IP"] ||
          (env as any)?.AUTHORIZED_M_PUBLIC_IP ||
          ""
        ).trim();

        // Query local OS Wi-Fi adapter if on Windows and client is localhost
        let osStatus = null;
        if (
          process.platform === "win32" &&
          (clientPublicIp === "127.0.0.1" || clientPublicIp === "::1" || !clientPublicIp)
        ) {
          osStatus = getWifiStatus();
        }

        const verification = verifyCampusWifi({
          ssid: osStatus?.ssid,
          bssid: osStatus?.bssid,
          state: osStatus?.state,
          ip: osStatus?.ip,
          gateway: osStatus?.gateway,
          dns: osStatus?.dns,
          dnsSuffix: osStatus?.dnsSuffix,
          auth: osStatus?.auth,
          band: osStatus?.band,
          signal: osStatus?.signal,
          clientPublicIp,
          authorizedMPublicIp: configuredAuthorizedIp,
        });

        const responsePayload = {
          isSonaWifi: verification.authorized,
          authorized: verification.authorized,
          ssid: verification.ssid,
          bssid: verification.bssid,
          ip: verification.ip || clientPublicIp,
          publicIp: clientPublicIp,
          gateway: verification.gateway,
          dns: verification.dns,
          state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
          reason: verification.reason,
          stage: verification.stage,
          bssidStatusMessage: verification.bssidStatusMessage,
          networkSummary: verification.networkSummary,
          authMethod: verification.authMethod,
          timestamp: verification.timestamp,
          signal: verification.signal || "",
          band: verification.band || "",
          auth: verification.auth || "",
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

