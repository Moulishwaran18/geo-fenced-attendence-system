import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentStaff, type AttendanceStatus } from "@/mocks/data";
import { formatIndiaDate, formatIndiaTime, indiaDateKey } from "@/lib/india-time";

export interface AttendanceRecord {
  id: string;
  rawId?: string;
  staff_code: string;
  staff_name: string;
  department: string;
  email?: string;
  date: string; // Formatted date e.g. "04 Oct 2026"
  rawDate: string; // ISO date e.g. "2026-10-04"
  day: string; // e.g. "Sunday"
  time: string; // e.g. "06:28 PM"
  status: AttendanceStatus;
  location: string;
  verification: "Verified" | "Failed" | "Manual";
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  device_id?: string | null;
  created_at?: string;
}

export interface MonthlyStats {
  workingDays: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  attendanceRate: number;
}

/** Formats "2026-10-04" into "04 Oct 2026" or preserves existing string */
export function formatDisplayDate(dateStr?: string, timestamp?: string): string {
  if (!dateStr && !timestamp) return "—";
  const raw = dateStr || timestamp;
  if (!raw) return "—";
  if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(raw)) return raw;

  try {
    const d = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
    if (isNaN(d.getTime())) return raw;
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return raw;
  }
}

/** Get YYYY-MM key from date string or timestamp */
export function getMonthKey(dateStr?: string, timestamp?: string): string {
  const raw = dateStr || timestamp;
  if (!raw) return "";
  if (/^\d{4}-\d{2}/.test(raw)) {
    return raw.slice(0, 7);
  }
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      return `${year}-${month}`;
    }
  } catch {
    // fallback
  }
  return "";
}

/** Get weekday name */
export function getWeekdayName(dateStr?: string, timestamp?: string): string {
  const raw = dateStr || timestamp;
  if (!raw) return "Weekday";
  try {
    const d = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
    if (isNaN(d.getTime())) return "Weekday";
    return d.toLocaleDateString("en-US", { weekday: "long" });
  } catch {
    return "Weekday";
  }
}

/** Standard working days in a given month (typically 22 working days) */
export function getWorkingDaysInMonth(year: number, monthZeroIndexed: number): number {
  let count = 0;
  const daysInMonth = new Date(year, monthZeroIndexed + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, monthZeroIndexed, day);
    const dayOfWeek = d.getDay(); // 0 is Sunday
    if (dayOfWeek !== 0) {
      count++;
    }
  }
  // Standard educational/institutional academic schedule defaults to 22 working days
  return Math.min(22, count);
}

