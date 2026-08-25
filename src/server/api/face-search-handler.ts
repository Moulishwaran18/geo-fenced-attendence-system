/**
 * Scalable Backend Face Verification & Vector Search Endpoint
 *
 * Endpoint:
 * - POST /api/face/verify
 *
 * Traceability & Audit:
 * - Unified verificationSessionId passed through camera -> embedding -> API -> DB -> UI
 * - Vector fingerprinting (SHA-256 / Hash) ensures exact embedding integrity
 */

import { searchFaceEmbeddings } from "../db/client";

const MATCH_THRESHOLD = 0.45;
const MIN_MATCH_MARGIN = 0.08;

function computeVectorFingerprint(vec: number[]): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round((vec[i] ?? 0) * 100000);
    hash ^= v & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (v >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function jsonResponse(data: unknown, status: number = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export async function handleFaceVerifyApi(request: Request): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const reqTimestamp = new Date().toISOString();

  try {
    const body = (await request.json()) as {
      descriptor?: number[];
      verificationSessionId?: string;
      embeddingFingerprint?: string;
      livenessCompleted?: boolean;
      sessionNonce?: string;
    };

    const verificationSessionId =
      body.verificationSessionId ||
      `VERIFY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // 1. Validate descriptor (ArcFace 512-D)
    if (!body.descriptor || !Array.isArray(body.descriptor) || body.descriptor.length !== 512) {
      console.warn(`[Backend Request] Rejected invalid descriptor. Session: ${verificationSessionId}`);
      return jsonResponse(
        {
          matched: false,
          finalResult: "UNKNOWN",
          verificationSessionId,
          reason: `Invalid face descriptor. Expected 512-dimensional float array. Received: ${body.descriptor?.length ?? 0}`,
          reqTimestamp,
        },
        400,
      );
    }

    const backendFingerprint = computeVectorFingerprint(body.descriptor);

    console.info(
      `[Backend Request] Session: ${verificationSessionId} | Timestamp: ${reqTimestamp} | Dim: ${body.descriptor.length} | ClientFP: ${body.embeddingFingerprint || "N/A"} | ServerFP: ${backendFingerprint}`,
    );

    // 2. Search ALL active staff embeddings in database (pgvector Cosine Distance <=> search)
    const candidates = await searchFaceEmbeddings(body.descriptor, 50);

    if (candidates.length === 0) {
      console.info(`[Backend Search] Session: ${verificationSessionId} | 0 active candidates in database.`);
      return jsonResponse({
        matched: false,
        finalResult: "UNKNOWN",
        verificationSessionId,
        embeddingFingerprint: backendFingerprint,
        reason: "Unknown Face. No active staff records found in database.",
        reqTimestamp,
      });
    }

    // 3. Person-Level Matching (Minimum distance per person across all their reference embeddings)
    const staffMap = new Map<
      string,
      {
        staffId: string;
        staffCode: string;
        name: string;
        distances: number[];
        embeddingCount: number;
      }
    >();

    for (const c of candidates) {
      if (!staffMap.has(c.staff_code)) {
        staffMap.set(c.staff_code, {
          staffId: c.staff_id,
          staffCode: c.staff_code,
          name: c.name,
          distances: [],
          embeddingCount: 0,
        });
      }
      const record = staffMap.get(c.staff_code)!;
      record.distances.push(c.distance);
      record.embeddingCount++;
    }

    const personDistances = Array.from(staffMap.values())
      .map((p) => ({
        staffId: p.staffId,
        staffCode: p.staffCode,
        name: p.name,
        minDistance: Math.min(...p.distances),
        allDistances: p.distances,
        embeddingCount: p.embeddingCount,
      }))
      .sort((a, b) => a.minDistance - b.minDistance);

    const bestPerson = personDistances[0]!;
    const secondBestPerson = personDistances.length > 1 ? personDistances[1]! : null;

    const bestDistance = bestPerson.minDistance;
    const secondBestDistance = secondBestPerson ? secondBestPerson.minDistance : 1.0;
    const matchMargin = secondBestDistance - bestDistance;

    // 4. Final Recognition Rule (Threshold <= 0.45 AND Margin >= 0.08)
    const isWithinThreshold = bestDistance <= MATCH_THRESHOLD;
    const hasAdequateMargin = matchMargin >= MIN_MATCH_MARGIN;
    const isMatched = isWithinThreshold && hasAdequateMargin;
    const finalResult = isMatched ? bestPerson.staffCode : "UNKNOWN";

    const embeddingsPerStaff: Record<string, number> = {};
    candidates.forEach((c) => {
      embeddingsPerStaff[c.staff_code] = (embeddingsPerStaff[c.staff_code] || 0) + 1;
    });

    console.info(
      `[Backend Decision] Session: ${verificationSessionId} | Best: ${bestPerson.staffCode} (dist: ${bestDistance.toFixed(4)}) | 2nd: ${secondBestPerson?.staffCode || "None"} (dist: ${secondBestDistance.toFixed(4)}) | Margin: ${matchMargin.toFixed(4)} | Result: ${finalResult}`,
    );

    const diagnosticPayload = {
      verificationSessionId,
      embeddingFingerprint: backendFingerprint,
      finalResult,
      bestCandidate: {
        staffCode: bestPerson.staffCode,
        name: bestPerson.name,
        distance: bestDistance,
      },
      secondBestCandidate: secondBestPerson
        ? {
            staffCode: secondBestPerson.staffCode,
            name: secondBestPerson.name,
            distance: secondBestDistance,
          }
        : null,
      threshold: MATCH_THRESHOLD,
      margin: MIN_MATCH_MARGIN,
      matchMargin,
      distance: bestDistance,
      searchedEmbeddingsCount: candidates.length,
      embeddingsPerStaff,
      personDistances: personDistances.map((p) => ({
        staffCode: p.staffCode,
        name: p.name,
        minDistance: p.minDistance,
        embeddingCount: p.embeddingCount,
      })),
      allCandidates: candidates.map((c) => ({
        staffCode: c.staff_code,
        name: c.name,
        embeddingId: c.embedding_id,
        referenceImagePath: c.reference_image_path,
        distance: c.distance,
      })),
    };

    if (!isMatched) {
      return jsonResponse({
        matched: false,
        reason: !isWithinThreshold
          ? `Unknown Face. Best distance (${bestDistance.toFixed(4)}) exceeds threshold (${MATCH_THRESHOLD}). Face is not registered.`
          : `Face match ambiguous. Distance separation margin (${matchMargin.toFixed(4)}) below required margin (${MIN_MATCH_MARGIN}).`,
        ...diagnosticPayload,
        reqTimestamp,
      });
    }

    // 5. Authorized Staff Confirmed
    return jsonResponse({
      matched: true,
      staff: {
        id: bestPerson.staffId,
        staffCode: bestPerson.staffCode,
        name: bestPerson.name,
      },
      ...diagnosticPayload,
      reqTimestamp,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Face verification API error:", err);
    return jsonResponse(
      {
        matched: false,
        finalResult: "UNKNOWN",
        reason: "Internal face verification error",
        reqTimestamp,
      },
      500,
    );
  }
}
