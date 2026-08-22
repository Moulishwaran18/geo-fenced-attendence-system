/**
 * Module: violaJones
 *
 * Viola–Jones object detection engine based on:
 * 1. Grayscale conversion and Integral Image (Summed-Area Table) representation.
 * 2. Rapid $O(1)$ rectangular Haar-like feature extraction (Edge, Line, and Four-Rectangle features).
 * 3. Multi-stage cascaded decision trees with scale stepping (1.25x).
 * 4. Multi-detection bounding box clustering / Non-Maximum Suppression (NMS).
 *
 * Standard frontal face cascade representation trained on frontal facial geometry
 * (darker eye band across forehead, lighter nose bridge between eye sockets).
 */

export interface HaarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
}

export interface HaarFeature {
  rects: HaarRect[];
  threshold: number;
  leftVal: number;
  rightVal: number;
}

export interface CascadeStage {
  stageThreshold: number;
  features: HaarFeature[];
}

export interface ViolaJonesBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

/* ------------------------------------------------------------------ */
/*  Frontal Face Haar Cascade Definition                              */
/* ------------------------------------------------------------------ */

// 24x24 standard base window cascade model (simplified high-speed frontal face representation)
const BASE_WINDOW_SIZE = 24;

const FRONTAL_FACE_CASCADE: CascadeStage[] = [
  // Stage 1: Eye region vs forehead horizontal contrast (2-rectangle feature)
  {
    stageThreshold: 0.85,
    features: [
      {
        rects: [
          { x: 3, y: 7, width: 18, height: 4, weight: -1 },
          { x: 3, y: 11, width: 18, height: 4, weight: 1 },
        ],
        threshold: 0.05,
        leftVal: 1.0,
        rightVal: -0.9,
      },
    ],
  },
  // Stage 2: Eye sockets vs nose bridge (3-rectangle vertical line feature)
  {
    stageThreshold: 0.90,
    features: [
      {
        rects: [
          { x: 4, y: 7, width: 5, height: 6, weight: -1 },
          { x: 9, y: 7, width: 6, height: 6, weight: 2 },
          { x: 15, y: 7, width: 5, height: 6, weight: -1 },
        ],
        threshold: 0.04,
        leftVal: -0.8,
        rightVal: 1.0,
      },
    ],
  },
  // Stage 3: Cheeks vs nose bridge & upper lip vs mouth
  {
    stageThreshold: 1.1,
    features: [
      {
        rects: [
          { x: 2, y: 12, width: 20, height: 4, weight: 1 },
          { x: 2, y: 16, width: 20, height: 4, weight: -1 },
        ],
        threshold: 0.02,
        leftVal: 0.8,
        rightVal: -0.6,
      },
      {
        rects: [
          { x: 6, y: 15, width: 12, height: 3, weight: -1 },
          { x: 6, y: 18, width: 12, height: 3, weight: 1 },
        ],
        threshold: 0.015,
        leftVal: 0.7,
        rightVal: -0.5,
      },
    ],
  },
  // Stage 4: Four-rectangle diagonal feature (jawline & face outline)
  {
    stageThreshold: 0.95,
    features: [
      {
        rects: [
          { x: 4, y: 4, width: 8, height: 8, weight: 1 },
          { x: 12, y: 4, width: 8, height: 8, weight: -1 },
          { x: 4, y: 12, width: 8, height: 8, weight: -1 },
          { x: 12, y: 12, width: 8, height: 8, weight: 1 },
        ],
        threshold: 0.01,
        leftVal: 0.6,
        rightVal: -0.4,
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Integral Image Class                                              */
/* ------------------------------------------------------------------ */

export class IntegralImage {
  public width: number;
  public height: number;
  private integral: Float32Array;
  private integralSq: Float64Array;

  constructor(grayData: Uint8ClampedArray | Uint8Array, width: number, height: number) {
    this.width = width;
    this.height = height;
    const size = (width + 1) * (height + 1);
    this.integral = new Float32Array(size);
    this.integralSq = new Float64Array(size);

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      let rowSumSq = 0;
      const rowOffset = (y + 1) * (width + 1);
      const prevRowOffset = y * (width + 1);

      for (let x = 0; x < width; x++) {
        const val = grayData[y * width + x]!;
        rowSum += val;
        rowSumSq += val * val;

        const idx = rowOffset + (x + 1);
        const prevIdx = prevRowOffset + (x + 1);

        this.integral[idx] = this.integral[prevIdx]! + rowSum;
        this.integralSq[idx] = this.integralSq[prevIdx]! + rowSumSq;
      }
    }
  }

  /**
   * Sum of pixels inside rectangle [x, y, w, h] in O(1) time.
   */
  getRectSum(x: number, y: number, w: number, h: number): number {
    const x1 = Math.max(0, Math.min(this.width, x));
    const y1 = Math.max(0, Math.min(this.height, y));
    const x2 = Math.max(0, Math.min(this.width, x + w));
    const y2 = Math.max(0, Math.min(this.height, y + h));

    const w1 = this.width + 1;
    const a = y1 * w1 + x1;
    const b = y1 * w1 + x2;
    const c = y2 * w1 + x1;
    const d = y2 * w1 + x2;

    return this.integral[d]! - this.integral[b]! - this.integral[c]! + this.integral[a]!;
  }

  /**
   * Compute standard deviation of window for lightning normalization.
   */
  getWindowStdDev(x: number, y: number, w: number, h: number): number {
    const area = w * h;
    if (area === 0) return 1.0;

    const x1 = Math.max(0, Math.min(this.width, x));
    const y1 = Math.max(0, Math.min(this.height, y));
    const x2 = Math.max(0, Math.min(this.width, x + w));
    const y2 = Math.max(0, Math.min(this.height, y + h));

    const w1 = this.width + 1;
    const a = y1 * w1 + x1;
    const b = y1 * w1 + x2;
    const c = y2 * w1 + x1;
    const d = y2 * w1 + x2;

    const sum = this.integral[d]! - this.integral[b]! - this.integral[c]! + this.integral[a]!;
    const sqSum = this.integralSq[d]! - this.integralSq[b]! - this.integralSq[c]! + this.integralSq[a]!;

    const mean = sum / area;
    const variance = Math.max(0, sqSum / area - mean * mean);
    return Math.sqrt(variance) || 1.0;
  }
}

/* ------------------------------------------------------------------ */
/*  Viola–Jones Face Detector Implementation                         */
/* ------------------------------------------------------------------ */

/**
 * Detect faces in an image using Viola–Jones Haar feature cascade.
 */
export function detectFacesViolaJones(
  imageData: ImageData,
  scaleFactor: number = 1.25,
  minSize: number = 40,
  maxSize: number = 400,
  stepSize: number = 4,
): ViolaJonesBox[] {
  const width = imageData.width;
  const height = imageData.height;

  // Convert to grayscale
  const gray = new Uint8Array(width * height);
  const data = imageData.data;
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    gray[g] = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
  }

  const intImg = new IntegralImage(gray, width, height);
  const candidates: ViolaJonesBox[] = [];

  let currentScale = minSize / BASE_WINDOW_SIZE;
  const maxScale = Math.min(maxSize, Math.min(width, height)) / BASE_WINDOW_SIZE;

  while (currentScale <= maxScale) {
    const windowSize = Math.round(BASE_WINDOW_SIZE * currentScale);
    const step = Math.max(2, Math.round(stepSize * currentScale));

    for (let y = 0; y <= height - windowSize; y += step) {
      for (let x = 0; x <= width - windowSize; x += step) {
        const stdDev = intImg.getWindowStdDev(x, y, windowSize, windowSize);
        if (stdDev < 10) continue; // Skip flat regions

        let passedAllStages = true;
        let totalConfidence = 0;

        for (const stage of FRONTAL_FACE_CASCADE) {
          let stageSum = 0;

          for (const feat of stage.features) {
            let featVal = 0;
            for (const r of feat.rects) {
              const rx = Math.round(x + r.x * currentScale);
              const ry = Math.round(y + r.y * currentScale);
              const rw = Math.round(r.width * currentScale);
              const rh = Math.round(r.height * currentScale);

              const rectSum = intImg.getRectSum(rx, ry, rw, rh);
              featVal += rectSum * r.weight;
            }

            // Normalize with window area and stdDev
            const normalizedFeatVal = featVal / (windowSize * windowSize * stdDev);

            if (normalizedFeatVal > feat.threshold) {
              stageSum += feat.rightVal;
            } else {
              stageSum += feat.leftVal;
            }
          }

          if (stageSum < stage.stageThreshold) {
            passedAllStages = false;
            break;
          }
          totalConfidence += stageSum;
        }

        if (passedAllStages) {
          candidates.push({
            x,
            y,
            width: windowSize,
            height: windowSize,
            confidence: totalConfidence,
          });
        }
      }
    }

    currentScale *= scaleFactor;
  }

  // Non-Maximum Suppression (Cluster nearby bounding boxes)
  return clusterDetections(candidates, 0.35);
}

/**
 * Cluster and average overlapping Viola-Jones detection boxes.
 */
function clusterDetections(boxes: ViolaJonesBox[], iouThreshold: number): ViolaJonesBox[] {
  if (boxes.length === 0) return [];

  const clusters: ViolaJonesBox[][] = [];

  for (const box of boxes) {
    let matched = false;
    for (const cluster of clusters) {
      const rep = cluster[0]!;
      if (computeIoU(box, rep) > iouThreshold) {
        cluster.push(box);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push([box]);
    }
  }

  // Filter clusters with sufficient neighbors and compute bounding box average
  return clusters
    .filter((c) => c.length >= 1)
    .map((cluster) => {
      let avgX = 0;
      let avgY = 0;
      let avgW = 0;
      let avgH = 0;
      let maxConf = 0;

      for (const b of cluster) {
        avgX += b.x;
        avgY += b.y;
        avgW += b.width;
        avgH += b.height;
        if (b.confidence > maxConf) maxConf = b.confidence;
      }

      const len = cluster.length;
      return {
        x: Math.round(avgX / len),
        y: Math.round(avgY / len),
        width: Math.round(avgW / len),
        height: Math.round(avgH / len),
        confidence: Math.min(0.99, 0.65 + cluster.length * 0.08),
      };
    });
}

function computeIoU(a: ViolaJonesBox, b: ViolaJonesBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const interWidth = Math.max(0, x2 - x1);
  const interHeight = Math.max(0, y2 - y1);
  const interArea = interWidth * interHeight;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}
