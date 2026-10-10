/**
 * Client-Side Staff Authentication & Session Management
 *
 * Provides:
 * - registerStaff(): POST /api/staff/register with validation and timeout
 * - loginStaff(): POST /api/staff/login with validation and session persistence
 * - getActiveStaff() / useActiveStaff(): reactive access to authenticated staff across app
 * - logoutStaff(): clears local session
 */

import { useCallback, useEffect, useState } from "react";
import { currentStaff } from "@/mocks/data";

export interface StaffSession {
  id: string;
  staff_code: string;
  staffId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  role: "staff";
  token?: string;
}

export interface StaffRegistrationPayload {
  staff_code: string;
  name: string;
  department: string;
  password: string;
  confirmPassword: string;
  registrationCode: string;
  designation?: string;
  email?: string;
}

const STORAGE_KEY = "campusattend.staff_session";
const SESSION_EVENT = "campusattend:staff-session-change";
const PROFILE_KEY = "campusattend.profile";
const PROFILE_EVENT = "campusattend:profile-change";

export const fallbackStaff: StaffSession = {
  id: "staff-default-priya",
  staff_code: currentStaff.staffId,
  staffId: currentStaff.staffId,
  name: currentStaff.name,
  email: currentStaff.email,
  department: currentStaff.department,
  designation: currentStaff.designation,
  role: "staff",
};

/**
 * Read the current staff session from localStorage, or return the default fallback.
 */
export function getActiveStaff(): StaffSession {
  if (typeof window === "undefined") return fallbackStaff;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallbackStaff;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed.staffId || parsed.staff_code)) {
      return {
        id: parsed.id || parsed.staff_code || parsed.staffId,
        staff_code: parsed.staff_code || parsed.staffId,
        staffId: parsed.staffId || parsed.staff_code,
        name: parsed.name || fallbackStaff.name,
        email: parsed.email || fallbackStaff.email,
        department: parsed.department || fallbackStaff.department,
        designation: parsed.designation || fallbackStaff.designation,
        role: "staff",
        token: parsed.token,
      };
    }
    return fallbackStaff;
  } catch {
    return fallbackStaff;
  }
}

/**
 * Save staff session to localStorage and notify all listeners across the app.
 */
export function setActiveStaffSession(session: StaffSession | null) {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    // Also sync the editable profile store so profile / header / settings reflect the name and email
    try {
      window.localStorage.setItem(
        PROFILE_KEY,
        JSON.stringify({ name: session.name, email: session.email }),
      );
      window.dispatchEvent(new Event(PROFILE_EVENT));
    } catch {}
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/**
 * React hook to reactively track the actively authenticated staff member.
 */
export function useActiveStaff(): StaffSession {
  const [activeStaff, setActiveStaff] = useState<StaffSession>(getActiveStaff);

  useEffect(() => {
    setActiveStaff(getActiveStaff());
    const sync = () => setActiveStaff(getActiveStaff());
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return activeStaff;
}

/**
 * Register a new staff account via POST /api/staff/register.
 */
export async function registerStaff(
  payload: StaffRegistrationPayload,
): Promise<{ success: boolean; message?: string; error?: string; staff?: any }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("/api/staff/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        error: data.error || `Registration failed (HTTP ${res.status}).`,
      };
    }

    return {
      success: true,
      message: data.message || "Staff account created successfully!",
      staff: data.staff,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return {
        success: false,
        error: "Registration request timed out. Please check your connection and try again.",
      };
    }
    return {
      success: false,
      error: err?.message || "Failed to connect to registration service.",
    };
  }
}

/**
 * Authenticate staff member via POST /api/staff/login.
 */
export async function loginStaff(
  staffId: string,
  password: string,
): Promise<{ success: boolean; staff?: StaffSession; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("/api/staff/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        staff_code: staffId.trim(),
        password,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        error: data.error || `Authentication failed (HTTP ${res.status}).`,
      };
    }

    const session: StaffSession = {
      id: data.staff?.id || staffId.trim().toUpperCase(),
      staff_code: data.staff?.staff_code || staffId.trim().toUpperCase(),
      staffId: data.staff?.staff_code || staffId.trim().toUpperCase(),
      name: data.staff?.name || "Staff Member",
      email: data.staff?.email || `${staffId.trim().toLowerCase()}@sonatech.ac.in`,
      department: data.staff?.department || "General",
      designation: data.staff?.designation || "Staff",
      role: "staff",
      token: data.token,
    };

    setActiveStaffSession(session);

    return {
      success: true,
      staff: session,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return {
        success: false,
        error: "Authentication request timed out. Please check your connection and try again.",
      };
    }
    return {
      success: false,
      error: err?.message || "Failed to reach authentication server. Please try again.",
    };
  }
}

/**
 * Clear staff session on logout.
 */
export function logoutStaff() {
  setActiveStaffSession(null);
}
