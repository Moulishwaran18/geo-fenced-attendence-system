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
  const base: VerificationSignal[] = [
    ok("location", "Inside Campus", "Accuracy: 11 m"),
    ok("wifi", "College Network", "SONA-STAFF-5G · Connected"),
    ok("bluetooth", "Campus Beacon", "BLE-GATE-02 · Detected"),
    { key: "identity", value: "Identity Verification", detail: "Ready", state: "pending" },
  ];

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
          ok("wifi", "College Network", "SONA-STAFF-5G · Connected"),
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
          ok("wifi", "College Network", "SONA-STAFF-5G · Connected"),
          ok("bluetooth", "Campus Beacon", "BLE-GATE-02 · Detected"),
          { key: "identity", value: "Identity Verification", detail: "Blocked", state: "error" },
        ],
      };
    case "wifi-unavailable":
      return {
        scenario,
        canMark: false,
        headline: "College network not detected",
        message: "Connect to SONA-STAFF-5G to continue verification.",
        tone: "warning",
        accuracy: "11 m",
        signals: [
          base[0],
          { key: "wifi", value: "Not Connected", detail: "College network missing", state: "warning" },
          base[2],
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
          base[0],
          base[1],
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
          base[0],
          base[1],
          base[2],
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
    setTimeout(
      () =>
        resolve({
          attendanceId: "ATT-20260819-001",
          time: "09:03 AM",
          date: "19 August 2026",
        }),
      2200,
    ),
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
