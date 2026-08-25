import fs from "fs";
import path from "path";

const dbPath = path.resolve("data", "staff-db.json");
const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  const sim = Math.max(-1.0, Math.min(1.0, dot / denom));
  return Math.max(0, 1.0 - sim);
}

// 1. Group active gallery embeddings
const staffEmbeddings = {};
for (const s of db.staff) {
  staffEmbeddings[s.staff_code] = [];
}
for (const emb of db.face_embeddings) {
  const staff = db.staff.find(s => s.id === emb.staff_id);
  if (staff) {
    staffEmbeddings[staff.staff_code].push({
      id: emb.id,
      path: emb.reference_image_path,
      vector: emb.embedding
    });
  }
}

console.log("===============================================================================");
console.log("             CLEAN ACTIVE GALLERY BIOMETRIC CALIBRATION REPORT");
console.log("===============================================================================\n");

console.log("ACTIVE ENROLLED GALLERY:");
for (const [code, embs] of Object.entries(staffEmbeddings)) {
  console.log(`▶ ${code} (${embs.length} verified photos):`);
  embs.forEach((e, idx) => console.log(`   [${idx + 1}] ${e.path} (dim: ${e.vector.length})`));
}

// 2. Compute Same-Person (Genuine) Distances
const genuinePairs = [];
const genuineDistances = [];

console.log("\n1. SAME-PERSON PAIRWISE DISTANCES (Within Clean Active Gallery):");
console.log("-------------------------------------------------------------------------------");
for (const [staffCode, embs] of Object.entries(staffEmbeddings)) {
  for (let i = 0; i < embs.length; i++) {
    for (let j = i + 1; j < embs.length; j++) {
      const pA = path.basename(embs[i].path);
      const pB = path.basename(embs[j].path);
      const dist = cosineDistance(embs[i].vector, embs[j].vector);
      genuinePairs.push({ staffCode, pA, pB, dist });
      genuineDistances.push(dist);
      console.log(`• ${staffCode}: ${pA} vs ${pB} -> Cosine Dist: ${dist.toFixed(4)} | Similarity: ${(1 - dist).toFixed(4)}`);
    }
  }
}

// 3. Compute Different-Person (Impostor) Distances
const impostorPairs = [];
const impostorDistances = [];
const staffCodes = Object.keys(staffEmbeddings);

console.log("\n2. DIFFERENT-PERSON CROSS DISTANCES (Inter-Identity Separation):");
console.log("-------------------------------------------------------------------------------");
for (let i = 0; i < staffCodes.length; i++) {
  for (let j = i + 1; j < staffCodes.length; j++) {
    const codeA = staffCodes[i];
    const codeB = staffCodes[j];
    const embsA = staffEmbeddings[codeA];
    const embsB = staffEmbeddings[codeB];

    for (let a = 0; a < embsA.length; a++) {
      for (let b = 0; b < embsB.length; b++) {
        const dist = cosineDistance(embsA[a].vector, embsB[b].vector);
        const pA = path.basename(embsA[a].path);
        const pB = path.basename(embsB[b].path);
        impostorPairs.push({ pair: `${codeA} (${pA}) vs ${codeB} (${pB})`, codeA, codeB, dist });
        impostorDistances.push(dist);
        console.log(`• ${codeA} (${pA}) vs ${codeB} (${pB}) -> Cosine Dist: ${dist.toFixed(4)} | Similarity: ${(1 - dist).toFixed(4)}`);
      }
    }
  }
}

// 4. Compute Statistical Metrics
function getStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  
  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sorted.length;
  const std = Math.sqrt(variance);
  return { count: arr.length, min, max, mean, median, std };
}

const genStats = getStats(genuineDistances);
const impStats = getStats(impostorDistances);

console.log("\n3. STATISTICAL SUMMARY:");
console.log("-------------------------------------------------------------------------------");
console.log(`GENUINE (Same-Person):    Count: ${genStats.count} | Min: ${genStats.min.toFixed(4)} | Max: ${genStats.max.toFixed(4)} | Mean: ${genStats.mean.toFixed(4)} | Median: ${genStats.median.toFixed(4)} | Std: ${genStats.std.toFixed(4)}`);
console.log(`IMPOSTOR (Cross-Person):  Count: ${impStats.count} | Min: ${impStats.min.toFixed(4)} | Max: ${impStats.max.toFixed(4)} | Mean: ${impStats.mean.toFixed(4)} | Median: ${impStats.median.toFixed(4)} | Std: ${impStats.std.toFixed(4)}`);
console.log(`BIOMETRIC SEPARATION GAP: ${(impStats.min - genStats.max).toFixed(4)} (Positive gap = ZERO OVERLAP!)`);

// 5. Threshold Sweep Analysis
console.log("\n4. THRESHOLD SWEEP (False Non-Match vs False Match Rate):");
console.log("-------------------------------------------------------------------------------");
console.log("Threshold | FNMR (Genuine Reject) | FMR (Impostor Accept) | Separation Quality");
console.log("----------+-----------------------+-----------------------+--------------------");

