import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { getWifiStatus } from "./lib/wifi-detection";
import { verifyCampusWifi } from "./lib/wifi-config";
import { handleStaffApi } from "./server/api/staff-handler";
import { handleFaceVerifyApi } from "./server/api/face-search-handler";
import { handleFaceDetectionLogApi } from "./server/api/audit-log-handler";

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

const defaultHandler = createStartHandler(defaultStreamHandler);

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const capturedError = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(capturedError);
  return new Response(renderErrorPage(capturedError), {
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

        const verification = verifyCampusWifi({
          ssid: body.ssid,
          state: body.state,
          signal: body.signal,
          band: body.band,
          auth: body.auth,
        });

        const responsePayload = {
          isSonaWifi: verification.authorized,
          authorized: verification.authorized,
          ssid: verification.ssid,
          networkSummary: verification.networkSummary,
          reason: verification.reason,
          state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
          stage: verification.stage,
          timestamp: verification.timestamp,
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
        let osStatus = null;
        if (process.platform === "win32") {
          osStatus = getWifiStatus();
        }

        const verification = verifyCampusWifi({
          ssid: osStatus?.ssid,
          state: osStatus?.state,
        });

        const responsePayload = {
          isSonaWifi: verification.authorized,
          authorized: verification.authorized,
          ssid: verification.ssid,
          networkSummary: verification.networkSummary,
          reason: verification.reason,
          state: verification.stage === "DISCONNECTED" ? "disconnected" : "connected",
          stage: verification.stage,
          timestamp: verification.timestamp,
        };

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      const response = await defaultHandler(request);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error("Server catch error:", error);
      return new Response(renderErrorPage(error), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
