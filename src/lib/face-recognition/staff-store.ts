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
  staff?: {
    id: string;
    staffCode: string;
    name: string;
  };
  bestCandidate?: {
    staffCode: string;
    name: string;
    distance: number;
  };
  secondBestCandidate?: {
    staffCode: string;
    name: string;
    distance: number;
  } | null;
  distance?: number;
  threshold?: number;
  margin?: number;
  matchMargin?: number;
  reason?: string;
  auditId?: string;
  verifiedAt?: string;
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
        embeddingCount: number;
        referenceSamples: Array<{
          id: string;
          staff_id: string;
          reference_image_path: string;
          created_at: string;
        }>;
      }>;
    };

    if (json.success && Array.isArray(json.data)) {
      return json.data.map((s) => ({
        id: s.staff_code,
        staffId: s.staff_code,
        name: s.name,
        email: s.email,
        department: s.department,
        designation: s.designation,
        referenceSamples: (s.referenceSamples || []).map((r) => ({
          id: r.id,
          photoUrl: r.reference_image_path,
          createdAt: r.created_at,
        })),
        embeddingCount: s.embeddingCount || 0,
        registeredAt: s.created_at,
        status: s.embeddingCount > 0 ? "enrolled" : "pending",
        active: s.active,
      }));
    }
  } catch (err) {
    console.warn("Failed to fetch staff from /api/admin/staff:", err);
  }

  // Fallback default test users if backend request not yet ready
  return [
    {
      id: "PERSON_001",
      staffId: "PERSON_001",
      name: "Test Person 1",
      email: "test.person1@sonatech.ac.in",
      department: "Computer Science & Engineering",
      designation: "Associate Professor",
      referenceSamples: [],
      embeddingCount: 0,
      registeredAt: new Date().toISOString(),
      status: "pending",
      active: true,
    },
    {
      id: "PERSON_002",
      staffId: "PERSON_002",
      name: "Test Person 2",
      email: "test.person2@sonatech.ac.in",
      department: "Information Technology",
      designation: "Assistant Professor",
      referenceSamples: [],
      embeddingCount: 0,
      registeredAt: new Date().toISOString(),
      status: "pending",
      active: true,
    },
    {
      id: "PERSON_003",
      staffId: "PERSON_003",
      name: "Test Person 3",
      email: "test.person3@sonatech.ac.in",
      department: "Electronics & Communication",
      designation: "Professor",
      referenceSamples: [],
      embeddingCount: 0,
      registeredAt: new Date().toISOString(),
      status: "pending",
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
 * Enroll a reference face embedding for a staff member.
 */
export async function enrollStaffFace(
  staffIdOrCode: string,
  descriptor: Float32Array | number[],
  referenceImagePath?: string,
): Promise<boolean> {
  try {
    const descArray = Array.isArray(descriptor) ? descriptor : Array.from(descriptor);
    const res = await fetch(`/api/admin/staff/${encodeURIComponent(staffIdOrCode)}/face-enrollment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        descriptor: descArray,
        referenceImagePath,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Face enrollment error:", err);
    return false;
  }
}

/**
 * Delete a specific reference embedding.
 */
export async function deleteStaffEmbedding(
  staffIdOrCode: string,
  embeddingId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/admin/staff/${encodeURIComponent(staffIdOrCode)}/embeddings/${encodeURIComponent(embeddingId)}`,
      { method: "DELETE" },
    );
    return res.ok;
  } catch (err) {
    console.error("Delete embedding error:", err);
    return false;
  }
}

/**
 * Scalable Backend Face Verification:
 * Compares live face descriptor against the backend PostgreSQL face database.
 */
export async function verifyLiveFace(
  descriptor: Float32Array | number[],
  livenessCompleted: boolean = true,
  sessionNonce?: string,
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
      }),
    });

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as VerifyFaceResponse;
      return {
        matched: false,
        reason: errJson.reason || `Verification rejected with HTTP ${res.status}`,
      };
    }

    return (await res.json()) as VerifyFaceResponse;
  } catch (err) {
    console.error("Live face verification error:", err);
    return {
      matched: false,
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
