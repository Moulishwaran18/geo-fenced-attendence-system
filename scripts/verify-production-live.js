const BASE_URL = "https://geo-fenced-attendence-system.vercel.app";

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

async function runProductionVerification() {
  console.log("=================================================================");
  console.log("   CAMPUSATTEND LIVE VERCEL PRODUCTION VERIFICATION SUITE         ");
  console.log("   Target URL: " + BASE_URL);
  console.log("=================================================================\n");

  // --- 1. /api/face/verify ROUTE RESOLUTION (NO 404) ---
  console.log("--- 1. /api/face/verify ROUTE RESOLUTION & METHOD GATING ---");
  {
    const resGet = await fetch(`${BASE_URL}/api/face/verify`, { method: "GET" });
    assert(resGet.status === 405, `GET /api/face/verify returns HTTP 405 Method Not Allowed (got ${resGet.status}, not 404)`);

    const resMalformed = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptor: new Array(128).fill(0.1) })
    });
    assert(resMalformed.status === 400, `POST /api/face/verify invalid dimension rejected with HTTP 400 (got ${resMalformed.status})`);
  }

  // --- 2. STAFF DIRECTORY IN PRODUCTION ---
  console.log("\n--- 2. PRODUCTION STAFF DIRECTORY FETCH ---");
  {
    const resStaff = await fetch(`${BASE_URL}/api/admin/staff`, { method: "GET" });
    assert(resStaff.status === 200, `GET /api/admin/staff returns HTTP 200 OK (got ${resStaff.status})`);
    const staffData = await resStaff.json();
    assert(staffData.success === true && staffData.count === 5, `Confirmed 5 staff members in production database (count: ${staffData.count})`);
    const codes = staffData.data?.map(s => s.staff_code) || [];
    assert(codes.includes("PERSON_001") && codes.includes("SCT-2417"), `Production staff directory contains verified records: ${codes.join(", ")}`);
  }

  // --- 3. LIVE ENROLLMENT, PERSISTENCE & VERIFICATION ROUNDTRIP ---
  console.log("\n--- 3. LIVE ENROLLMENT, PERSISTENCE & VERIFICATION ROUNDTRIP ---");
  let testEmbeddingId = null;
  {
    // Generate valid 512-D L2-normalized synthetic vector for verification
    const testVector = new Float32Array(512);
    let norm = 0;
    for (let i = 0; i < 512; i++) {
      testVector[i] = Math.sin(i * 0.15) + Math.cos(i * 0.08);
      norm += testVector[i] * testVector[i];
    }
    norm = Math.sqrt(norm);
    const normalizedVector = Array.from(testVector).map(v => v / norm);

    // 3A: Enroll face via production endpoint
    const resEnroll = await fetch(`${BASE_URL}/api/admin/staff/PERSON_001/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedding: normalizedVector,
        referenceImagePath: "production_verification/test_vector.jpg"
      })
    });
    assert(resEnroll.status === 200, `POST /api/admin/staff/PERSON_001/enroll succeeds with HTTP 200 OK (got ${resEnroll.status})`);
    const enrollData = await resEnroll.json();
    assert(enrollData.success === true, "Enrollment confirms success: true");
    testEmbeddingId = enrollData.data?.id;
    assert(testEmbeddingId !== undefined, `Persisted template stored in Supabase Cloud with ID: ${testEmbeddingId}`);

    // 3B: Verify face recognition on production with matching enrolled face
    const resVerify = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descriptor: normalizedVector,
        verificationSessionId: "VERCEL-PROD-TEST-SESSION-001"
      })
    });
    assert(resVerify.status === 200, `POST /api/face/verify returns HTTP 200 OK (got ${resVerify.status})`);
    const verifyData = await resVerify.json();
    assert(verifyData.matched === true, "Verification successfully MATCHED enrolled face (matched: true)");
    assert(verifyData.finalResult === "PERSON_001", `Target identity correctly resolved (finalResult: ${verifyData.finalResult})`);
    assert(typeof verifyData.distance === "number" && verifyData.distance < 0.05, `Cosine distance is near zero (${verifyData.distance?.toFixed(6)})`);

    // 3C: Verify unknown face is rejected
    const orthogonalVector = new Float32Array(512);
    let oNorm = 0;
    for (let i = 0; i < 512; i++) {
      orthogonalVector[i] = (i % 2 === 0 ? 1 : -1) * (i + 1);
      oNorm += orthogonalVector[i] * orthogonalVector[i];
    }
    oNorm = Math.sqrt(oNorm);
    const normalizedOrthogonal = Array.from(orthogonalVector).map(v => v / oNorm);

    const resUnk = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descriptor: normalizedOrthogonal,
        verificationSessionId: "VERCEL-PROD-TEST-SESSION-UNKNOWN"
      })
    });
    assert(resUnk.status === 200, `Unknown face verification returns HTTP 200 OK (got ${resUnk.status})`);
    const unkData = await resUnk.json();
    assert(unkData.matched === false, "Unknown face is correctly REJECTED (matched: false)");
    assert(unkData.finalResult === "UNKNOWN", `Unknown face classified as UNKNOWN (finalResult: ${unkData.finalResult})`);

    // 3D: Teardown test embedding
    if (testEmbeddingId) {
      const resDel = await fetch(`${BASE_URL}/api/admin/staff/PERSON_001/embedding/${testEmbeddingId}`, {
        method: "DELETE"
      });
      assert(resDel.status === 200, `Cleaned up test embedding via DELETE (HTTP ${resDel.status})`);
    }
  }

  // --- 4. STATIC ARCFACE MODEL ASSET VERIFICATION ---
  {
    const modelUrl = `${BASE_URL}/models/w600k_mbf.onnx`;
    const resModel = await fetch(modelUrl, { method: "GET", headers: { Range: "bytes=0-1024" } });
    assert(resModel.status === 200 || resModel.status === 206, `ArcFace ONNX model asset loads with HTTP ${resModel.status} (${modelUrl})`);
    const buffer = await resModel.arrayBuffer();
    assert(buffer.byteLength > 0, `Model binary data streamed successfully (${buffer.byteLength} bytes received in sample)`);
  }

  console.log("\n=================================================================");
  console.log(`PRODUCTION TEST RESULTS: ${passCount} Passed, ${failCount} Failed`);
  console.log("=================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runProductionVerification().catch((err) => {
  console.error("Production verification failed:", err);
  process.exit(1);
});
