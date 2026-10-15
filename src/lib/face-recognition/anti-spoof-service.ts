/**
 * Module: antiSpoofService
 *
 * Presentation Attack Detection (PAD) evaluating multiple physical and visual attack vectors:
 * 1. MiniFASNet-V2 Deep Neural Network (Silent-Face-Anti-Spoofing, Apache-2.0, 80x80 BGR, 2.7x scale crop, [0..255] range).
 *    Class 0: Print attack (paper photo, posters)
 *    Class 1: REAL / LIVE (genuine human face)
 *    Class 2: Replay attack (smartphone, tablet, monitor display)
 * 2. Screen Moire & Subpixel High-Frequency Grids (detects LCD/OLED raster patterns).
 * 3. Specular Glare & Screen Surface Reflection (detects harsh planar glass reflections vs skin diffusion).
 * 4. Color Gamut & Histogram Uniformity (detects printed paper CMYK or screen gamma anomalies).
 * 5. Temporal Static Matrix Detector (flags motionless pixel matrices indicative of printed photos).
 */

import * as ort from "onnxruntime-web";
import { FACE_CONFIG } from "./face-config";

export interface PresentationAttackAnalysis {
  passed: boolean;
  liveScore: number; // 0.0 (spoof) to 1.0 (genuine human)
  spoofRiskScore: number; // 0.0 (clean real) to 1.0 (high spoof probability)
  printAttackScore: number;
  replayAttackScore: number;
  attackType: "none" | "print_attack" | "replay_attack" | "static_photo" | "screen_reflection";
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
  rawLogits?: number[] | undefined;
  failureReason?: string | undefined;
}

export interface AntiSpoofAggregatedResult {
  passed: boolean;
  medianLiveScore: number;
  maxPrintAttackScore: number;
  maxReplayAttackScore: number;
  p75PrintAttackScore: number;
  p75ReplayAttackScore: number;
  medianGlareRatio?: number;
  maxGlareRatio?: number;
  hasGlare?: boolean;
  maxMoireEnergy?: number;
  frameCount: number;
  attackType: "none" | "print_attack" | "replay_attack" | "static_photo" | "screen_reflection";
  reason?: string | undefined;
  lastRawLogits?: number[] | undefined;
  modelInfo: {
    name: string;
    inputShape: string;
    inputFormat: string;
    classMapping: string;
  };
}

function softmax(logits: number[]): number[] {
  const maxVal = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - maxVal));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return sumExp > 0 ? exps.map((v) => v / sumExp) : [0.33, 0.34, 0.33];
}

export class AntiSpoofService {
  private recentFrameHistories: Uint8ClampedArray[] = [];
  private readonly maxHistorySize = 8;
  private miniFASNetSession: ort.InferenceSession | null = null;
  private isModelLoading = false;
  private sampledAnalyses: PresentationAttackAnalysis[] = [];
  private customModelPath?: string | ArrayBuffer | undefined;
  private lastRawLogits: number[] | null = null;

  constructor(customModelPath?: string | ArrayBuffer | undefined) {
    this.customModelPath = customModelPath;
  }

  /**
   * Reset temporal history buffers and sampled frame metrics for a fresh verification session.
   */
  reset(): void {
    this.recentFrameHistories = [];
    this.sampledAnalyses = [];
    this.lastRawLogits = null;
  }

