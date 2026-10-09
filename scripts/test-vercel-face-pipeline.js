import faceVerifyHandler from "../api/face/verify.ts";
import staffHandler from "../api/admin/staff/index.ts";
import { getStaffById, getDatabaseDiagnostics, storeFaceEmbedding, deleteFaceEmbedding, searchFaceEmbeddings } from "../src/server/db/client.ts";

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(d) {
      this.data = d;
      return this;
    },
    end(d) {
      if (d && !this.data) {
        try {
          this.data = JSON.parse(d);
        } catch {
          this.data = d;
        }
      }
      return this;
    }
  };
  return res;
}

async function testVercelEndpoints() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND VERCEL FACE RECOGNITION & ENROLLMENT TEST SUITE   ");
  console.log("=================================================================");

  // --- 1. /api/face/verify METHOD & MALFORMED PAYLOAD TESTS ---
  console.log("\n--- 1. /api/face/verify INPUT & PROTOCOL VALIDATION ---");
  {
    // 1A: GET method should be rejected with 405
    const resA = createMockRes();
    await faceVerifyHandler({ method: "GET" }, resA);
    assert(resA.statusCode === 405, `GET /api/face/verify rejected with HTTP 405 (got ${resA.statusCode})`);

    // 1B: Empty body rejected with 400
    const resB = createMockRes();
    await faceVerifyHandler({ method: "POST", body: {} }, resB);
    assert(resB.statusCode === 400, `Missing descriptor rejected with HTTP 400 (got ${resB.statusCode})`);

    // 1C: Wrong dimension (e.g. 128 instead of 512)
    const resC = createMockRes();
    await faceVerifyHandler({ method: "POST", body: { descriptor: new Array(128).fill(0.1) } }, resC);
    assert(resC.statusCode === 400, `Non-512 dimension rejected with HTTP 400 (got ${resC.statusCode})`);

    // 1D: Array with NaN or non-finite values
    const nanVector = new Array(512).fill(1 / Math.sqrt(512));
    nanVector[10] = NaN;
    const resD = createMockRes();
    await faceVerifyHandler({ method: "POST", body: { descriptor: nanVector } }, resD);
    assert(resD.statusCode === 400, `Descriptor containing NaN rejected with HTTP 400 (got ${resD.statusCode})`);

    // 1E: Completely unnormalized vector (norm = 100)
    const largeVector = new Array(512).fill(100);
    const resE = createMockRes();
    await faceVerifyHandler({ method: "POST", body: { descriptor: largeVector } }, resE);
    assert(resE.statusCode === 400, `Unnormalized descriptor rejected with HTTP 400 (got ${resE.statusCode})`);
  }

  // --- 2. /api/admin/staff ENDPOINT TESTS ---
  console.log("\n--- 2. /api/admin/staff DIRECTORY & METADATA TESTS ---");
  {
    // 2A: List all staff
    const resStaff = createMockRes();
    await staffHandler({ method: "GET", url: "/api/admin/staff" }, resStaff);
    assert(resStaff.statusCode === 200, `GET /api/admin/staff returns HTTP 200 (got ${resStaff.statusCode})`);
    assert(resStaff.data && Array.isArray(resStaff.data.data) && resStaff.data.data.length >= 3, `Returned staff directory (${resStaff.data?.data?.length} records found)`);

    // Verify raw embeddings are NEVER exposed in staff list
    if (resStaff.data && Array.isArray(resStaff.data.data)) {
      const hasExposedVectors = resStaff.data.data.some(s => s.referenceSamples && s.referenceSamples.some(r => r.embedding && r.embedding.length > 0));
      assert(!hasExposedVectors, "Raw biometric embeddings are strictly omitted from staff directory response");
    }

    // 2B: Single staff query for PERSON_001
    const resSingle = createMockRes();
    await staffHandler(
      { method: "GET", url: "/api/admin/staff/PERSON_001", query: { slug: ["staff", "PERSON_001"] } },
      resSingle
    );
    assert(resSingle.statusCode === 200, `GET /api/admin/staff/PERSON_001 returns HTTP 200 (got ${resSingle.statusCode})`);
    assert(resSingle.data?.data?.staff_code === "PERSON_001", `Resolved correct staff member (${resSingle.data?.data?.name})`);

    // 2C: Nonexistent staff returns 404
    const resUnknown = createMockRes();
    await staffHandler(
      { method: "GET", url: "/api/admin/staff/UNKNOWN_999", query: { slug: ["staff", "UNKNOWN_999"] } },
      resUnknown
    );
    assert(resUnknown.statusCode === 404, `Nonexistent staff query returns HTTP 404 (got ${resUnknown.statusCode})`);
  }

  // --- 3. LIVE ENROLLMENT & DATABASE MATCHING ROUNDTRIP ---
  console.log("\n--- 3. LIVE BIOMETRIC ENROLLMENT, PERSISTENCE & MATCHING ROUNDTRIP ---");
  {
    // Generate valid 512-D L2-normalized synthetic test vector
    const testVector = new Float32Array(512);
    let norm = 0;
    for (let i = 0; i < 512; i++) {
      testVector[i] = Math.sin(i * 0.1) + Math.cos(i * 0.05);
      norm += testVector[i] * testVector[i];
    }
    norm = Math.sqrt(norm);
    const normalizedVector = Array.from(testVector).map(v => v / norm);

    // 3A: Enroll test vector for PERSON_001 via /api/admin/staff/PERSON_001/enroll
    const resEnroll = createMockRes();
    await staffHandler(
      {
        method: "POST",
        url: "/api/admin/staff/PERSON_001/enroll",
        query: { slug: ["staff", "PERSON_001", "enroll"] },
        body: {
          embedding: normalizedVector,
          referenceImagePath: "test/temp_verified_test.jpg"
        }
      },
      resEnroll
    );
    assert(resEnroll.statusCode === 200, `POST /api/admin/staff/PERSON_001/enroll succeeds (got ${resEnroll.statusCode})`);
    assert(resEnroll.data?.success === true, "Enrollment response confirms success");
    const embeddingId = resEnroll.data?.data?.id;
    assert(embeddingId !== undefined, `Template stored in Supabase with ID: ${embeddingId}`);

    // 3B: Verify live matching with the exact enrolled vector via /api/face/verify
    const resVerify = createMockRes();
    await faceVerifyHandler(
      {
        method: "POST",
        body: {
          descriptor: normalizedVector,
          livenessCompleted: true,
          recognitionFrameId: 99999
        }
      },
      resVerify
    );
    assert(resVerify.statusCode === 200, `POST /api/face/verify returns HTTP 200 (got ${resVerify.statusCode})`);
    assert(resVerify.data?.matched === true, "Verification successfully MATCHED enrolled face");
    assert(resVerify.data?.finalResult === "PERSON_001", `Correctly identified target identity (expected PERSON_001, got ${resVerify.data?.finalResult})`);
    assert(typeof resVerify.data?.distance === "number" && resVerify.data.distance < 0.05, `Cosine distance is near 0.0 (${resVerify.data?.distance?.toFixed(6)})`);

    // 3C: Test an orthogonal/unknown face vector against the database
    const orthogonalVector = new Float32Array(512);
    let oNorm = 0;
    for (let i = 0; i < 512; i++) {
      orthogonalVector[i] = (i % 2 === 0 ? 1 : -1) * (i + 1);
      oNorm += orthogonalVector[i] * orthogonalVector[i];
    }
    oNorm = Math.sqrt(oNorm);
    const normalizedOrthogonal = Array.from(orthogonalVector).map(v => v / oNorm);

    const resUnk = createMockRes();
    await faceVerifyHandler(
      {
        method: "POST",
        body: {
          descriptor: normalizedOrthogonal,
          livenessCompleted: true
        }
      },
      resUnk
    );
    assert(resUnk.statusCode === 200, `Unknown face verification returns HTTP 200 (got ${resUnk.statusCode})`);
    assert(resUnk.data?.matched === false, "Unknown face is correctly REJECTED (matched: false)");
    assert(resUnk.data?.finalResult === "UNKNOWN", `Result classified as UNKNOWN (got ${resUnk.data?.finalResult})`);

    // 3D: Clean up the enrolled test vector cleanly
    if (embeddingId) {
      const resDel = createMockRes();
      await staffHandler(
        {
          method: "DELETE",
          url: `/api/admin/staff/PERSON_001/embedding/${embeddingId}`,
          query: { slug: ["staff", "PERSON_001", "embedding", embeddingId] }
        },
        resDel
      );
      assert(resDel.statusCode === 200, `Cleaned up temporary test embedding (${embeddingId})`);
    }
  }

  // --- 4. PRIVACY & SECURITY GATING TESTS ---
  console.log("\n--- 4. ZERO CLIENT TRUST & BIOMETRIC PRIVACY AUDIT ---");
  {
    // Client-supplied booleans (faceVerified: true, livenessPassed: true) without matching descriptor must fail
    const dummyRand = new Array(512).fill(1 / Math.sqrt(512));
    const resSpoof = createMockRes();
    await faceVerifyHandler(
      {
        method: "POST",
        body: {
          descriptor: dummyRand,
          faceVerified: true,
          livenessPassed: true,
          recognizedStaffCode: "PERSON_001"
        }
      },
      resSpoof
    );
    assert(resSpoof.data?.matched === false, "Attacker-supplied faceVerified: true claim is IGNORED by server");
  }

  console.log("\n=================================================================");
  console.log(`TEST SUITE RESULTS: ${passCount} Passed, ${failCount} Failed`);
  console.log("=================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

testVercelEndpoints().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
