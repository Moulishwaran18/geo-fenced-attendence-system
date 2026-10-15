/**
 * Client-Side API Helper for Staff Face Enrollment & Approval System
 */

import { getActiveStaff } from "./staff-auth";
import { getAdminAuthHeaders } from "./admin-auth";

export type FaceEnrollmentState =
  | "not_registered"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "expired";

export interface StaffFaceSample {
  id: string;
  reference_image_path: string;
  photo_data?: string | null;
  created_at: string;
}

export interface StaffFaceStatusResponse {
  success: boolean;
  staff?: {
    id: string;
    staff_code: string;
    name: string;
    department: string;
  };
  status: FaceEnrollmentState;
  enrollmentStatus?: FaceEnrollmentState;
  isLocked: boolean;
  canEdit: boolean;
  canSaveReplacement?: boolean;
  embeddingCount: number;
  sampleCount?: number;
  samples: StaffFaceSample[];
  hasPendingRequest: boolean;
  isExpired?: boolean | undefined;
  activeRequest?: {
    id: string;
    reason: string;
    status: string;
    created_at: string;
    deviceId?: string | undefined;
    sampleCount?: number | undefined;
    requestType?: "initial" | "replacement" | string | undefined;
    admin_notes?: string | undefined;
  } | null | undefined;
  pendingRequest?: {
    id: string;
    reason: string;
    status: string;
    created_at: string;
    deviceId?: string | undefined;
    sampleCount?: number | undefined;
    requestType?: "initial" | "replacement" | string | undefined;
  } | null | undefined;
  approvedRequest?: {
    id: string;
    status: string;
    expires_at?: string | undefined;
    remaining_seconds?: number | null | undefined;
  } | null | undefined;
  rejectedRequest?: {
    id: string;
    status: string;
    adminNotes?: string | undefined;
    created_at?: string | undefined;
  } | null | undefined;
  expiredRequest?: {
    id: string;
    status: string;
    expires_at?: string | undefined;
    approved_at?: string | undefined;
  } | null | undefined;
  oneTimeToken?: string | null | undefined;
  error?: string | undefined;
}

export interface FaceChangeRequest {
  id: string;
  staff_code: string;
  staff_name: string;
  department: string;
  currentEmbeddingCount: number;
  sampleCount?: number;
  requestType?: "initial" | "replacement";
  deviceId?: string;
  maskedDeviceId?: string;
  reason: string;
  status: "pending" | "approved" | "consumed" | "rejected" | "expired";
  created_at: string;
  approved_at?: string;
  expires_at?: string;
  is_expired?: boolean;
  remaining_seconds?: number;
  admin_notes?: string;
  has_one_time_token?: boolean;
}

function getStaffAuthHeaders(): Record<string, string> {
  const staff = getActiveStaff();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (staff?.token) {
    headers["Authorization"] = `Bearer ${staff.token}`;
    headers["x-staff-token"] = staff.token;
  }
  return headers;
}

/**
 * Fetch the authenticated staff member's face enrollment & lock status.
 */
export async function getStaffFaceStatus(): Promise<StaffFaceStatusResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    let res = await fetch("/api/staff/face/status", {
      method: "GET",
      headers: getStaffAuthHeaders(),
      credentials: "include",
      signal: controller.signal,
    });
    if (res.status === 404) {
      res = await fetch("/api/staff/face", {
        method: "GET",
        headers: getStaffAuthHeaders(),
        credentials: "include",
        signal: controller.signal,
      });
    }
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        status: "not_registered",
        isLocked: false,
        canEdit: true,
        embeddingCount: 0,
        samples: [],
        hasPendingRequest: false,
        error: data.error || `HTTP ${res.status}: Failed to retrieve face status`,
      };
    }

    const statusData: StaffFaceStatusResponse = {
      ...data,
      enrollmentStatus: data.status,
      sampleCount: data.embeddingCount,
      canSaveReplacement: Boolean(data.oneTimeToken || (data.status === "approved" && data.canEdit)),
      activeRequest: data.pendingRequest || null,
    };
    return statusData;
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      status: "not_registered",
      enrollmentStatus: "not_registered",
      isLocked: false,
      canEdit: true,
      canSaveReplacement: false,
      embeddingCount: 0,
      sampleCount: 0,
      samples: [],
      hasPendingRequest: false,
      activeRequest: null,
      error: err?.message || "Failed to reach server for face status",
    };
  }
}

export interface StaffEnrollDeviceParams {
  deviceId?: string | undefined;
  templateCount?: number | undefined;
  oneTimeToken?: string | null | undefined;
}

/**
 * Register device-local face enrollment OR consume one-time replacement token.
 * Biometrics are never sent to the server.
 */
export async function submitStaffFaceEnrollment(
  params: StaffEnrollDeviceParams = {},
  oneTimeTokenOverride?: string | null,
): Promise<{ success: boolean; message?: string; isLocked?: boolean; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  const effectiveToken = params.oneTimeToken || oneTimeTokenOverride || null;

  try {
    const headers = getStaffAuthHeaders();
    if (effectiveToken) {
      headers["x-one-time-token"] = effectiveToken;
    }
    if (params.deviceId) {
      headers["x-device-id"] = params.deviceId;
    }

    const enrollPayload = {
      deviceId: params.deviceId || "android-keystore",
      templateCount: params.templateCount || 3,
      oneTimeToken: effectiveToken || undefined,
      action: "enroll",
    };

    let res = await fetch("/api/staff/face/enroll", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(enrollPayload),
      signal: controller.signal,
    });

    if (res.status === 404) {
      res = await fetch("/api/staff/face", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(enrollPayload),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        error: data.error || `HTTP ${res.status}: Failed to save face registration`,
      };
    }

    return {
      success: true,
      message: data.message || "Face registration saved successfully.",
      isLocked: data.isLocked !== false,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err?.message || "Connection error during face registration save",
    };
  }
}