export function useAttendance(targetStaffCode: string = currentStaff.staffId) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Query authoritative PostgreSQL attendance records from Supabase
      const { data, error: sbError } = await supabase
        .from("attendance_records")
        .select("*")
        .order("created_at", { ascending: false });

      if (sbError) {
        throw new Error(sbError.message);
      }

      if (data) {
        // Filter by user staff_code if available, preserving user-specific history
        const userRows = targetStaffCode
          ? data.filter(
              (r) =>
                !r.staff_code ||
                r.staff_code.toLowerCase() === targetStaffCode.toLowerCase(),
            )
          : data;

        const mapped: AttendanceRecord[] = userRows.map((r) => {
          const rawDate = r.date || (r.created_at ? r.created_at.split("T")[0] : "");
          const displayDate = formatDisplayDate(r.date, r.created_at);
          const dayName = r.day || getWeekdayName(r.date, r.created_at);
          const timeStr = r.time || (r.created_at ? formatIndiaTime(new Date(r.created_at)) : "09:00 AM");

          const idStr = r.id
            ? r.id.startsWith("ATT-")
              ? r.id
              : `ATT-${r.id.slice(0, 8).toUpperCase()}`
            : `ATT-${rawDate.replaceAll("-", "")}-LIVE`;

          return {
            id: idStr,
            rawId: r.id,
            staff_code: r.staff_code || targetStaffCode,
            staff_name: r.staff_name || currentStaff.name,
            department: r.department || currentStaff.department,
            email: currentStaff.email,
            date: displayDate,
            rawDate,
            day: dayName,
            time: timeStr,
            status: (r.status as AttendanceStatus) || "Present",
            location: r.location || "Main Campus, Sona College",
            verification: (r.verification as "Verified" | "Failed" | "Manual") || "Verified",
            latitude: r.latitude ?? null,
            longitude: r.longitude ?? null,
            device_id: r.device_id ?? null,
            created_at: r.created_at,
          };
        });

        setRecords(mapped);
      } else {
        setRecords([]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load attendance records.";
      console.warn("[useAttendance] Error fetching records from Supabase:", err);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [targetStaffCode]);

  useEffect(() => {
    void fetchRecords();

    // 1. Supabase Realtime channel subscription
    const channel = supabase
      .channel("attendance_records_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance_records" },
        () => {
          void fetchRecords();
        },
      )
      .subscribe();

    // 2. Custom local event when attendance is marked in this session
    const handleAttendanceMarked = () => {
      void fetchRecords();
    };

    // 3. Auto refetch on window focus
    const handleFocus = () => {
      void fetchRecords();
    };

    window.addEventListener("campusattend:attendance-marked", handleAttendanceMarked);
    window.addEventListener("focus", handleFocus);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("campusattend:attendance-marked", handleAttendanceMarked);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchRecords]);

  // Determine Today's Attendance Record in IST
  const todayRecord = useMemo(() => {
    if (records.length === 0) return null;
    const now = new Date();
    // Get YYYY-MM-DD in Asia/Kolkata
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    return (
      records.find(
        (r) =>
          r.rawDate === parts ||
          (r.created_at && r.created_at.startsWith(parts)),
      ) ?? null
    );
  }, [records]);

  // Today's Status: Present | Late | Absent | Not Marked
  const todayStatus: "Present" | "Late" | "Absent" | "Not Marked" = useMemo(() => {
    if (todayRecord) {
      return todayRecord.status;
    }
    return "Not Marked";
  }, [todayRecord]);

  // Today's Marking Time
  const todayMarkingTime = useMemo(() => {
    if (todayRecord) {
      return todayRecord.time;
    }
    return "—";
  }, [todayRecord]);

  // Monthly stats calculated dynamically from records for the current active month
  const monthlyStats: MonthlyStats = useMemo(() => {
    const now = new Date();
    const currentMonthPrefix = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
    }).format(now); // e.g. "2026-10"

    const monthRecords = records.filter(
      (r) =>
        r.rawDate.startsWith(currentMonthPrefix) ||
        (r.created_at && r.created_at.startsWith(currentMonthPrefix)),
    );

    const year = now.getFullYear();
    const month = now.getMonth();
    const workingDays = getWorkingDaysInMonth(year, month);

    const presentCount = monthRecords.filter((r) => r.status === "Present").length;
    const lateCount = monthRecords.filter((r) => r.status === "Late").length;
    const absentCount = monthRecords.filter((r) => r.status === "Absent").length;

    const totalMarked = presentCount + lateCount;
    // Calculate attendance rate (percentage)
    const attendanceRate =
      workingDays > 0 ? Math.min(100, Math.round((totalMarked / workingDays) * 100)) : 100;

    return {
      workingDays,
      presentCount,
      lateCount,
      absentCount,
      attendanceRate,
    };
  }, [records]);

  // Available months dynamically extracted from data
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    // Always include current month
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    monthSet.add(currentKey);

    records.forEach((r) => {
      const key = getMonthKey(r.rawDate, r.created_at);
      if (key) monthSet.add(key);
    });

    return Array.from(monthSet)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => {
        const [y, m] = key.split("-").map(Number);
        const d = new Date(y!, m! - 1, 1);
        const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        return { value: key, label };
      });
  }, [records]);

  return {
    records,
    recentRecords: records.slice(0, 5),
    todayRecord,
    todayStatus,
    todayMarkingTime,
    monthlyStats,
    availableMonths,
    isLoading,
    error,
    refresh: fetchRecords,
  };
}
