import fs from "fs";
import { searchFaceEmbeddings, getDatabaseDiagnostics } from "../src/server/db/client.ts";
import { handleFaceVerifyApi } from "../src/server/api/face-search-handler.ts";

const jsonDb = JSON.parse(fs.readFileSync("data/staff-db.json", "utf-8"));

async function testParity() {
  console.log("==================================================");
  console.log("CampusAttend — Vector Search & Verification Test");
  console.log("==================================================");

  // 1. Diagnostics
  const diag = await getDatabaseDiagnostics();
  console.log("\n1. Database Diagnostic Check:");
  console.log(`   status:               ${diag.status}`);
  console.log(`   databaseType:         ${diag.databaseType}`);
  console.log(`   databaseName:         ${diag.databaseName}`);
  console.log(`   pgvector:             ${diag.pgvector}`);
  console.log(`   staffCount:           ${diag.staffCount}`);
  console.log(`   totalEmbeddingCount:  ${diag.totalEmbeddingCount}`);
  console.log(`   activeEmbeddingCount: ${diag.activeEmbeddingCount}`);
  console.log(`   activeSource:         ${diag.activeSource}`);

  if (diag.status !== "CONNECTED" || diag.pgvector !== "ENABLED") {
    console.error("\n[FAIL] Database is not connected or pgvector is not enabled!");
    process.exit(1);
  }

  // 2. Self-Distance Tests for each staff member
  console.log("\n2. Self-Distance Cosine Tests (Direct pgvector Query):");
  
  const testCodes = ["PERSON_001", "PERSON_002", "PERSON_003"];
  let allSelfTestsPass = true;

  for (const code of testCodes) {
    const staff = jsonDb.staff.find(s => s.staff_code === code);
    const emb = jsonDb.face_embeddings.find(e => e.staff_id === staff.id);

    // Run search on pgvector
    const results = await searchFaceEmbeddings(emb.embedding, 5);
    console.log(`\n   Target query vector: ${code} (${emb.reference_image_path})`);
    
    if (code === "PERSON_001") {
      // PERSON_001 is active=true, so it will be in results
      const top = results[0];
      console.log(`     Top match: ${top?.staff_code} (name: ${top?.name}), distance: ${top?.distance.toFixed(8)}`);
      const isZero = top && top.staff_code === code && top.distance < 1e-4;
      if (isZero) {
        console.log(`     ✓ Self-distance test for ${code}: PASS (distance ~ 0)`);
      } else {
        console.log(`     ✗ Self-distance test for ${code}: FAIL`);
        allSelfTestsPass = false;
      }
    } else {
      // PERSON_002 and PERSON_003 are active=false, so searchFaceEmbeddings only searches active staff (PERSON_001)
      console.log(`     (Note: ${code} is inactive in staff table, active staff candidates searched: ${results.length})`);
    }
  }

  // 3. API Verification Simulation
  console.log("\n3. POST /api/face/verify Integration Test:");
  
  const p1Emb = jsonDb.face_embeddings.find(e => e.staff_id === "staff-person_001");
  const fakeReq = new Request("http://localhost:5173/api/face/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      descriptor: p1Emb.embedding,
      verificationSessionId: "TEST-SESSION-001",
    }),
  });

  const res = await handleFaceVerifyApi(fakeReq);
  const body = await res.json();

  console.log(`   Response status:       ${res.status}`);
  console.log(`   matched:               ${body.matched}`);
  console.log(`   finalResult:           ${body.finalResult}`);
  console.log(`   bestCandidate:         ${body.bestCandidate?.staffCode} (${body.bestCandidate?.name})`);
  console.log(`   distance:              ${body.distance}`);
  console.log(`   threshold:             ${body.threshold}`);
  console.log(`   margin:                ${body.margin}`);
  console.log(`   matchMargin:           ${body.matchMargin}`);

  const apiPass = body.matched === true && body.finalResult === "PERSON_001" && body.distance < 0.45;
  console.log(`\n   Live PERSON_001 test:  ${apiPass ? "✓ PASS" : "✗ FAIL"}`);

  console.log("\n==================================================");
  if (allSelfTestsPass && apiPass) {
    console.log("✓ ALL VECTOR SEARCH & VERIFICATION TESTS PASSED");
  } else {
    console.log("✗ TESTS FAILED");
  }
  console.log("==================================================");
}

testParity().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
