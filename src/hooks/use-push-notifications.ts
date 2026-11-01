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
}

export function usePushNotifications(): PushNotificationState {
  const activeStaff = useActiveStaff();
  const [isNative, setIsNative] = useState<boolean>(false);
  const [permissionStatus, setPermissionStatus] = useState<"granted" | "denied" | "not_requested" | "unsupported">("unsupported");
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState<boolean>(false);
  const syncAttemptedRef = useRef<boolean>(false);

  // Check Android Notification Bridge availability
  useEffect(() => {
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

  // Request Notification Permission
  const requestPermission = useCallback(async (): Promise<string> => {
    if (typeof window === "undefined") return "unsupported";
    const bridge = (window as any).AndroidNotificationBridge;
    if (bridge && typeof bridge.requestPermission === "function") {
      const result = bridge.requestPermission();
      const updatedStatus = bridge.getPermissionStatus ? bridge.getPermissionStatus() : result;
      setPermissionStatus(updatedStatus === "granted" ? "granted" : updatedStatus === "denied" ? "denied" : "not_requested");
      return updatedStatus;
    }
    return "unsupported";
  }, []);

  // Sync token to server when active staff member is resolved
  useEffect(() => {
    const staffCode = activeStaff?.staffId;
    if (!staffCode || !deviceToken || syncAttemptedRef.current) return;

    syncAttemptedRef.current = true;

    async function syncToken() {
      try {
        const res = await fetch("/api/device", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "push-token",
            staffCode,
            deviceId: `DEV_${staffCode}`,
            token: deviceToken,
            platform: "android",
          }),
        });

        if (res.ok) {
          setIsRegistered(true);
        }
      } catch (err) {
        console.warn("[usePushNotifications] Token synchronization notice:", err);
      }
    }

    void syncToken();
  }, [activeStaff?.staffId, deviceToken]);

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
  };
}
