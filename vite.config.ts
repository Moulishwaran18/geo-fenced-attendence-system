// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { getWifiStatus } from "./src/lib/wifi-detection.ts";
import {
  verifyCampusWifi,
} from "./src/lib/wifi-config.ts";
import { handleFaceVerifyApi } from "./src/server/api/face-search-handler.ts";
import staffHandler from "./src/server/api/staff-handler.ts";
import { handleFaceDetectionLogApi } from "./src/server/api/audit-log-handler.ts";
import wifiStatusHandler from "./api/wifi-status.ts";
import attendanceHandler from "./api/attendance.ts";
import networkInfoHandler from "./api/network-info.ts";
import staffRegisterHandler from "./api/staff/register.ts";
import staffLoginHandler from "./api/staff/login.ts";

function apiMiddlewarePlugin(): Plugin {
  return {
    name: "api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith("/api/network-info")) {
          await networkInfoHandler(req, res);
          return;
        }

        if (
          req.url &&
          (req.url.startsWith("/api/wifi/verify") || req.url.startsWith("/api/wifi-status"))
        ) {
          await wifiStatusHandler(req, res);
          return;
        }

        if (
          req.url &&
          (req.url.startsWith("/api/attendance") || req.url.startsWith("/api/mark-attendance"))
        ) {
          await attendanceHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/api/face/verify")) {
          const handleRequest = async (bodyString: string) => {
            try {
              const fullUrl = `https://${req.headers.host || req.headers[":authority"] || "localhost:8080"}${req.url}`;
              const sanitizedHeaders: Record<string, string> = {
                "content-type": "application/json",
              };
              for (const [key, val] of Object.entries(req.headers)) {
                if (typeof key === "string" && !key.startsWith(":") && typeof val === "string") {
                  sanitizedHeaders[key.toLowerCase()] = val;
                } else if (typeof key === "string" && !key.startsWith(":") && Array.isArray(val)) {
                  sanitizedHeaders[key.toLowerCase()] = val.join(", ");
                }
              }
              const reqInit: RequestInit = {
                method: req.method || "POST",
                headers: sanitizedHeaders,
              };
              if (req.method !== "GET" && req.method !== "HEAD") {
                reqInit.body = bodyString;
              }
              const webReq = new Request(fullUrl, reqInit);
              const webRes = await handleFaceVerifyApi(webReq);
              res.statusCode = webRes.status;
              webRes.headers.forEach((val, key) => res.setHeader(key, val));
              const text = await webRes.text();
              res.end(text);
            } catch (innerErr: any) {
              console.error("[apiMiddlewarePlugin] Error in /api/face/verify:", innerErr);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: innerErr?.message || "Internal server error" }));
            }
          };

          if ((req as any).body) {
            const bodyStr = typeof (req as any).body === "string" ? (req as any).body : JSON.stringify((req as any).body);
            await handleRequest(bodyStr);
            return;
          }

          const chunks: Buffer[] = [];
          req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", async () => {
            const bodyStr = Buffer.concat(chunks).toString("utf-8");
            await handleRequest(bodyStr);
          });
          req.on("error", (err) => {
            console.error("[apiMiddlewarePlugin] Stream error:", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Stream error" }));
          });
          return;
        }

        if (req.url && (req.url.startsWith("/api/face-detection-log") || req.url.startsWith("/api/admin/face-detection-logs"))) {
          const handleLogRequest = async (bodyString: string) => {
            try {
              const fullUrl = `https://${req.headers.host || req.headers[":authority"] || "localhost:8080"}${req.url}`;
              const sanitizedHeaders: Record<string, string> = {
                "content-type": "application/json",
              };
              for (const [key, val] of Object.entries(req.headers)) {
                if (typeof key === "string" && !key.startsWith(":") && typeof val === "string") {
                  sanitizedHeaders[key.toLowerCase()] = val;
                } else if (typeof key === "string" && !key.startsWith(":") && Array.isArray(val)) {
                  sanitizedHeaders[key.toLowerCase()] = val.join(", ");
                }
              }
              const reqInit: RequestInit = {
                method: req.method || "GET",
                headers: sanitizedHeaders,
              };
              if (req.method !== "GET" && req.method !== "HEAD" && bodyString) {
                reqInit.body = bodyString;
              }
              const webReq = new Request(fullUrl, reqInit);
              const pathname = new URL(fullUrl).pathname;
              const webRes = await handleFaceDetectionLogApi(webReq, pathname);
              res.statusCode = webRes.status;
              webRes.headers.forEach((val, key) => res.setHeader(key, val));
              const text = await webRes.text();
              res.end(text);
            } catch (innerErr: any) {
              console.error("[apiMiddlewarePlugin] Error in /api/face-detection-log:", innerErr);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: innerErr?.message || "Internal server error" }));
            }
          };

          if ((req as any).body) {
            const bodyStr = typeof (req as any).body === "string" ? (req as any).body : JSON.stringify((req as any).body);
            await handleLogRequest(bodyStr);
            return;
          }

          const chunks: Buffer[] = [];
          req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on("end", async () => {
            const bodyStr = Buffer.concat(chunks).toString("utf-8");
            await handleLogRequest(bodyStr);
          });
          req.on("error", (err) => {
            console.error("[apiMiddlewarePlugin] Stream error:", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Stream error" }));
          });
          return;
        }

        if (req.url && req.url.startsWith("/api/staff/register")) {
          await staffRegisterHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/api/staff/login")) {
          await staffLoginHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/api/admin/")) {
          await staffHandler(req, res);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  vite: {
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
    },
    plugins: [basicSsl(), apiMiddlewarePlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

