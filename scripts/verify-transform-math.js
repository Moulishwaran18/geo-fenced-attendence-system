const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

// Photo 1 corrected landmarks
const src = [
  [340.98, 461.98],
  [480.05, 464.66],
  [408.53, 540.33],
  [353.45, 615.45],
  [464.29, 619.25]
];

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= n; srcMeanY /= n;
  dstMeanX /= n; dstMeanY /= n;

  let srcVar = 0, sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - srcMeanX;
    const sy = src[i][1] - srcMeanY;
    const dx = dst[i][0] - dstMeanX;
    const dy = dst[i][1] - dstMeanY;
    srcVar += sx * sx + sy * sy;
    sxx += dx * sx;
    sxy += dx * sy;
    syx += dy * sx;
    syy += dy * sy;
  }
  srcVar /= n; sxx /= n; sxy /= n; syx /= n; syy /= n;

  const a = (sxx + syy) / srcVar;
  const b = (sxy - syx) / srcVar;
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const det = a * a + b * b;
  const invA = a / det;
  const invB = -b / det;
  const invTx = (-a * tx - b * ty) / det;
  const invTy = (b * tx - a * ty) / det;

  const invM = [
    [invA, -invB, invTx],
    [invB, invA, invTy],
  ];

  return { M: [[a, -b, tx], [b, a, ty]], invM };
}

const { invM } = estimateSimilarityTransform(src);
console.log('Testing Inverse Transform Accuracy:');
ARCFACE_REFERENCE_POINTS.forEach((dstPt, i) => {
  const backX = invM[0][0] * dstPt[0] + invM[0][1] * dstPt[1] + invM[0][2];
  const backY = invM[1][0] * dstPt[0] + invM[1][1] * dstPt[1] + invM[1][2];
  console.log('  Point ' + i + ': dst=' + JSON.stringify(dstPt) + ' -> mapped back=[' + backX.toFixed(2) + ', ' + backY.toFixed(2) + '] (expected: [' + src[i][0] + ', ' + src[i][1] + '])');
});
