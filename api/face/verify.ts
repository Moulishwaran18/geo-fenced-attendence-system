/**
 * Vercel Serverless Function: POST /api/face/verify
 *
 * Biometric Face Verification endpoint for CampusAttend.
 * Matches 512-D ArcFace descriptors against enrolled database in Supabase Cloud.
 */

const MATCH_THRESHOLD = 0.45;
const MIN_MATCH_MARGIN = 0.08;


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

  // DEVICE-ONLY PRIVACY ENFORCEMENT:
  // Cloud biometric vector verification is disabled. Biometric templates remain exclusively on-device.
  return sendJsonResponse(res, 200, {
    matched: false,
    finalResult: "UNKNOWN",
    reason: "Cloud biometric vector matching is disabled. Biometric matching is performed exclusively on-device via Android Keystore.",
    code: "CLOUD_BIOMETRICS_DISABLED",
    distance: 1.0,
    threshold: MATCH_THRESHOLD,
    margin: MIN_MATCH_MARGIN,
    searchedEmbeddingsCount: 0,
    telemetry: {
      mode: "DEVICE_LOCAL_ONLY",
      hardwareKeystore: true,
      message: "Biometrics remain strictly on staff member's Android device.",
    },
    reqTimestamp: new Date().toISOString(),
  });
}

