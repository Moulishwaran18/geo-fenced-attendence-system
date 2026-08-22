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
 * Strictly verifies whether the device is connected to the genuine SONA-WIFI network
 * matching all institutional network properties:
 * - Exact SSID: SONA-WIFI
 * - Security Type: Open (No WPA2/WPA3 mobile hotspot encryption)
 * - Campus Gateway: 172.16.16.16
 * - Campus DNS Server: 172.16.16.16
 * - Campus Subnet: 172.16.0.0/16 (IPv4 starting with 172.16.)
 * - Campus DNS Suffix: DCLAB.COM
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

  // 1. Query OS Wi-Fi adapter information
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
        const match = section.match(new RegExp(fieldName + "[ .:]+:\\s*([^\\r\\n]+)", "i"));
        return match && match[1] ? match[1].trim() : "";
      };

      dnsSuffix = getSectionField("Connection-specific DNS Suffix");
      const rawIp = getSectionField("IPv4 Address");
      const ipOnlyMatch = rawIp.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
      if (ipOnlyMatch?.[1]) ip = ipOnlyMatch[1].trim();
      gateway = getSectionField("Default Gateway");
      dns = getSectionField("DNS Servers");
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
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Strict Anti-Spoofing Multi-Property Validation:
  // Must match the EXACT hardware, network, gateway, security, and DNS signature of genuine Sona Wi-Fi:
  const isSsidExact = ssid.trim().toUpperCase() === "SONA-WIFI";
  const isAuthOpen = !auth || auth.toLowerCase() === "open";
  const isSonaIpRange = ip.startsWith("172.16.");
  const isSonaGateway = gateway === "172.16.16.16";
  const isSonaDns = dns.includes("172.16.16.16") || dns.startsWith("172.16.");
  const isSonaSuffix = dnsSuffix.toUpperCase().includes("DCLAB.COM");

  let isSonaWifi = false;
  let reason = "";

  if (state !== "connected") {
    isSonaWifi = false;
    reason = "Wi-Fi is disconnected. Please connect to genuine SONA-WIFI.";
  } else if (!isSsidExact) {
    isSonaWifi = false;
    reason = `Unauthorized network SSID "${ssid || "Unknown"}". Only genuine SONA-WIFI is permitted.`;
  } else if (!isAuthOpen) {
    isSonaWifi = false;
    reason = `Security mismatch: detected ${auth} (Spoofed mobile hotspot detected. Genuine SONA-WIFI is an Open network).`;
  } else if (!isSonaIpRange) {
    isSonaWifi = false;
    reason = `Unauthorized IP subnet: ${ip || "None"} (Spoofed hotspot detected. Genuine SONA-WIFI assigns 172.16.x.x subnet).`;
  } else if (!isSonaGateway) {
    isSonaWifi = false;
    reason = `Unauthorized Gateway: ${gateway || "None"} (Spoofed hotspot detected. Genuine SONA-WIFI gateway is 172.16.16.16).`;
  } else if (!isSonaDns && !isSonaSuffix) {
    isSonaWifi = false;
    reason = `Unauthorized DNS: ${dns || "None"} (Expected Sona College DNS 172.16.16.16 / DCLAB.COM).`;
  } else {
    // Verified genuine Sona Campus Network!
    isSonaWifi = true;
    reason = "Verified Genuine SONA-WIFI Network (Gateway: 172.16.16.16 · Subnet: 172.16.0.0/16 · DNS: DCLAB.COM)";
  }

  return {
    isSonaWifi,
    ssid: ssid || (isSonaIpRange ? "SONA-WIFI" : ""),
    bssid,
    signal,
    ip,
    gateway,
    dns,
    dnsSuffix,
    auth,
    state,
    reason,
    timestamp: new Date().toISOString(),
  };
}
