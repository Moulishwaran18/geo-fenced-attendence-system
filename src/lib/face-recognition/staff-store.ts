/**
 * Staff Profile Store — manages enrolled face profiles and multiple reference embeddings.
 *
 * Requirements:
 * - Exactly 3 authorized identities: PERSON_001, PERSON_002, PERSON_003.
 * - PERSON_001 maintains MULTIPLE reference embeddings across different angles & lighting.
 * - PERSON_002 and PERSON_003 are preserved and not overwritten.
 * - Closed-set: no PERSON_004, no guest users, no auto-enrolling unknown faces.
 */

import { FACE_CONFIG } from "./face-config";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ReferenceSample {
  id: string;
  photoUrl: string;
  embedding: number[]; // 128-float biometric descriptor
  confidence: number;
  createdAt: string;
}

export interface StaffProfile {
  /** Identity identifier: "PERSON_001", "PERSON_002", "PERSON_003". */
  id: string;
  /** Staff ID string, e.g. "STAFF-001". */
  staffId: string;
  /** Full name of the authorized staff member. */
  name: string;
  /** Array of reference samples / embeddings for this identity. */
  referenceSamples: ReferenceSample[];
  /** Legacy single-embedding array for backward compatibility. */
  embedding?: number[] | undefined;
  /** Registration timestamp ISO string. */
  registeredAt: string;
  /** Profile status. */
  status: "enrolled" | "pending" | "removed";
  /** Audit hash. */
  photoHash: string;
}

export interface MultiEmbeddingProfile {
  id: string;
  staffId: string;
  name: string;
  embeddings: Float32Array[];
}

const STORAGE_KEY = "campusattend_face_profiles_v2";
const LEGACY_STORAGE_KEY = "campusattend_face_profiles";

/* ------------------------------------------------------------------ */
/*  Internal Storage Helpers                                           */
/* ------------------------------------------------------------------ */

function readStore(): StaffProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as StaffProfile[];
    }

    // Migration from legacy v1 store if present
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Array<{
        id: string;
        name: string;
        embedding: number[];
        registeredAt: string;
        status: "enrolled" | "pending" | "removed";
        photoHash: string;
      }>;

      const migrated: StaffProfile[] = legacy.map((p) => ({
        id: p.id.startsWith("PERSON_") ? p.id : p.id === "STAFF-001" ? "PERSON_001" : p.id === "STAFF-002" ? "PERSON_002" : "PERSON_003",
        staffId: p.id.startsWith("STAFF-") ? p.id : `STAFF-${p.id.replace("PERSON_", "")}`,
        name: p.name,
        referenceSamples: [
          {
            id: `sample-${Date.now()}-1`,
            photoUrl: "/staff-photos/staff-1.jpg",
            embedding: p.embedding,
            confidence: 0.95,
            createdAt: p.registeredAt,
          },
        ],
        embedding: p.embedding,
        registeredAt: p.registeredAt,
        status: p.status,
        photoHash: p.photoHash,
      }));

      writeStore(migrated);
      return migrated;
    }

    return [];
  } catch {
    return [];
  }
}

