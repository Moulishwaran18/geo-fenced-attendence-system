/**
 * Module: antiSpoofService
 *
 * Presentation Attack Detection (PAD) evaluating multiple physical and visual attack vectors:
 * 1. Screen Moire & Subpixel High-Frequency Grids (detects phone/monitor LCD/OLED raster patterns).
 * 2. Specular Glare & Screen Surface Reflection (detects harsh planar glass reflections vs skin diffusion).
 * 3. Color Gamut & Histogram Uniformity (detects printed paper CMYK or screen gamma anomalies).
 * 4. Temporal Static Matrix Detector (flags motionless pixel matrices indicative of printed photos).
 */

import { FACE_CONFIG } from "./face-config";

export interface PresentationAttackAnalysis {
  passed: boolean;
  spoofRiskScore: number; // 0.0 (clean real) to 1.0 (high spoof probability)
  moirePatternDetected: boolean;
  specularGlareDetected: boolean;
  colorGamutAnomalous: boolean;
  staticMatrixDetected: boolean;
  details: {
    moireEnergy: number;
    glareRatio: number;
    colorDynamicRange: number;
    temporalMotionVariance: number;
  };
  failureReason?: string | undefined;
}

export class AntiSpoofService {
  private recentFrameHistories: Uint8ClampedArray[] = [];
  private readonly maxHistorySize = 6;

  /**
   * Reset temporal history buffers for a fresh verification session.
   */
  reset(): void {
    this.recentFrameHistories = [];
  }

  /**
   * Analyze cropped facial bounding box for presentation attacks.
   */
  analyzeFaceROI(
    video: HTMLVideoElement,
    faceBox: { x: number; y: number; width: number; height: number },
  ): PresentationAttackAnalysis {
    if (!video.videoWidth || !video.videoHeight || faceBox.width <= 0 || faceBox.height <= 0) {
      return {
        passed: true,
        spoofRiskScore: 0.1,
        moirePatternDetected: false,
        specularGlareDetected: false,
        colorGamutAnomalous: false,
        staticMatrixDetected: false,
        details: {
          moireEnergy: 0,
          glareRatio: 0,
          colorDynamicRange: 100,
          temporalMotionVariance: 50,
        },
      };
    }

    // Crop face ROI to offscreen canvas
    const roiWidth = 128;
    const roiHeight = 128;
    const canvas = document.createElement("canvas");
    canvas.width = roiWidth;
    canvas.height = roiHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      return {
        passed: true,
        spoofRiskScore: 0.1,
        moirePatternDetected: false,
        specularGlareDetected: false,
        colorGamutAnomalous: false,
        staticMatrixDetected: false,
        details: {
          moireEnergy: 0,
          glareRatio: 0,
          colorDynamicRange: 100,
          temporalMotionVariance: 50,
        },
      };
    }

