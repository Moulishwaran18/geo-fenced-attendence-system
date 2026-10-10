/**
 * Client-Side Administrator Authentication Service & State Hook
 *
 * Provides:
 * - Server-side credential verification via /api/admin/login
 * - Secure session token persistence (localStorage + cookie)
 * - Automatic Authorization header injection for admin REST endpoints
 * - Session validation against /api/admin/session
 * - Logout cleanup
 */

import { useState, useEffect, useCallback } from "react";

const ADMIN_TOKEN_KEY = "campusattend_admin_token";
const ADMIN_USER_KEY = "campusattend_admin_user";

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin";
}

/**
 * Get stored administrator JWT/HMAC token.
 */
export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Store administrator token and user metadata.
 */
export function setAdminToken(token: string, admin?: AuthenticatedAdmin) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    if (admin) {
      localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(admin));
    }
    // Set cookie for SSR and cross-request fetch compatibility with HTTPS support
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const secureFlag = isHttps ? "; Secure" : "";
    document.cookie = `admin_session=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secureFlag}; Max-Age=86400`;
  } catch (err) {
    console.warn("Failed to persist admin session in storage:", err);
  }
}

/**
 * Invalidate administrator session locally.
 */
export function clearAdminToken() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const secureFlag = isHttps ? "; Secure" : "";
    document.cookie = `admin_session=; Path=/; SameSite=Lax${secureFlag}; Max-Age=0`;
  } catch (err) {
    console.warn("Failed to clear admin session from storage:", err);
  }
}

/**
 * Get cached administrator user info.
 */
export function getCachedAdmin(): AuthenticatedAdmin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ADMIN_USER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/**
 * Get HTTP headers for authenticated administrator API requests.
 */
export function getAdminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
  return {};
}

/**
 * Authenticate administrator credentials against server with request timeout.
 */
export async function loginAdmin(
  idOrUsername: string,
  password: string,
): Promise<{
  success: boolean;
  admin?: AuthenticatedAdmin;
  token?: string;
  error?: string;
}> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        username: idOrUsername.trim(),
        password,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 401) {
        return {
          success: false,
          error: data.error || "Invalid administrator credentials. Please check your Administrator ID and password.",
        };
      }
      if (res.status === 404) {
        return {
          success: false,
          error: "Administrator authentication endpoint not found (HTTP 404). Please verify production deployment.",
        };
      }
      return {
        success: false,
        error: data.error || `Authentication server error (HTTP ${res.status}). Please try again later.`,
      };
    }

    if (!data.success || !data.token) {
      return {
        success: false,
        error: data.error || "Authentication failed on server.",
      };
    }

    setAdminToken(data.token, data.admin);

    return {
      success: true,
      token: data.token,
      admin: data.admin,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return {
        success: false,
        error: "Authentication request timed out after 10 seconds. Please check your network connection and try again.",
      };
    }
    return {
      success: false,
      error: err?.message || "Failed to reach administrator authentication server. Please check network connectivity.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Terminate administrator session on server and client.
 */
export async function logoutAdmin(): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const token = getAdminToken();
    await fetch("/api/admin/logout", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
      signal: controller.signal,
    }).catch(() => {});
  } finally {
    clearTimeout(timeoutId);
    clearAdminToken();
  }
}

/**
 * Verify administrator session with server.
 */
export async function verifyAdminSession(): Promise<{
  authenticated: boolean;
  admin?: AuthenticatedAdmin;
  error?: string;
}> {
  const token = getAdminToken();
  if (!token) {
    return { authenticated: false, error: "No token" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch("/api/admin/session", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.authenticated && data.admin) {
      return { authenticated: true, admin: data.admin };
    }

    clearAdminToken();
    return { authenticated: false, error: data.error || "Session invalid or expired." };
  } catch (err: any) {
    // If network error, rely on cached token if present
    const cached = getCachedAdmin();
    if (cached) {
      return { authenticated: true, admin: cached };
    }
    return { authenticated: false, error: err?.message || "Network error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * React hook for administrator authentication status.
 */
export function useAdminAuth() {
  const [admin, setAdmin] = useState<AuthenticatedAdmin | null>(() => getCachedAdmin());
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean>(() => !!getAdminToken());

  const checkStatus = useCallback(async () => {
    setLoading(true);
    const result = await verifyAdminSession();
    setAuthenticated(result.authenticated);
    setAdmin(result.admin || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const login = useCallback(async (id: string, pass: string) => {
    setLoading(true);
    const result = await loginAdmin(id, pass);
    if (result.success && result.admin) {
      setAuthenticated(true);
      setAdmin(result.admin);
    }
    setLoading(false);
    return result;
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    await logoutAdmin();
    setAuthenticated(false);
    setAdmin(null);
    setLoading(false);
  }, []);

  return {
    admin,
    loading,
    authenticated,
    login,
    logout,
    checkStatus,
  };
}
