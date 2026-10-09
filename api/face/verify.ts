/**
 * Vercel Serverless Function: POST /api/face/verify
 *
 * Biometric Face Verification endpoint for CampusAttend.
 * Matches 512-D ArcFace descriptors against enrolled database in Supabase Cloud.
 */

import { createClient } from "@supabase/supabase-js";

const MATCH_THRESHOLD = 0.45;
const MIN_MATCH_MARGIN = 0.08;

function getSupabaseClient() {
  const url =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"])) ||
    "https://qvjcxoznvhoagclbyhad.supabase.co";
  const key =
    (typeof process !== "undefined" &&
      (process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
        process.env["SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_ANON_KEY"] ||
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])) ||
    "sb_publishable_S7pR3uyZmQkR9krOVueWfQ_W4dV1vo9";
  if (!url || !key) return null;
  return createClient(url, key);
}

function calculateCosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1.0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 1.0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, 1.0 - sim);
}

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (typeof res.status === "function") {
      const chained = res.status(status);
      if (chained && typeof chained.json === "function") {
        return chained.json(payload);
      }
    }
    if (typeof res.json === "function") {
      res.statusCode = status;
      return res.json(payload);
    }
    res.statusCode = status;
    if (typeof res.end === "function") {
      res.end(JSON.stringify(payload));
    }
    return;
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export default async function handler(req: any, res?: any) {
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    return sendJsonResponse(res, 204, {});
  }

  if (method !== "POST") {
    return sendJsonResponse(res, 405, { error: "Method not allowed. Use POST." });
  }

  let body: any = {};
  try {
    if (typeof req.json === "function") {
      body = await req.json();
    } else if (req.body) {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } else if (typeof req.on === "function") {
      const chunks: Buffer[] = [];
      await new Promise((resolve) => {
        req.on("data", (chunk: any) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        req.on("end", resolve);
        req.on("error", resolve);
      });
      const str = Buffer.concat(chunks).toString("utf-8");
      body = str ? JSON.parse(str) : {};
    }
  } catch {
    body = {};
  }

  const descriptor = body.descriptor || body.embedding;

  // 1. Validate descriptor
  if (!Array.isArray(descriptor) || descriptor.length !== 512) {
    return sendJsonResponse(res, 400, {
      matched: false,
      finalResult: "UNKNOWN",
      reason: `Descriptor dimension must be 512. Received ${Array.isArray(descriptor) ? descriptor.length : typeof descriptor}`,
    });
  }

  let norm = 0;
  for (let i = 0; i < 512; i++) {
    const v = descriptor[i];
    if (typeof v !== "number" || isNaN(v) || !isFinite(v)) {
      return sendJsonResponse(res, 400, {
        matched: false,
        finalResult: "UNKNOWN",
        reason: `Descriptor contains non-finite number at index ${i}`,
      });
    }
    norm += v * v;
  }
  norm = Math.sqrt(norm);

  if (norm < 0.70 || norm > 1.30) {
    return sendJsonResponse(res, 400, {
      matched: false,
      finalResult: "UNKNOWN",
      reason: `Descriptor is not properly normalized (L2 norm = ${norm.toFixed(4)}, expected ~1.0)`,
    });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJsonResponse(res, 500, {
      matched: false,
      finalResult: "UNKNOWN",
      reason: "Database configuration unavailable on server",
    });
  }

  try {
    let candidates: Array<{
      staffId: string;
      staffCode: string;
      name: string;
      distance: number;
    }> = [];

    // 2. Try Supabase pgvector RPC
    try {
      const { data: rpcRows, error: rpcErr } = await supabase.rpc("match_face_embeddings", {
        query_embedding: descriptor,
        match_threshold: 0.65,
        match_count: 5,
      });

      if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
        candidates = rpcRows.map((r: any) => ({
          staffId: r.staff_id,
          staffCode: r.staff_code,
          name: r.name,
          distance: parseFloat(r.distance),
        }));
      }
    } catch {
      // RPC fallback
    }

    // 3. Fallback: query active staff face embeddings directly
    if (candidates.length === 0) {
      const { data: embs, error: embErr } = await supabase
        .from("face_embeddings")
        .select(
          "id, staff_id, embedding, staff:staff_id(id, staff_code, name, active)",
        );

      if (!embErr && Array.isArray(embs) && embs.length > 0) {
        for (const f of embs) {
          const staffObj = Array.isArray(f.staff) ? f.staff[0] : f.staff;
          if (!staffObj || !staffObj.active) continue;
          let embVec: number[] = [];
          if (Array.isArray(f.embedding)) {
            embVec = f.embedding;
          } else if (typeof f.embedding === "string") {
            try {
              embVec = JSON.parse(f.embedding);
            } catch {}
          }
          if (embVec.length !== 512) continue;
          const dist = calculateCosineDistance(descriptor, embVec);
          candidates.push({
            staffId: staffObj.id,
            staffCode: staffObj.staff_code,
            name: staffObj.name,
            distance: dist,
          });
        }
        candidates.sort((a, b) => a.distance - b.distance);
      }
    }

    if (candidates.length === 0) {
      return sendJsonResponse(res, 200, {
        matched: false,
        finalResult: "UNKNOWN",
        reason: "No registered face templates found in database.",
        distance: 1.0,
        threshold: MATCH_THRESHOLD,
        margin: MIN_MATCH_MARGIN,
        searchedEmbeddingsCount: 0,
        telemetry: {
          recognitionModel: "w600k_mbf.onnx",
          modelFamily: "InsightFace MobileFaceNet + ArcFace",
          compatibility: "MATCH",
        },
        engine: "InsightFace MobileFaceNet + ArcFace (w600k_mbf.onnx)",
        reqTimestamp: new Date().toISOString(),
      });
    }

    // 4. Group by individual staff member (find minimum distance per person)
    const personMap = new Map<string, {
      staffId: string;
      staffCode: string;
      name: string;
      minDistance: number;
      embeddingCount: number;
    }>();

    for (const c of candidates) {
      const key = c.staffCode;
      const existing = personMap.get(key);
      if (!existing || c.distance < existing.minDistance) {
        personMap.set(key, {
          staffId: c.staffId,
          staffCode: c.staffCode,
          name: c.name,
          minDistance: c.distance,
          embeddingCount: (existing?.embeddingCount || 0) + 1,
        });
      } else {
        existing.embeddingCount++;
      }
    }

    const personDistances = Array.from(personMap.values()).sort(
      (a, b) => a.minDistance - b.minDistance,
    );

    const bestPerson = personDistances[0]!;
    const secondBestPerson = personDistances.length > 1 ? personDistances[1]! : null;

    const bestDistance = bestPerson.minDistance;
    const secondBestDistance = secondBestPerson ? secondBestPerson.minDistance : 1.0;
    const matchMargin = secondBestDistance - bestDistance;

    const isWithinThreshold = bestDistance <= MATCH_THRESHOLD;
    const hasAdequateMargin = secondBestPerson ? matchMargin >= MIN_MATCH_MARGIN : true;
    const isMatched = isWithinThreshold && hasAdequateMargin;
    const finalResult = isMatched ? bestPerson.staffCode : "UNKNOWN";

    const diagnosticPayload = {
      verificationSessionId: body.verificationSessionId,
      recognitionFrameId: body.recognitionFrameId,
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
      personDistances: personDistances.map((p) => ({
        staffCode: p.staffCode,
        name: p.name,
        minDistance: p.minDistance,
        embeddingCount: p.embeddingCount,
      })),
      telemetry: {
        recognitionModel: "w600k_mbf.onnx",
        modelFamily: "InsightFace MobileFaceNet + ArcFace",
        databaseEmbeddingModel: "InsightFace MobileFaceNet + ArcFace",
        compatibility: "MATCH",
        engine: "InsightFace MobileFaceNet + ArcFace (w600k_mbf.onnx)",
      },
      engine: "InsightFace MobileFaceNet + ArcFace (w600k_mbf.onnx)",
    };

    if (!isMatched) {
      return sendJsonResponse(res, 200, {
        matched: false,
        reason: !isWithinThreshold
          ? `Unknown Face. Best distance (${bestDistance.toFixed(4)}) exceeds threshold (${MATCH_THRESHOLD}).`
          : `Match ambiguous. Separation margin (${matchMargin.toFixed(4)}) below required margin (${MIN_MATCH_MARGIN}).`,
        ...diagnosticPayload,
        reqTimestamp: new Date().toISOString(),
      });
    }

    return sendJsonResponse(res, 200, {
      matched: true,
      authenticated: true,
      user_id: bestPerson.staffId,
      name: bestPerson.name,
      staff: {
        id: bestPerson.staffId,
        staffCode: bestPerson.staffCode,
        name: bestPerson.name,
      },
      ...diagnosticPayload,
      reqTimestamp: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Face verification API error:", err?.message || err);
    return sendJsonResponse(res, 500, {
      matched: false,
      finalResult: "UNKNOWN",
      reason: "Internal face verification error",
      details: err?.message || String(err),
      reqTimestamp: new Date().toISOString(),
    });
  }
}