export interface RequestFaceEnrollmentParams {
  reason?: string;
  deviceId?: string;
  sampleCount?: number;
}

/**
 * Submit an initial or replacement face registration approval request to the administrator.
 * Biometrics are NEVER uploaded to the server.
 */
export async function requestStaffFaceEnrollment(
  params: RequestFaceEnrollmentParams = {}
): Promise<{ success: boolean; message?: string; requestId?: string; request?: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const payload = {
    reason: (params.reason || "Initial face biometric registration").trim(),
    deviceId: params.deviceId,
    sampleCount: params.sampleCount || 1,
    action: "request-enrollment",
  };

  try {
    let res = await fetch("/api/staff/face/request", {
      method: "POST",
      headers: getStaffAuthHeaders(),
      credentials: "include",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status === 404) {
      res = await fetch("/api/staff/face", {
        method: "POST",
        headers: getStaffAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        error: data.error || `HTTP ${res.status}: Failed to submit registration request`,
      };
    }

    return {
      success: true,
      message: data.message || "Face registration request submitted.",
      requestId: data.requestId,
      request: data.request,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err?.message || "Network error while submitting enrollment request",
    };
  }
}

/**
 * Request administrator approval to change an already registered & locked face.
 */
export async function requestStaffFaceChange(
  reason: string,
  extraParams?: { deviceId?: string | undefined; sampleCount?: number | undefined }
): Promise<{ success: boolean; message?: string; requestId?: string; request?: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const payload = {
    reason: reason.trim(),
    action: "request-change",
    deviceId: extraParams?.deviceId,
    sampleCount: extraParams?.sampleCount,
  };

  try {
    let res = await fetch("/api/staff/face/request-change", {
      method: "POST",
      headers: getStaffAuthHeaders(),
      credentials: "include",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status === 404) {
      res = await fetch("/api/staff/face", {
        method: "POST",
        headers: getStaffAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.success === false) {
      return {
        success: false,
        error: data.error || `HTTP ${res.status}: Failed to submit change request`,
      };
    }

    return {
      success: true,
      message: data.message || "Face change request submitted.",
      requestId: data.requestId,
      request: data.request,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err?.message || "Network error while submitting change request",
    };
  }
}

/**
 * Cancel a pending face change request.
 */
export async function cancelStaffFaceChange(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    let res = await fetch("/api/staff/face/cancel-request", {
      method: "POST",
      headers: getStaffAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({ action: "cancel-request" }),
    });

    if (res.status === 404) {
      res = await fetch("/api/staff/face", {
        method: "POST",
        headers: getStaffAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ action: "cancel-request" }),
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      return { success: false, error: data.error || "Failed to cancel request" };
    }
    return { success: true, message: data.message || "Request cancelled" };
  } catch (err: any) {
    return { success: false, error: err?.message || "Network error" };
  }
}

/**
 * Administrator: Query all face change requests.
 */
export async function getAdminFaceRequests(): Promise<{
  success: boolean;
  requests: FaceChangeRequest[];
  pendingCount: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/admin/face-requests", {
      method: "GET",
      headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      return { success: false, requests: [], pendingCount: 0, error: data.error || "Failed to load requests" };
    }
    return {
      success: true,
      requests: data.requests || [],
      pendingCount: data.pendingCount || 0,
    };
  } catch (err: any) {
    return { success: false, requests: [], pendingCount: 0, error: err?.message || "Connection error" };
  }
}

/**
 * Administrator: Approve face change request and issue one-time token.
 */
export async function approveFaceChangeRequest(
  id: string,
  adminNotes?: string,
): Promise<{ success: boolean; message?: string; oneTimeToken?: string; error?: string }> {
  try {
    let res = await fetch("/api/admin/face-requests/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
      credentials: "include",
      body: JSON.stringify({ id, requestId: id, adminNotes }),
    });
    if (res.status === 404) {
      res = await fetch(`/api/admin/face-requests/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ id, requestId: id, adminNotes }),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      return { success: false, error: data.error || "Failed to approve request" };
    }
    return {
      success: true,
      message: data.message,
      oneTimeToken: data.oneTimeToken,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Network error" };
  }
}

/**
 * Administrator: Reject face change request.
 */
export async function rejectFaceChangeRequest(
  id: string,
  adminNotes?: string,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    let res = await fetch("/api/admin/face-requests/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
      credentials: "include",
      body: JSON.stringify({ id, requestId: id, adminNotes }),
    });
    if (res.status === 404) {
      res = await fetch(`/api/admin/face-requests/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ id, requestId: id, adminNotes }),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      return { success: false, error: data.error || "Failed to reject request" };
    }
    return { success: true, message: data.message };
  } catch (err: any) {
    return { success: false, error: err?.message || "Network error" };
  }
}
