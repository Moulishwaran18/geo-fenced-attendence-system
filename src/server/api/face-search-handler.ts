import { searchFaceEmbeddings } from "../db/client.ts";
import { recordFaceDetectionLog } from "../db/audit-log.ts";

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

function sendJsonResponse(res: any, status: number, payload: any) {
  if (res && typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json");
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
  return jsonResponse(payload, status);
}

export async function handleFaceVerifyApi(request: Request): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const reqTimestamp = new Date().toISOString();

  try {
    let body: any;
    try {
      body = await request.json();
    } catch (parseErr) {
      console.warn("[FaceVerifyApi] Failed to parse request JSON:", parseErr);
      return jsonResponse(
        {
          matched: false,
          finalResult: "UNKNOWN",
          reason: "Malformed request payload",
          reqTimestamp,
        },
        400,
      );
    }

    const recognitionFrameId =
      body.recognitionFrameId || Math.floor(10000 + Math.random() * 90000);

    const verificationSessionId =
      body.verificationSessionId || `VERIFY-FRAME-${recognitionFrameId}`;

    // 1. Validate 512-D ArcFace descriptor (w600k_mbf.onnx)
    if (!body.descriptor || !Array.isArray(body.descriptor) || body.descriptor.length !== 512) {
      return jsonResponse(
        {
          matched: false,
          finalResult: "UNKNOWN",
          verificationSessionId,
          recognitionFrameId,
          reason: `Invalid face descriptor. Expected 512-dimensional ArcFace (w600k_mbf.onnx) float array. Received: ${body.descriptor?.length ?? 0}`,
          reqTimestamp,
          telemetry: {
            recognitionModel: "w600k_mbf.onnx",
            modelFamily: "InsightFace MobileFaceNet + ArcFace",
            embeddingDimension: body.descriptor?.length ?? 0,
            compatibility: "MISMATCH",
          },
        },
        400,
      );
    }

    const descriptorList = body.descriptor as number[];
    for (let i = 0; i < descriptorList.length; i++) {
      const v = descriptorList[i];
      if (typeof v !== "number" || isNaN(v) || !isFinite(v)) {
        return jsonResponse(
          {
            matched: false,
            finalResult: "UNKNOWN",
            reason: `Invalid face descriptor. Contains non-finite value at index ${i}.`,
            reqTimestamp,
          },
          400,
        );
      }
    }

    const embeddingNorm = Math.sqrt(
      descriptorList.reduce((s: number, v: number) => s + v * v, 0),
    );
    if (embeddingNorm < 0.7 || embeddingNorm > 1.3) {
      return jsonResponse(
        {
          matched: false,
          finalResult: "UNKNOWN",
          reason: `Invalid face descriptor normalization. Expected L2 norm near 1.0, got ${embeddingNorm.toFixed(4)}.`,
          reqTimestamp,
        },
        400,
      );
    }

    const backendFingerprint = computeVectorFingerprint(descriptorList);

    // 2. Search active staff embeddings in database (PostgreSQL pgvector / Supabase)
    const candidates = await searchFaceEmbeddings(descriptorList, 50);

    const modelTelemetry = {
      recognitionModel: "w600k_mbf.onnx",
      modelFamily: "InsightFace MobileFaceNet + ArcFace",
      embeddingDimension: 512,
      embeddingNorm: parseFloat(embeddingNorm.toFixed(6)),
      databaseEmbeddingModel: "InsightFace MobileFaceNet + ArcFace",
      compatibility: "MATCH",
      engine: "InsightFace MobileFaceNet + ArcFace (w600k_mbf.onnx)",
    };

    if (candidates.length === 0) {
      return jsonResponse({
        matched: false,
        finalResult: "UNKNOWN",
        recognitionFrameId,
        verificationSessionId,
        embeddingFingerprint: backendFingerprint,
        reason: "Unknown Face. No active enrolled staff records found in database.",
        reqTimestamp,
        telemetry: modelTelemetry,
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
    const hasAdequateMargin = secondBestPerson ? matchMargin >= MIN_MATCH_MARGIN : true;
    const isMatched = isWithinThreshold && hasAdequateMargin;
    const finalResult = isMatched ? bestPerson.staffCode : "UNKNOWN";

    const diagnosticPayload = {
      verificationSessionId,
      recognitionFrameId,
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
      personDistances: personDistances.map((p) => ({
        staffCode: p.staffCode,
        name: p.name,
        minDistance: p.minDistance,
        embeddingCount: p.embeddingCount,
      })),
      telemetry: modelTelemetry,
      engine: modelTelemetry.engine,
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

    // 5. Authorized Staff Confirmed: non-blocking audit logging
    let auditLogInfo = { logged: false, duplicateSuppressed: false };
    try {
      const logRes = await recordFaceDetectionLog({
        userId: bestPerson.staffCode,
        name: bestPerson.name,
      });
      auditLogInfo = {
        logged: logRes.logged,
        duplicateSuppressed: logRes.duplicateSuppressed,
      };
    } catch {
      // Non-blocking
    }

    return jsonResponse({
      matched: true,
      authenticated: true,
      liveness_verified: body.livenessCompleted !== false,
      user_id: bestPerson.staffId,
      name: bestPerson.name,
      staff: {
        id: bestPerson.staffId,
        staffCode: bestPerson.staffCode,
        name: bestPerson.name,
      },
      auditLog: auditLogInfo,
      ...diagnosticPayload,
      reqTimestamp,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Face verification API error:", err?.message || err);
    return jsonResponse(
      {
        matched: false,
        finalResult: "UNKNOWN",
        reason: "Internal face verification error",
        reqTimestamp,
        telemetry: {
          recognitionModel: "w600k_mbf.onnx",
          compatibility: "ERROR",
        },
      },
      500,
    );
  }
}

/**
 * Universal Vercel / Node Serverless Function Handler
 */
export default async function handler(req: any, res?: any) {
  if (req.method?.toUpperCase() !== "POST") {
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

  const reqObj = new Request("https://localhost/api/face/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const webRes = await handleFaceVerifyApi(reqObj);
  const data = await webRes.json();
  return sendJsonResponse(res, webRes.status, data);
}
