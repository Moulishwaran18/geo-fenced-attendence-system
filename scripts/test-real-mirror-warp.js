import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-web";

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= n; srcMeanY /= n; dstMeanX /= n; dstMeanY /= n;

  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - srcMeanX;
    const dy = src[i][1] - srcMeanY;
    srcVar += dx * dx + dy * dy;
  }
  srcVar /= n;
  if (srcVar === 0) srcVar = 1e-6;

  let sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    sxx += dx * sx; sxy += dx * sy;
    syx += dy * sx; syy += dy * sy;
  }
  sxx /= n; sxy /= n; syx /= n; syy /= n;

  const a = (sxx + syy) / srcVar;
  const b = (syx - sxy) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b || 1e-6;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  return {
    M: [[a, -b, tx], [b, a, ty]],
    invM: [[invA, -invB, invTx], [invB, invA, invTy]],
  };
}

function warpImage(imgData, width, height, invM) {
  const outW = 112, outH = 112;
  const planar = new Float32Array(3 * outW * outH);
  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
      const wx = sx - x0, wy = sy - y0;

      let r = 0, g = 0, b = 0;
      if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
        const idx00 = (y0 * width + x0) * 4;
        const idx10 = (y0 * width + x1) * 4;
        const idx01 = (y1 * width + x0) * 4;
        const idx11 = (y1 * width + x1) * 4;

        r = (1 - wx) * (1 - wy) * imgData[idx00] + wx * (1 - wy) * imgData[idx10] + (1 - wx) * wy * imgData[idx01] + wx * wy * imgData[idx11];
        g = (1 - wx) * (1 - wy) * imgData[idx00 + 1] + wx * (1 - wy) * imgData[idx10 + 1] + (1 - wx) * wy * imgData[idx01 + 1] + wx * wy * imgData[idx11 + 1];
        b = (1 - wx) * (1 - wy) * imgData[idx00 + 2] + wx * (1 - wy) * imgData[idx10 + 2] + (1 - wx) * wy * imgData[idx01 + 2] + wx * wy * imgData[idx11 + 2];
      }

      const pixelIdx = dy * outW + dx;
      planar[0 * outW * outH + pixelIdx] = (r - 127.5) / 128.0;
      planar[1 * outW * outH + pixelIdx] = (g - 127.5) / 128.0;
      planar[2 * outW * outH + pixelIdx] = (b - 127.5) / 128.0;
    }
  }
  return planar;
}

async function main() {
  const modelBytes = fs.readFileSync("public/models/w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(modelBytes.buffer, { executionProviders: ["wasm"] });

  async function getEmbedding(planar) {
    const inputTensor = new ort.Tensor("float32", planar, [1, 3, 112, 112]);
    const res = await session.run({ [session.inputNames[0]]: inputTensor });
    const raw = Array.from(res[session.outputNames[0]].data);
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1e-6;
    return raw.map((v) => v / norm);
  }

  function cosineDist(e1, e2) {
    let dot = 0;
    for (let i = 0; i < e1.length; i++) dot += e1[i] * e2[i];
    return Math.max(0, 1 - dot);
  }

  function processFrame(frameName) {
    const meta = JSON.parse(fs.readFileSync(`.output/public/debug-frames/${frameName}/metadata.json`, "utf-8"));
    const frameBuf = fs.readFileSync(`.output/public/debug-frames/${frameName}/original_camera_frame.jpg`);
    const rawJpeg = jpeg.decode(frameBuf, { useTArray: true });
    const { width, height, data } = rawJpeg;
    const pts5 = meta.landmarks5;

    // Canonical
    const { invM: invMCanonical } = estimateSimilarityTransform(pts5);
    const planarCanonical = warpImage(data, width, height, invMCanonical);

    // Mirrored
    const mirroredData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const dstIdx = (y * width + (width - 1 - x)) * 4;
        mirroredData[dstIdx] = data[srcIdx];
        mirroredData[dstIdx + 1] = data[srcIdx + 1];
        mirroredData[dstIdx + 2] = data[srcIdx + 2];
        mirroredData[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    const pts5Mirrored = [
      [width - 1 - pts5[1][0], pts5[1][1]],
      [width - 1 - pts5[0][0], pts5[0][1]],
      [width - 1 - pts5[2][0], pts5[2][1]],
      [width - 1 - pts5[4][0], pts5[4][1]],
      [width - 1 - pts5[3][0], pts5[3][1]],
    ];
    const { invM: invMMirror } = estimateSimilarityTransform(pts5Mirrored);
    const planarMirroredProper = warpImage(mirroredData, width, height, invMMirror);

    return { planarCanonical, planarMirroredProper };
  }

  const f1 = processFrame("frame-10303");
  const f2 = processFrame("frame-11437");

  const emb1Can = await getEmbedding(f1.planarCanonical);
  const emb1Mir = await getEmbedding(f1.planarMirroredProper);
  const emb2Can = await getEmbedding(f2.planarCanonical);
  const emb2Mir = await getEmbedding(f2.planarMirroredProper);

  console.log("=== Real Face Comparison ===");
  console.log("Frame 10303 Canonical vs Frame 10303 Mirrored:", cosineDist(emb1Can, emb1Mir).toFixed(4));
  console.log("Frame 11437 Canonical vs Frame 11437 Mirrored:", cosineDist(emb2Can, emb2Mir).toFixed(4));
  console.log("Frame 10303 vs Frame 11437 (Both Canonical):", cosineDist(emb1Can, emb2Can).toFixed(4));
  console.log("Frame 10303 vs Frame 11437 (Canonical vs Mirrored):", cosineDist(emb1Can, emb2Mir).toFixed(4));
  console.log("Frame 10303 vs Frame 11437 (Mirrored vs Mirrored):", cosineDist(emb1Mir, emb2Mir).toFixed(4));
}

main().catch(console.error);
