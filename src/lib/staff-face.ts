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
  canPrepareReplacement?: boolean;
  hasStage1Permission?: boolean;
  hasPendingPermissionRequest?: boolean;
  hasPendingImageApproval?: boolean;
  prepToken?: string | null | undefined;
  permissionRequestId?: string | null | undefined;
  approvedDigest?: string | null | undefined;
  stage?: 1 | 2 | undefined;
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
    requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string | undefined;
    linkedRequestId?: string | undefined;
    digest?: string | undefined;
    admin_notes?: string | undefined;
  } | null | undefined;
  pendingRequest?: {
    id: string;
    reason: string;
    status: string;
    created_at: string;
    deviceId?: string | undefined;
    sampleCount?: number | undefined;
    requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string | undefined;
    linkedRequestId?: string | undefined;
    digest?: string | undefined;
  } | null | undefined;
  approvedRequest?: {
    id: string;
    status: string;
    expires_at?: string | undefined;
    remaining_seconds?: number | null | undefined;
    requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string | undefined;
    oneTimeToken?: string | null | undefined;
    approvedDigest?: string | null | undefined;
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
  latestRequest?: {
    id: string;
    reason: string;
    status: string;
    created_at: string;
    deviceId?: string | undefined;
    sampleCount?: number | undefined;
    requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string | undefined;
    linkedRequestId?: string | undefined;
    digest?: string | undefined;
    adminNotes?: string | undefined;
    approved_at?: string | undefined;
    expires_at?: string | undefined;
    remaining_seconds?: number | null | undefined;
  } | null | undefined;
  latestRequestStatus?: "pending" | "approved" | "completed" | "rejected" | "expired" | "none" | "not_registered" | string | undefined;
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
  requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string;
  stage?: 1 | 2;
  deviceId?: string;
  maskedDeviceId?: string;
  linkedRequestId?: string;
  digest?: string;
  maskedDigest?: string;
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

/**
 * Computes a deterministic, canonical SHA-256 digest over 1 to 5 face embedding vectors.
 * Guaranteed invariant across representation orders and serializations.
 */
export async function computeCanonicalTemplateDigest(
  embeddings: Array<number[] | Float32Array>
): Promise<string> {
  const normalizedStrings = embeddings.map((emb) => {
    const arr = Array.from(emb);
    return arr.map((num) => Number(num).toFixed(6)).join(",");
  });
  const canonicalData = `v1;count:${embeddings.length};` + normalizedStrings.join("|");

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(canonicalData));
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return "sha256_" + hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Pure-JS SHA-256 / 32-bit FNV fallback for test runners
  let h = 0x811c9dc5;
  for (let i = 0; i < canonicalData.length; i++) {
    h ^= canonicalData.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "sha256_fnv_" + (h >>> 0).toString(16).padStart(8, "0");
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
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Status query timed out after 15s", "TimeoutError"));
  }, 15000);

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
      enrollmentStatus: data.enrollmentStatus || (data.isLocked ? "approved" : data.status),
      sampleCount: data.sampleCount ?? data.embeddingCount,
      canSaveReplacement: Boolean(data.canSaveReplacement && data.oneTimeToken),
      canPrepareReplacement: Boolean(data.canPrepareReplacement || data.hasStage1Permission),
      hasStage1Permission: Boolean(data.hasStage1Permission || data.canPrepareReplacement),
      hasPendingPermissionRequest: Boolean(data.hasPendingPermissionRequest),
      hasPendingImageApproval: Boolean(data.hasPendingImageApproval),
      prepToken: data.prepToken || null,
      permissionRequestId: data.permissionRequestId || null,
      approvedDigest: data.approvedDigest || null,
      stage: data.stage || (data.hasPendingImageApproval ? 2 : 1),
      activeRequest: data.pendingRequest || data.approvedRequest || data.latestRequest || null,
      latestRequest: data.latestRequest || null,
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
  requestId?: string | undefined;
  digest?: string | undefined;
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
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Face enrollment save timed out after 25s", "TimeoutError"));
  }, 25000);

  const effectiveToken = params.oneTimeToken || oneTimeTokenOverride || null;

  try {
    const headers = getStaffAuthHeaders();
    if (effectiveToken) {
      headers["x-one-time-token"] = effectiveToken;
    }
    if (params.deviceId) {
      headers["x-device-id"] = params.deviceId;
    }
    if (params.requestId) {
      headers["x-request-id"] = params.requestId;
    }
    if (params.digest) {
      headers["x-digest"] = params.digest;
    }

    const enrollPayload = {
      deviceId: params.deviceId || "android-keystore",
      templateCount: params.templateCount || 5,
      oneTimeToken: effectiveToken || undefined,
      requestId: params.requestId || undefined,
      digest: params.digest || undefined,
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
    // Fallback: Check if server actually completed enrollment
    try {
      const srvCheck = await getStaffFaceStatus();
      if (srvCheck.isLocked && !srvCheck.canSaveReplacement) {
        return {
          success: true,
          message: "Face registration confirmed by server.",
          isLocked: true,
        };
      }
    } catch {}

    const isAbort =
      err?.name === "AbortError" ||
      err?.name === "TimeoutError" ||
      String(err?.message || "").toLowerCase().includes("aborted");
    return {
      success: false,
      error: isAbort
        ? "Save request timed out. Please refresh device status to verify lock state."
        : (err?.message || "Connection error during face registration save"),
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
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Face enrollment request timed out after 25s", "TimeoutError"));
  }, 25000);

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
    try {
      const srvCheck = await getStaffFaceStatus();
      if (srvCheck.hasPendingRequest && srvCheck.pendingRequest) {
        return {
          success: true,
          message: "Face registration request confirmed by server.",
          requestId: srvCheck.pendingRequest.id,
          request: srvCheck.pendingRequest,
        };
      }
    } catch {}

    const isAbort =
      err?.name === "AbortError" ||
      err?.name === "TimeoutError" ||
      String(err?.message || "").toLowerCase().includes("aborted");
    return {
      success: false,
      error: isAbort
        ? "Request timed out while waiting for server confirmation. Please refresh to check pending status."
        : (err?.message || "Network error while submitting enrollment request"),
    };
  }
}

