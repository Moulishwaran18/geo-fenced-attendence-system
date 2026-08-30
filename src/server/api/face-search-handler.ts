import fs from "fs";
import path from "path";
import { searchFaceEmbeddings } from "../db/client.ts";
import { runOfflineArcFaceOn112Image, cosineDistance } from "../biometrics/offline-arcface.ts";

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
      body.recognitionFrameId ||
      Math.floor(10000 + Math.random() * 90000);

    const verificationSessionId =
      body.verificationSessionId ||
      `VERIFY-FRAME-${recognitionFrameId}`;

    // 1. Validate 512-D ArcFace descriptor (w600k_mbf.onnx)
    if (!body.descriptor || !Array.isArray(body.descriptor) || body.descriptor.length !== 512) {
      console.warn(`[Backend Request] Rejected invalid descriptor. Frame: ${recognitionFrameId}`);
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
            databaseEmbeddingModel: "InsightFace MobileFaceNet + ArcFace",
            compatibility: "MISMATCH",
          },
        },
        400,
      );
    }

    const descriptorList = body.descriptor as number[];
    const backendFingerprint = computeVectorFingerprint(descriptorList);
    const embeddingNorm = Math.sqrt(descriptorList.reduce((s: number, v: number) => s + v * v, 0));

    // 2. Save Exact Frame Artifacts to disk for audit
    const debugFramesDir = path.resolve("public", "debug-frames", `frame-${recognitionFrameId}`);
    try {
      if (!fs.existsSync(debugFramesDir)) {
        fs.mkdirSync(debugFramesDir, { recursive: true });
      }

      if (body.rawFrameDataUrl) {
        const rawBuf = Buffer.from(body.rawFrameDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
        fs.writeFileSync(path.join(debugFramesDir, "original_camera_frame.jpg"), rawBuf);
      }

      if (body.aligned112DataUrl) {
        const alignedBuf = Buffer.from(body.aligned112DataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
        fs.writeFileSync(path.join(debugFramesDir, "aligned_112x112_image.jpg"), alignedBuf);
      }

      fs.writeFileSync(
        path.join(debugFramesDir, "metadata.json"),
        JSON.stringify(
          {
            recognitionFrameId,
            verificationSessionId,
            timestamp: reqTimestamp,
            confidence: body.confidence,
            faceBox: body.faceBox,
            landmarks5: body.landmarks5,
            tensorChecksum: body.tensorChecksum,
            embeddingChecksum: body.embeddingChecksum,
            embeddingNorm,
            fingerprint: backendFingerprint,
          },
          null,
          2,
        ),
      );
    } catch (saveErr) {
      console.warn("Notice: could not save frame debug artifacts:", saveErr);
    }

    // 3. Offline Re-Inference on the Exact Saved 112x112 Image in Node.js
    let offlineEmbeddingB: number[] | null = null;
    let liveVsOfflineDistance: number | null = null;
    let offlineMinDistance: number | null = null;

    if (body.aligned112DataUrl) {
      try {
        const offlineRes = await runOfflineArcFaceOn112Image(body.aligned112DataUrl);
        offlineEmbeddingB = offlineRes.embedding;
        liveVsOfflineDistance = cosineDistance(body.descriptor, offlineEmbeddingB);

        const offlineCandidates = await searchFaceEmbeddings(offlineEmbeddingB, 10);
        const p001Offline = offlineCandidates.filter((c) => c.staff_code === "PERSON_001");
        if (p001Offline.length > 0) {
          offlineMinDistance = Math.min(...p001Offline.map((c) => c.distance));
        }
      } catch (offErr) {
        console.warn("Offline re-inference notice:", offErr);
      }
    }

    // 4. Search ALL active staff embeddings in PostgreSQL pgvector (Cosine Distance <=> search)
    const candidates = await searchFaceEmbeddings(body.descriptor, 50);

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
      console.info(`[Backend Search] Frame: ${recognitionFrameId} | 0 active candidates in PostgreSQL.`);
      return jsonResponse({
        matched: false,
        finalResult: "UNKNOWN",
        recognitionFrameId,
        verificationSessionId,
        embeddingFingerprint: backendFingerprint,
        reason: "Unknown Face. No active staff records found in database.",
        reqTimestamp,
        telemetry: modelTelemetry,
      });
    }

    // 5. Extract Individual Distances for PERSON_001 Embeddings (P001-1 .. P001-5)
    const p001Candidates = candidates.filter((c) => c.staff_code === "PERSON_001");
    const p001Distances: Record<string, number> = {};
    p001Candidates.forEach((c, idx) => {
      p001Distances[`P001-${idx + 1}`] = parseFloat(c.distance.toFixed(6));
    });

    // 6. Person-Level Matching (Minimum distance per person across all their reference embeddings)
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

    // 7. Final Recognition Rule (Threshold <= 0.45 AND Margin >= 0.08)
    const isWithinThreshold = bestDistance <= MATCH_THRESHOLD;
    const hasAdequateMargin = matchMargin >= MIN_MATCH_MARGIN;
    const isMatched = isWithinThreshold && hasAdequateMargin;
    const finalResult = isMatched ? bestPerson.staffCode : "UNKNOWN";

    // 8. Root Cause Diagnosis Calculation
    let rootCause = "CASE_A_SUCCESS: Live embedding matches PERSON_001 in PostgreSQL pgvector (dist <= 0.45).";
    if (!isMatched) {
      if (body.doubleInferenceDist !== undefined && body.doubleInferenceDist > 0.001) {
        rootCause = "CASE_D_NON_DETERMINISTIC_MODEL: Double inference produced different embeddings on same tensor.";
      } else if (liveVsOfflineDistance !== null && liveVsOfflineDistance > 0.05 && offlineMinDistance !== null && offlineMinDistance <= MATCH_THRESHOLD) {
        rootCause = "CASE_B_INFERENCE_DIVERGENCE: Browser ONNX runtime output diverged from Node ONNX runtime.";
      } else {
        rootCause = "CASE_C_ALIGNED_INPUT_MISMATCH: The aligned 112x112 input image produced distance > 0.45 against database gallery.";
      }
    }

    // 9. Synchronized Console Frame Audit
    console.info(`\n================================================================================`);
    console.info(`[RECOGNITION FRAME ID: ${recognitionFrameId}] SYNCHRONIZED BIOMETRIC STAGE AUDIT`);
    console.info(`================================================================================`);
    console.info(`• Detection Frame:  ${recognitionFrameId} | Conf: ${( (body.confidence ?? 0.88) * 100).toFixed(1)}% | Box: [x:${body.faceBox?.x ?? "—"}, y:${body.faceBox?.y ?? "—"}, w:${body.faceBox?.width ?? "—"}, h:${body.faceBox?.height ?? "—"}]`);
    console.info(`• Landmark Frame:   ${recognitionFrameId} | 5 Canonical Points`);
    console.info(`• Crop Frame:       ${recognitionFrameId} | ${body.faceBox?.width ?? 0}x${body.faceBox?.height ?? 0}px`);
    console.info(`• Alignment Frame:  ${recognitionFrameId} | 112x112 Planar RGB | Tensor Checksum: ${body.tensorChecksum ?? "—"}`);
    console.info(`• ArcFace Frame:    ${recognitionFrameId} | 512-D | L2 Norm: ${embeddingNorm.toFixed(6)} | Checksum: ${body.embeddingChecksum ?? backendFingerprint}`);
    console.info(`• Double Inference: Distance(A, B) = ${body.doubleInferenceDist !== undefined ? body.doubleInferenceDist.toFixed(8) : "N/A"} (${body.doubleInferenceDist !== undefined && body.doubleInferenceDist < 0.0001 ? "PASS" : "FAIL"})`);
    console.info(`• Offline Re-Run:   Distance(Live A, Offline B) = ${liveVsOfflineDistance !== null ? liveVsOfflineDistance.toFixed(8) : "N/A"}`);
    console.info(`\nPostgreSQL pgvector Distance vs 5 PERSON_001 Reference Embeddings:`);
    console.info(`  P001-1: ${p001Distances["P001-1"]?.toFixed(6) ?? "N/A"}`);
    console.info(`  P001-2: ${p001Distances["P001-2"]?.toFixed(6) ?? "N/A"}`);
    console.info(`  P001-3: ${p001Distances["P001-3"]?.toFixed(6) ?? "N/A"}`);
    console.info(`  P001-4: ${p001Distances["P001-4"]?.toFixed(6) ?? "N/A"}`);
    console.info(`  P001-5: ${p001Distances["P001-5"]?.toFixed(6) ?? "N/A"}`);
    console.info(`• Minimum Distance: ${bestDistance.toFixed(6)} (Threshold <= ${MATCH_THRESHOLD}: ${isWithinThreshold ? "PASS" : "FAIL"})`);
    console.info(`• Separation Margin:${matchMargin.toFixed(6)} (Margin >= ${MIN_MATCH_MARGIN}: ${hasAdequateMargin ? "PASS" : "FAIL"})`);
    console.info(`• Final Decision:   ${finalResult}`);
    console.info(`• Root Cause:       ${rootCause}`);
    console.info(`================================================================================\n`);

    const deterministicAudit = {
      recognitionFrameId,
      detectorConfidence: body.confidence ?? 0.88,
      faceBox: body.faceBox ?? null,
      landmarks5: body.landmarks5 ?? null,
      tensorChecksum: body.tensorChecksum ?? "N/A",
      embeddingChecksum: body.embeddingChecksum ?? backendFingerprint,
      embeddingDimension: 512,
      embeddingNorm: parseFloat(embeddingNorm.toFixed(6)),
      doubleInferenceDist: body.doubleInferenceDist ?? 0,
      liveVsOfflineDistance: liveVsOfflineDistance !== null ? parseFloat(liveVsOfflineDistance.toFixed(8)) : null,
      offlineMinDistance: offlineMinDistance !== null ? parseFloat(offlineMinDistance.toFixed(6)) : null,
      p001Distances,
      p001_1: p001Distances["P001-1"] ?? null,
      p001_2: p001Distances["P001-2"] ?? null,
      p001_3: p001Distances["P001-3"] ?? null,
      p001_4: p001Distances["P001-4"] ?? null,
      p001_5: p001Distances["P001-5"] ?? null,
      bestDistance,
      minDistance: bestDistance,
      bestReference: p001Candidates[0] ? path.basename(p001Candidates[0].reference_image_path) : "N/A",
      threshold: MATCH_THRESHOLD,
      margin: MIN_MATCH_MARGIN,
      matchMargin,
      finalDecision: finalResult,
      rootCause,
    };

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
      deterministicAudit,
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

    // 10. Authorized Staff Confirmed
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
        telemetry: {
          recognitionModel: "w600k_mbf.onnx",
          modelFamily: "InsightFace MobileFaceNet + ArcFace",
          databaseEmbeddingModel: "InsightFace MobileFaceNet + ArcFace",
          compatibility: "ERROR",
        },
      },
      500,
    );
  }
}

