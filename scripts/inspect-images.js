import fs from "fs";
import path from "path";
import crypto from "crypto";
import jpeg from "jpeg-js";

const PHOTOS_DIR = path.resolve("public", "staff-photos");
const DB_PATH = path.resolve("data", "staff-db.json");

// Cosine Distance Helper
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

function analyzeImageQuality(rawJpeg) {
  const { width, height, data } = rawJpeg; // data is RGBA Uint8Array
  let totalLuma = 0;
  let totalLumaSq = 0;
  const pixelCount = width * height;

  const gray = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = luma;
    totalLuma += luma;
    totalLumaSq += luma * luma;
  }

  const brightness = totalLuma / pixelCount;
  const variance = (totalLumaSq / pixelCount) - (brightness * brightness);
  const contrast = Math.sqrt(Math.max(0, variance));

  // Blur estimation via Laplacian variance
  let laplacianSum = 0;
  let laplacianSumSq = 0;
  let lapCount = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // 3x3 discrete Laplacian operator: [0, 1, 0; 1, -4, 1; 0, 1, 0]
      const lap =
        gray[idx - width] +
        gray[idx + width] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];

      laplacianSum += lap;
      laplacianSumSq += lap * lap;
      lapCount++;
    }
  }

  const lapMean = laplacianSum / lapCount;
  const lapVar = (laplacianSumSq / lapCount) - (lapMean * lapMean);
  const sharpness = Math.sqrt(Math.max(0, lapVar));

  return { width, height, brightness, contrast, sharpness };
}

