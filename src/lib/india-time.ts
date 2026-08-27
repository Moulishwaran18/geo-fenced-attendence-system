import { useEffect, useState } from "react";

const TZ = "Asia/Kolkata";

export function formatIndiaTime(date: Date, withSeconds = true) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).format(date);
}

export function formatIndiaDate(date: Date, withWeekday = true) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ,
    ...(withWeekday ? { weekday: "long" } : {}),
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Compact key like 20260820 in IST, for attendance IDs. */
export function indiaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts.replaceAll("-", "");
}

/** Live IST clock. Returns null on the server/first render to avoid hydration mismatch. */
export function useIndiaTime(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

export const ATTENDANCE_WINDOW_CONFIG = {
  startHour: 8,
  startMinute: 45,
  endHour: 9,
  endMinute: 10,
  label: "8:45 AM – 9:10 AM",
  timeZone: TZ,
};

/**
 * Checks if the given date is within the authoritative attendance window (8:45 AM – 9:10 AM IST).
 */
export function isWithinAttendanceWindow(date: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(date);

    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
    const currentMinutes = hour * 60 + minute;

    const startMinutes = ATTENDANCE_WINDOW_CONFIG.startHour * 60 + ATTENDANCE_WINDOW_CONFIG.startMinute; // 525 (8:45 AM)
    const endMinutes = ATTENDANCE_WINDOW_CONFIG.endHour * 60 + ATTENDANCE_WINDOW_CONFIG.endMinute; // 550 (9:10 AM)

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch {
    return false;
  }
}

export function getAttendanceWindowStatus(date: Date = new Date(), isDevMode = false) {
  const inWindow = isWithinAttendanceWindow(date);
  const timeStr = formatIndiaTime(date, false);

  if (isDevMode) {
    return {
      isOpen: true,
      inActualWindow: inWindow,
      statusLabel: inWindow
        ? "Open (8:45 AM – 9:10 AM)"
        : `Bypassed (Dev Mode) — Actual: Closed (${timeStr} is outside 8:45 AM – 9:10 AM)`,
      badgeTone: "warning" as const,
      isBypassed: !inWindow,
    };
  }

  return {
    isOpen: inWindow,
    inActualWindow: inWindow,
    statusLabel: inWindow ? "Open (8:45 AM – 9:10 AM)" : `Closed (${timeStr} is outside 8:45 AM – 9:10 AM)`,
    badgeTone: (inWindow ? "success" : "error") as "success" | "error",
    isBypassed: false,
  };
}

