import fs from 'fs';
import path from 'path';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:moulish@127.0.0.1:5432/campus_biometrics' });

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < 512; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1.0;
  return 1 - (dot / denom);
}

async function verify() {
  const session = await ort.InferenceSession.create(path.resolve('public/models/w600k_mbf.onnx'), { executionProviders: ['wasm'] });
  const dbRes = await pool.query("SELECT reference_image_path, embedding::text FROM face_embeddings WHERE staff_id = (SELECT id FROM staff WHERE staff_code = 'PERSON_001') ORDER BY reference_image_path");
  const stored = dbRes.rows.map(r => ({ path: r.reference_image_path, vec: JSON.parse(r.embedding) }));

  console.log('PostgreSQL Stored PERSON_001 Embeddings: ' + stored.length);

  for (let i = 1; i <= 5; i++) {
    const p = path.resolve('public/staff-photos/person-001/aligned_corrected_0' + i + '.jpg');
    const buf = fs.readFileSync(p);
    const img = jpeg.decode(buf);
    const planar = new Float32Array(3 * 112 * 112);
    for (let y = 0; y < 112; y++) {
      for (let x = 0; x < 112; x++) {
        const idx = (y * 112 + x) * 4;
        const pIdx = y * 112 + x;
        planar[0 * 112 * 112 + pIdx] = (img.data[idx] - 127.5) / 128.0;
        planar[1 * 112 * 112 + pIdx] = (img.data[idx + 1] - 127.5) / 128.0;
        planar[2 * 112 * 112 + pIdx] = (img.data[idx + 2] - 127.5) / 128.0;
      }
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', planar, [1, 3, 112, 112]) });
    const raw = Array.from(out[session.outputNames[0]].data);
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
    const emb = raw.map(v => v / norm);

    const selfDist = cosineDistance(emb, stored[i - 1].vec);
    console.log('Photo 0' + i + ': Raw Norm = ' + norm.toFixed(4) + ' | Self-Distance to DB Vector = ' + selfDist.toFixed(8));
  }
  await pool.end();
}

verify().catch(console.error);
