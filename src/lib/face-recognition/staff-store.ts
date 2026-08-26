/**
 * Staff Profile Store & Client Biometric API Service — CampusAttend
 *
 * Requirements:
 * - Scalable to 100+, 500+, 1000+ staff members.
 * - Initial 3 test staff: PERSON_001, PERSON_002, PERSON_003.
 * - Admin can add PERSON_004+ and manage face embeddings.
 * - Backend vector search with zero raw biometric exposure to client.
 */

export interface ReferenceSample {
  id: string;
  photoUrl: string;
  embedding?: number[]; // Redacted on client for security
  confidence?: number;
  createdAt: string;
}

export interface MultiEmbeddingProfile {
  id: string;
  staffId: string;
  name: string;
  embeddings: (Float32Array | number[])[];
}

export interface StaffProfile {
  id: string;
  staffId: string;
  name: string;
  email?: string;
  department?: string;
  designation?: string;
  referenceSamples: ReferenceSample[];
  embeddingCount: number;
  registeredAt: string;
  status: "enrolled" | "pending" | "removed";
  active: boolean;
}

export interface VerifyFaceResponse {
  matched: boolean;
  finalResult?: string | undefined;
  verificationSessionId?: string | undefined;
  embeddingFingerprint?: string | undefined;
  staff?: {
    id: string;
    staffCode: string;
    name: string;
  } | undefined;
  bestCandidate?: {
    staffCode: string;
    name: string;
    distance: number;
  } | undefined;
  secondBestCandidate?: {
    staffCode: string;
    name: string;
    distance: number;
  } | null | undefined;
  distance?: number | undefined;
  threshold?: number | undefined;
  margin?: number | undefined;
  matchMargin?: number | null | undefined;
  searchedEmbeddingsCount?: number | undefined;
  embeddingsPerStaff?: Record<string, number> | undefined;
  personDistances?: Array<{
    staffCode: string;
    name: string;
    minDistance: number;
    embeddingCount: number;
  }> | undefined;
  allCandidates?: Array<{
    staffCode: string;
    name: string;
    embeddingId: string;
    referenceImagePath: string;
    distance: number;
  }> | undefined;
  reason?: string | undefined;
  auditId?: string | undefined;
  reqTimestamp?: string | undefined;
  verifiedAt?: string | undefined;
  accepted?: boolean | undefined;
  attendanceToken?: string | undefined;
  engine?: string | undefined;
  deterministicAudit?: DeterministicAuditData | undefined;
  telemetry?: {
    recognitionModel: string;
    modelFamily: string;
    embeddingDimension: number;
    embeddingNorm?: number;
    databaseEmbeddingModel: string;
    compatibility: string;
  } | undefined;
}

export interface DeterministicAuditData {
  recognitionFrameId: number | string;
  detectorConfidence: number;
  faceBox: { x: number; y: number; width: number; height: number } | null;
  landmarks5: number[][] | null;
  tensorChecksum: string;
  embeddingChecksum: string;
  embeddingDimension: number;
  embeddingNorm: number;
  doubleInferenceDist: number;
  liveVsOfflineDistance: number | null;
  offlineMinDistance: number | null;
  p001Distances?: Record<string, number>;
  p001_1: number | null;
  p001_2: number | null;
  p001_3: number | null;
  p001_4: number | null;
  p001_5: number | null;
  bestDistance: number;
  minDistance: number;
  bestReference: string;
  threshold: number;
  margin: number;
  matchMargin: number | null;
  finalDecision: string;
  rootCause: string;
}

// -----------------------------------------------------------------------------
// Backend API Integration
// -----------------------------------------------------------------------------

/**
 * Fetch all staff from the backend database.
 */
export async function fetchAllStaff(): Promise<StaffProfile[]> {
  try {
    const res = await fetch("/api/admin/staff");
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{
        id: string;
        staff_code: string;
        name: string;
        email: string;
        department: string;
        designation: string;
        active: boolean;
        created_at: string;
        updated_at: string;
        embeddingCount: number;
        referenceSamples: Array<{
          id: string;
          staff_id: string;
          reference_image_path: string;
          created_at: string;
        }>;
      }>;
    };
    return (json.data || []).map((s) => ({
      id: s.id,
      staffId: s.staff_code,
      name: s.name,
      email: s.email,
      department: s.department,
      designation: s.designation,
      referenceSamples: [],
      embeddingCount: 0,
      registeredAt: s.created_at,
      status: "enrolled" as const,
      active: s.active,
    }));
  } catch (err) {
    console.error("Fetch staff failed:", err);
    return getFallbackStaff();
  }
}

