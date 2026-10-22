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
import {
  getDeviceLoginPayload,
  signLoginChallenge,
  registerCurrentDevice,
} from "./device-registration-client";

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
  deviceId?: string;
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

/**
 * Read the current staff session from localStorage, or null if unauthenticated.
 */
export function getActiveStaff(): StaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed.staffId || parsed.staff_code)) {
      return {
        id: parsed.id || parsed.staff_code || parsed.staffId,
        staff_code: parsed.staff_code || parsed.staffId,
        staffId: parsed.staffId || parsed.staff_code,
        name: parsed.name || "Staff Member",
        email: parsed.email || "",
        department: parsed.department || "General",
        designation: parsed.designation || "Staff",
        role: "staff",
        token: parsed.token,
        deviceId: parsed.deviceId,
      };
    }
    return null;
  } catch {
    return null;
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
export function useActiveStaff(): StaffSession | null {
  const [activeStaff, setActiveStaff] = useState<StaffSession | null>(getActiveStaff);

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
 * Register a new staff account via POST /api/staff/register with automatic device binding.
 */
export async function registerStaff(
  payload: StaffRegistrationPayload,
): Promise<{ success: boolean; message?: string; error?: string; staff?: any }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    let deviceData: any = {};
    try {
      deviceData = await getDeviceLoginPayload(payload.staff_code);
    } catch {}

    const res = await fetch("/api/staff/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        ...payload,
        ...(deviceData || {}),
      }),
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
 * Enforces One Faculty ID = One Phone policy using hardware or WebCrypto cryptographic proof.
 */
export async function loginStaff(
  staffId: string,
  password: string,
): Promise<{ success: boolean; staff?: StaffSession; error?: string; code?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const cleanId = staffId.trim().toUpperCase();

  try {
    // 1. Gather hardware or WebCrypto device binding payload
    let devicePayload: any = {};
    try {
      devicePayload = await getDeviceLoginPayload(cleanId);
    } catch (e) {
      console.warn("[staff-auth] Device payload acquisition note:", e);
    }

    let res = await fetch("/api/staff/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        staff_code: cleanId,
        password,
        ...(devicePayload || {}),
      }),
      signal: controller.signal,
    });

    let data = await res.json().catch(() => ({}));

    // If account has no registered device yet, perform initial secure device binding from this phone
    if (res.status === 403 && (data?.code === "DEVICE_REGISTRATION_REQUIRED" || data?.requiresDeviceRegistration)) {
      try {
        const regRes = await registerCurrentDevice(cleanId, undefined, password);
        if (regRes.success) {
          const freshDevicePayload = await getDeviceLoginPayload(cleanId);
          res = await fetch("/api/staff/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              staff_code: cleanId,
              password,
              ...(freshDevicePayload || {}),
            }),
            signal: controller.signal,
          });
          data = await res.json().catch(() => ({}));
        }
      } catch (regErr) {
        console.warn("[staff-auth] Initial device binding attempt notice:", regErr);
      }
    }

    // If server requests single-use challenge proof
    if (res.status === 403 && data?.requiresDeviceProof && data?.challenge && data?.challengeToken) {
      try {
        const challengeSig = await signLoginChallenge(cleanId, data.challenge);
        if (challengeSig) {
          res = await fetch("/api/staff/login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              staff_code: cleanId,
              password,
              challengeToken: data.challengeToken,
              challenge: data.challenge,
              deviceSignature: challengeSig,
            }),
            signal: controller.signal,
          });
          data = await res.json().catch(() => ({}));
        }
      } catch (chalErr) {
        console.warn("[staff-auth] Challenge response error:", chalErr);
      }
    }

    clearTimeout(timeoutId);

    if (!res.ok || data.success === false) {
      if (data?.error === "DEVICE_MISMATCH") {
        return {
          success: false,
          code: "DEVICE_MISMATCH",
          error:
            data.message ||
            `Login rejected: Faculty account '${cleanId}' is bound to another phone. Only your registered phone is authorized to log in.`,
        };
      }
      if (data?.error === "DEVICE_REGISTRATION_REQUIRED" || data?.code === "DEVICE_REGISTRATION_REQUIRED") {
        return {
          success: false,
          code: "DEVICE_REGISTRATION_REQUIRED",
          error:
            data.message ||
            `Login rejected: Faculty account '${cleanId}' has no registered device binding. Please complete initial device registration from your primary authorized phone.`,
        };
      }
      if (data?.error === "DEVICE_REVOKED") {
        return {
          success: false,
          code: "DEVICE_REVOKED",
          error:
            data.message ||
            `Login rejected: The registered device for account '${cleanId}' was revoked by administration. Please contact an administrator to approve a replacement device.`,
        };
      }
      return {
        success: false,
        error: data.message || data.error || `Authentication failed (HTTP ${res.status}).`,
      };
    }

    const session: StaffSession = {
      id: data.staff?.id || cleanId,
      staff_code: data.staff?.staff_code || cleanId,
      staffId: data.staff?.staff_code || cleanId,
      name: data.staff?.name || "Staff Member",
      email: data.staff?.email || `${cleanId.toLowerCase()}@sonatech.ac.in`,
      department: data.staff?.department || "General",
      designation: data.staff?.designation || "Staff",
      role: "staff",
      token: data.token,
      deviceId: data.device?.id,
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
 * Verifies the current staff session with the backend server and validates that
 * the One Faculty ID = One Phone policy is satisfied.
 * Clears local session if the registered device was revoked or mismatched.
 */
export async function verifyAndRestoreStaffSession(): Promise<{
  valid: boolean;
  staff?: StaffSession;
  error?: string;
}> {
  const current = getActiveStaff();
  if (!current) return { valid: false };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (current.token) {
      headers["Authorization"] = `Bearer ${current.token}`;
      headers["x-staff-token"] = current.token;
    }

    const res = await fetch("/api/staff/session", {
      method: "GET",
      headers,
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      // If session revoked or device mismatch, clear local session immediately
      if (res.status === 401 || res.status === 403) {
        logoutStaff();
        return {
          valid: false,
          error: data.message || data.error || "Session expired or device revoked.",
        };
      }
      return { valid: false, error: data.error };
    }

    const updatedSession: StaffSession = {
      ...current,
      id: data.staff?.id || current.id,
      name: data.staff?.name || current.name,
      email: data.staff?.email || current.email,
      department: data.staff?.department || current.department,
      designation: data.staff?.designation || current.designation,
      token: data.token || current.token,
      deviceId: data.device?.id || current.deviceId,
    };

    setActiveStaffSession(updatedSession);
    return { valid: true, staff: updatedSession };
  } catch (err: any) {
    return { valid: false, error: err?.message || "Failed to verify session." };
  }
}

/**
 * Clear staff session on logout.
 */
export function logoutStaff() {
  setActiveStaffSession(null);
}
