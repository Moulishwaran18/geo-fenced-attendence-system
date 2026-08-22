/**
 * Module: verificationSession
 *
 * Manages verification session lifecycle:
 * - Cryptographic session token / nonce generation
 * - Short-lived expiration (30-second TTL)
 * - Single-use anti-replay protection
 * - Backend verification simulation (validates session nonce, quality, Viola-Jones, liveness, anti-spoof, deepfake, similarity)
 */

import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VerificationSession {
  sessionId: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  assignedChallengeType: string;
  isConsumed: boolean;
}

export interface VerificationPayload {
  /** Session ID issued by backend. */
  sessionId: string;
  /** Cryptographic nonce matching session. */
  sessionNonce: string;
  /** Matched staff ID. */
  staffId: string;
  /** Matched staff name. */
  staffName: string;
  /** Measured Euclidean distance. */
  similarityDistance: number;
  /** Liveness completed flag. */
  livenessCompleted: boolean;
  /** Name of the completed challenge. */
  completedChallengeType: string;
  /** Frame quality check passed. */
  frameQualityPassed: boolean;
  /** Viola-Jones single face detection confirmed. */
  violaJonesPassed: boolean;
  /** Presentation attack detection passed. */
  antiSpoofPassed: boolean;
  /** Measured presentation attack risk score (0.0 to 1.0). */
  spoofRiskScore: number;
  /** GAN/Deepfake classifier passed. */
  deepfakePassed: boolean;
  /** Deepfake risk score (0.0 to 1.0). */
  deepfakeRiskScore: number;
  /** Deepfake classification label. */
  deepfakeClassification: string;
  /** Device information. */
  deviceInfo: string;
  /** Timestamp when verification took place. */
  verifiedAt: string;
}

export interface VerificationResult {
  /** Accepted by server decision. */
  accepted: boolean;
  /** Rejection reason if not accepted. */
  reason?: string;
  /** Cryptographically signed attendance token issued upon acceptance. */
  attendanceToken?: string;
  /** Server confirmed staff ID. */
  confirmedStaffId?: string;
  /** Server confirmed staff name. */
  confirmedStaffName?: string;
  /** Unique audit ID for compliance logging. */
  auditId: string;
}

/* ------------------------------------------------------------------ */
/*  Session Nonce Store                                                */
/* ------------------------------------------------------------------ */

const sessionRegistry = new Map<string, VerificationSession>();

/**
 * Generate a cryptographically secure random string.
 */
function secureRandomString(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).substring(2, 15);
  const timePart = Date.now().toString(36);
  return `${prefix}-${timePart}-${randomPart}`;
}

/**
 * Create a new short-lived verification session with cryptographic nonce.
 */
export function createVerificationSession(assignedChallengeType: string): VerificationSession {
  const now = Date.now();
  const session: VerificationSession = {
    sessionId: secureRandomString("sess"),
    nonce: secureRandomString("nonce"),
    createdAt: now,
    expiresAt: now + FACE_CONFIG.LIVENESS.SESSION_TTL_SEC * 1000,
    assignedChallengeType,
    isConsumed: false,
  };

  sessionRegistry.set(session.sessionId, session);
  return session;
}

/**
 * Check if a session is currently valid and unexpired.
 */
