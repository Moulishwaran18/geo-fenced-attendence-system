import { execSync } from "node:child_process";
import {
  verifyCampusWifi,
  AUTHORIZED_SSIDS,
  type WifiStatus,
} from "./wifi-config.ts";

export { AUTHORIZED_SSIDS, type WifiStatus };

/**
 * Local development utility: queries host OS Wi-Fi adapter SSID (Windows only).
 * Authenticates using ONLY pure SSID name. All IP/gateway/DNS checks removed.
 */
export function getWifiStatus(): WifiStatus {
  if (typeof window !== "undefined") {
    return {
      isSonaWifi: false,
      authorized: false,
      ssid: "Unavailable",
      state: "unknown",
      reason: "SSID unavailable in browser. Connect via the Android attendance app.",
      timestamp: new Date().toISOString(),
      networkSummary: "Unable to determine Wi-Fi name",
      stage: "UNABLE_TO_VERIFY",
    };
  }

  let ssid = "";
  let state: "connected" | "disconnected" | "unknown" = "unknown";
  let signal = "";
  let band = "";
  let auth = "";

  if (process.platform === "win32") {
    try {
      const netshOutput = execSync("netsh wlan show interfaces", {
        encoding: "utf-8",
        timeout: 2500,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const ssidMatch = netshOutput.match(/^\s*SSID\s*:\s*(.+)$/m);
      const stateMatch = netshOutput.match(/^\s*State\s*:\s*(.+)$/m);
      const signalMatch = netshOutput.match(/^\s*Signal\s*:\s*(.+)$/m);
      const authMatch = netshOutput.match(/^\s*Authentication\s*:\s*(.+)$/m);
      const bandMatch = netshOutput.match(/^\s*Band\s*:\s*(.+)$/m);

      if (ssidMatch?.[1]) ssid = ssidMatch[1].trim();
      if (bandMatch?.[1]) band = bandMatch[1].trim();
      if (signalMatch?.[1]) signal = signalMatch[1].trim();
      if (authMatch?.[1]) auth = authMatch[1].trim();
      if (stateMatch?.[1]) {
        const rawState = stateMatch[1].trim().toLowerCase();
        state = rawState === "connected" ? "connected" : "disconnected";
      }
    } catch {
      state = "disconnected";
    }
  }

  const verification = verifyCampusWifi({
    ssid,
    state,
    auth,
    band,
    signal,
  });

  return {
    isSonaWifi: verification.authorized,
    authorized: verification.authorized,
    ssid: verification.ssid || ssid || "Unavailable",
    signal: signal || undefined,
    band: band || undefined,
    auth: auth || undefined,
    state: state === "connected" ? "connected" : state === "disconnected" ? "disconnected" : "unknown",
    reason: verification.reason,
    timestamp: verification.timestamp,
    networkSummary: verification.networkSummary,
    stage: verification.stage,
  };
}
