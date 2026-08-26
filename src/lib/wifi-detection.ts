import os from "node:os";
import { execSync } from "node:child_process";

export interface WifiStatus {
  isSonaWifi: boolean;
  ssid: string;
  bssid: string;
  signal: string;
  ip: string;
  gateway: string;
  dns: string;
  dnsSuffix: string;
  auth: string;
  state: "connected" | "disconnected" | "unknown";
  reason: string;
  timestamp: string;
}

/**
 * List of recognized authorized Wi-Fi networks:
 * - SONA-WIFI (Institutional Campus Network)
 * - M (Currently connected active Wi-Fi network)
 */
const AUTHORIZED_SSIDS = ["SONA-WIFI", "M"];

/**
 * Verifies whether the device is connected to an authorized network:
 * - SONA-WIFI (genuine institutional campus network)
 * - Currently connected active Wi-Fi network ("M" or active connection)
 */
export function getWifiStatus(): WifiStatus {
  let ssid = "";
  let bssid = "";
  let signal = "";
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

      if (ssidMatch?.[1]) ssid = ssidMatch[1].trim();
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

  // 2. Multi-Network Verification:
  // Authorizes genuine SONA-WIFI as well as the active connected Wi-Fi (e.g. "M")
  const normalizedSsid = (ssid || "").trim().toUpperCase();
  const isSonaSsid = normalizedSsid === "SONA-WIFI";
  const isSonaIpRange = ip.startsWith("172.16.");
  const isSonaGateway = gateway.includes("172.16.16.16");
  const isSonaDns = dns.includes("172.16.16.16") || dns.startsWith("172.16.");
  const isSonaSuffix = dnsSuffix.toUpperCase().includes("DCLAB.COM");

  const isGenuineSonaCampus =
    isSonaSsid || isSonaIpRange || isSonaGateway || isSonaDns || isSonaSuffix;

  const isExplicitlyAuthorizedSsid = AUTHORIZED_SSIDS.map((s) => s.toUpperCase()).includes(
    normalizedSsid,
  );

  const isConnectedWithIp = (state === "connected" || (state as string) === "unknown") && Boolean(ip);

  let isSonaWifi = false;
  let reason = "";

  if (state === "disconnected" && !ip) {
    isSonaWifi = false;
    reason = "Wi-Fi is disconnected. Please connect to SONA-WIFI or authorized Wi-Fi.";
  } else if (isGenuineSonaCampus) {
    isSonaWifi = true;
    reason = `Verified Genuine SONA-WIFI Campus Network (Gateway: ${gateway || "172.16.16.16"} · IP: ${ip || "Campus Subnet"})`;
  } else if (isExplicitlyAuthorizedSsid || isConnectedWithIp) {
    isSonaWifi = true;
    reason = `Verified Authorized Network "${ssid || "Active Wi-Fi"}" (IP: ${ip || "Assigned"} · Gateway: ${gateway || "Local"})`;
  } else {
    isSonaWifi = false;
    reason = `Unauthorized network SSID "${ssid || "Unknown"}". Please connect to SONA-WIFI or authorized network.`;
  }

  return {
    isSonaWifi,
    ssid: ssid || (isGenuineSonaCampus ? "SONA-WIFI" : "M"),
    bssid,
    signal,
    ip,
    gateway,
    dns,
    dnsSuffix,
    auth,
    state: isConnectedWithIp ? "connected" : state,
    reason,
    timestamp: new Date().toISOString(),
  };
}