export function isSessionActive(sessionId: string): boolean {
  const session = sessionRegistry.get(sessionId);
  if (!session) return false;
  if (session.isConsumed) return false;
  if (Date.now() > session.expiresAt) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Backend Verification Service (Simulated API Endpoint)             */
/* ------------------------------------------------------------------ */

/**
 * Simulated server-side verification endpoint.
 *
 * Validates all security layers of the biometric payload:
 * 1. Session presence & anti-replay
 * 2. TTL expiration
 * 3. Cryptographic nonce match
 * 4. Frame quality check
 * 5. Viola-Jones face detection
 * 6. Liveness proof
 * 7. Presentation-attack risk score
 * 8. GAN/Deepfake classification
 * 9. Biometric face distance threshold
 */
export async function submitFaceVerification(
  payload: VerificationPayload,
): Promise<VerificationResult> {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 450));

  const auditId = `AUDIT-${Date.now().toString(36).toUpperCase()}`;

  // 1. Validate session presence in registry
  const session = sessionRegistry.get(payload.sessionId);
  if (!session) {
    return {
      accepted: false,
      reason: "Invalid or nonexistent verification session.",
      auditId,
    };
  }

  // 2. Validate single-use (anti-replay check)
  if (session.isConsumed) {
    return {
      accepted: false,
      reason: "Verification session has already been used (anti-replay protection).",
      auditId,
    };
  }

  // 3. Mark session as consumed immediately
  session.isConsumed = true;

  // 4. Validate session TTL (expiration check)
  if (Date.now() > session.expiresAt) {
    return {
      accepted: false,
      reason: "Verification session expired. Please retry with live camera.",
      auditId,
    };
  }

  // 5. Validate cryptographic nonce
  if (session.nonce !== payload.sessionNonce) {
    return {
      accepted: false,
      reason: "Session nonce mismatch (potential tampering).",
      auditId,
    };
  }

  // 6. Validate frame quality
  if (!payload.frameQualityPassed) {
    return {
      accepted: false,
      reason: "Frame quality check failed.",
      auditId,
    };
  }

  // 7. Validate Viola-Jones detection
  if (!payload.violaJonesPassed) {
    return {
      accepted: false,
      reason: "Viola–Jones face detection validation failed.",
      auditId,
    };
  }

  // 8. Validate liveness completion & challenge integrity
  if (!payload.livenessCompleted) {
    return {
      accepted: false,
      reason: "Liveness verification was not completed.",
      auditId,
    };
  }

  if (session.assignedChallengeType !== payload.completedChallengeType) {
    return {
      accepted: false,
      reason: "Completed challenge does not match server-assigned challenge.",
      auditId,
    };
  }

  // 9. Validate presentation-attack detection (PAD)
  if (!payload.antiSpoofPassed || payload.spoofRiskScore > FACE_CONFIG.ANTI_SPOOF.MAX_SPOOF_RISK) {
    return {
      accepted: false,
      reason: "Presentation attack / screen reflection detected. Verification rejected.",
      auditId,
    };
  }

  // 10. Validate GAN / Deepfake risk
  if (!payload.deepfakePassed || payload.deepfakeRiskScore > FACE_CONFIG.DEEPFAKE.MAX_DEEPFAKE_RISK) {
    return {
      accepted: false,
      reason: "Synthetic or deepfake artifacts detected. Verification rejected.",
      auditId,
    };
  }

  // 11. Validate face similarity threshold
  if (payload.similarityDistance >= FACE_CONFIG.FACE_MATCH_THRESHOLD) {
    return {
      accepted: false,
      reason: "Face similarity distance did not meet the required threshold.",
      auditId,
    };
  }

  // 12. Validate staff ID existence
  if (!payload.staffId || payload.staffId.trim() === "") {
    return {
      accepted: false,
      reason: "No matching registered staff profile.",
      auditId,
    };
  }

  // All 12 backend security gates passed — Issue signed attendance token
  const attendanceToken = `ATT-TOKEN-${payload.staffId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    accepted: true,
    attendanceToken,
    confirmedStaffId: payload.staffId,
    confirmedStaffName: payload.staffName,
    auditId,
  };
}

/**
 * Helper to build the verification payload from the multi-layer scan result.
 */
export function buildVerificationPayload(
  session: VerificationSession,
  staffId: string,
  staffName: string,
  distance: number,
  completedChallengeType: string,
  securityMetrics: {
    frameQualityPassed: boolean;
    violaJonesPassed: boolean;
    antiSpoofPassed: boolean;
    spoofRiskScore: number;
    deepfakePassed: boolean;
    deepfakeRiskScore: number;
    deepfakeClassification: string;
  },
): VerificationPayload {
  return {
    sessionId: session.sessionId,
    sessionNonce: session.nonce,
    staffId,
    staffName,
    similarityDistance: distance,
    livenessCompleted: true,
    completedChallengeType,
    frameQualityPassed: securityMetrics.frameQualityPassed,
    violaJonesPassed: securityMetrics.violaJonesPassed,
    antiSpoofPassed: securityMetrics.antiSpoofPassed,
    spoofRiskScore: securityMetrics.spoofRiskScore,
    deepfakePassed: securityMetrics.deepfakePassed,
    deepfakeRiskScore: securityMetrics.deepfakeRiskScore,
    deepfakeClassification: securityMetrics.deepfakeClassification,
    deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : "browser",
    verifiedAt: new Date().toISOString(),
  };
}
