/**
 * Scalable Backend Face Verification & Vector Search Endpoint
 *
 * Endpoint:
 * - POST /api/face/verify
 *
 * Biometric Security:
 * - Direct vector similarity search on backend (using pgvector <-> L2 distance).
 * - Raw embeddings are NEVER exposed in response or transferred to client.
 * - Unknown faces are strictly rejected without creating or auto-enrolling records.
 */

import { searchFaceEmbeddings } from "../db/client";

const MATCH_THRESHOLD = 0.45;
const MIN_MATCH_MARGIN = 0.08;

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

  const auditId = `FACE-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  try {
    const body = (await request.json()) as {
      descriptor?: number[];
      livenessCompleted?: boolean;
      sessionNonce?: string;
    };

    // 1. Validate descriptor (ArcFace 512-D)
    if (!body.descriptor || !Array.isArray(body.descriptor) || body.descriptor.length !== 512) {
      return jsonResponse(
        {
          matched: false,
          reason: `Invalid face descriptor. Expected 512-dimensional float array. Received: ${body.descriptor?.length ?? 0}`,
          auditId,
        },
        400,
      );
    }

    // 2. Validate liveness challenge completion
    if (body.livenessCompleted !== true) {
      return jsonResponse(
        {
          matched: false,
          reason: "Live presence / blink verification not completed.",
          auditId,
        },
        403,
      );
    }

    // 3. Search authorized staff embeddings in database (pgvector Cosine Distance <=> search)
    const candidates = await searchFaceEmbeddings(body.descriptor, 10);

    if (candidates.length === 0) {
      return jsonResponse({
        matched: false,
        reason: "No active staff members found in database. Please enroll authorized staff.",
        auditId,
      });
    }

    const best = candidates[0]!;

    // Find second best candidate with a different staff_id for margin evaluation
    const secondBest = candidates.find((c) => c.staff_id !== best.staff_id);
    const matchMargin = secondBest ? secondBest.distance - best.distance : 1.0;

    // 4. Threshold & Closed-Set Evaluation
    const isWithinThreshold = best.distance <= MATCH_THRESHOLD;
    const hasAdequateMargin = matchMargin >= MIN_MATCH_MARGIN;

    const diagnosticPayload = {
      bestCandidate: {
        staffCode: best.staff_code,
        name: best.name,
        distance: best.distance,
      },
      secondBestCandidate: secondBest
        ? {
            staffCode: secondBest.staff_code,
            name: secondBest.name,
            distance: secondBest.distance,
          }
        : null,
      threshold: MATCH_THRESHOLD,
      margin: MIN_MATCH_MARGIN,
      matchMargin,
      distance: best.distance,
    };

    if (!isWithinThreshold || !hasAdequateMargin) {
      return jsonResponse({
        matched: false,
        reason: !isWithinThreshold
          ? "Face Not Recognized. Distance exceeds threshold (0.45)."
          : "Face match ambiguous. Distance separation margin below threshold (0.08).",
        ...diagnosticPayload,
        auditId,
      });
    }

    // 5. Authorized Staff Confirmed
    return jsonResponse({
      matched: true,
      staff: {
        id: best.staff_id,
        staffCode: best.staff_code,
        name: best.name,
      },
      ...diagnosticPayload,
      auditId,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Face verification API error:", err);
    return jsonResponse(
      {
        matched: false,
        reason: "Internal face verification error",
        auditId,
      },
      500,
    );
  }
}
