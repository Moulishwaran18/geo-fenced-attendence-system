import fs from "fs";

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

  // --- 2. STAFF DIRECTORY & ENROLLED TEMPLATE METADATA ---
  console.log("\n--- 2. PRODUCTION STAFF DIRECTORY & TEMPLATE PERSISTENCE ---");
  let p1Staff = null;
  {
    const resStaff = await fetch(`${BASE_URL}/api/admin/staff`, { method: "GET" });
    assert(resStaff.status === 200, `GET /api/admin/staff returns HTTP 200 OK (got ${resStaff.status})`);
    const staffData = await resStaff.json();
    assert(staffData.success === true && staffData.count === 5, `Confirmed 5 staff members in production database (count: ${staffData.count})`);
    const codes = staffData.data?.map(s => s.staff_code) || [];
    assert(codes.includes("PERSON_001") && codes.includes("SCT-2417"), `Production staff directory contains verified records: ${codes.join(", ")}`);

    p1Staff = staffData.data?.find(s => s.staff_code === "PERSON_001");
    assert(p1Staff !== undefined, "Found PERSON_001 staff record");
    assert(
      p1Staff && p1Staff.embeddingCount >= 5,
      `PERSON_001 has ${p1Staff?.embeddingCount} persisted face templates in Supabase Cloud (expected >= 5)`
    );
    assert(
      p1Staff && Array.isArray(p1Staff.referenceSamples) && p1Staff.referenceSamples.length >= 5,
      `PERSON_001 returned ${p1Staff?.referenceSamples?.length} reference samples for UI gallery display`
    );
  }

  // --- 3. VERIFY PRODUCTION DATABASE FACE MATCHING (PERMANENT TEMPLATES) ---
  console.log("\n--- 3. PRODUCTION BIOMETRIC VERIFICATION (PERMANENT DATABASE TEMPLATES) ---");
  {
    // Load local reference embedding for PERSON_001
    const localDb = JSON.parse(fs.readFileSync("data/staff-db.json", "utf-8"));
    const p1Clean = localDb.face_embeddings.find(e => e.id === "emb-p1-clean-1");
    assert(p1Clean !== undefined, "Found reference template 1 for PERSON_001 in local store");

    // Test 3A: Enrolled face matches PERSON_001
    const resVerify = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descriptor: p1Clean.embedding,
        verificationSessionId: "VERCEL-PROD-TEST-P1-EXACT"
      })
    });
    assert(resVerify.status === 200, `POST /api/face/verify returns HTTP 200 OK (got ${resVerify.status})`);
    const verifyData = await resVerify.json();
    assert(verifyData.matched === true, "Verification successfully MATCHED enrolled face template (matched: true)");
    assert(verifyData.finalResult === "PERSON_001", `Target identity correctly resolved as PERSON_001 (got: ${verifyData.finalResult})`);
    assert(verifyData.staff?.staffCode === "PERSON_001", `Staff payload returns correct staffCode: ${verifyData.staff?.staffCode}`);
    assert(typeof verifyData.distance === "number" && verifyData.distance < 0.05, `Cosine distance is near zero (${verifyData.distance?.toFixed(6)})`);

    // Test 3B: Perturbed face vector (simulating live camera variations: yaw/lighting)
    const perturbedVec = p1Clean.embedding.map(v => v * 0.95 + (Math.random() - 0.5) * 0.04);
    const pNorm = Math.sqrt(perturbedVec.reduce((s, v) => s + v * v, 0));
    const normalizedPerturbed = perturbedVec.map(v => v / pNorm);

    const resPerturbed = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descriptor: normalizedPerturbed,
        verificationSessionId: "VERCEL-PROD-TEST-P1-CAMERA-SIM"
      })
    });
    const pertData = await resPerturbed.json();
    assert(pertData.matched === true, `Simulated camera variation accepted (matched: true, distance: ${pertData.distance?.toFixed(4)} <= 0.45)`);
    assert(pertData.finalResult === "PERSON_001", `Simulated camera variation correctly recognized as PERSON_001`);

    // Test 3C: Unknown face is strictly REJECTED
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
        verificationSessionId: "VERCEL-PROD-TEST-UNKNOWN"
      })
    });
    assert(resUnk.status === 200, `Unknown face verification returns HTTP 200 OK (got ${resUnk.status})`);
    const unkData = await resUnk.json();
    assert(unkData.matched === false, "Unknown face is correctly REJECTED (matched: false)");
    assert(unkData.finalResult === "UNKNOWN", `Unknown face classified as UNKNOWN (got: ${unkData.finalResult})`);
    assert(unkData.distance > 0.45, `Distance exceeds threshold (${unkData.distance?.toFixed(4)} > 0.45)`);
  }

  // --- 4. LIVE ENROLLMENT WRITE & PERSISTENCE ROUNDTRIP ---
  console.log("\n--- 4. LIVE ENROLLMENT ENDPOINT VALIDATION & REJECTION HANDLING ---");
  {
    // Test 4A: Reject invalid / corrupt enrollment (never report success on failure)
    const resBadEnroll = await fetch(`${BASE_URL}/api/admin/staff/PERSON_001/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ descriptor: [1, 2, 3] }) // Bad dimension
    });
    assert(resBadEnroll.status === 400, `Malformed enrollment rejected with HTTP 400 (got ${resBadEnroll.status})`);
    const badData = await resBadEnroll.json();
    assert(badData.success === false, "Malformed enrollment returns success: false");

    // Test 4B: Successful new live template enrollment roundtrip
    const newTestVector = new Float32Array(512);
    let tNorm = 0;
    for (let i = 0; i < 512; i++) {
      newTestVector[i] = Math.sin(i * 0.22) + Math.cos(i * 0.11);
      tNorm += newTestVector[i] * newTestVector[i];
    }
    tNorm = Math.sqrt(tNorm);
    const normalizedNew = Array.from(newTestVector).map(v => v / tNorm);

    const resLiveEnroll = await fetch(`${BASE_URL}/api/admin/staff/PERSON_001/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedding: normalizedNew,
        referenceImagePath: "production_verification/live_test_snap.jpg"
      })
    });
    assert(resLiveEnroll.status === 200, `Live enrollment succeeds with HTTP 200 (got ${resLiveEnroll.status})`);
    const liveEnrollData = await resLiveEnroll.json();
    assert(liveEnrollData.success === true, "Live enrollment returns success: true");
    const newEmbId = liveEnrollData.data?.id;
    assert(newEmbId !== undefined, `New template assigned ID in database: ${newEmbId}`);

    // Verify verification endpoint immediately matches new template
    const resNewVerify = await fetch(`${BASE_URL}/api/face/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        descriptor: normalizedNew,
        verificationSessionId: "VERCEL-PROD-TEST-NEW-EMB"
      })
    });
    const newVerifyData = await resNewVerify.json();
    assert(newVerifyData.matched === true, "Newly enrolled template immediately verified in production (matched: true)");

    // Clean up only the test vector
    if (newEmbId) {
      const resDel = await fetch(`${BASE_URL}/api/admin/staff/PERSON_001/embedding/${newEmbId}`, {
        method: "DELETE"
      });
      assert(resDel.status === 200, `Cleaned up ephemeral test vector via DELETE (HTTP ${resDel.status})`);
    }

    // Confirm permanent templates are still present
    const resCheck = await fetch(`${BASE_URL}/api/admin/staff`, { method: "GET" });
    const checkData = await resCheck.json();
    const p1Check = checkData.data?.find(s => s.staff_code === "PERSON_001");
    assert(p1Check && p1Check.embeddingCount >= 5, `Permanent templates preserved in database: ${p1Check?.embeddingCount} present`);
  }

  // --- 5. STATIC ARCFACE MODEL ASSET VERIFICATION ---
  console.log("\n--- 5. STATIC ARCFACE MODEL ASSET VERIFICATION ---");
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