for (let t = 0.35; t <= 0.60; t += 0.02) {
  const thresh = parseFloat(t.toFixed(2));
  const fnmr = genuineDistances.filter(d => d > thresh).length / genuineDistances.length;
  const fmr = impostorDistances.filter(d => d <= thresh).length / impostorDistances.length;
  let status = "Sub-optimal";
  if (fnmr === 0 && fmr === 0) status = "★ PERFECT ZERO-ERROR ZONE";
  else if (fnmr === 0) status = "Zero FNMR";
  else if (fmr === 0) status = "Zero FMR (High Security)";
  console.log(`${thresh.toFixed(2).padEnd(9)} | ${(fnmr * 100).toFixed(1).padStart(5)}%                 | ${(fmr * 100).toFixed(1).padStart(5)}%                 | ${status}`);
}

// 6. Live Probe Evaluation Bench
console.log("\n5. LIVE PROBE MATCH EVALUATION BENCH (Using Clean Active Gallery):");
console.log("-------------------------------------------------------------------------------");

const gallery = {};
for (const s of db.staff) {
  gallery[s.id] = {
    staffCode: s.staff_code,
    name: s.name,
    embeddings: db.face_embeddings.filter(f => f.staff_id === s.id).map(f => f.embedding)
  };
}

function evaluateProbe(probeEmbedding, threshold = 0.45, minMargin = 0.08) {
  const evaluations = Object.values(gallery).map(identity => {
    let minDistance = 999;
    let bestIdx = -1;
    identity.embeddings.forEach((emb, idx) => {
      const d = cosineDistance(probeEmbedding, emb);
      if (d < minDistance) {
        minDistance = d;
        bestIdx = idx;
      }
    });

    return {
      staffCode: identity.staffCode,
      name: identity.name,
      bestDistance: minDistance,
      bestIdx,
      isWithinThreshold: minDistance <= threshold
    };
  }).sort((a, b) => a.bestDistance - b.bestDistance);

  const best = evaluations[0];
  const secondBest = evaluations[1] || null;
  const margin = secondBest ? (secondBest.bestDistance - best.bestDistance) : null;

  let finalDecision = "IDLE";
  let reason = "";

  if (best.bestDistance > threshold) {
    finalDecision = "REJECTED_THRESHOLD (Unknown Face)";
    reason = `Best distance (${best.bestDistance.toFixed(4)}) exceeds threshold (${threshold.toFixed(2)})`;
  } else if (margin !== null && margin < minMargin) {
    finalDecision = "REJECTED_MARGIN (Ambiguous Identity)";
    reason = `Match margin (${margin.toFixed(4)}) is less than required minimum (${minMargin.toFixed(2)})`;
  } else {
    finalDecision = `AUTHORIZED: ${best.name} (${best.staffCode})`;
    reason = `Verified with distance ${best.bestDistance.toFixed(4)} <= ${threshold.toFixed(2)} and margin ${margin?.toFixed(4) || "N/A"}`;
  }

  return {
    bestMatch: `${best.name} (${best.staffCode})`,
    secondBestMatch: secondBest ? `${secondBest.name} (${secondBest.staffCode})` : "None",
    bestDistance: best.bestDistance,
    secondBestDistance: secondBest?.bestDistance ?? null,
    margin,
    threshold,
    finalDecision,
    reason,
  };
}

// Test PERSON_001 Live (using ref_02 against gallery)
console.log("\n▶ TEST CASE 1: PERSON_001 Live Probe:");
console.log(JSON.stringify(evaluateProbe(gallery["staff-person_001"].embeddings[1], 0.45, 0.08), null, 2));

// Test PERSON_002 Live (using ref_05 against gallery)
console.log("\n▶ TEST CASE 2: PERSON_002 Live Probe:");
console.log(JSON.stringify(evaluateProbe(gallery["staff-person_002"].embeddings[1], 0.45, 0.08), null, 2));

// Test PERSON_003 Live (using ref_03 against gallery)
console.log("\n▶ TEST CASE 3: PERSON_003 Live Probe:");
console.log(JSON.stringify(evaluateProbe(gallery["staff-person_003"].embeddings[1], 0.45, 0.08), null, 2));

// Test Unknown Person Live (Orthogonal / Impostor probe)
const randomProbe = new Array(512).fill(0).map(() => (Math.random() - 0.5));
const norm = Math.sqrt(randomProbe.reduce((sum, v) => sum + v * v, 0));
const unitRandomProbe = randomProbe.map(v => v / norm);

console.log("\n▶ TEST CASE 4: UNKNOWN PERSON Live Probe:");
console.log(JSON.stringify(evaluateProbe(unitRandomProbe, 0.45, 0.08), null, 2));