  /**
   * Initialize MiniFASNet-V2 ONNX inference session.
   */
  async initializeModel(modelUrlOrBuffer?: string | ArrayBuffer): Promise<boolean> {
    if (this.miniFASNetSession) return true;
    if (this.isModelLoading) return false;

    this.isModelLoading = true;
    try {
      const url = modelUrlOrBuffer || this.customModelPath || FACE_CONFIG.ANTI_SPOOF.MINIFASNET_MODEL_URL;
      if (typeof window !== "undefined") {
        this.miniFASNetSession = await ort.InferenceSession.create(url as string, {
          executionProviders: ["wasm"],
        });
      } else {
        // Node environment fallback for automated testing
        const fs = await import("fs");
        const path = await import("path");
        const modelPath =
          typeof url === "string" && !url.startsWith("http")
            ? path.resolve("public", url.replace(/^\//, ""))
            : path.resolve("public", "models", "MiniFASNetV2.onnx");

        if (fs.existsSync(modelPath)) {
          const buf = fs.readFileSync(modelPath);
          this.miniFASNetSession = await ort.InferenceSession.create(buf);
        } else {
          throw new Error(`MiniFASNet ONNX model not found at ${modelPath}`);
        }
      }
      return Boolean(this.miniFASNetSession);
    } catch (err) {
      console.warn("[AntiSpoofService] MiniFASNet ONNX initialization warning:", err);
      return false;
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * Check if MiniFASNet model is initialized and ready.
   */
  isModelReady(): boolean {
    return Boolean(this.miniFASNetSession);
  }

  /**
   * Analyze facial bounding box across optical cues and MiniFASNet neural network.
   */
  async analyzeFrame(
    sourceCanvasOrVideo: HTMLCanvasElement | HTMLVideoElement,
    faceBox: { x: number; y: number; width: number; height: number },
  ): Promise<PresentationAttackAnalysis> {
    const srcW = (sourceCanvasOrVideo as HTMLVideoElement).videoWidth || sourceCanvasOrVideo.width || 0;
    const srcH = (sourceCanvasOrVideo as HTMLVideoElement).videoHeight || sourceCanvasOrVideo.height || 0;

    if (!srcW || !srcH || !faceBox || faceBox.width <= 0 || faceBox.height <= 0) {
      return {
        passed: false,
        liveScore: 0,
        spoofRiskScore: 1.0,
        printAttackScore: 0,
        replayAttackScore: 0,
        attackType: "static_photo",
        moirePatternDetected: false,
        specularGlareDetected: false,
        colorGamutAnomalous: false,
        staticMatrixDetected: true,
        details: { moireEnergy: 0, glareRatio: 0, colorDynamicRange: 0, temporalMotionVariance: 0 },
        failureReason: "Invalid frame geometry for anti-spoofing.",
      };
    }

    // ── 1. Optical PAD Analysis (128x128 crop) ──
    const roiWidth = 128;
    const roiHeight = 128;
    const padCanvas = document.createElement("canvas");
    padCanvas.width = roiWidth;
    padCanvas.height = roiHeight;
    const padCtx = padCanvas.getContext("2d", { willReadFrequently: true });

    if (!padCtx) {
      throw new Error("Could not create canvas context for anti-spoofing.");
    }

    const padX = faceBox.width * 0.1;
    const padY = faceBox.height * 0.1;
    const sx = Math.max(0, faceBox.x - padX);
    const sy = Math.max(0, faceBox.y - padY);
    const sw = Math.min(srcW - sx, faceBox.width + padX * 2);
    const sh = Math.min(srcH - sy, faceBox.height + padY * 2);

    padCtx.drawImage(sourceCanvasOrVideo, sx, sy, sw, sh, 0, 0, roiWidth, roiHeight);
    const imgData = padCtx.getImageData(0, 0, roiWidth, roiHeight);
    const data = imgData.data;

    // Blank frame detection: If camera frame is unpainted / pure black, discard early
    let sumLum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sumLum += data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    }
    const avgLum = sumLum / (roiWidth * roiHeight);
    if (avgLum < 5) {
      return {
        passed: false,
        liveScore: 0.1,
        spoofRiskScore: 0.9,
        printAttackScore: 0.1,
        replayAttackScore: 0.1,
        attackType: "static_photo",
        moirePatternDetected: false,
        specularGlareDetected: false,
        colorGamutAnomalous: false,
        staticMatrixDetected: false,
        details: { moireEnergy: 0, glareRatio: 0, colorDynamicRange: 0, temporalMotionVariance: 0 },
        failureReason: "Camera frame unpainted or blank.",
      };
    }

    const moireEnergy = this.computeHighFrequencyMoireEnergy(data, roiWidth, roiHeight);
    const moirePatternDetected = moireEnergy > FACE_CONFIG.ANTI_SPOOF.MOIRE_THRESHOLD;

    const glareRatio = this.computeSpecularGlareRatio(data, roiWidth, roiHeight);

    const colorDynamicRange = this.computeColorDynamicRange(data);
    const colorGamutAnomalous = colorDynamicRange < FACE_CONFIG.ANTI_SPOOF.MIN_DYNAMIC_RANGE;

    const currentGrayscale = this.toGrayscaleBuffer(data);
    const temporalMotionVariance = this.updateTemporalHistory(currentGrayscale);
    const staticMatrixDetected =
      this.recentFrameHistories.length >= 4 &&
      temporalMotionVariance < FACE_CONFIG.ANTI_SPOOF.MIN_TEMPORAL_VARIANCE;

    // ── 2. MiniFASNet-V2 Deep Neural Network Inference (80x80 BGR, 2.7x scale, [0..255]) ──
    let miniFASNetLiveScore = 0.5;
    let printAttackScore = 0.25;
    let replayAttackScore = 0.25;
    let rawLogits: number[] | undefined;

    if (this.miniFASNetSession) {
      try {
        const cropScale = FACE_CONFIG.ANTI_SPOOF.CROP_SCALE || 2.7;
        const centerX = faceBox.x + faceBox.width / 2;
        const centerY = faceBox.y + faceBox.height / 2;
        const scaledW = faceBox.width * cropScale;
        const scaledH = faceBox.height * cropScale;

        const left = Math.max(0, centerX - scaledW / 2);
        const top = Math.max(0, centerY - scaledH / 2);
        const cropW = Math.min(srcW - left, scaledW);
        const cropH = Math.min(srcH - top, scaledH);

        const mCanvas = document.createElement("canvas");
        mCanvas.width = 80;
        mCanvas.height = 80;
        const mCtx = mCanvas.getContext("2d", { willReadFrequently: true });
        if (mCtx) {
          mCtx.drawImage(sourceCanvasOrVideo, left, top, cropW, cropH, 0, 0, 80, 80);
          const mData = mCtx.getImageData(0, 0, 80, 80).data;

          // Convert to BGR planar Float32Array [1, 3, 80, 80]
          // CRITICAL: MiniFASNet-V2 expects raw pixel values in [0..255], NOT divided by 255.0!
          // Dividing by 255 compresses all pixels to near-zero, which the model classifies as screen replay (99.4%).
          const floatArr = new Float32Array(3 * 80 * 80);
          for (let y = 0; y < 80; y++) {
            for (let x = 0; x < 80; x++) {
              const pIdx = (y * 80 + x) * 4;
              const r = mData[pIdx]!; // raw [0..255] float
              const g = mData[pIdx + 1]!;
              const b = mData[pIdx + 2]!;

              const idx = y * 80 + x;
              floatArr[0 * 6400 + idx] = b; // Blue channel
              floatArr[1 * 6400 + idx] = g; // Green channel
              floatArr[2 * 6400 + idx] = r; // Red channel
            }
          }

          const tensor = new ort.Tensor("float32", floatArr, [1, 3, 80, 80]);
          const results = await this.miniFASNetSession.run({ input: tensor });
          rawLogits = Array.from(results["output"]!.data as Float32Array);
          this.lastRawLogits = rawLogits;
          const probs = softmax(rawLogits);

          // MiniFASNet-V2 Class Mapping:
          // Class 0: Print Attack (paper, posters, photo print)
          // Class 1: REAL / LIVE (authentic human face)
          // Class 2: Replay Attack (smartphone screen, monitor display)
          printAttackScore = Number(probs[0]!.toFixed(4));
          miniFASNetLiveScore = Number(probs[1]!.toFixed(4));
          replayAttackScore = Number(probs[2]!.toFixed(4));
        }
      } catch (err) {
        console.warn("[AntiSpoofService] MiniFASNet inference failed, relying on optical PAD:", err);
      }
    }

    // Glare evaluation: Fused neural and optical criteria.
    // Natural skin highlights (forehead, nose ridge, glasses) cover 3-12% of facial pixels.
    // Harsh planar electronic glass reflections cover >22%, or >14% corroborated by neural replay signals or moiré.
    const isExtremeGlare = glareRatio > FACE_CONFIG.ANTI_SPOOF.MAX_GLARE_RATIO;
    const isCorroboratedGlare =
      glareRatio > 0.14 &&
      (replayAttackScore >= 0.35 || moirePatternDetected || miniFASNetLiveScore < FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE);
    const specularGlareDetected = isExtremeGlare || isCorroboratedGlare;

    // ── 3. Combine Neural & Optical Probabilities ──
    let riskScore = 0.05;
    if (moirePatternDetected) riskScore += 0.35;
    if (specularGlareDetected) riskScore += 0.25;
    if (colorGamutAnomalous) riskScore += 0.20;
    if (staticMatrixDetected) riskScore += 0.40;

    // Weight MiniFASNet inference score
    if (this.miniFASNetSession) {
      if (printAttackScore > 0.40) riskScore += 0.45;
      if (replayAttackScore > 0.40) riskScore += 0.45;
      if (miniFASNetLiveScore < FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE) riskScore += 0.35;
    }

    riskScore = Math.min(1.0, Math.max(0.0, riskScore));
    const liveScore = this.miniFASNetSession
      ? Math.max(0.0, Math.min(1.0, miniFASNetLiveScore * (1.0 - riskScore * 0.5)))
      : Math.max(0.0, 1.0 - riskScore);

    let attackType: "none" | "print_attack" | "replay_attack" | "static_photo" | "screen_reflection" = "none";
    let failureReason: string | undefined;

    if (printAttackScore > 0.40 || colorGamutAnomalous) {
      attackType = "print_attack";
      failureReason = `Printed photograph detected (Print confidence: ${(printAttackScore * 100).toFixed(1)}%). Genuine live face required.`;
    } else if (replayAttackScore > 0.40 || moirePatternDetected) {
      attackType = "replay_attack";
      failureReason = `Screen or video replay attack detected (Screen confidence: ${(replayAttackScore * 100).toFixed(1)}%). Presentation attack rejected.`;
    } else if (staticMatrixDetected) {
      attackType = "static_photo";
      failureReason = "Static photograph detected. Zero natural facial movement observed.";
    } else if (specularGlareDetected) {
      attackType = "screen_reflection";
      failureReason = "Harsh electronic screen glass reflection detected. Use direct live camera.";
    } else if (liveScore < FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE) {
      attackType = "print_attack";
      failureReason = `Low anti-spoof confidence score (${(liveScore * 100).toFixed(1)}% < ${(FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE * 100)}%). Verification rejected.`;
    }

    const passed =
      liveScore >= FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE &&
      riskScore <= FACE_CONFIG.ANTI_SPOOF.MAX_SPOOF_RISK &&
      printAttackScore < 0.40 &&
      replayAttackScore < 0.40 &&
      !moirePatternDetected &&
      !specularGlareDetected &&
      !colorGamutAnomalous &&
      !staticMatrixDetected;

    // ── 4. Cache Sample for Aggregated Verification ──
    const analysis: PresentationAttackAnalysis = {
      passed,
      liveScore,
      spoofRiskScore: riskScore,
      printAttackScore,
      replayAttackScore,
      attackType,
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
      rawLogits,
      failureReason,
    };

    this.sampledAnalyses.push(analysis);
    if (this.sampledAnalyses.length > 20) {
      this.sampledAnalyses.shift();
    }

    return analysis;
  }

  /**
   * Get the aggregated decision across sampled frames with statistically robust median analysis.
   */
  getAggregatedResult(): AntiSpoofAggregatedResult {
    const modelInfo = {
      name: "MiniFASNetV2.onnx (80x80 BGR)",
      inputShape: "[1, 3, 80, 80]",
      inputFormat: "BGR planar, raw [0..255] float range",
      classMapping: "0: Print Attack, 1: Genuine Live Face, 2: Screen Replay Attack",
    };

    if (this.sampledAnalyses.length === 0) {
      return {
        passed: false,
        medianLiveScore: 0,
        maxPrintAttackScore: 0,
        maxReplayAttackScore: 0,
        p75PrintAttackScore: 0,
        p75ReplayAttackScore: 0,
        frameCount: 0,
        attackType: "static_photo",
        reason: "No presentation-attack detection frames sampled.",
        lastRawLogits: this.lastRawLogits || undefined,
        modelInfo,
      };
    }

    const sortedLive = this.sampledAnalyses.map((a) => a.liveScore).sort((a, b) => a - b);
    const medianLiveScore = sortedLive[Math.floor(sortedLive.length / 2)] ?? 0;

    const sortedPrint = this.sampledAnalyses.map((a) => a.printAttackScore).sort((a, b) => a - b);
    const maxPrintAttackScore = Math.max(...sortedPrint);
    const p75PrintIdx = Math.min(sortedPrint.length - 1, Math.floor(sortedPrint.length * 0.75));
    const p75PrintAttackScore = sortedPrint[p75PrintIdx] ?? 0;

    const sortedReplay = this.sampledAnalyses.map((a) => a.replayAttackScore).sort((a, b) => a - b);
    const maxReplayAttackScore = Math.max(...sortedReplay);
    const p75ReplayIdx = Math.min(sortedReplay.length - 1, Math.floor(sortedReplay.length * 0.75));
    const p75ReplayAttackScore = sortedReplay[p75ReplayIdx] ?? 0;

    const failedSample = this.sampledAnalyses.find((a) => !a.passed);
    const moireCount = this.sampledAnalyses.filter((a) => a.moirePatternDetected).length;
    const staticMatrixCount = this.sampledAnalyses.filter((a) => a.staticMatrixDetected).length;

    const sortedGlare = this.sampledAnalyses.map((a) => a.details.glareRatio).sort((a, b) => a - b);
    const medianGlareRatio = sortedGlare[Math.floor(sortedGlare.length / 2)] ?? 0;
    const maxGlareRatio = Math.max(...this.sampledAnalyses.map((a) => a.details.glareRatio), 0);
    const maxMoireEnergy = Math.max(...this.sampledAnalyses.map((a) => a.details.moireEnergy), 0);

    // Optical cues require at least 2 consistent frames to trigger a hard rejection
    const hasMoire = moireCount >= 2;
    const hasStaticMatrix = staticMatrixCount >= 2;

    // Glare requires either extreme screen glare across multiple frames (>22%)
    // OR corroborated glare (>14%) coupled with neural replay indicators or low live score
    const extremeGlareCount = this.sampledAnalyses.filter(
      (a) => a.details.glareRatio > FACE_CONFIG.ANTI_SPOOF.MAX_GLARE_RATIO,
    ).length;
    const corroboratedGlareCount = this.sampledAnalyses.filter(
      (a) =>
        a.details.glareRatio > 0.14 &&
        (a.replayAttackScore >= 0.35 || a.moirePatternDetected || a.liveScore < FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE),
    ).length;
    const hasGlare = extremeGlareCount >= 2 || corroboratedGlareCount >= 2;

    const passed =
      this.sampledAnalyses.length >= 3 &&
      medianLiveScore >= FACE_CONFIG.ANTI_SPOOF.MIN_LIVE_SCORE &&
      p75PrintAttackScore < 0.40 &&
      p75ReplayAttackScore < 0.40 &&
      !hasStaticMatrix &&
      !hasMoire &&
      !hasGlare;

    let attackType: "none" | "print_attack" | "replay_attack" | "static_photo" | "screen_reflection" = "none";
    let reason: string | undefined;

    if (!passed) {
      if (p75PrintAttackScore >= 0.40) {
        attackType = "print_attack";
        reason = `Presentation attack detected: Printed photograph (Print score: ${(p75PrintAttackScore * 100).toFixed(1)}%).`;
      } else if (p75ReplayAttackScore >= 0.40 || hasMoire) {
        attackType = "replay_attack";
        reason = `Presentation attack detected: Electronic screen or video replay (Replay score: ${(p75ReplayAttackScore * 100).toFixed(1)}%).`;
      } else if (hasStaticMatrix) {
        attackType = "static_photo";
        reason = "Presentation attack detected: Static image with zero natural facial micro-movement.";
      } else if (hasGlare) {
        attackType = "screen_reflection";
        reason = "Presentation attack detected: Harsh electronic display glass glare.";
      } else {
        attackType = failedSample?.attackType || "print_attack";
        reason = failedSample?.failureReason || `Anti-spoof score insufficient (Median: ${(medianLiveScore * 100).toFixed(1)}%).`;
      }
    }

    return {
      passed,
      medianLiveScore,
      maxPrintAttackScore,
      maxReplayAttackScore,
      p75PrintAttackScore,
      p75ReplayAttackScore,
      medianGlareRatio,
      maxGlareRatio,
      hasGlare,
      maxMoireEnergy,
      frameCount: this.sampledAnalyses.length,
      attackType,
      reason,
      lastRawLogits: this.lastRawLogits || undefined,
      modelInfo,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Optical Anti-Spoof Feature Extractors                           */
  /* ---------------------------------------------------------------- */

  private computeHighFrequencyMoireEnergy(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): number {
    let laplacianSum = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const center = (data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3;

        const left = (data[idx - 4]! + data[idx - 3]! + data[idx - 2]!) / 3;
        const right = (data[idx + 4]! + data[idx + 5]! + data[idx + 6]!) / 3;
        const up = (data[idx - width * 4]! + data[idx - width * 4 + 1]! + data[idx - width * 4 + 2]!) / 3;
        const down = (data[idx + width * 4]! + data[idx + width * 4 + 1]! + data[idx + width * 4 + 2]!) / 3;

        const laplacian = Math.abs(4 * center - left - right - up - down);
        laplacianSum += laplacian;
        count++;
      }
    }

    const meanLaplacian = count > 0 ? laplacianSum / count : 0;
    return Math.min(1.0, meanLaplacian / 50.0);
  }

  private computeSpecularGlareRatio(data: Uint8ClampedArray, width?: number, height?: number): number {
    const totalPixels = data.length / 4;
    if (totalPixels === 0) return 0;

    const side = Math.round(Math.sqrt(totalPixels));
    const w = width ?? side;
    const h = height ?? side;

    // Exclude top 12% padding band (where overhead lighting, whiteboards, or light ceilings reside)
    // and margin margins (5% on sides and bottom) to evaluate the actual facial region.
    const startY = Math.floor(h * 0.12);
    const endY = Math.floor(h * 0.95);
    const startX = Math.floor(w * 0.05);
    const endX = Math.floor(w * 0.95);

    let saturatedPixels = 0;
    let evaluatedPixels = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * w + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;

        evaluatedPixels++;
        if (r > 248 && g > 248 && b > 248) {
          saturatedPixels++;
        }
      }
    }

    return evaluatedPixels > 0 ? saturatedPixels / evaluatedPixels : 0;
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

    return ((maxR - minR) + (maxG - minG) + (maxB - minB)) / 3;
  }

  private toGrayscaleBuffer(data: Uint8ClampedArray): Uint8ClampedArray {
    const gray = new Uint8ClampedArray(data.length / 4);
    for (let i = 0; i < gray.length; i++) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return gray;
  }

  private updateTemporalHistory(currentFrame: Uint8ClampedArray): number {
    this.recentFrameHistories.push(currentFrame);
    if (this.recentFrameHistories.length > this.maxHistorySize) {
      this.recentFrameHistories.shift();
    }

    if (this.recentFrameHistories.length < 2) return 1.0;

    const prev = this.recentFrameHistories[this.recentFrameHistories.length - 2]!;
    let totalDiff = 0;
    for (let i = 0; i < currentFrame.length; i++) {
      totalDiff += Math.abs(currentFrame[i]! - prev[i]!);
    }

    return totalDiff / currentFrame.length;
  }
}
