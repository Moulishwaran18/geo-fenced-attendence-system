import os from "node:os";
import { execSync } from "node:child_process";
import {
  verifyCampusWifi,
  AUTHORIZED_SSIDS,
  type WifiStatus,
  type WifiVerificationResult,
} from "./wifi-config.ts";

export { AUTHORIZED_SSIDS, type WifiStatus };

/**
 * Performs local OS Wi-Fi network detection and validates against
 * authoritative campus profiles using multi-factor network evidence.
 */
export function getWifiStatus(): WifiStatus {
  if (typeof window !== "undefined") {
    return {
      isSonaWifi: false,
      authorized: false,
      ssid: "Unavailable",
      state: "unknown",
      reason: "SSID unavailable. Connect to an authorized campus network (M or SONA).",
      timestamp: new Date().toISOString(),
      networkSummary: "Unauthorized Wi-Fi network",
      stage: "UNABLE_TO_VERIFY",
    };
  }
  let ssid = "";
  let bssid = "";
  let signal = "";
  let band = "";
  let state: "connected" | "disconnected" | "unknown" = "unknown";
  let auth = "";
  let ip = "";
  let gateway = "";
  let dns = "";
  let dnsSuffix = "";

  // 1. Query OS Wi-Fi adapter information (Windows)
  if (process.platform === "win32") {
    try {
      const netshOutput = execSync("netsh wlan show interfaces", {
        encoding: "utf-8",
        timeout: 2500,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const ssidMatch = netshOutput.match(/^\s*SSID\s*:\s*(.+)$/m);
      const stateMatch = netshOutput.match(/^\s*State\s*:\s*(.+)$/m);
      const bssidMatch = netshOutput.match(/^\s*AP BSSID\s*:\s*(.+)$/m);
      const signalMatch = netshOutput.match(/^\s*Signal\s*:\s*(.+)$/m);
      const authMatch = netshOutput.match(/^\s*Authentication\s*:\s*(.+)$/m);
      const bandMatch = netshOutput.match(/^\s*Band\s*:\s*(.+)$/m);

      if (ssidMatch?.[1]) ssid = ssidMatch[1].trim();
      if (bandMatch?.[1]) band = bandMatch[1].trim();
      if (stateMatch?.[1]) {
        const rawState = stateMatch[1].trim().toLowerCase();
        state = rawState === "connected" ? "connected" : "disconnected";
      }
      if (bssidMatch?.[1]) bssid = bssidMatch[1].trim();
      if (signalMatch?.[1]) signal = signalMatch[1].trim();
      if (authMatch?.[1]) auth = authMatch[1].trim();
    } catch {
      state = "disconnected";
    }

    try {
      const ipconfigOutput = execSync("ipconfig /all", {
        encoding: "utf-8",
        timeout: 2500,
        stdio: ["ignore", "pipe", "ignore"],
      });

      // Target specifically the active Wi-Fi section
      const wifiIndex = ipconfigOutput.indexOf("Wireless LAN adapter Wi-Fi:");
      const section = wifiIndex !== -1 ? ipconfigOutput.slice(wifiIndex) : ipconfigOutput;

      const getSectionField = (fieldName: string) => {
        const match = section.match(new RegExp(fieldName + "[ .:]+:\\s*([^\\r\\n]*)", "i"));
        return match && match[1] ? match[1].trim() : "";
      };

      dnsSuffix = getSectionField("Connection-specific DNS Suffix");
      const rawIp = getSectionField("IPv4 Address");
      const ipOnlyMatch = rawIp.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
      if (ipOnlyMatch?.[1]) ip = ipOnlyMatch[1].trim();

      // Extract IPv4 gateway if present, or first gateway
      const gatewayMatches = section.match(/Default Gateway[ .:]+:\s*([^\r\n]+)(?:\r?\n\s+([0-9.]+))?/i);
      if (gatewayMatches) {
        gateway = gatewayMatches[2]?.trim() || gatewayMatches[1]?.trim() || "";
      }

      const dnsMatches = section.match(/DNS Servers[ .:]+:\s*([^\r\n]+)(?:\r?\n\s+([0-9.]+))?/i);
      if (dnsMatches) {
        dns = dnsMatches[1]?.trim() || "";
      }
    } catch {
      // ignore
    }
  }

  // Fallback to os.networkInterfaces() if IP was not extracted from ipconfig
  if (!ip) {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        const netList = interfaces[name] || [];
        for (const net of netList) {
          if (net.family === "IPv4" && !net.internal) {
            const isWifiInterface =
              name.toLowerCase().includes("wi-fi") ||
              name.toLowerCase().includes("wireless") ||
              name.toLowerCase().includes("wlan");
            if (!ip || isWifiInterface) {
              ip = net.address;
              if (state === "unknown") state = "connected";
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Multi-Factor Wi-Fi Authentication against Authoritative Profiles
  const verification = verifyCampusWifi({
    ssid,
    bssid,
    state,
    ip,
    gateway,
    dns,
    dnsSuffix,
    auth,
    band,
    signal,
  });

  return {
    isSonaWifi: verification.authorized,
    authorized: verification.authorized,
    ssid: verification.ssid || ssid || "Unavailable",
    bssid: verification.bssid || bssid || "Not available in browser",
    signal: verification.signal || signal,
    band: verification.band || band,
    auth: verification.auth || auth,
    ip: verification.ip || ip,
    gateway: verification.gateway || gateway,
    dns: verification.dns || dns,
    dnsSuffix,
    state: state === "connected" ? "connected" : state === "disconnected" ? "disconnected" : "unknown",
    reason: verification.reason,
    timestamp: verification.timestamp,
    bssidStatusMessage: verification.bssidStatusMessage,
    networkSummary: verification.networkSummary,
    stage: verification.stage,
  };
}
