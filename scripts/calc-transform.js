const ARCFACE_REFERENCE_POINTS = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

const src = [
  [313.9502431402604, 592.9861728449663],
  [423.2662575642268, 591.5484916170439],
  [374.1148945093155, 654.0841021537781],
  [329.2997488975525, 709.1060136556625],
  [411.7569167613983, 710.9269624948502],
];

function estimateSimilarityTransform(src, dst = ARCFACE_REFERENCE_POINTS) {
  let srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
  const numPts = src.length;
  for (let i = 0; i < numPts; i++) {
    srcMeanX += src[i][0]; srcMeanY += src[i][1];
    dstMeanX += dst[i][0]; dstMeanY += dst[i][1];
  }
  srcMeanX /= numPts; srcMeanY /= numPts;
  dstMeanX /= numPts; dstMeanY /= numPts;

  let srcVar = 0, sxx = 0, syy = 0, sxy = 0, syx = 0;
  for (let i = 0; i < numPts; i++) {
    const sX = src[i][0] - srcMeanX, sY = src[i][1] - srcMeanY;
    const dX = dst[i][0] - dstMeanX, dY = dst[i][1] - dstMeanY;
    srcVar += sX * sX + sY * sY;
    sxx += sX * dX; syy += sY * dY;
    sxy += sX * dY; syx += sY * dX;
  }
  srcVar /= numPts;
  sxx /= numPts; syy /= numPts; sxy /= numPts; syx /= numPts;

  const a = (sxx + syy) / (srcVar || 1e-6);
  const b = (sxy - syx) / (srcVar || 1e-6);
  const tx = dstMeanX - (a * srcMeanX - b * srcMeanY);
  const ty = dstMeanY - (b * srcMeanX + a * srcMeanY);

  const denom = a * a + b * b || 1e-6;
  const invA = a / denom;
  const invB = -b / denom;
  const invTx = -(invA * tx - invB * ty);
  const invTy = -(invB * tx + invA * ty);

  return {
    M: [[a, -b, tx], [b, a, ty]],
    invM: [[invA, -invB, invTx], [invB, invA, invTy]],
    scale: Math.sqrt(a*a + b*b),
    invScale: 1 / Math.sqrt(a*a + b*b),
    rotationDeg: Math.atan2(b, a) * 180 / Math.PI
  };
}

console.log('Transform for Mobile Frame 92823:');
console.log(estimateSimilarityTransform(src));

console.log('\nMapped Reference Points back to source image:');
const t = estimateSimilarityTransform(src);
ARCFACE_REFERENCE_POINTS.forEach((pt, i) => {
  const sx = t.invM[0][0] * pt[0] + t.invM[0][1] * pt[1] + t.invM[0][2];
  const sy = t.invM[1][0] * pt[0] + t.invM[1][1] * pt[1] + t.invM[1][2];
  console.log('  Ref[' + i + '] -> [' + sx.toFixed(2) + ', ' + sy.toFixed(2) + '] vs src[' + i + '] [' + src[i][0].toFixed(2) + ', ' + src[i][1].toFixed(2) + ']');
});
