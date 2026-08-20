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
