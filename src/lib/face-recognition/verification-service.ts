/**
 * Verification service — simulates backend attendance verification.
 *
 * In production, the frontend sends verification data to a server endpoint
 * which:
 *  1. Validates the session / auth token
 *  2. Confirms the staff ID against server-side records
 *  3. Checks the liveness challenge was passed
 *  4. Confirms similarity score is within threshold
 *  5. Records the face-verified attendance entry
 *
 * The frontend does NOT simply send `{ faceVerified: true }`.
 * Instead it sends the full verification payload and the server makes
 * the final attendance decision.
 */

import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VerificationPayload {
  /** Staff ID that was matched. */
  staffId: string;
  /** Staff name (for display confirmation). */
  staffName: string;
  /** Euclidean distance from the matching. */
  similarityDistance: number;
  /** Whether liveness challenges were completed. */
  livenessCompleted: boolean;
  /** Number of liveness challenges completed. */
  livenessChallengesCompleted: number;
  /** Device fingerprint / user-agent. */
  deviceInfo: string;
  /** ISO timestamp when verification was performed. */
  verifiedAt: string;
  /** Session nonce (to prevent replay). */
  sessionNonce: string;
}

export interface VerificationResult {
  /** Whether the server accepted the face verification. */
  accepted: boolean;
  /** Reason for rejection, if any. */
  reason?: string;
  /** Signed attendance token for the downstream attendance recording. */
  attendanceToken?: string;
  /** The verified staff ID (server-confirmed). */
  confirmedStaffId?: string;
  /** The verified staff name. */
  confirmedStaffName?: string;
  /** Audit record ID. */
  auditId: string;
}

/* ------------------------------------------------------------------ */
/*  Nonce generation                                                   */
/* ------------------------------------------------------------------ */

let currentNonce: string | null = null;

/** Generate a new session nonce (call at the start of each scan). */
export function generateSessionNonce(): string {
  currentNonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return currentNonce;
}

/** Get the current session nonce. */
export function getCurrentNonce(): string {
  if (!currentNonce) {
    return generateSessionNonce();
  }
  return currentNonce;
}

/* ------------------------------------------------------------------ */
/*  Backend verification (simulated)                                   */
/* ------------------------------------------------------------------ */

/**
 * Submit face verification data to the "backend" for final decision.
 *
 * In this prototype, validation runs locally. In production, this would
 * be an API call to a secure server endpoint.
 */
export async function submitFaceVerification(
  payload: VerificationPayload,
): Promise<VerificationResult> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 800));

  const auditId = `FACE-${Date.now().toString(36).toUpperCase()}`;

  // --- Server-side validation checks ---

  // 1. Check session nonce (prevent replay)
  if (!payload.sessionNonce || !payload.sessionNonce.startsWith("nonce-")) {
    return {
      accepted: false,
      reason: "Invalid session. Please restart face verification.",
      auditId,
    };
  }

  // 2. Check liveness was completed
  if (!payload.livenessCompleted) {
    return {
      accepted: false,
      reason: "Liveness verification was not completed.",
      auditId,
    };
  }

  // 3. Check similarity is within server-side threshold
  if (payload.similarityDistance >= FACE_CONFIG.MATCH_THRESHOLD) {
    return {
      accepted: false,
      reason: "Face similarity score did not meet the required threshold.",
      auditId,
    };
  }

  // 4. Check staff ID is valid
  if (!payload.staffId) {
    return {
      accepted: false,
      reason: "No staff match found.",
      auditId,
    };
  }

  // --- All checks passed ---

  // Generate signed attendance token
  const attendanceToken = `att-${payload.staffId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Invalidate the nonce (single-use)
  currentNonce = null;

  return {
    accepted: true,
    attendanceToken,
    confirmedStaffId: payload.staffId,
    confirmedStaffName: payload.staffName,
    auditId,
  };
}

/**
 * Build a VerificationPayload from the face scan results.
 */
export function buildVerificationPayload(
  staffId: string,
  staffName: string,
  distance: number,
  livenessCompleted: boolean,
  livenessChallengesCompleted: number,
): VerificationPayload {
  return {
    staffId,
    staffName,
    similarityDistance: distance,
    livenessCompleted,
    livenessChallengesCompleted,
    deviceInfo: navigator.userAgent,
    verifiedAt: new Date().toISOString(),
    sessionNonce: getCurrentNonce(),
  };
}
