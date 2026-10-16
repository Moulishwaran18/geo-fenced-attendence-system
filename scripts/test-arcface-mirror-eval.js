import * as ort from "onnxruntime-web";
import fs from "fs";

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose tip
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
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
    sxx += dx * sx;
    sxy += dx * sy;
    syx += dy * sx;
    syy += dy * sy;
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
    invM: [[invA, -invB, invTx], [invB, invA, invTy]]
  };
}

async function test() {
  const modelBytes = fs.readFileSync("public/models/w600k_mbf.onnx");
  const session = await ort.InferenceSession.create(modelBytes.buffer, {
    executionProviders: ["wasm"],
  });

  // Let's create an asymmetrical face image (e.g. 200x200)
  const W = 200, H = 200;
  const imgData = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      // Background dark gray
      imgData[idx] = 40;
      imgData[idx + 1] = 40;
      imgData[idx + 2] = 40;
      imgData[idx + 3] = 255;
      // Head ellipse
      const dx = (x - 100) / 60, dy = (y - 100) / 80;
      if (dx * dx + dy * dy <= 1) {
        // Skin tone
        imgData[idx] = 210;
        imgData[idx + 1] = 160;
        imgData[idx + 2] = 130;
      }
      // Left eye at (80, 85) - dark spot
      if (Math.hypot(x - 80, y - 85) < 7) {
        imgData[idx] = 20; imgData[idx + 1] = 20; imgData[idx + 2] = 20;
      }
      // Right eye at (120, 85) - dark spot
      if (Math.hypot(x - 120, y - 85) < 7) {
        imgData[idx] = 20; imgData[idx + 1] = 20; imgData[idx + 2] = 20;
      }
      // Nose at (100, 105)
      if (Math.hypot(x - 100, y - 105) < 5) {
        imgData[idx] = 150; imgData[idx + 1] = 100; imgData[idx + 2] = 80;
      }
      // Mouth at (100, 135)
      if (Math.abs(y - 135) < 4 && Math.abs(x - 100) < 18) {
        imgData[idx] = 160; imgData[idx + 1] = 50; imgData[idx + 2] = 50;
      }
      // Prominent beauty mark / mole near left cheek (70, 115) - ASYMMETRY
      if (Math.hypot(x - 70, y - 115) < 6) {
        imgData[idx] = 10; imgData[idx + 1] = 10; imgData[idx + 2] = 10;
      }
    }
  }

  // Landmarks in original image:
  const ptsNormal = [
    [80, 85],   // left eye
    [120, 85],  // right eye
    [100, 105], // nose
    [85, 135],  // left mouth
    [115, 135], // right mouth
  ];

  function warp(imageBuffer, invM) {
    const out = new Float32Array(3 * 112 * 112);
    for (let dy = 0; dy < 112; dy++) {
      for (let dx = 0; dx < 112; dx++) {
        const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
        const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        let r = 0, g = 0, b = 0;
        if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) {
          const idx = (y0 * W + x0) * 4;
          r = imageBuffer[idx];
          g = imageBuffer[idx + 1];
          b = imageBuffer[idx + 2];
        }
        const pixelIdx = dy * 112 + dx;
        out[0 * 112 * 112 + pixelIdx] = (r - 127.5) / 128.0;
        out[1 * 112 * 112 + pixelIdx] = (g - 127.5) / 128.0;
        out[2 * 112 * 112 + pixelIdx] = (b - 127.5) / 128.0;
      }
    }
    return out;
  }

  // 1. Canonical aligned tensor
  const { invM: invMNormal } = estimateSimilarityTransform(ptsNormal);
  const planarNormal = warp(imgData, invMNormal);

  // 2. Horizontally mirrored image buffer
  const mirroredImg = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const srcIdx = (y * W + x) * 4;
      const dstIdx = (y * W + (W - 1 - x)) * 4;
      mirroredImg[dstIdx] = imgData[srcIdx];
      mirroredImg[dstIdx + 1] = imgData[srcIdx + 1];
      mirroredImg[dstIdx + 2] = imgData[srcIdx + 2];
      mirroredImg[dstIdx + 3] = imgData[srcIdx + 3];
    }
  }

  // 3. Properly mapped landmarks on mirrored image
  const ptsMirrored = [
    [W - 1 - ptsNormal[1][0], ptsNormal[1][1]], // former right eye is now left eye
    [W - 1 - ptsNormal[0][0], ptsNormal[0][1]], // former left eye is now right eye
    [W - 1 - ptsNormal[2][0], ptsNormal[2][1]], // nose
    [W - 1 - ptsNormal[4][0], ptsNormal[4][1]], // former right mouth is left mouth
    [W - 1 - ptsNormal[3][0], ptsNormal[3][1]], // former left mouth is right mouth
  ];
  const { invM: invMMirror } = estimateSimilarityTransform(ptsMirrored);
  const planarMirroredProper = warp(mirroredImg, invMMirror);

  // 4. Broken naive tensor flip (flip planarNormal directly)
  const planarBrokenTensorFlip = new Float32Array(3 * 112 * 112);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 112; y++) {
      for (let x = 0; x < 112; x++) {
        planarBrokenTensorFlip[c * 112 * 112 + y * 112 + (111 - x)] = planarNormal[c * 112 * 112 + y * 112 + x];
      }
    }
  }

  async function getEmbedding(data) {
    const inputTensor = new ort.Tensor("float32", data, [1, 3, 112, 112]);
    const res = await session.run({ [session.inputNames[0]]: inputTensor });
    const raw = Array.from(res[session.outputNames[0]].data);
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
    return raw.map(v => v / norm);
  }

  function cosineDist(e1, e2) {
    let dot = 0;
    for (let i = 0; i < e1.length; i++) dot += e1[i] * e2[i];
    return Math.max(0, 1 - dot);
  }

  const embNormal = await getEmbedding(planarNormal);
  const embMirroredProper = await getEmbedding(planarMirroredProper);
  const embBrokenTensorFlip = await getEmbedding(planarBrokenTensorFlip);

  console.log("Self distance (canonical vs canonical):", cosineDist(embNormal, embNormal));
  console.log("Distance between Canonical and Properly Mirrored image:", cosineDist(embNormal, embMirroredProper));
  console.log("Distance between Canonical and Broken Tensor Flip:", cosineDist(embNormal, embBrokenTensorFlip));
  console.log("Distance between Enrolled Mirrored photo and Live Canonical (unflipped):", cosineDist(embMirroredProper, embNormal));
  console.log("Distance between Enrolled Mirrored photo and Live Properly Mirrored:", cosineDist(embMirroredProper, embMirroredProper));
  console.log("Distance between Enrolled Mirrored photo and Broken Tensor Flip:", cosineDist(embMirroredProper, embBrokenTensorFlip));
}

test().catch(console.error);
