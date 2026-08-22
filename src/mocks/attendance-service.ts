import { formatIndiaDate, formatIndiaTime, indiaDateKey } from "@/lib/india-time";
/**
 * Mock attendance/verification service.
 * Swap these implementations for real GPS / Wi-Fi / BLE / face APIs later.
 */

export type VerificationScenario =
  | "ready"
  | "outside-campus"
  | "low-accuracy"
  | "gps-unavailable"
  | "wifi-unavailable"
  | "bluetooth-unavailable"
  | "face-failed"
  | "already-marked"
  | "window-closed";

export interface VerificationSignal {
  key: "location" | "wifi" | "bluetooth" | "identity";
  value: string;
  detail: string;
  state: "verified" | "warning" | "error" | "pending";
}

export interface VerificationSnapshot {
  scenario: VerificationScenario;
  canMark: boolean;
  headline: string;
  message: string;
  tone: "success" | "warning" | "error";
  accuracy: string;
  signals: VerificationSignal[];
}

const ok = (
  key: VerificationSignal["key"],
  value: string,
  detail: string,
): VerificationSignal => ({ key, value, detail, state: "verified" });

export function getSnapshot(scenario: VerificationScenario): VerificationSnapshot {
  const loc = ok("location", "Inside Campus", "Accuracy: 11 m");
  const wifi = ok("wifi", "College Network", "SONA-WIFI · Connected");
  const ble = ok("bluetooth", "Campus Beacon", "BLE-GATE-02 · Detected");
  const identity: VerificationSignal = {
    key: "identity",
    value: "Identity Verification",
    detail: "Ready",
    state: "pending",
  };
  const base: VerificationSignal[] = [loc, wifi, ble, identity];

  switch (scenario) {
    case "outside-campus":
      return {
        scenario,
        canMark: false,
        headline: "Attendance unavailable",
        message: "You appear to be outside the authorized campus boundary.",
        tone: "error",
        accuracy: "14 m",
        signals: [
          {
            key: "location",
            value: "Outside Campus",
            detail: "1.4 km from boundary",
            state: "error",
          },
          { key: "wifi", value: "Mobile Data", detail: "Not on college network", state: "error" },
          { key: "bluetooth", value: "No Beacon", detail: "Campus beacon not found", state: "error" },
          { key: "identity", value: "Identity Verification", detail: "Blocked", state: "error" },
        ],
      };
    case "low-accuracy":
      return {
        scenario,
        canMark: false,
        headline: "Location accuracy is too low",
        message: "Move to an open area and try again.",
        tone: "warning",
        accuracy: "148 m",
        signals: [
          {
            key: "location",
            value: "Approximate location",
            detail: "Accuracy: 148 m",
            state: "warning",
          },
          ok("wifi", "College Network", "SONA-WIFI · Connected"),
          ok("bluetooth", "Campus Beacon", "BLE-GATE-02 · Detected"),
          { key: "identity", value: "Identity Verification", detail: "Waiting", state: "pending" },
        ],
      };
    case "gps-unavailable":
      return {
        scenario,
        canMark: false,
        headline: "Location services unavailable",
        message: "Enable location access for CampusAttend in your device settings.",
        tone: "error",
        accuracy: "—",
        signals: [
          { key: "location", value: "GPS Unavailable", detail: "Permission denied", state: "error" },
          ok("wifi", "College Network", "SONA-WIFI · Connected"),
          ok("bluetooth", "Campus Beacon", "BLE-GATE-02 · Detected"),
          { key: "identity", value: "Identity Verification", detail: "Blocked", state: "error" },
        ],
      };
    case "wifi-unavailable":
      return {
        scenario,
        canMark: false,
        headline: "College network not detected",
        message: "Connect to SONA-WIFI to continue verification.",
        tone: "warning",
        accuracy: "11 m",
        signals: [
          loc,
          { key: "wifi", value: "Not Connected", detail: "College network missing", state: "warning" },
          ble,
          { key: "identity", value: "Identity Verification", detail: "Waiting", state: "pending" },
        ],
      };
    case "bluetooth-unavailable":
      return {
        scenario,
        canMark: false,
        headline: "Campus beacon not detected",
        message: "Turn on Bluetooth so the nearest campus beacon can be found.",
        tone: "warning",
        accuracy: "11 m",
        signals: [
          loc,
          wifi,
          { key: "bluetooth", value: "Bluetooth Off", detail: "No beacon signal", state: "warning" },
          { key: "identity", value: "Identity Verification", detail: "Waiting", state: "pending" },
        ],
      };
    case "face-failed":
      return {
        scenario,
        canMark: false,
        headline: "Face verification failed",
        message: "We couldn't match your face. Retry in good lighting or contact the admin office.",
        tone: "error",
        accuracy: "11 m",
        signals: [
          loc,
          wifi,
          ble,
          { key: "identity", value: "Identity Verification", detail: "Failed · 2 attempts", state: "error" },
        ],
      };
    case "already-marked":
      return {
        scenario,
        canMark: false,
        headline: "Attendance already marked",
        message: "You marked attendance today at 09:03 AM. Only one entry per day is allowed.",
        tone: "success",
        accuracy: "11 m",
        signals: base,
      };
    case "window-closed":
      return {
        scenario,
        canMark: false,
        headline: "Attendance window closed",
        message: "Today's window (8:45 AM – 9:10 AM) has ended. Request a manual entry from admin.",
        tone: "warning",
        accuracy: "11 m",
        signals: base,
      };
    default:
      return {
        scenario: "ready",
        canMark: true,
        headline: "Attendance Ready",
        message: "All checks passed. You can mark your attendance now.",
        tone: "success",
        accuracy: "11 m",
        signals: base,
      };
  }
}

export interface AttendanceReceipt {
  attendanceId: string;
  time: string;
  date: string;
}

export function markAttendance(): Promise<AttendanceReceipt> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const now = new Date();
      resolve({
        attendanceId: `ATT-${indiaDateKey(now)}-${String(Math.floor(Math.random() * 900) + 100)}`,
        time: formatIndiaTime(now),
        date: formatIndiaDate(now, false),
      });
    }, 2200),
  );
}

export const scenarioLabels: Record<VerificationScenario, string> = {
  ready: "All systems ready",
  "outside-campus": "Outside campus",
  "low-accuracy": "Low GPS accuracy",
  "gps-unavailable": "GPS unavailable",
  "wifi-unavailable": "Wi-Fi unavailable",
  "bluetooth-unavailable": "Bluetooth unavailable",
  "face-failed": "Face verification failed",
  "already-marked": "Already marked today",
  "window-closed": "Attendance window closed",
};
