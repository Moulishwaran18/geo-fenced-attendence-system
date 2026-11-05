/**
 * CampusAttend — Push Notification Hook & Device Token Sync
 *
 * Provides:
 * 1. Automatic registration and synchronization of Android device push tokens with backend.
 * 2. Notification permission monitoring and status warning for Android 13+.
 * 3. Supabase Realtime listener to present native Android status-bar notifications.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useActiveStaff } from "@/lib/staff-auth";
import { supabase } from "@/lib/supabase";

export interface PushNotificationState {
  isNative: boolean;
  permissionStatus: "granted" | "denied" | "not_requested" | "unsupported";
  deviceToken: string | null;
  isRegistered: boolean;
  requestPermission: () => Promise<string>;
  openSettings: () => void;
  scheduleTestAlert: (delaySeconds?: number) => boolean;
}

export function usePushNotifications(): PushNotificationState {
  const activeStaff = useActiveStaff();
  const [isNative, setIsNative] = useState<boolean>(false);
  const [permissionStatus, setPermissionStatus] = useState<"granted" | "denied" | "not_requested" | "unsupported">("unsupported");
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const syncAttemptedRef = useRef<boolean>(false);

  // Check Android Notification Bridge availability & permission status
  const checkStatus = useCallback(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as any).AndroidNotificationBridge;
    if (bridge) {
      setIsNative(true);
      const perm = typeof bridge.getPermissionStatus === "function" ? bridge.getPermissionStatus() : "granted";
      setPermissionStatus(perm === "granted" ? "granted" : perm === "denied" ? "denied" : "not_requested");

      const token = typeof bridge.getDeviceToken === "function" ? bridge.getDeviceToken() : null;
      if (token) setDeviceToken(token);
    } else {
      setIsNative(false);
      setPermissionStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Recheck permission when user returns to app from system notification settings
    const handleRecheck = () => {
      checkStatus();
    };

    (window as any).__onNotificationPermissionChanged = handleRecheck;
    window.addEventListener("focus", handleRecheck);
    document.addEventListener("visibilitychange", handleRecheck);

    return () => {
      delete (window as any).__onNotificationPermissionChanged;
      window.removeEventListener("focus", handleRecheck);
      document.removeEventListener("visibilitychange", handleRecheck);
    };
  }, [checkStatus]);

  // Request Notification Permission
  const requestPermission = useCallback(async (): Promise<string> => {
    if (typeof window === "undefined") return "unsupported";
    const bridge = (window as any).AndroidNotificationBridge;
    if (bridge && typeof bridge.requestPermission === "function") {
      const result = bridge.requestPermission();
      checkStatus();
      return result;
    }
    return "unsupported";
  }, [checkStatus]);

  // Open Android Notification Settings directly
  const openSettings = useCallback(() => {
    if (typeof window === "undefined") return;
    const bridge = (window as any).AndroidNotificationBridge;
    if (bridge && typeof bridge.openNotificationSettings === "function") {
      bridge.openNotificationSettings();
    }
  }, []);

  // Schedule native test alert for background/closed verification
  const scheduleTestAlert = useCallback((delaySeconds = 5): boolean => {
    if (typeof window === "undefined") return false;
    const bridge = (window as any).AndroidNotificationBridge;
    if (bridge && typeof bridge.scheduleTestReminder === "function") {
      return bridge.scheduleTestReminder(delaySeconds);
    }
    return false;
  }, []);

  // Sync token to server when active staff member is resolved
  useEffect(() => {
    const staffCode = activeStaff?.staffId;
    if (!staffCode || !deviceToken || syncAttemptedRef.current) return;

    syncAttemptedRef.current = true;

    async function syncToken() {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        if (activeStaff?.token) {
          headers["Authorization"] = `Bearer ${activeStaff.token}`;
          headers["x-staff-token"] = activeStaff.token;
        }

        const res = await fetch("/api/device", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({
            action: "push-token",
            staffCode,
            deviceId: activeStaff?.deviceId || `DEV_${staffCode}`,
            token: deviceToken,
            platform: "android",
          }),
        });

        if (res.ok) {
          const json = await res.json();
          setIsRegistered(true);

          // Synchronize institution reminder times to Android native AlarmManager for background alarms
          const sched = json.reminderSchedule;
          const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
          if (sched && sched.enabled && bridge && typeof bridge.syncReminderSchedule === "function") {
            const daysStr = Array.isArray(sched.applicable_days) ? sched.applicable_days.join(",") : "";
            bridge.syncReminderSchedule(
              sched.reminder_time_1 || "09:00",
              sched.reminder_time_2 || "10:00",
              !!sched.reminder_time_2_enabled,
              daysStr,
              sched.timezone || "Asia/Kolkata"
            );
          }
        }
      } catch (err) {
        console.warn("[usePushNotifications] Token synchronization notice:", err);
      }
    }

    void syncToken();
  }, [activeStaff?.staffId, activeStaff?.deviceId, activeStaff?.token, deviceToken]);

  // Realtime listener for incoming attendance reminder broadcasts
  useEffect(() => {
    const staffCode = activeStaff?.staffId?.toUpperCase();
    if (!staffCode) return;

    const channel = supabase
      .channel(`attendance_reminders_${staffCode}`)
      .on("broadcast", { event: "attendance_reminder" }, (payload: any) => {
        const notif = payload.payload;
        if (notif) {
          const bridge = typeof window !== "undefined" ? (window as any).AndroidNotificationBridge : null;
          if (bridge && typeof bridge.showNotification === "function") {
            bridge.showNotification(
              notif.title || "CampusAttend – Attendance Reminder",
              notif.message || "You have not marked your attendance today. Please open CampusAttend and complete your attendance verification.",
              notif.destination || "/mark-attendance"
            );
          }
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeStaff?.staffId]);

  return {
    isNative,
    permissionStatus,
    deviceToken,
    isRegistered,
    requestPermission,
    openSettings,
    scheduleTestAlert,
  };
}