function writeStore(profiles: StaffProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch (err) {
    console.error("Failed to persist staff profiles to localStorage:", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Public Query API                                                   */
/* ------------------------------------------------------------------ */

/** Get all currently active enrolled staff profiles. */
export function getEnrolledStaff(): StaffProfile[] {
  return readStore().filter((p) => p.status === "enrolled");
}

/** Get all profiles (including removed / pending). */
export function getAllProfiles(): StaffProfile[] {
  return readStore();
}

/** Retrieve an authorized staff profile by ID ("PERSON_001", "STAFF-001", etc.). */
export function getProfileById(id: string): StaffProfile | undefined {
  const normId = id.toUpperCase();
  return readStore().find(
    (p) => p.id.toUpperCase() === normId || p.staffId.toUpperCase() === normId,
  );
}

/** Check whether an identity is enrolled. */
export function isEnrolled(id: string): boolean {
  const p = getProfileById(id);
  return p !== undefined && p.status === "enrolled";
}

/** Get count of enrolled profiles. */
export function enrolledCount(): number {
  return getEnrolledStaff().length;
}

/* ------------------------------------------------------------------ */
/*  Enrollment & Multiple Sample Mutation API                          */
/* ------------------------------------------------------------------ */

/**
 * Enroll or update an authorized staff profile with an initial face embedding.
 */
export function enrollStaff(
  id: string,
  name: string,
  embedding: Float32Array,
  photoUrl: string = "/staff-photos/staff-1.jpg",
  confidence: number = 0.95,
  photoHash: string = "proto-hash",
): StaffProfile {
  const existing = readStore();

  // Normalize ID (e.g. "STAFF-001" -> "PERSON_001", "STAFF-002" -> "PERSON_002")
  const personId = id.startsWith("PERSON_")
    ? id
    : id === "STAFF-001"
      ? "PERSON_001"
      : id === "STAFF-002"
        ? "PERSON_002"
        : "PERSON_003";

  const staffId = id.startsWith("STAFF-")
    ? id
    : `STAFF-${personId.replace("PERSON_", "")}`;

  // Verify closed set: only PERSON_001, PERSON_002, PERSON_003 allowed
  const allowed = FACE_CONFIG.AUTHORIZED_IDENTITIES as readonly string[];
  if (!allowed.includes(personId)) {
    throw new Error(`Unauthorized identity: ${personId}. Only PERSON_001, PERSON_002, and PERSON_003 are permitted.`);
  }

  const newSample: ReferenceSample = {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    photoUrl,
    embedding: Array.from(embedding),
    confidence,
    createdAt: new Date().toISOString(),
  };

  const idx = existing.findIndex((p) => p.id === personId || p.staffId === staffId);

  if (idx >= 0 && existing[idx]) {
    const current = existing[idx]!;
    current.name = name;
    current.status = "enrolled";
    current.embedding = Array.from(embedding);

    // If sample already exists with same photoUrl, replace embedding, otherwise add
    const sampleIdx = current.referenceSamples.findIndex((s) => s.photoUrl === photoUrl);
    if (sampleIdx >= 0) {
      current.referenceSamples[sampleIdx] = newSample;
    } else {
      current.referenceSamples.push(newSample);
    }

    writeStore(existing);
    return current;
  }

  // Check 3-person closed set limit
  const activeCount = existing.filter((p) => p.status === "enrolled").length;
  if (activeCount >= FACE_CONFIG.MAX_STAFF_PROFILES) {
    throw new Error(`Maximum limit of ${FACE_CONFIG.MAX_STAFF_PROFILES} authorized staff profiles reached.`);
  }

  const newProfile: StaffProfile = {
    id: personId,
    staffId,
    name,
    referenceSamples: [newSample],
    embedding: Array.from(embedding),
    registeredAt: new Date().toISOString(),
    status: "enrolled",
    photoHash,
  };

  existing.push(newProfile);
  writeStore(existing);
  return newProfile;
}

/**
 * Add a reference embedding sample specifically to PERSON_001 (or another authorized identity).
 * This improves multi-angle and multi-lighting recognition without creating new identities.
 */
export function addReferenceEmbedding(
  personId: string,
  embedding: Float32Array,
  photoUrl: string,
  confidence: number = 0.95,
): ReferenceSample {
  const existing = readStore();
  const profile = existing.find(
    (p) => p.id.toUpperCase() === personId.toUpperCase() || p.staffId.toUpperCase() === personId.toUpperCase(),
  );

  if (!profile) {
    throw new Error(`Profile ${personId} not found. Please enroll the profile before adding reference samples.`);
  }

  const sample: ReferenceSample = {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    photoUrl,
    embedding: Array.from(embedding),
    confidence,
    createdAt: new Date().toISOString(),
  };

  const sampleIdx = profile.referenceSamples.findIndex((s) => s.photoUrl === photoUrl);
  if (sampleIdx >= 0) {
    profile.referenceSamples[sampleIdx] = sample;
  } else {
    profile.referenceSamples.push(sample);
  }

  // Keep latest embedding as primary
  profile.embedding = Array.from(embedding);
  profile.status = "enrolled";

  writeStore(existing);
  return sample;
}

/** Soft-delete an authorized staff profile. */
export function removeStaff(id: string): void {
  const existing = readStore();
  const idx = existing.findIndex(
    (p) => p.id.toUpperCase() === id.toUpperCase() || p.staffId.toUpperCase() === id.toUpperCase(),
  );
  if (idx >= 0 && existing[idx]) {
    existing[idx]!.status = "removed";
    writeStore(existing);
  }
}

/** Clear all stored biometric data. */
export function clearAllProfiles(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/* ------------------------------------------------------------------ */
/*  Multi-Embedding Matching Preparation                              */
/* ------------------------------------------------------------------ */

/**
 * Format enrolled staff profiles with all their reference sample embeddings as Float32Array.
 */
export function getEmbeddingsForMatching(): MultiEmbeddingProfile[] {
  return getEnrolledStaff().map((p) => {
    const embeddings: Float32Array[] = [];

    // Add all reference sample embeddings
    if (p.referenceSamples && p.referenceSamples.length > 0) {
      for (const sample of p.referenceSamples) {
        if (sample.embedding && sample.embedding.length === 128) {
          embeddings.push(new Float32Array(sample.embedding));
        }
      }
    }

    // Fallback to legacy single embedding if referenceSamples was empty
    if (embeddings.length === 0 && p.embedding && p.embedding.length === 128) {
      embeddings.push(new Float32Array(p.embedding));
    }

    return {
      id: p.id,
      staffId: p.staffId,
      name: p.name,
      embeddings,
    };
  });
}
