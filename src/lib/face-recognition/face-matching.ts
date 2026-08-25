/**
 * Module: faceMatching
 *
 * Direct, high-speed face matching engine comparing live face embeddings
 * against enrolled authorized staff profiles (PERSON_001, PERSON_002, PERSON_003).
 */

import * as faceapi from "face-api.js";
import { FACE_CONFIG } from "./face-config";
import type { MultiEmbeddingProfile } from "./staff-store";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface IdentityMatchEvaluation {
  id: string;
  staffId: string;
  name: string;
  bestDistance: number;
  bestSampleIndex: number;
  sampleDistances: number[];
  isWithinThreshold: boolean;
}

export interface MatchResult {
  id: string;
  staffId: string;
  staffName: string;
  distance: number;
  sampleIndex: number;
  secondBestDistance: number | null;
  secondBestStaffName: string | null;
  matchMargin: number | null;
  matched: boolean;
  evaluations: IdentityMatchEvaluation[];
}

/* ------------------------------------------------------------------ */
/*  Matching Functions                                                 */
/* ------------------------------------------------------------------ */

/**
 * Compare live face descriptor against all reference embeddings of enrolled profiles.
 */
export function evaluateAllIdentities(
  liveDescriptor: Float32Array,
  profiles: MultiEmbeddingProfile[],
): IdentityMatchEvaluation[] {
  const liveArray = Array.from(liveDescriptor);

  return profiles
    .map((profile) => {
      if (!profile.embeddings || profile.embeddings.length === 0) {
        return {
          id: profile.id,
          staffId: profile.staffId,
          name: profile.name,
          bestDistance: 999,
          bestSampleIndex: -1,
          sampleDistances: [],
          isWithinThreshold: false,
        };
      }

      const sampleDistances: number[] = [];
      let minDistance = 999;
      let minIndex = 0;

      profile.embeddings.forEach((emb: Float32Array | number[], idx: number) => {
        const dist = faceapi.euclideanDistance(liveArray, Array.from(emb));
        sampleDistances.push(dist);
        if (dist < minDistance) {
          minDistance = dist;
          minIndex = idx;
        }
      });

      return {
        id: profile.id,
        staffId: profile.staffId,
        name: profile.name,
        bestDistance: minDistance,
        bestSampleIndex: minIndex,
        sampleDistances,
        isWithinThreshold: minDistance < FACE_CONFIG.FACE_MATCH_THRESHOLD,
      };
    })
    .sort((a, b) => a.bestDistance - b.bestDistance);
}

/**
 * Find the best matching identity with clean, frictionless matching.
 */
export function findBestMatch(
  liveDescriptor: Float32Array,
  profiles: MultiEmbeddingProfile[],
): MatchResult | null {
  if (profiles.length === 0) return null;

  const evaluations = evaluateAllIdentities(liveDescriptor, profiles);
  const best = evaluations[0];
  if (!best || best.bestDistance === 999) return null;

  const secondBest = evaluations.length > 1 ? evaluations[1] : undefined;
  const secondBestDistance = secondBest ? secondBest.bestDistance : null;
  const secondBestStaffName = secondBest ? secondBest.name : null;

  const matchMargin =
    secondBestDistance !== null && secondBestDistance !== 999
      ? secondBestDistance - best.bestDistance
      : null;

  const isMatched = best.bestDistance < FACE_CONFIG.FACE_MATCH_THRESHOLD;

  return {
    id: best.id,
    staffId: best.staffId,
    staffName: best.name,
    distance: best.bestDistance,
    sampleIndex: best.bestSampleIndex,
    secondBestDistance,
    secondBestStaffName,
    matchMargin,
    matched: isMatched,
    evaluations,
  };
}

/**
 * Compatibility wrapper.
 */
export function compareFaces(
  liveDescriptor: Float32Array,
  profiles: MultiEmbeddingProfile[],
): MatchResult[] {
  const evaluations = evaluateAllIdentities(liveDescriptor, profiles);
  return evaluations.map((e) => ({
    id: e.id,
    staffId: e.staffId,
    staffName: e.name,
    distance: e.bestDistance,
    sampleIndex: e.bestSampleIndex,
    secondBestDistance: null,
    secondBestStaffName: null,
    matchMargin: null,
    matched: e.isWithinThreshold,
    evaluations,
  }));
}
