/**
 * Client-side device detection. Reads the high-entropy User-Agent Client Hints
 * when the browser exposes them and falls back to UA string parsing.
 */

export interface DeviceInfo {
  /** Human readable device name, e.g. "iPhone · iOS 18.2" */
  name: string;
  model: string;
  platform: string;
  browser: string;
  /** Stable-ish id derived from the device fingerprint */
  deviceId: string;
}

const UNKNOWN: DeviceInfo = {
  name: "Detecting device…",
  model: "Unknown device",
  platform: "Unknown OS",
  browser: "Unknown browser",
  deviceId: "DEV-PENDING",
};

export const unknownDevice = UNKNOWN;

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return `Edge ${ua.match(/Edg\/(\d+)/)?.[1] ?? ""}`.trim();
  if (/OPR\//.test(ua)) return `Opera ${ua.match(/OPR\/(\d+)/)?.[1] ?? ""}`.trim();
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox\//.test(ua)) return `Firefox ${ua.match(/Firefox\/(\d+)/)?.[1] ?? ""}`.trim();
  if (/Chrome\//.test(ua)) return `Chrome ${ua.match(/Chrome\/(\d+)/)?.[1] ?? ""}`.trim();
  if (/Safari\//.test(ua)) return `Safari ${ua.match(/Version\/(\d+)/)?.[1] ?? ""}`.trim();
  return "Browser";
}

function detectPlatform(ua: string): string {
  if (/Android/.test(ua)) return `Android ${ua.match(/Android (\d+(\.\d+)?)/)?.[1] ?? ""}`.trim();
  if (/iPhone|iPad|iPod/.test(ua))
    return `iOS ${(ua.match(/OS (\d+[_.]\d+)/)?.[1] ?? "").replace("_", ".")}`.trim();
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return `macOS ${(ua.match(/Mac OS X (\d+[_.]\d+)/)?.[1] ?? "").replace(/_/g, ".")}`.trim();
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}

function detectModel(ua: string): string {
  const android = ua.match(/Android [^;)]+;\s*([^;)]+?)(?: Build\/|\)|;)/);
  if (android?.[1]) {
    const model = android[1].trim();
    if (model && !/^wv$/i.test(model)) return model;
  }
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux PC";
  return "Unknown device";
}

function hashId(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `DEV-${h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6)}-AX`;
}

/** Detects the current device. Browser-only — call inside an effect. */
export async function detectDevice(): Promise<DeviceInfo> {
  if (typeof navigator === "undefined") return UNKNOWN;

  const ua = navigator.userAgent;
  let model = detectModel(ua);
  let platform = detectPlatform(ua);

  const uaData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues: (hints: string[]) => Promise<Record<string, string>>;
      };
    }
  ).userAgentData;

  if (uaData?.getHighEntropyValues) {
    try {
      const hints = await uaData.getHighEntropyValues(["model", "platform", "platformVersion"]);
      if (hints["model"]) model = hints["model"];
      if (hints["platform"]) {
        platform = [hints["platform"], hints["platformVersion"]].filter(Boolean).join(" ").trim();
      }
    } catch {
      /* fall back to UA parsing */
    }
  }

  const browser = detectBrowser(ua);
  const fingerprint = [
    model,
    platform,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(navigator.hardwareConcurrency ?? 0),
  ].join("|");

  return {
    model,
    platform,
    browser,
    name: `${model} (${platform})`,
    deviceId: hashId(fingerprint),
  };
}