    // Add 10% padding around face
    const padX = faceBox.width * 0.1;
    const padY = faceBox.height * 0.1;
    const sx = Math.max(0, faceBox.x - padX);
    const sy = Math.max(0, faceBox.y - padY);
    const sw = Math.min(video.videoWidth - sx, faceBox.width + padX * 2);
    const sh = Math.min(video.videoHeight - sy, faceBox.height + padY * 2);

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, roiWidth, roiHeight);
    const imgData = ctx.getImageData(0, 0, roiWidth, roiHeight);
    const data = imgData.data;

    // 1. High-Frequency Moire Energy (Screen Raster Pattern)
    const moireEnergy = this.computeHighFrequencyMoireEnergy(data, roiWidth, roiHeight);
    const moirePatternDetected = moireEnergy > FACE_CONFIG.ANTI_SPOOF.MOIRE_THRESHOLD;

    // 2. Specular Screen Glare & Reflection Ratio
    const glareRatio = this.computeSpecularGlareRatio(data);
    const specularGlareDetected = glareRatio > FACE_CONFIG.ANTI_SPOOF.MAX_GLARE_RATIO;

    // 3. Color Gamut & Dynamic Range (Printed paper compression)
    const colorDynamicRange = this.computeColorDynamicRange(data);
    const colorGamutAnomalous = colorDynamicRange < FACE_CONFIG.ANTI_SPOOF.MIN_DYNAMIC_RANGE;

    // 4. Temporal Motion & Static Matrix Check
    const currentGrayscale = this.toGrayscaleBuffer(data);
    const temporalMotionVariance = this.updateTemporalHistory(currentGrayscale);
    const staticMatrixDetected =
      this.recentFrameHistories.length >= 4 &&
      temporalMotionVariance < FACE_CONFIG.ANTI_SPOOF.MIN_TEMPORAL_VARIANCE;

    // Combined Probabilistic Spoof Risk Score
    let riskScore = 0.05;
    if (moirePatternDetected) riskScore += 0.35;
    if (specularGlareDetected) riskScore += 0.25;
    if (colorGamutAnomalous) riskScore += 0.20;
    if (staticMatrixDetected) riskScore += 0.35;
    riskScore = Math.min(1.0, riskScore);

    const passed = riskScore < FACE_CONFIG.ANTI_SPOOF.MAX_SPOOF_RISK;

    let failureReason: string | undefined;
    if (moirePatternDetected || specularGlareDetected) {
      failureReason = "Screen or display reflection detected. Please use the live camera directly.";
    } else if (staticMatrixDetected) {
      failureReason = "Static image detected. Live physical motion is required.";
    } else if (colorGamutAnomalous) {
      failureReason = "Printed photo or color anomaly detected.";
    } else if (!passed) {
      failureReason = "Presentation attack detected. Verification rejected.";
    }

    return {
      passed,
      spoofRiskScore: riskScore,
      moirePatternDetected,
      specularGlareDetected,
      colorGamutAnomalous,
      staticMatrixDetected,
      details: {
        moireEnergy,
        glareRatio,
        colorDynamicRange,
        temporalMotionVariance,
      },
      failureReason,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Internal Anti-Spoof Feature Calculators                         */
  /* ---------------------------------------------------------------- */

  private computeHighFrequencyMoireEnergy(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): number {
    // Computes high-pass gradient energy across high-frequency diagonals
    let highFreqEnergy = 0;
    let totalEnergy = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const curLum = 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!;

        const rightIdx = (y * width + (x + 1)) * 4;
        const rightLum = 0.299 * data[rightIdx]! + 0.587 * data[rightIdx + 1]! + 0.114 * data[rightIdx + 2]!;

        const bottomIdx = ((y + 1) * width + x) * 4;
        const bottomLum = 0.299 * data[bottomIdx]! + 0.587 * data[bottomIdx + 1]! + 0.114 * data[bottomIdx + 2]!;

        const dx = Math.abs(curLum - rightLum);
        const dy = Math.abs(curLum - bottomLum);

        totalEnergy += curLum;
        if (dx > 25 && dy > 25) {
          // Sharp repetitive alternating high-frequency edge
          highFreqEnergy += (dx + dy);
        }
      }
    }

    return totalEnergy > 0 ? (highFreqEnergy * 100) / totalEnergy : 0;
  }

  private computeSpecularGlareRatio(data: Uint8ClampedArray): number {
    let saturatedPixels = 0;
    const totalPixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // Specular glare on phone glass creates harsh RGB > 245 clusters
      if (r > 245 && g > 245 && b > 245) {
        saturatedPixels++;
      }
    }

    return saturatedPixels / totalPixels;
  }

  private computeColorDynamicRange(data: Uint8ClampedArray): number {
    let minR = 255, maxR = 0;
    let minG = 255, maxG = 0;
    let minB = 255, maxB = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }

    const rangeR = maxR - minR;
    const rangeG = maxG - minG;
    const rangeB = maxB - minB;
    return (rangeR + rangeG + rangeB) / 3.0;
  }

  private toGrayscaleBuffer(data: Uint8ClampedArray): Uint8ClampedArray {
    const gray = new Uint8ClampedArray(data.length / 4);
    for (let i = 0, g = 0; i < data.length; i += 4, g++) {
      gray[g] = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    }
    return gray;
  }

  private updateTemporalHistory(currentGrayscale: Uint8ClampedArray): number {
    this.recentFrameHistories.push(currentGrayscale);
    if (this.recentFrameHistories.length > this.maxHistorySize) {
      this.recentFrameHistories.shift();
    }

    if (this.recentFrameHistories.length < 2) {
      return 100; // Normal default
    }

    // Compare with previous frame pixel-by-pixel
    const prev = this.recentFrameHistories[this.recentFrameHistories.length - 2]!;
    let totalDiff = 0;
    for (let i = 0; i < currentGrayscale.length; i++) {
      totalDiff += Math.abs(currentGrayscale[i]! - prev[i]!);
    }

    return totalDiff / currentGrayscale.length;
  }
}
