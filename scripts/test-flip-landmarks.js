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

// Suppose face in 640x480 frame:
const W = 640, H = 480;
// Typical face landmarks centered at (320, 240), box width 200:
const normalLandmarks = [
  [280, 210], // left eye (viewer's left)
  [360, 210], // right eye (viewer's right)
  [320, 250], // nose
  [290, 290], // left mouth
  [350, 290], // right mouth
];

// If frame is flipped horizontally:
// Point at x becomes (W - 1 - x)
// The left eye (280) moves to 640 - 1 - 280 = 359 (now on the right of the flipped frame!)
// The right eye (360) moves to 640 - 1 - 360 = 279 (now on the left of the flipped frame!)
// So the 5 landmark points for the flipped image MUST be ordered:
// [newLeftEye, newRightEye, newNose, newLeftMouth, newRightMouth]
const flippedCorrectLandmarks = [
  [W - 1 - normalLandmarks[1][0], normalLandmarks[1][1]], // former right eye is now the left eye at 279!
  [W - 1 - normalLandmarks[0][0], normalLandmarks[0][1]], // former left eye is now the right eye at 359!
  [W - 1 - normalLandmarks[2][0], normalLandmarks[2][1]], // nose at 319
  [W - 1 - normalLandmarks[4][0], normalLandmarks[4][1]], // former right mouth is now left mouth
  [W - 1 - normalLandmarks[3][0], normalLandmarks[3][1]], // former left mouth is now right mouth
];

console.log("Normal landmarks:", normalLandmarks);
console.log("Flipped correctly mapped landmarks:", flippedCorrectLandmarks);

const resNormal = estimateSimilarityTransform(normalLandmarks, ARCFACE_REFERENCE_POINTS);
const resFlipped = estimateSimilarityTransform(flippedCorrectLandmarks, ARCFACE_REFERENCE_POINTS);

console.log("Normal mapped eye 0:", [
  resNormal.M[0][0] * normalLandmarks[0][0] + resNormal.M[0][1] * normalLandmarks[0][1] + resNormal.M[0][2],
  resNormal.M[1][0] * normalLandmarks[0][0] + resNormal.M[1][1] * normalLandmarks[0][1] + resNormal.M[1][2],
]);
console.log("Flipped mapped eye 0:", [
  resFlipped.M[0][0] * flippedCorrectLandmarks[0][0] + resFlipped.M[0][1] * flippedCorrectLandmarks[0][1] + resFlipped.M[0][2],
  resFlipped.M[1][0] * flippedCorrectLandmarks[0][0] + resFlipped.M[1][1] * flippedCorrectLandmarks[0][1] + resFlipped.M[1][2],
]);
