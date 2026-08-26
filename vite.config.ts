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

function wifiStatusPlugin(): Plugin {
  return {
    name: "wifi-status-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith("/api/wifi-status")) {
          const status = getWifiStatus();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.end(JSON.stringify(status));
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
    plugins: [basicSsl(), wifiStatusPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});

