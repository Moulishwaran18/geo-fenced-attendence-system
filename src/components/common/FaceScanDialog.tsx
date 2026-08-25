import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Loader2,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import * as faceapi from "face-api.js";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadModels,
  initArcFaceSession,
  generateArcFaceEmbedding,
  detectFacesWithLandmarks,
  createAuthoritativeDetection,
  getSsdOptions,
  drawCompleteFaceOverlay,
  verifyLiveFace,
  generateAlignedFacePreview,
  generateCroppedFacePreview,
  evaluateFaceCropQuality,
  calculateCosineDistance,
  getDetailedEAR,
  extract5Landmarks,
  FACE_CONFIG,
  type VerificationResult,
  type VerifyFaceResponse,
} from "@/lib/face-recognition";

/* ------------------------------------------------------------------ */
/*  Types & Props                                                      */
/* ------------------------------------------------------------------ */

export type VerificationPhase =
  | "loading-models"
  | "starting"
  | "detecting"
  | "stabilizing"
  | "recognizing"
  | "matched"
  | "unrecognized"
  | "error";

function computeVectorFingerprint(vec: number[]): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < vec.length; i++) {
    const v = Math.round((vec[i] ?? 0) * 100000);
    hash ^= v & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (v >> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export interface FaceScanResult {
  staffId: string;
  staffName: string;
  distance: number;
  snapshot: string;
  verification: VerificationResult;
}

interface DiagnosticState {
  fps: number;
  frameResolution: string;
  frameFormat: string;
  framesAnalyzed: number;
  lastFrameTime: number;
  detectorReady: boolean;
  detectorModel: string;
  faceCount: number;
  faceDetected: boolean;
  faceConfidence: number;
  faceStable: boolean;
  stabilityDurationMs: number;
  verificationSessionId: string;
  embeddingFingerprint: string;
  framesCapturedCount: number;
  goodFramesCount: number;
  rejectedFramesCount: number;
  bestFrameIndex: number | null;
  consensusIdentity: string;
  consensusCount: number;
  consensusTotalGood: number;
  multiFrameHistory: Array<{
    frameIndex: number;
    isGood: boolean;
    rejectReason?: string;
    confidence: number;
    sharpness: number;
    brightness: number;
    identity: string;
    distance: number | null;
    margin: number | null;
    decision: string;
    fingerprint: string;
  }>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  landmarksCount: number;
  alignmentPoints: { x: number; y: number }[] | null;
  embeddingDim: number;
  liveEmbeddingL2Norm: number;
  recognitionTimestamp: string;
  originalFramePreview: string | null;
  croppedFacePreview: string | null;
  alignedFacePreview: string | null;
  qualitySharpness: number;
  qualityBrightness: number;
  qualityContrast: number;
  faceWidthRatio: number;
  faceHeightRatio: number;
  meanEAR: number;
  fiveLandmarksPreAlign: number[][];
  fivePoseDistances: Array<{ pose: string; dist: number; sim: number }>;
  p1MinDist: number | null;
  p1MaxDist: number | null;
  p1MeanDist: number | null;
  vectorStats: { min: number; max: number; mean: number; nans: number; infs: number } | null;
  searchedEmbeddingsCount: number;
  embeddingsPerStaff: Record<string, number>;
  personDistances: Array<{ staffCode: string; name: string; minDistance: number; embeddingCount: number }>;
  allCandidates: Array<{
    staffCode: string;
    name: string;
    embeddingId: string;
    referenceImagePath: string;
    distance: number;
  }>;
  bestMatch: { staffCode: string; name: string; distance: number } | null;
  secondBestMatch: { staffCode: string; name: string; distance: number } | null;
  distance: number | null;
  threshold: number;
  margin: number;
  matchMargin: number | null;
  finalResult: string;
  enrolledStaffCount: number;
  databaseStatus: string;
}

export function FaceScanDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (result: FaceScanResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isLoopRunningRef = useRef(false);
  const isVerifyingRef = useRef(false);
  const isFaceDetectedRef = useRef(false);
  const lastFaceCountRef = useRef(-1);
  const lastUiUpdateRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(Date.now());
  const currentFpsRef = useRef<number>(0);

  // Temporal Face Stability Tracking Refs
  const stabilityStartTimeRef = useRef<number | null>(null);
  const stableFrameCountRef = useRef<number>(0);
  const lastBoxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const attemptCounterRef = useRef(0);
  const activeSessionIdRef = useRef("");

  const [phase, setPhase] = useState<VerificationPhase>("loading-models");
  const [errorMessage, setErrorMessage] = useState("");
  const [liveGuidance, setLiveGuidance] = useState<string>("Searching for face...");
  const [modelProgress, setModelProgress] = useState(0);
  const [matchName, setMatchName] = useState<string>("");
  const [matchCode, setMatchCode] = useState<string>("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [isFaceStable, setIsFaceStable] = useState<boolean>(false);
  const [stabilityDurationMs, setStabilityDurationMs] = useState<number>(0);

  // Developer Diagnostic Telemetry State
  const [diag, setDiag] = useState<DiagnosticState>({
    fps: 0,
    frameResolution: "—",
    frameFormat: "RGB (HTMLVideoElement)",
    framesAnalyzed: 0,
    lastFrameTime: 0,
    detectorReady: false,
    detectorModel: "SSD MobileNet V1 + 68 Landmarks",
    faceCount: 0,
    faceDetected: false,
    faceConfidence: 0,
    faceStable: false,
    stabilityDurationMs: 0,
    verificationSessionId: "—",
    embeddingFingerprint: "—",
    framesCapturedCount: 0,
    goodFramesCount: 0,
    rejectedFramesCount: 0,
    bestFrameIndex: null,
    consensusIdentity: "IDLE",
    consensusCount: 0,
    consensusTotalGood: 0,
    multiFrameHistory: [],
    boundingBox: null,
    landmarksCount: 0,
    alignmentPoints: null,
    embeddingDim: 512,
    liveEmbeddingL2Norm: 1.0,
    recognitionTimestamp: "—",
    originalFramePreview: null,
    croppedFacePreview: null,
    alignedFacePreview: null,
    qualitySharpness: 0,
    qualityBrightness: 0,
    qualityContrast: 0,
    faceWidthRatio: 0,
    faceHeightRatio: 0,
    meanEAR: 0.28,
    fiveLandmarksPreAlign: [],
    fivePoseDistances: [],
    p1MinDist: null,
    p1MaxDist: null,
    p1MeanDist: null,
    vectorStats: null,
    searchedEmbeddingsCount: 5,
    embeddingsPerStaff: { PERSON_001: 5 },
    personDistances: [],
    allCandidates: [],
    bestMatch: null,
    secondBestMatch: null,
    distance: null,
    threshold: FACE_CONFIG.MATCH_THRESHOLD,
    margin: FACE_CONFIG.MIN_MATCH_MARGIN,
    matchMargin: null,
    finalResult: "IDLE",
    enrolledStaffCount: 1,
    databaseStatus: "5 Active Embeddings (PERSON_001 Active)",
  });
  const [rawDetectorLog, setRawDetectorLog] = useState<string>("Initializing raw detector stream...");
  const [showDiag, setShowDiag] = useState(true);

  // Forward references to break circular hook dependencies
  const executeRecognitionRef = useRef<() => Promise<void>>(async () => {});
  const startDetectionLoopRef = useRef<() => void>(() => {});
  const startCameraRef = useRef<() => Promise<void>>(async () => {});

  /* ---------------------------------------------------------------- */
  /*  Camera Lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  const stopCamera = useCallback(() => {
    isLoopRunningRef.current = false;
    isVerifyingRef.current = false;
    isFaceDetectedRef.current = false;
    lastFaceCountRef.current = -1;
    stabilityStartTimeRef.current = null;
    stableFrameCountRef.current = 0;
    lastBoxRef.current = null;
    activeSessionIdRef.current = "";
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Multi-Frame Recognition Pipeline (Burst Capture & Consensus)    */
  /* ---------------------------------------------------------------- */

  const executeRecognition = useCallback(async () => {
    if (isVerifyingRef.current) return;
    isVerifyingRef.current = true;
    setPhase("recognizing");

    const video = videoRef.current;

    try {
      if (!video || !video.videoWidth || !video.videoHeight) {
        throw new Error("Live camera stream unavailable for biometric alignment.");
      }

      // Generate Unique Session ID for this exact live verification attempt
      attemptCounterRef.current++;
      const pad = String(attemptCounterRef.current).padStart(4, "0");
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const verificationSessionId = `VERIFY-${dateStr}-${pad}`;
      activeSessionIdRef.current = verificationSessionId;

      const TOTAL_BURST_FRAMES = 6;
      const goodFrames: Array<{
        frameIndex: number;
        timestamp: string;
        confidence: number;
        sharpness: number;
        brightness: number;
        meanEAR: number;
        box: { x: number; y: number; width: number; height: number };
        landmarks: faceapi.FaceLandmarks68;
        arcFaceDescriptor: number[];
        fingerprint: string;
        l2Norm: number;
        verifyRes: VerifyFaceResponse;
        originalFramePreview: string;
        croppedFacePreview: string;
        alignedFacePreview: string;
        preAlign5: number[][];
      }> = [];

      const frameHistory: Array<{
        frameIndex: number;
        isGood: boolean;
        rejectReason?: string;
        confidence: number;
        sharpness: number;
        brightness: number;
        identity: string;
        distance: number | null;
        margin: number | null;
        decision: string;
        fingerprint: string;
      }> = [];

      let capturedCount = 0;
      let rejectedCount = 0;

      for (let i = 0; i < TOTAL_BURST_FRAMES; i++) {
        if (!video || !video.videoWidth || !video.videoHeight) break;
        capturedCount++;

        // 1. Capture synchronous frame snapshot
        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = video.videoWidth;
        snapCanvas.height = video.videoHeight;
        const snapCtx = snapCanvas.getContext("2d");
        if (!snapCtx) continue;
        snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        const frameTimestamp = new Date().toISOString();

        // 2. Authoritative face detection & landmarks on snapshot
        const rawDetections = await faceapi
          .detectAllFaces(snapCanvas, getSsdOptions())
          .withFaceLandmarks();

        const authDetection = createAuthoritativeDetection(
          rawDetections.map((d) => ({
            landmarks: d.landmarks,
            confidence: d.detection.score,
            box: d.detection.box,
          })),
        );

        if (rawDetections.length !== 1 || !authDetection.detected) {
          rejectedCount++;
          frameHistory.push({
            frameIndex: i + 1,
            isGood: false,
            rejectReason: rawDetections.length === 0 ? "No face" : "Multiple faces",
            confidence: authDetection.confidence,
            sharpness: 0,
            brightness: 0,
            identity: "REJECTED",
            distance: null,
            margin: null,
            decision: "REJECTED",
            fingerprint: "—",
          });
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }

        const liveFace = rawDetections[0]!;
        const ear = getDetailedEAR(liveFace.landmarks);
        const qual = evaluateFaceCropQuality(
          snapCanvas,
          video.videoWidth,
          video.videoHeight,
          liveFace.detection.box,
          authDetection.confidence,
        );

        if (ear.meanEAR < 0.20 || !qual.isQualityAcceptable) {
          rejectedCount++;
          frameHistory.push({
            frameIndex: i + 1,
            isGood: false,
            rejectReason: ear.meanEAR < 0.20 ? "Blink / eye closure" : (qual.rejectReason || "Quality poor"),
            confidence: authDetection.confidence,
            sharpness: qual.sharpness,
            brightness: qual.brightness,
            identity: "REJECTED",
            distance: null,
            margin: null,
            decision: "REJECTED",
            fingerprint: "—",
          });
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }

        // Quality Gate Passed -> Generate Alignment & Previews
        const preAlign5 = extract5Landmarks(liveFace.landmarks);

        const fullFrameCanvas = document.createElement("canvas");
        fullFrameCanvas.width = video.videoWidth;
        fullFrameCanvas.height = video.videoHeight;
        const fCtx = fullFrameCanvas.getContext("2d");
        if (fCtx) {
          fCtx.drawImage(snapCanvas, 0, 0);
          fCtx.strokeStyle = "rgba(52, 211, 153, 0.9)";
          fCtx.lineWidth = 3;
          fCtx.strokeRect(liveFace.detection.box.x, liveFace.detection.box.y, liveFace.detection.box.width, liveFace.detection.box.height);
        }
        const originalFramePreview = fullFrameCanvas.toDataURL("image/jpeg", 0.85);

        const croppedFacePreview = generateCroppedFacePreview(
          snapCanvas,
          video.videoWidth,
          video.videoHeight,
          liveFace.detection.box,
        );

        const alignedPreviewUrl = generateAlignedFacePreview(
          snapCanvas,
          video.videoWidth,
          video.videoHeight,
          liveFace.landmarks,
        );

        // Generate ArcFace embedding
        const arcFaceDescriptor = await generateArcFaceEmbedding(
          snapCanvas,
          video.videoWidth,
          video.videoHeight,
          liveFace.landmarks,
        );

        const liveFingerprint = computeVectorFingerprint(arcFaceDescriptor);
        const l2Norm = Math.sqrt(arcFaceDescriptor.reduce((s, v) => s + v * v, 0));

        // Call backend vector search endpoint
        const verifyRes = await verifyLiveFace(
          arcFaceDescriptor,
          true,
          undefined,
          verificationSessionId,
          liveFingerprint,
        );

        const frameIdentity = verifyRes.matched ? (verifyRes.staff?.staffCode || "AUTHORIZED") : (verifyRes.bestCandidate?.staffCode || "UNKNOWN");
        const frameDist = verifyRes.bestCandidate?.distance ?? null;
        const frameMargin = verifyRes.matchMargin ?? null;
        const frameDecision = verifyRes.matched ? "MATCH" : "NO_MATCH";

        goodFrames.push({
          frameIndex: i + 1,
          timestamp: frameTimestamp,
          confidence: authDetection.confidence,
          sharpness: qual.sharpness,
          brightness: qual.brightness,
          meanEAR: ear.meanEAR,
          box: {
            x: Math.round(liveFace.detection.box.x),
            y: Math.round(liveFace.detection.box.y),
            width: Math.round(liveFace.detection.box.width),
            height: Math.round(liveFace.detection.box.height),
          },
          landmarks: liveFace.landmarks,
          arcFaceDescriptor,
          fingerprint: liveFingerprint,
          l2Norm,
          verifyRes,
          originalFramePreview,
          croppedFacePreview,
          alignedFacePreview: alignedPreviewUrl,
          preAlign5,
        });

        frameHistory.push({
          frameIndex: i + 1,
          isGood: true,
          confidence: authDetection.confidence,
          sharpness: qual.sharpness,
          brightness: qual.brightness,
          identity: frameIdentity,
          distance: frameDist,
          margin: frameMargin,
          decision: frameDecision,
          fingerprint: liveFingerprint,
        });

        await new Promise((r) => setTimeout(r, 60));
      }

      // Race Guard Check
      if (activeSessionIdRef.current !== verificationSessionId) {
        console.warn(`[Frontend Race Guard] Dropped stale consensus response for session ${verificationSessionId}. Active is ${activeSessionIdRef.current}`);
        return;
      }

      // Check if we have at least 3 good frames
      if (goodFrames.length < 3) {
        setDiag((prev) => ({
          ...prev,
          verificationSessionId,
          framesCapturedCount: capturedCount,
          goodFramesCount: goodFrames.length,
          rejectedFramesCount: rejectedCount,
          consensusIdentity: "INSUFFICIENT",
          consensusCount: 0,
          consensusTotalGood: goodFrames.length,
          multiFrameHistory: frameHistory,
          finalResult: "UNKNOWN",
        }));
        setPhase("unrecognized");
        setErrorMessage("Hold still and face the camera directly. (Insufficient clear frames)");
        isVerifyingRef.current = false;
        return;
      }

      // Consensus Calculation: Tally identity votes
      const identityVotes: Record<string, number> = {};
      const matchingFramesByIdentity: Record<string, typeof goodFrames> = {};

      for (const gf of goodFrames) {
        if (gf.verifyRes.matched && gf.verifyRes.staff) {
          const code = gf.verifyRes.staff.staffCode;
          identityVotes[code] = (identityVotes[code] || 0) + 1;
          if (!matchingFramesByIdentity[code]) matchingFramesByIdentity[code] = [];
          matchingFramesByIdentity[code]!.push(gf);
        } else {
          identityVotes["UNKNOWN"] = (identityVotes["UNKNOWN"] || 0) + 1;
        }
      }

      let topIdentity = "UNKNOWN";
      let topVotes = 0;
      for (const [id, count] of Object.entries(identityVotes)) {
        if (count > topVotes) {
          topVotes = count;
          topIdentity = id;
        }
      }

      const isConsensusPassed = topIdentity !== "UNKNOWN" && topVotes >= 3;

      // Select best frame among matching frames (or lowest distance good frame)
      const candidatePool = isConsensusPassed && matchingFramesByIdentity[topIdentity]
        ? [...matchingFramesByIdentity[topIdentity]!]
        : [...goodFrames];

      candidatePool.sort((a, b) => (a.verifyRes.bestCandidate?.distance ?? 1.0) - (b.verifyRes.bestCandidate?.distance ?? 1.0));
      const bestFrame = candidatePool[0]!;
      const bestVerifyRes = bestFrame.verifyRes;

      const allCandidatesList = bestVerifyRes.allCandidates ?? [];
      const p1Candidates = allCandidatesList.filter((c: { staffCode: string }) => c.staffCode === "PERSON_001");
      const p1Dists = p1Candidates.map((c: { referenceImagePath: string; distance: number }, idx: number) => ({
        pose: `Reference ${idx + 1} (${c.referenceImagePath.split("/").pop()})`,
        dist: c.distance,
        sim: 1 - c.distance,
      }));
      const p1DistValues = p1Dists.map((p: { dist: number }) => p.dist);
      const p1Min = p1DistValues.length > 0 ? Math.min(...p1DistValues) : null;
      const p1Max = p1DistValues.length > 0 ? Math.max(...p1DistValues) : null;
      const p1Mean = p1DistValues.length > 0 ? p1DistValues.reduce((a: number, b: number) => a + b, 0) / p1DistValues.length : null;

      const bestCand = bestVerifyRes.bestCandidate ?? null;
      const secondCand = bestVerifyRes.secondBestCandidate ?? null;
      const bestDist = bestCand ? bestCand.distance : null;
      const secondDist = secondCand ? secondCand.distance : 1.0;
      const margin = secondDist !== null && bestDist !== null ? secondDist - bestDist : null;

      const finalResult = isConsensusPassed ? (bestVerifyRes.staff?.staffCode || "AUTHORIZED") : "UNKNOWN";

      const nanCount = bestFrame.arcFaceDescriptor.filter((v) => isNaN(v)).length;
      const infCount = bestFrame.arcFaceDescriptor.filter((v) => !isFinite(v)).length;
      const minVal = Math.min(...bestFrame.arcFaceDescriptor);
      const maxVal = Math.max(...bestFrame.arcFaceDescriptor);
      const meanVal = bestFrame.arcFaceDescriptor.reduce((a, b) => a + b, 0) / bestFrame.arcFaceDescriptor.length;

      // Update developer diagnostic panel metrics
      setDiag((prev) => ({
        ...prev,
        faceDetected: true,
        faceConfidence: bestFrame.confidence,
        faceStable: true,
        stabilityDurationMs: stabilityDurationMs,
        verificationSessionId,
        embeddingFingerprint: bestFrame.fingerprint,
        framesCapturedCount: capturedCount,
        goodFramesCount: goodFrames.length,
        rejectedFramesCount: rejectedCount,
        bestFrameIndex: bestFrame.frameIndex,
        consensusIdentity: topIdentity,
        consensusCount: topVotes,
        consensusTotalGood: goodFrames.length,
        multiFrameHistory: frameHistory,
        boundingBox: bestFrame.box,
        landmarksCount: bestFrame.landmarks.positions.length,
        embeddingDim: bestFrame.arcFaceDescriptor.length,
        liveEmbeddingL2Norm: bestFrame.l2Norm,
        recognitionTimestamp: bestFrame.timestamp,
        originalFramePreview: bestFrame.originalFramePreview,
        croppedFacePreview: bestFrame.croppedFacePreview,
        alignedFacePreview: bestFrame.alignedFacePreview,
        qualitySharpness: bestFrame.sharpness,
        qualityBrightness: bestFrame.brightness,
        qualityContrast: 0,
        meanEAR: bestFrame.meanEAR,
        fiveLandmarksPreAlign: bestFrame.preAlign5,
        fivePoseDistances: p1Dists,
        p1MinDist: p1Min,
        p1MaxDist: p1Max,
        p1MeanDist: p1Mean,
        vectorStats: { min: minVal, max: maxVal, mean: meanVal, nans: nanCount, infs: infCount },
        searchedEmbeddingsCount: bestVerifyRes.searchedEmbeddingsCount ?? (bestVerifyRes.allCandidates?.length ?? 5),
        embeddingsPerStaff: bestVerifyRes.embeddingsPerStaff ?? { PERSON_001: 5 },
        personDistances: bestVerifyRes.personDistances ?? [],
        allCandidates: bestVerifyRes.allCandidates ?? [],
        bestMatch: bestCand,
        secondBestMatch: secondCand,
        distance: bestDist,
        threshold: bestVerifyRes.threshold ?? FACE_CONFIG.MATCH_THRESHOLD,
        margin: bestVerifyRes.margin ?? FACE_CONFIG.MIN_MATCH_MARGIN,
        matchMargin: margin,
        finalResult,
      }));

      if (!isConsensusPassed || !bestVerifyRes.staff) {
        setPhase("unrecognized");
        setErrorMessage(
          topIdentity === "UNKNOWN"
            ? "Unknown Face. Face is not registered."
            : `Inconsistent recognition consensus (${topVotes}/${goodFrames.length}). Please hold still.`,
        );
        isVerifyingRef.current = false;
        return;
      }

      setMatchName(bestVerifyRes.staff.name);
      setMatchCode(bestVerifyRes.staff.staffCode);
      setPhase("matched");
    } catch (err) {
      console.error("Biometric recognition error:", err);
      setPhase("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Biometric matching failed. Please ensure your camera is functioning.",
      );
    } finally {
      isVerifyingRef.current = false;
    }
  }, [stabilityDurationMs]);

  executeRecognitionRef.current = executeRecognition;

  /* ---------------------------------------------------------------- */
  /*  Frame Analysis Loop (Detection & Temporal Stability Gate)        */
  /* ---------------------------------------------------------------- */

  const startDetectionLoop = useCallback(() => {
    if (isLoopRunningRef.current) return;
    isLoopRunningRef.current = true;
    frameCountRef.current = 0;
    lastFaceCountRef.current = -1;
    fpsTimerRef.current = Date.now();
    stabilityStartTimeRef.current = null;
    stableFrameCountRef.current = 0;
    lastBoxRef.current = null;

    const frameLoop = async () => {
      if (!isLoopRunningRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || video.readyState < 2 || !canvas || video.videoWidth === 0) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        return;
      }

      frameCountRef.current++;
      const currentFrameIndex = frameCountRef.current;
      const now = Date.now();
      if (now - fpsTimerRef.current >= 1000) {
        currentFpsRef.current = Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current));
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        return;
      }

      try {
        const faces = await detectFacesWithLandmarks(video);
        const authDetection = createAuthoritativeDetection(faces);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (faces.length === 0) {
          stabilityStartTimeRef.current = null;
          stableFrameCountRef.current = 0;
          lastBoxRef.current = null;
          setIsFaceStable(false);
          setStabilityDurationMs(0);
          setLiveGuidance("No face detected. Center your face in camera.");

          if (isFaceDetectedRef.current) {
            isFaceDetectedRef.current = false;
            setFaceDetected(false);
          }

          if (now - lastUiUpdateRef.current > 120) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              fps: currentFpsRef.current,
              frameResolution: `${video.videoWidth}x${video.videoHeight}`,
              framesAnalyzed: prev.framesAnalyzed + 1,
              lastFrameTime: now,
              faceCount: 0,
              faceDetected: false,
              faceConfidence: 0,
              faceStable: false,
              stabilityDurationMs: 0,
              boundingBox: null,
              landmarksCount: 0,
            }));
          }
        } else if (faces.length > 1) {
          stabilityStartTimeRef.current = null;
          stableFrameCountRef.current = 0;
          lastBoxRef.current = null;
          setIsFaceStable(false);
          setStabilityDurationMs(0);
          setLiveGuidance("Multiple faces detected. Only one person should be visible.");

          if (isFaceDetectedRef.current) {
            isFaceDetectedRef.current = false;
            setFaceDetected(false);
          }

          faces.forEach((f: { box: faceapi.Box }) => {
            ctx.save();
            ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
            ctx.lineWidth = 3;
            ctx.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height);
            ctx.font = "bold 12px monospace";
            ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
            ctx.fillText(`Multiple Faces (${faces.length})`, f.box.x, Math.max(16, f.box.y - 6));
            ctx.restore();
          });

          if (now - lastUiUpdateRef.current > 120) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              fps: currentFpsRef.current,
              frameResolution: `${video.videoWidth}x${video.videoHeight}`,
              framesAnalyzed: prev.framesAnalyzed + 1,
              lastFrameTime: now,
              faceCount: faces.length,
              faceDetected: false,
              faceConfidence: 0,
              faceStable: false,
              stabilityDurationMs: 0,
              boundingBox: null,
            }));
          }
        } else {
          // Exactly 1 face
          const face = faces[0]!;
          const box = authDetection.boundingBox;
          const validBox = Boolean(box && box.width >= 100 && box.height >= 100);

          if (!isFaceDetectedRef.current && validBox) {
            isFaceDetectedRef.current = true;
            setFaceDetected(true);
          }

          // Check temporal stability against previous box
          const lastBox = lastBoxRef.current;
          let isStableFrame = false;
          if (lastBox && box) {
            const dx = Math.abs(box.x - lastBox.x);
            const dy = Math.abs(box.y - lastBox.y);
            const dw = Math.abs(box.width - lastBox.width);
            const dh = Math.abs(box.height - lastBox.height);
            if (dx <= 18 && dy <= 18 && dw <= 18 && dh <= 18) {
              isStableFrame = true;
            }
          }

          if (box) {
            lastBoxRef.current = { ...box };
          }

          if (isStableFrame) {
            stableFrameCountRef.current++;
            if (!stabilityStartTimeRef.current) {
              stabilityStartTimeRef.current = now;
            }
          } else {
            stabilityStartTimeRef.current = now;
            stableFrameCountRef.current = 1;
          }

          const currentStabilityDuration = stabilityStartTimeRef.current ? now - stabilityStartTimeRef.current : 0;
          setStabilityDurationMs(currentStabilityDuration);

          // Check Quality & Eyes
          const earInfo = getDetailedEAR(face.landmarks);
          const isEyeOpen = earInfo.meanEAR >= 0.20;
          const qual = box
            ? evaluateFaceCropQuality(video, video.videoWidth, video.videoHeight, box, authDetection.confidence)
            : null;

          let guidanceMsg = "Hold still...";
          if (box && (box.width < 120 || box.height < 120)) {
            guidanceMsg = "Move closer to camera...";
          } else if (qual && qual.brightness < 35) {
            guidanceMsg = "Move to better lighting...";
          } else if (qual && qual.brightness > 225) {
            guidanceMsg = "Avoid strong glare / move to softer light...";
          } else if (qual && qual.sharpness < 15.0) {
            guidanceMsg = "Hold still... (Image blurred)";
          } else if (!isEyeOpen) {
            guidanceMsg = "Keep eyes open...";
          } else if (currentStabilityDuration < 400 || stableFrameCountRef.current < 5) {
            guidanceMsg = `Hold still... (${Math.min(currentStabilityDuration, 400)}ms / 400ms)`;
          } else {
            guidanceMsg = "Face stable ✓ Recognizing...";
          }
          setLiveGuidance(guidanceMsg);

          const isFullyStableAndClear =
            validBox &&
            authDetection.confidence >= 0.30 &&
            qual &&
            qual.isQualityAcceptable &&
            isEyeOpen &&
            currentStabilityDuration >= 400 &&
            stableFrameCountRef.current >= 5;

          setIsFaceStable(Boolean(isFullyStableAndClear));

          drawCompleteFaceOverlay(canvas, face, {
            boxColor: isFullyStableAndClear ? "rgba(52, 211, 153, 0.95)" : "rgba(56, 189, 248, 0.9)",
            landmarkColor: "rgba(52, 211, 153, 0.7)",
            alignmentPointsColor: "rgba(56, 189, 248, 1.0)",
            showLandmarks: true,
            showAlignmentPoints: true,
            showLabel: true,
          });

          if (now - lastUiUpdateRef.current > 100) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              fps: currentFpsRef.current,
              frameResolution: `${video.videoWidth}x${video.videoHeight}`,
              framesAnalyzed: prev.framesAnalyzed + 1,
              lastFrameTime: now,
              faceCount: 1,
              faceDetected: Boolean(validBox),
              faceConfidence: authDetection.confidence,
              faceStable: Boolean(isFullyStableAndClear),
              stabilityDurationMs: currentStabilityDuration,
              boundingBox: authDetection.boundingBox,
              landmarksCount: face.landmarks.positions.length,
              qualitySharpness: qual?.sharpness ?? 0,
              qualityBrightness: qual?.brightness ?? 0,
              meanEAR: earInfo.meanEAR,
            }));
          }

          // Trigger face recognition automatically when face is fully stabilized & clear
          if (isFullyStableAndClear && !isVerifyingRef.current) {
            isLoopRunningRef.current = false;
            void executeRecognitionRef.current();
            return;
          }
        }
      } catch (err) {
        console.error("Frame tracking error:", err);
      }

      if (isLoopRunningRef.current && !isVerifyingRef.current) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
      }
    };

    animFrameRef.current = requestAnimationFrame(() => void frameLoop());
  }, []);

  startDetectionLoopRef.current = startDetectionLoop;

  /* ---------------------------------------------------------------- */
  /*  Start Camera Stream                                              */
  /* ---------------------------------------------------------------- */

  const startCamera = useCallback(async () => {
    setPhase("starting");
    setErrorMessage("");
    setMatchName("");
    setMatchCode("");
    setFaceDetected(false);
    isVerifyingRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available in this browser.");
      }

      // Clean up previous stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: FACE_CONFIG.CAMERA.facingMode,
          width: FACE_CONFIG.CAMERA.width,
          height: FACE_CONFIG.CAMERA.height,
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (video.readyState >= 2) {
            video.play().catch(() => {}).finally(() => resolve());
          } else {
            video.onloadedmetadata = () => {
              video.play().catch(() => {}).finally(() => resolve());
            };
          }
        });
      }

      setPhase("detecting");
      startDetectionLoopRef.current();
    } catch (err) {
      console.error("Camera startup error:", err);
      setPhase("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Could not start camera stream.",
      );
    }
  }, []);

  startCameraRef.current = startCamera;

  /* ---------------------------------------------------------------- */
  /*  Lifecycle: Initialize Models on Dialog Open                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let mounted = true;

    if (!open) {
      stopCamera();
      return;
    }

    const init = async () => {
      try {
        setPhase("loading-models");
        setModelProgress(30);

        await Promise.all([loadModels(), initArcFaceSession()]);
        if (!mounted) return;
        setModelProgress(100);

        setDiag((prev) => ({
          ...prev,
          detectorReady: true,
        }));

        if (mounted) {
          await startCameraRef.current();
        }
      } catch (err) {
        if (!mounted) return;
        console.error("Model loading error:", err);
        setPhase("error");
        setErrorMessage("Failed to load biometric recognition models.");
      }
    };

    void init();

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [open, stopCamera]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="pb-2 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanFace className="size-5 text-primary" />
            Face Detection & Vector Recognition Pipeline
          </DialogTitle>
          <DialogDescription className="text-xs">
            SSD MobileNet V1 Face Detection · ArcFace 512-D Embedding · Active Staff Database Search
          </DialogDescription>
        </DialogHeader>

        {/* Video Camera Container */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-border shadow-inner">
          <video
            ref={videoRef}
            playsInline
            muted
            className="size-full object-cover -scale-x-100"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 size-full -scale-x-100"
          />

          {/* Model Loading State */}
          {phase === "loading-models" && (
            <div className="absolute inset-0 grid place-items-center bg-muted/90 p-6">
              <div className="w-full max-w-[200px] space-y-3 text-center">
                <Loader2 className="mx-auto size-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Loading ArcFace AI Models</p>
                <Progress value={modelProgress} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{modelProgress}%</p>
              </div>
            </div>
          )}

          {/* Camera Starting State */}
          {phase === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-muted/80 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Starting camera feed…
              </span>
            </div>
          )}

          {/* Recognizing State */}
          {phase === "recognizing" && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-[2px] text-white">
              <div className="text-center space-y-2">
                <Loader2 className="size-8 animate-spin mx-auto text-primary" />
                <p className="text-xs font-semibold">Aligning 112×112 Face & Searching Database…</p>
              </div>
            </div>
          )}

          {/* Camera Error */}
          {phase === "error" && (
            <div className="absolute inset-0 grid place-items-center gap-2 p-6 text-center bg-muted/95">
              <div>
                <CameraOff className="mx-auto size-8 text-destructive" aria-hidden />
                <p className="mt-2 text-sm text-destructive font-medium">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Matched State Banner */}
          {phase === "matched" && matchName && (
            <div className="absolute inset-x-0 bottom-0 bg-success/95 text-white px-3 py-2 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-1.5 text-xs font-bold">
                <ShieldCheck className="size-4" /> Face Recognized: {matchCode} ({matchName})
              </p>
            </div>
          )}

          {/* Unrecognized / Unknown State Banner */}
          {phase === "unrecognized" && (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/95 text-white px-3 py-2 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-1 text-xs font-bold">
                <XCircle className="size-4" /> {errorMessage || "Unknown Face. Face is not registered."}
              </p>
            </div>
          )}

          {/* Live Detection & Stability Status Indicator */}
          {phase === "detecting" && (
            <div className="absolute top-2 left-2 flex items-center gap-2">
              <div className="bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-mono border border-white/10 text-white">
                {diag.faceCount === 1 ? (
                  <span className="text-emerald-400 font-bold">● 1 Face ({(diag.faceConfidence * 100).toFixed(0)}%)</span>
                ) : diag.faceCount > 1 ? (
                  <span className="text-red-400 font-bold">● {diag.faceCount} Faces (Multiple)</span>
                ) : (
                  <span className="text-amber-400">○ No face</span>
                )}
              </div>
              <div className="bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-sans border border-white/10 text-white font-medium">
                {liveGuidance}
              </div>
            </div>
          )}
        </div>

        {/* ================================================== */}
        {/* DEVELOPMENT RECOGNITION & TELEMETRY PANEL           */}
        {/* ================================================== */}
        <div className="rounded-xl border border-border bg-card overflow-hidden text-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between bg-muted/50 px-3.5 py-2 font-semibold text-muted-foreground hover:bg-muted transition-colors"
            onClick={() => setShowDiag((d) => !d)}
          >
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <Cpu className="size-3.5 text-primary" />
              Live Face-to-ArcFace Diagnostic & Verification Panel
            </span>
            {showDiag ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {showDiag && (
            <div className="p-3.5 space-y-3 font-mono text-[11px] bg-background">
              {/* Section 1: Live Capture Stability & Quality Telemetry */}
              <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-border pb-1">
                  <span className="text-foreground">Live Frame Stability & Quality Gate:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono h-4 font-bold",
                      diag.faceStable ? "border-success text-success bg-success/10" : "border-amber-500 text-amber-500 bg-amber-500/10",
                    )}
                  >
                    Face stable: {diag.faceStable ? "YES" : "NO"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Session ID</div>
                    <div className="font-bold text-primary truncate">{diag.verificationSessionId}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Vector Fingerprint</div>
                    <div className="font-bold text-foreground font-mono">{diag.embeddingFingerprint}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Stability duration</div>
                    <div className="font-bold text-foreground">{diag.stabilityDurationMs} ms / 400 ms</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Detector confidence</div>
                    <div className="font-bold text-foreground">{(diag.faceConfidence * 100).toFixed(1)}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Face size</div>
                    <div className="font-bold text-foreground">{diag.boundingBox ? `${diag.boundingBox.width}x${diag.boundingBox.height}px` : "—"}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Blur score (Sharpness)</div>
                    <div className={cn("font-bold", diag.qualitySharpness >= 15 ? "text-success" : "text-destructive")}>
                      {diag.qualitySharpness.toFixed(1)} {diag.qualitySharpness >= 15 ? "(Clear)" : "(Blur)"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Brightness</div>
                    <div className="font-bold text-foreground">{Math.round(diag.qualityBrightness)} / 255 (Req: 35–225)</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Eye Openness (EAR)</div>
                    <div className="font-bold text-foreground">{diag.meanEAR.toFixed(3)} (Open: &ge; 0.20)</div>
                  </div>
                </div>
              </div>

              {/* Section 1.5: Multi-Frame Consensus Telemetry */}
              <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-border pb-1">
                  <span className="text-foreground">Multi-Frame Burst Sequence & Consensus:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono h-4 font-bold",
                      diag.consensusIdentity.startsWith("PERSON_")
                        ? "border-success text-success bg-success/10"
                        : "border-amber-500 text-amber-500 bg-amber-500/10",
                    )}
                  >
                    Consensus: {diag.consensusIdentity} ({diag.consensusCount}/{diag.consensusTotalGood})
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Frames captured</div>
                    <div className="font-bold text-foreground">{diag.framesCapturedCount} frames</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Good frames</div>
                    <div className="font-bold text-success">{diag.goodFramesCount} passed</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Rejected frames</div>
                    <div className={cn("font-bold", diag.rejectedFramesCount > 0 ? "text-destructive" : "text-muted-foreground")}>
                      {diag.rejectedFramesCount} rejected
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Best frame #</div>
                    <div className="font-bold text-primary">
                      {diag.bestFrameIndex ? `Frame #${diag.bestFrameIndex} (Dist: ${diag.distance?.toFixed(4)})` : "—"}
                    </div>
                  </div>
                </div>

                {/* Per-Frame Detailed Results Table */}
                {diag.multiFrameHistory.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border">
                    <div className="text-[10px] text-muted-foreground font-sans font-semibold">
                      Per-Frame Biometric Evaluation Breakdown:
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {diag.multiFrameHistory.map((f) => (
                        <div
                          key={f.frameIndex}
                          className={cn(
                            "flex items-center justify-between px-2 py-1 rounded border text-[9px] font-mono",
                            f.frameIndex === diag.bestFrameIndex
                              ? "border-primary/60 bg-primary/10"
                              : "border-border bg-background/80",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">#{f.frameIndex}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[8px] h-3.5 px-1 font-mono",
                                f.isGood ? "border-success text-success" : "border-destructive text-destructive",
                              )}
                            >
                              {f.isGood ? "GOOD" : "REJECT"}
                            </Badge>
                            {f.rejectReason ? (
                              <span className="text-destructive text-[8px]">({f.rejectReason})</span>
                            ) : (
                              <span className="text-muted-foreground text-[8px]">
                                Conf: {(f.confidence * 100).toFixed(0)}% · Blur: {f.sharpness.toFixed(1)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-bold text-primary">{f.identity}</span>
                            {f.distance !== null && (
                              <span className={cn("font-mono font-semibold", f.distance <= 0.45 ? "text-success" : "text-destructive")}>
                                {f.distance.toFixed(4)}
                              </span>
                            )}
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[8px] h-3.5 px-1 font-mono",
                                f.decision === "MATCH"
                                  ? "border-success text-success bg-success/10"
                                  : "border-muted-foreground text-muted-foreground",
                              )}
                            >
                              {f.decision}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Exact Recognition Previews */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
                <div className="text-[11px] font-sans font-semibold text-primary border-b border-primary/20 pb-1">
                  Visual Previews (Full Frame · Face Crop · 112×112 ArcFace Tensor - Best Frame #{diag.bestFrameIndex || 1}):
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="space-y-1">
                    <div className="text-[9px] text-muted-foreground font-sans">Full Frame</div>
                    <div className="relative aspect-video rounded overflow-hidden border border-border bg-black flex items-center justify-center">
                      {diag.originalFramePreview ? (
                        <img src={diag.originalFramePreview} alt="Original Frame" className="size-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-muted-foreground font-sans">Face Crop</div>
                    <div className="relative aspect-square size-16 mx-auto rounded overflow-hidden border border-border bg-black flex items-center justify-center">
                      {diag.croppedFacePreview ? (
                        <img src={diag.croppedFacePreview} alt="Face Crop" className="size-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-primary font-sans font-semibold">112×112 ArcFace</div>
                    <div className="relative size-16 mx-auto rounded overflow-hidden border-2 border-primary bg-black flex items-center justify-center">
                      {diag.alignedFacePreview ? (
                        <img src={diag.alignedFacePreview} alt="112x112 Aligned" className="size-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-primary">Pending</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Person-Level Database Matching */}
              <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground font-sans border-b border-border pb-1">
                  <span>Person-Level Recognition Result:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono h-4 font-bold",
                      diag.finalResult.startsWith("PERSON_")
                        ? "border-success text-success bg-success/10"
                        : "border-destructive text-destructive bg-destructive/10",
                    )}
                  >
                    Final result: {diag.finalResult}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">PERSON_001 (Active)</div>
                    <div className="text-xs font-bold text-foreground">
                      Best distance: {diag.p1MinDist !== null ? diag.p1MinDist.toFixed(4) : "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Threshold: 0.45</div>
                  </div>

                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">Best Match Candidate</div>
                    <div className="text-xs font-bold text-primary">
                      {diag.bestMatch ? `${diag.bestMatch.staffCode} (${diag.bestMatch.distance.toFixed(4)})` : "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Active gallery: {diag.searchedEmbeddingsCount} vectors</div>
                  </div>

                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">Decision Rule</div>
                    <div className="text-xs font-bold text-foreground">
                      {diag.distance !== null && diag.distance <= 0.45 ? (
                        <span className="text-success">MATCH (dist &le; 0.45)</span>
                      ) : (
                        <span className="text-destructive">UNKNOWN</span>
                      )}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Req Margin: &ge; 0.08</div>
                  </div>
                </div>

                {/* Section 4: Individual References for PERSON_001 */}
                {diag.fivePoseDistances.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground font-sans font-semibold">PERSON_001 (5 Active References Breakdown):</span>
                      <span className="font-mono text-[9px] text-foreground">
                        Min: <strong className="text-success">{diag.p1MinDist?.toFixed(4)}</strong> · Max: {diag.p1MaxDist?.toFixed(4)} · Mean: {diag.p1MeanDist?.toFixed(4)}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-24 overflow-y-auto">
                      {diag.fivePoseDistances.map((c, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-background/80 px-2 py-1 rounded border border-border text-[9px] font-mono">
                          <span className="truncate">P001 Reference {idx + 1}</span>
                          <span className={cn("font-bold ml-2", c.dist <= 0.45 ? "text-success" : "text-muted-foreground")}>
                            {c.dist.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex gap-2">
          {phase === "matched" || phase === "unrecognized" || phase === "error" ? (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                setPhase("detecting");
                setErrorMessage("");
                setMatchName("");
                setMatchCode("");
                isVerifyingRef.current = false;
                stabilityStartTimeRef.current = null;
                stableFrameCountRef.current = 0;
                lastBoxRef.current = null;
                startDetectionLoopRef.current();
              }}
            >
              <RefreshCw className="mr-2 size-4" /> Scan Again
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
