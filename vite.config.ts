// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { getWifiStatus } from "./src/lib/wifi-detection";
import { handleFaceVerifyApi } from "./src/server/api/face-search-handler";

function apiMiddlewarePlugin(): Plugin {
  return {
    name: "api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith("/api/wifi-status")) {
          const status = getWifiStatus();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(JSON.stringify(status));
          return;
        }

        if (req.url && req.url.startsWith("/api/face/verify")) {
          try {
            let bodyStr = "";
            req.on("data", (chunk) => (bodyStr += chunk));
            req.on("end", async () => {
              try {
                const fullUrl = `https://${req.headers.host || "localhost:8080"}${req.url}`;
                const reqInit: RequestInit = {
                  method: req.method || "POST",
                  headers: req.headers as any,
                };
                if (req.method !== "GET" && req.method !== "HEAD") {
                  reqInit.body = bodyStr;
                }
                const webReq = new Request(fullUrl, reqInit);
                const webRes = await handleFaceVerifyApi(webReq);
                res.statusCode = webRes.status;
                webRes.headers.forEach((val, key) => res.setHeader(key, val));
                const text = await webRes.text();
                res.end(text);
              } catch (innerErr: any) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: innerErr?.message || "Internal server error" }));
              }
            });
            return;
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Internal error" }));
            return;
          }
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