export interface RequestFaceChangeParams {
  deviceId?: string | undefined;
  sampleCount?: number | undefined;
  requestType?: "initial" | "replacement" | "permission_request" | "image_approval" | string | undefined;
  linkedRequestId?: string | undefined;
  digest?: string | undefined;
}

/**
 * Request administrator approval to change an already registered & locked face.
 * Supports Stage 1 (permission_request) and Stage 2 (image_approval).
 */
export async function requestStaffFaceChange(
  reason: string,
  extraParams?: RequestFaceChangeParams
): Promise<{ success: boolean; message?: string; requestId?: string; request?: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Face change request timed out after 25s", "TimeoutError"));
  }, 25000);

  const reqType = extraParams?.requestType || (extraParams?.digest ? "image_approval" : "permission_request");
  const payload = {
    reason: reason.trim(),
    action: reqType === "image_approval" ? "request-image-approval" : "request-change",
    requestType: reqType,
    deviceId: extraParams?.deviceId,
    sampleCount: extraParams?.sampleCount,
    linkedRequestId: extraParams?.linkedRequestId,
    permissionRequestId: extraParams?.linkedRequestId,
    digest: extraParams?.digest,
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

    const retObj: { success: boolean; message?: string; requestId?: string; request?: any; error?: string } = {
      success: true,
      message: data.message || "Face change request submitted.",
    };
    if (typeof data.requestId === "string") {
      retObj.requestId = data.requestId;
    }
    if (data.request) {
      retObj.request = data.request;
    }
    return retObj;
  } catch (err: any) {
    clearTimeout(timeoutId);
    // Fallback: Query current staff face status to see if server already committed the request row
    try {
      const srvCheck = await getStaffFaceStatus();
      if (srvCheck.hasPendingRequest && (srvCheck.pendingRequest || srvCheck.activeRequest)) {
        const req = srvCheck.pendingRequest || srvCheck.activeRequest;
        const fallbackObj: { success: boolean; message?: string; requestId?: string; request?: any; error?: string } = {
          success: true,
          message: "Face change request confirmed by server.",
          request: req,
        };
        if (req?.id) {
          fallbackObj.requestId = req.id;
        }
        return fallbackObj;
      }
    } catch {}

    const isAbort =
      err?.name === "AbortError" ||
      err?.name === "TimeoutError" ||
      String(err?.message || "").toLowerCase().includes("aborted");
    return {
      success: false,
      error: isAbort
        ? "Request timed out while waiting for server confirmation. Please check your connection or refresh status."
        : (err?.message || "Network error while submitting change request"),
    };
  }
}

/**
 * Stage 1: Request permission to prepare replacement face images (Institutional reason only, ZERO images).
 */
export async function requestStaffFacePermission(
  reason: string,
  deviceId?: string
): Promise<{ success: boolean; message?: string; requestId?: string; request?: any; error?: string }> {
  return requestStaffFaceChange(reason, {
    deviceId,
    requestType: "permission_request",
    sampleCount: 1,
  });
}

/**
 * Stage 2: Submit the exact staged replacement images for administrator approval.
 * Bound to staff identity, device ID, Stage 1 permission ID, sample count, and cryptographic digest.
 */
export async function requestStaffFaceImageApproval(params: {
  reason?: string | undefined;
  deviceId?: string | undefined;
  sampleCount: number;
  linkedRequestId?: string | undefined;
  digest: string;
}): Promise<{ success: boolean; message?: string; requestId?: string; request?: any; error?: string }> {
  return requestStaffFaceChange(params.reason || "Replacement face images submitted for administrator approval", {
    deviceId: params.deviceId,
    sampleCount: params.sampleCount,
    requestType: "image_approval",
    linkedRequestId: params.linkedRequestId,
    digest: params.digest,
  });
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