async function runInspection() {
  console.log("===============================================================================");
  console.log("             COMPREHENSIVE 15 REFERENCE IMAGE INSPECTION REPORT");
  console.log("===============================================================================\n");

  const persons = ["person-001", "person-002", "person-003"];
  const allImages = [];

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));

  for (const person of persons) {
    const personDir = path.join(PHOTOS_DIR, person);
    const files = fs.readdirSync(personDir).filter(f => f.endsWith(".jpg")).sort();

    for (const file of files) {
      const filePath = path.join(personDir, file);
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = crypto.createHash("md5").update(fileBuffer).digest("hex");
      const rawJpeg = jpeg.decode(fileBuffer, { useTArray: true });
      const quality = analyzeImageQuality(rawJpeg);

      const relPath = `/staff-photos/${person}/${file}`;
      const embRecord = db.face_embeddings.find(e => e.reference_image_path === relPath);

      let embedding = null;
      let embNorm = 0;
      let embDim = 0;

      if (embRecord && embRecord.embedding) {
        embedding = embRecord.embedding;
        embDim = embedding.length;
        embNorm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      }

      allImages.push({
        person,
        file,
        relPath,
        sizeBytes: fileBuffer.length,
        md5: fileHash,
        width: quality.width,
        height: quality.height,
        resolution: `${quality.width}x${quality.height}`,
        brightness: parseFloat(quality.brightness.toFixed(1)),
        contrast: parseFloat(quality.contrast.toFixed(1)),
        sharpness: parseFloat(quality.sharpness.toFixed(1)),
        embDim,
        embNorm: parseFloat(embNorm.toFixed(4)),
        embedding
      });
    }
  }

  // 1. Table of all 15 images
  console.log("1. IMAGE PROPERTIES & METRICS:");
  console.log("-------------------------------------------------------------------------------");
  console.log("ID         | File            | Resolution | File Size | MD5 (8c) | Bright | Contrast | Sharpness | Norm");
  console.log("-----------+-----------------+------------+-----------+----------+--------+----------+-----------+-------");
  allImages.forEach(img => {
    const id = img.person.replace("person-00", "P00");
    console.log(`${id.padEnd(10)} | ${img.file.padEnd(15)} | ${img.resolution.padEnd(10)} | ${String(img.sizeBytes + " B").padEnd(9)} | ${img.md5.slice(0, 8).padEnd(8)} | ${String(img.brightness).padEnd(6)} | ${String(img.contrast).padEnd(8)} | ${String(img.sharpness).padEnd(9)} | ${img.embNorm}`);
  });

  // 2. Duplicate file check
  console.log("\n2. FILE REUSE & DUPLICATION ANALYSIS:");
  console.log("-------------------------------------------------------------------------------");
  const hashMap = {};
  allImages.forEach(img => {
    if (!hashMap[img.md5]) hashMap[img.md5] = [];
    hashMap[img.md5].push(`${img.person}/${img.file}`);
  });
  let foundDups = false;
  for (const [hash, files] of Object.entries(hashMap)) {
    if (files.length > 1) {
      foundDups = true;
      console.log(`⚠️ IDENTICAL FILE DUPLICATE (MD5: ${hash}):\n   ${files.join(" == ")}`);
    }
  }
  if (!foundDups) console.log("✓ No exact file duplicates across dataset.");

  // 3. Complete 15x15 Pairwise Matrix
  console.log("\n3. COMPLETE 15x15 PAIRWISE DISTANCE MATRIX (512-D Cosine Distance):");
  console.log("-------------------------------------------------------------------------------");
  const labels = allImages.map(img => `${img.person.replace("person-00", "P")}_${img.file.replace("reference_", "r").replace(".jpg", "")}`);
  console.log("        " + labels.map(l => l.padEnd(7)).join(" "));

  const matrix = [];
  for (let i = 0; i < allImages.length; i++) {
    const row = [];
    for (let j = 0; j < allImages.length; j++) {
      if (allImages[i].embedding && allImages[j].embedding) {
        const d = cosineDistance(allImages[i].embedding, allImages[j].embedding);
        row.push(d);
      } else {
        row.push(999);
      }
    }
    matrix.push(row);
    console.log(`${labels[i].padEnd(7)} ` + row.map(d => d.toFixed(3).padEnd(7)).join(" "));
  }

  // 4. Same-person high distance anomalies (> 0.45)
  console.log("\n4. HIGH INTRA-PERSON DISTANCES (Within Same Folder > 0.45):");
  console.log("-------------------------------------------------------------------------------");
  for (let i = 0; i < allImages.length; i++) {
    for (let j = i + 1; j < allImages.length; j++) {
      if (allImages[i].person === allImages[j].person) {
        const d = matrix[i][j];
        if (d > 0.45) {
          console.log(`❌ MISMATCH WITHIN ${allImages[i].person.toUpperCase()}: ${allImages[i].file} vs ${allImages[j].file} -> Dist: ${d.toFixed(4)} (Sim: ${(1 - d).toFixed(4)})`);
        }
      }
    }
  }

  // 5. Cross-person low distance anomalies (<= 0.45)
  console.log("\n5. SUSPICIOUS CROSS-PERSON DISTANCES (Between Different People <= 0.45):");
  console.log("-------------------------------------------------------------------------------");
  for (let i = 0; i < allImages.length; i++) {
    for (let j = i + 1; j < allImages.length; j++) {
      if (allImages[i].person !== allImages[j].person) {
        const d = matrix[i][j];
        if (d <= 0.45) {
          console.log(`🚨 FALSE IDENTITY COLLISION: ${allImages[i].person}/${allImages[i].file} vs ${allImages[j].person}/${allImages[j].file} -> Dist: ${d.toFixed(4)} (Sim: ${(1 - d).toFixed(4)})`);
        }
      }
    }
  }

  // 6. Detailed clustering breakdown: which reference images actually cluster together?
  console.log("\n6. CLUSTER & IDENTITY MAPPING INSIGHT:");
  console.log("-------------------------------------------------------------------------------");
  for (let i = 0; i < allImages.length; i++) {
    const imgA = allImages[i];
    const closeMatches = [];
    for (let j = 0; j < allImages.length; j++) {
      if (i !== j) {
        const d = matrix[i][j];
        if (d <= 0.45) {
          closeMatches.push({ label: labels[j], dist: d.toFixed(3), samePerson: allImages[j].person === imgA.person });
        }
      }
    }
    const matchesStr = closeMatches.map(m => `${m.label}(${m.dist}${m.samePerson ? "✓" : "❌"})`).join(", ");
    console.log(`${labels[i].padEnd(8)} matches (<=0.45): [${matchesStr || "NONE"}]`);
  }
}

runInspection().catch(console.error);
