import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { verifyCampusWifi } from "./lib/wifi-config";
import handleWifiStatus from "../api/wifi-status";
import handleAttendance from "../api/attendance";
import handleNetworkInfo from "../api/network-info";
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

      if (url.pathname === "/api/network-info") {
        return await handleNetworkInfo(request);
      }

      if (url.pathname === "/api/wifi/verify" || url.pathname === "/api/wifi-status") {
        return await handleWifiStatus(request);
      }

      if (url.pathname === "/api/attendance" || url.pathname === "/api/mark-attendance") {
        return await handleAttendance(request);
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