function getFallbackStaff(): StaffProfile[] {
  return [
    {
      id: "PERSON_001",
      staffId: "PERSON_001",
      name: "Test Person 1",
      email: "test.person1@sonatech.ac.in",
      department: "Computer Science & Engineering",
      designation: "Associate Professor",
      referenceSamples: [],
      embeddingCount: 5,
      registeredAt: new Date().toISOString(),
      status: "enrolled",
      active: true,
    },
  ];
}

/**
 * Create a new staff record on the backend (e.g. PERSON_004+).
 */
export async function createNewStaff(data: {
  staff_code: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  active?: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (err) {
    console.error("Create staff error:", err);
    return false;
  }
}

/**
 * Toggle staff active/inactive status.
 */
export async function toggleStaffStatus(staffIdOrCode: string, active: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/staff/${encodeURIComponent(staffIdOrCode)}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    return res.ok;
  } catch (err) {
    console.error("Update staff status error:", err);
    return false;
  }
}

/**
 * Enroll a new 512-dimensional face embedding into the staff database.
 */
export async function enrollStaffFace(
  staffId: string,
  embedding: Float32Array | number[],
  referenceImagePath: string,
): Promise<boolean> {
  try {
    const embArray = Array.isArray(embedding) ? embedding : Array.from(embedding);
    const res = await fetch(`/api/admin/staff/${encodeURIComponent(staffId)}/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embedding: embArray,
        referenceImagePath,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Enroll staff face error:", err);
    return false;
  }
}

/**
 * Delete a specific reference embedding.
 */
export async function deleteStaffEmbedding(
  staffId: string,
  embeddingId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/admin/staff/${encodeURIComponent(staffId)}/embedding/${encodeURIComponent(embeddingId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    console.error("Delete embedding error:", err);
    return false;
  }
}

/**
 * Verify a live 512-dimensional ArcFace embedding against active backend database.
 */
export async function verifyLiveFace(
  descriptor: Float32Array | number[],
  livenessCompleted: boolean = true,
  sessionNonce?: string,
  verificationSessionId?: string,
  embeddingFingerprint?: string,
  extraPayload?: {
    recognitionFrameId?: number | string;
    rawFrameDataUrl?: string;
    aligned112DataUrl?: string;
    tensorChecksum?: string;
    embeddingChecksum?: string;
    descriptorB?: number[];
    doubleInferenceDist?: number;
    faceBox?: { x: number; y: number; width: number; height: number };
    landmarks5?: number[][];
    confidence?: number;
  },
): Promise<VerifyFaceResponse> {
  try {
    const descArray = Array.isArray(descriptor) ? descriptor : Array.from(descriptor);
    const res = await fetch("/api/face/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        descriptor: descArray,
        livenessCompleted,
        sessionNonce,
        verificationSessionId,
        embeddingFingerprint,
        ...extraPayload,
      }),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as VerifyFaceResponse;
      return {
        matched: false,
        verificationSessionId,
        embeddingFingerprint,
        reason: errJson.reason || `Verification rejected with HTTP ${res.status}`,
      };
    }

    return (await res.json()) as VerifyFaceResponse;
  } catch (err) {
    console.error("Live face verification error:", err);
    return {
      matched: false,
      verificationSessionId,
      embeddingFingerprint,
      reason: `Verification connection failed: ${String(err)}`,
    };
  }
}

/**
 * Verify a live camera image directly using Python DeepFace (RetinaFace + FaceNet-512).
 */
export async function verifyLiveFaceImage(
  imageDataUrl: string,
  verificationSessionId?: string,
): Promise<VerifyFaceResponse> {
  try {
    const res = await fetch("/api/face/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: imageDataUrl,
        verificationSessionId,
      }),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as VerifyFaceResponse;
      return {
        matched: false,
        verificationSessionId,
        reason: errJson.reason || `Verification rejected with HTTP ${res.status}`,
      };
    }

    return (await res.json()) as VerifyFaceResponse;
  } catch (err) {
    console.error("DeepFace live verification error:", err);
    return {
      matched: false,
      verificationSessionId,
      reason: `Verification connection failed: ${String(err)}`,
    };
  }
}

// -----------------------------------------------------------------------------
// Synchronous Cache Helpers (for immediate initial UI renders)
// -----------------------------------------------------------------------------

export function getEnrolledStaff(): StaffProfile[] {
  // Provided for backward compatibility
  return [];
}

export function getAllProfiles(): StaffProfile[] {
  return [];
}

export function isEnrolled(): boolean {
  return true;
}

export function enrolledCount(): number {
  return 3;
}

export function clearAllProfiles(): void {
  // no-op for backend db
}
