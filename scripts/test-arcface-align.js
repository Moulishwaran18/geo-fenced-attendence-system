import fs from "fs";
import path from "path";
import * as ort from "onnxruntime-web";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";
import jpeg from "jpeg-js";

function estimateSimilarityTransform(src, dst) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0];
    srcMeanY += src[i][1];
    dstMeanX += dst[i][0];
    dstMeanY += dst[i][1];
  }
  srcMeanX /= n; srcMeanY /= n; dstMeanX /= n; dstMeanY /= n;

  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - srcMeanX;
    const dy = src[i][1] - srcMeanY;
    srcVar += dx * dx + dy * dy;
  }
  srcVar /= n;

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
  const b = (sxy - syx) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  return {
    M: [[a, -b, tx], [b, a, ty]],
    invM: [[invA, -invB, invTx], [invB, invA, invTy]],
  };
}

const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export function alignCropFace(imgData, width, height, landmarks) {
  const pts = landmarks.positions;
  const leftEye = [
    (pts[36].x + pts[37].x + pts[38].x + pts[39].x + pts[40].x + pts[41].x) / 6,
    (pts[36].y + pts[37].y + pts[38].y + pts[39].y + pts[40].y + pts[41].y) / 6,
  ];
  const rightEye = [
    (pts[42].x + pts[43].x + pts[44].x + pts[45].x + pts[46].x + pts[47].x) / 6,
    (pts[42].y + pts[43].y + pts[44].y + pts[45].y + pts[46].y + pts[47].y) / 6,
  ];
  const nose = [pts[30].x, pts[30].y];
  const leftMouth = [pts[48].x, pts[48].y];
  const rightMouth = [pts[54].x, pts[54].y];

  const srcPoints = [leftEye, rightEye, nose, leftMouth, rightMouth];
  const { invM } = estimateSimilarityTransform(srcPoints, ARCFACE_REFERENCE_POINTS);

  const outW = 112;
  const outH = 112;
  const floatPlanar = new Float32Array(3 * outW * outH); // [3, 112, 112]

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      const sx = invM[0][0] * dx + invM[0][1] * dy + invM[0][2];
      const sy = invM[1][0] * dx + invM[1][1] * dy + invM[1][2];

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const wx = sx - x0;
      const wy = sy - y0;

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
      floatPlanar[0 * outW * outH + pixelIdx] = (r - 127.5) / 128.0;
      floatPlanar[1 * outW * outH + pixelIdx] = (g - 127.5) / 128.0;
      floatPlanar[2 * outW * outH + pixelIdx] = (b - 127.5) / 128.0;
    }
  }

  return floatPlanar;
}

async function run() {
  console.log("Testing ArcFace Model Pipeline...");
  const modelDir = path.resolve("public", "models");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
  const session = await ort.InferenceSession.create(path.join(modelDir, "w600k_mbf.onnx"));

  const p1Buf = fs.readFileSync("public/staff-photos/person-001/reference_01.jpg");
  const p1Dec = jpeg.decode(p1Buf, { useTArray: true });

  const rgb = new Uint8Array(p1Dec.width * p1Dec.height * 3);
  for (let i = 0; i < p1Dec.width * p1Dec.height; i++) {
    rgb[i * 3] = p1Dec.data[i * 4];
    rgb[i * 3 + 1] = p1Dec.data[i * 4 + 1];
    rgb[i * 3 + 2] = p1Dec.data[i * 4 + 2];
  }
  const tensor = tf.tensor3d(rgb, [p1Dec.height, p1Dec.width, 3], "int32");
  const detections = await faceapi
    .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
    .withFaceLandmarks();
  tensor.dispose();

  console.log("Detected faces for Person 1 Photo 1:", detections.length);
  const aligned = alignCropFace(p1Dec.data, p1Dec.width, p1Dec.height, detections[0].landmarks);

  const inputTensor = new ort.Tensor("float32", aligned, [1, 3, 112, 112]);
  const feeds = { [session.inputNames[0]]: inputTensor };
  const res = await session.run(feeds);
  const out = res[session.outputNames[0]].data;

  let norm = 0;
  for (let i = 0; i < 512; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  const normalizedEmbedding = Array.from(out).map((v) => v / norm);

  console.log("✓ Embedding length:", normalizedEmbedding.length);
  console.log("✓ L2 Norm of embedding:", Math.sqrt(normalizedEmbedding.reduce((s, v) => s + v * v, 0)));
  console.log("✓ Sample 512-D vector values:", normalizedEmbedding.slice(0, 5));
}

run().catch(console.error);
