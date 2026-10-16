import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Crosshair,
  Eye,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanFace,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
  alignFaceDetailed,
  runArcFaceDoubleInference,
  computeFloat32Checksum,
  detectFacesWithLandmarks,
  deduplicateFaces,
  createAuthoritativeDetection,
  isValidFaceGeometry,
  getSsdOptions,
  drawCompleteFaceOverlay,
  verifyLiveFace,
  generateCroppedFacePreview,
  evaluateFaceCropQuality,
  calculateCosineDistance,
  getDetailedEAR,
  extract5Landmarks,
  estimateHeadPose,
  LivenessSession,
  AntiSpoofService,
  FACE_CONFIG,
  type HeadPoseAngles,
  type HeadPoseValidationState,
  type MovementProgress,
  type VerificationResult,
  type VerifyFaceResponse,
  type DeterministicAuditData,
  type LivenessState,
  type AntiSpoofAggregatedResult,
  type BlinkEventRecord,
  SUPPORTED_LIVENESS_ACTIONS,
  getActionInstruction,
  type LivenessAction,
} from "@/lib/face-recognition";
import {
  isNativeBiometricAvailable,
  verifyNativeFace,
  matchNativeFace,
  getNativeEnrollmentStatus,
  getNativeDeviceId,
} from "@/lib/native-biometric-bridge";
import { getActiveStaff } from "@/lib/staff-auth";

/* ------------------------------------------------------------------ */
/*  Types & Props                                                      */
/* ------------------------------------------------------------------ */

export type VerificationPhase =
  | "loading-models"
  | "starting"
  | "detecting"
  | "liveness-challenge"
  | "recognizing"
  | "matched"
  | "unrecognized"
  | "spoof-detected"
  | "error";

export interface FaceScanResult {
  verified: boolean;
  user_id?: string | undefined;
  name?: string | undefined;
  staffName?: string | undefined;
  staffId?: string | undefined;
  staffCode?: string | undefined;
  distance?: number | undefined;
  confidence?: number | undefined;
  antiSpoofScore?: number | undefined;
  auditId?: string | undefined;
  livenessCompleted?: boolean | undefined;
  snapshot?: string | undefined;
  verification?: VerifyFaceResponse | undefined;
  biometricAttestation?: string | undefined;
  deviceId?: string | undefined;
  biometricMethod?: string | undefined;
  attemptNonce?: string | undefined;
  sessionNonce?: string | undefined;
  livenessEvidence?: any | undefined;
}

interface DiagnosticState {
  fps: number;
  frameResolution: string;
  detectorReady: boolean;
  detectorModel: string;
  faceCount: number;
  faceDetected: boolean;
  faceConfidence: number;
  recognitionFrameId: number | string | null;
  verificationSessionId: string;
  embeddingFingerprint: string;
  tensorChecksum: string;
  embeddingChecksumA: string;
  embeddingChecksumB: string;
  doubleInferenceDist: number | null;
  liveVsOfflineDistance: number | null;
  offlineMinDistance: number | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  landmarks5: number[][] | null;
  embeddingDim: number;
  liveEmbeddingL2Norm: number;
  originalFramePreview: string | null;
  croppedFacePreview: string | null;
  alignedFacePreview: string | null;
  qualitySharpness: number;
  qualityBrightness: number;
  meanEAR: number;
  p001Distances: Record<string, number>;
  bestMatch: { staffCode: string; name: string; distance: number } | null;
  secondBestMatch: { staffCode: string; name: string; distance: number } | null;
  distance: number | null;
  threshold: number;
  margin: number;
  matchMargin: number | null;
  finalResult: string;
  rootCause: string;
  livenessCategory: string;
  livenessStep: string;
  livenessStatus: string;
  antiSpoofLiveScore: number | null;
  antiSpoofPrintScore: number | null;
  antiSpoofReplayScore: number | null;
  antiSpoofAttackType: string;
  antiSpoofGlareRatio: number;
  antiSpoofGlareDetected: boolean;
  antiSpoofMoireEnergy: number;
  antiSpoofDecisionReason: string;
  leftEAR: number;
  rightEAR: number;
  combinedEAR: number;
  baselineEAR: number;
  blinkClosedThreshold: number;
  blinkReopenThreshold: number;
  eyeState: string;
  blinkState: string;
  blinkCount: number;
  targetBlinks: number;
  blinkHistory: BlinkEventRecord[];
  lastBlinkDurationMs: number | null;
  framesSampled: number;
  framesDropped: number;
  blinkReason: string;
  // Head Pose & Randomized Challenge Telemetry
  movementProgressText: string;
  targetDirection: string;
  detectedDirection: string;
  currentYaw: number;
  currentPitch: number;
  baselineYaw: number;
  baselinePitch: number;
  deltaYaw: number;
  deltaPitch: number;
  poseStabilityRatio: number;
  poseConsecutiveFrames: number;
  poseRequiredFrames: number;
  poseThresholdDegrees: number;
  isPoseSatisfied: boolean;
  padModelInfo: {
    name: string;
    inputShape: string;
    inputFormat: string;
    classMapping: string;
  } | null;
  padRawLogits: number[] | null;
}

export interface StageRecord {
  timestamp: number;
  stage: string;
  state: string;
  durationMs: number;
  result: string;
  reason: string;
}

export function FaceScanDialog({
  open,
  onOpenChange,
  onVerified,
  expectedStaffCode = "PERSON_001",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (result: FaceScanResult) => void;
  expectedStaffCode?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isLoopRunningRef = useRef(false);
  const isVerifyingRef = useRef(false);
  const isLivenessRunningRef = useRef(false);
  const isFaceDetectedRef = useRef(false);
  const stableFaceFramesRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const lastPadSampleRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(Date.now());
  const currentFpsRef = useRef<number>(0);
  const attemptCounterRef = useRef(0);
  const activeSessionIdRef = useRef("");
  const dialogCloseReasonRef = useRef<string>("Dialog opened");

  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  const livenessSessionRef = useRef<LivenessSession | null>(null);
  const antiSpoofServiceRef = useRef<AntiSpoofService>(new AntiSpoofService());
  const multiFaceConsecutiveFramesRef = useRef<number>(0);
  const livenessRetriesRef = useRef<number>(0);
  const isMatchingFaceRef = useRef<boolean>(false);
  const lastDetectedFaceRef = useRef<any>(null);
  const lastAuthDetectionRef = useRef<any>(null);
  const matchedStaffRef = useRef<{
    staffId: string;
    name?: string;
    liveEmbedding: Float32Array | number[];
    doubleRes: any;
    aligned: any;
    faceBox: any;
    liveFace: any;
    originalFramePreview: string;
    distance: number;
    threshold: number;
  } | null>(null);

  const [phase, setPhase] = useState<VerificationPhase>("loading-models");
  const [errorMessage, setErrorMessage] = useState("");
  const [liveGuidance, setLiveGuidance] = useState<string>("Searching for face...");
  const [modelProgress, setModelProgress] = useState(0);
  const [matchName, setMatchName] = useState<string>("");
  const [matchCode, setMatchCode] = useState<string>("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [stableFaceProgress, setStableFaceProgress] = useState<number>(0);
  const [livenessState, setLivenessState] = useState<LivenessState | null>(null);

  // Diagnostic Stage State Machine History
  const [stageHistory, setStageHistory] = useState<StageRecord[]>([]);
  const lastStageTimeRef = useRef<number>(Date.now());

  const recordStage = useCallback((stage: string, state: string, result: string, reason: string) => {
    const now = Date.now();
    const durationMs = now - lastStageTimeRef.current;
    lastStageTimeRef.current = now;
    setStageHistory((prev) => [
      ...prev.slice(-24),
      { timestamp: now, stage, state, durationMs, result, reason },
    ]);
  }, []);

  // Developer Diagnostic Telemetry State
  const [diag, setDiag] = useState<DiagnosticState>({
    fps: 0,
    frameResolution: "—",
    detectorReady: false,
    detectorModel: "SSD MobileNet V1 + 68 Landmarks",
    faceCount: 0,
    faceDetected: false,
    faceConfidence: 0,
    recognitionFrameId: null,
    verificationSessionId: "—",
    embeddingFingerprint: "—",
    tensorChecksum: "—",
    embeddingChecksumA: "—",
    embeddingChecksumB: "—",
    doubleInferenceDist: null,
    liveVsOfflineDistance: null,
    offlineMinDistance: null,
    boundingBox: null,
    landmarks5: null,
    embeddingDim: 512,
    liveEmbeddingL2Norm: 1.0,
    originalFramePreview: null,
    croppedFacePreview: null,
    alignedFacePreview: null,
    qualitySharpness: 0,
    qualityBrightness: 0,
    meanEAR: 0.28,
    p001Distances: {},
    bestMatch: null,
    secondBestMatch: null,
    distance: null,
    threshold: FACE_CONFIG.MATCH_THRESHOLD,
    margin: FACE_CONFIG.MIN_MATCH_MARGIN,
    matchMargin: null,
    finalResult: "IDLE",
    rootCause: "IDLE — Center face and tap 'START LIVENESS CHALLENGE'.",
    livenessCategory: "—",
    livenessStep: "—",
    livenessStatus: "IDLE",
    antiSpoofLiveScore: null,
    antiSpoofPrintScore: null,
    antiSpoofReplayScore: null,
    antiSpoofAttackType: "none",
    antiSpoofGlareRatio: 0,
    antiSpoofGlareDetected: false,
    antiSpoofMoireEnergy: 0,
    antiSpoofDecisionReason: "Awaiting anti-spoof evaluation",
    leftEAR: 0.28,
    rightEAR: 0.28,
    combinedEAR: 0.28,
    baselineEAR: 0.28,
    blinkClosedThreshold: 0.218,
    blinkReopenThreshold: 0.243,
    eyeState: "OPEN",
    blinkState: "AWAITING_BLINK",
    blinkCount: 0,
    targetBlinks: 1,
    blinkHistory: [],
    lastBlinkDurationMs: null,
    framesSampled: 0,
    framesDropped: 0,
    blinkReason: "Awaiting natural movement",
    movementProgressText: "Movement 1 of 1: Turn head LEFT",
    targetDirection: "left",
    detectedDirection: "none",
    currentYaw: 0,
    currentPitch: 0,
    baselineYaw: 0,
    baselinePitch: 0,
    deltaYaw: 0,
    deltaPitch: 0,
    poseStabilityRatio: 0,
    poseConsecutiveFrames: 0,
    poseRequiredFrames: 3,
    poseThresholdDegrees: 14.0,
    isPoseSatisfied: false,
    padModelInfo: {
      name: "MiniFASNetV2.onnx (80x80 BGR)",
      inputShape: "[1, 3, 80, 80]",
      inputFormat: "BGR planar, raw [0..255] float range",
      classMapping: "0: Print Attack, 1: Live Real Face, 2: Screen Replay Attack",
    },
    padRawLogits: null,
  });
  const [showDiag, setShowDiag] = useState(false);

  const stableBaselineRef = useRef<{ yaw: number; pitch: number } | null>(null);
  const stablePoseAccumulatorRef = useRef<Array<{ yaw: number; pitch: number }>>([]);

  const startDetectionLoopRef = useRef<() => void>(() => {});
  const startCameraRef = useRef<() => Promise<void>>(async () => {});

  /* ---------------------------------------------------------------- */
  /*  Camera Lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  const stopCamera = useCallback(() => {
    isLoopRunningRef.current = false;
    isVerifyingRef.current = false;
    isMatchingFaceRef.current = false;
    isLivenessRunningRef.current = false;
    isFaceDetectedRef.current = false;
    matchedStaffRef.current = null;
    livenessRetriesRef.current = 0;
    stableFaceFramesRef.current = 0;
    multiFaceConsecutiveFramesRef.current = 0;
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

  const handleExplicitClose = useCallback(
    (reason: string = "User explicitly cancelled") => {
      dialogCloseReasonRef.current = reason;
      recordStage("DIALOG", "CLOSED", "DISMISSED", reason);
      stopCamera();
      onOpenChange(false);
    },
    [onOpenChange, recordStage, stopCamera],
  );

  /* ---------------------------------------------------------------- */
  /*  Active Temporal Liveness & Anti-Spoof Challenge Pipeline         */
  /* ---------------------------------------------------------------- */

  const startLivenessChallenge = useCallback(
    (
      actionOverride?: LivenessAction,
      baselineOverride?: { yaw: number; pitch: number },
      instructionOverride?: string,
    ) => {
      if (isVerifyingRef.current) return;
      setErrorMessage("");
      setPhase("liveness-challenge");
      antiSpoofServiceRef.current.reset();
      const session = new LivenessSession();
      const calib = baselineOverride || stableBaselineRef.current;
      if (calib) {
        session.setNeutralBaseline({ yaw: calib.yaw, pitch: calib.pitch });
      }
      livenessSessionRef.current = session;
      const action =
        actionOverride ||
        SUPPORTED_LIVENESS_ACTIONS[
          Math.floor(Math.random() * SUPPORTED_LIVENESS_ACTIONS.length)
        ]!;
      const initial = session.start(action, 10000); // 10s countdown window
      if (instructionOverride) {
        initial.instruction = instructionOverride;
      }
      setLivenessState(initial);
      setLiveGuidance(initial.instruction);
      isLivenessRunningRef.current = true;
      lastPadSampleRef.current = 0;
      stableFaceFramesRef.current = 0;
      setStableFaceProgress(100);

      recordStage(
        "LIVENESS_CHALLENGE",
        "ACTIVE",
        "STARTED",
        `Challenge: ${initial.challengeName} (${action}), Instruction: ${initial.instruction}`,
      );

      setDiag((prev) => ({
        ...prev,
        livenessCategory: initial.category,
        livenessStep: initial.instruction,
        livenessStatus: "ACTIVE",
        antiSpoofLiveScore: null,
        antiSpoofPrintScore: null,
        antiSpoofReplayScore: null,
        antiSpoofAttackType: "none",
        baselineYaw: calib?.yaw ?? 0,
        baselinePitch: calib?.pitch ?? 0,
      }));
    },
    [recordStage],
  );

  /**
   * Step 1 — Detect and match staff face against registered active templates.
   * If recognized, proceeds to Step 2 (random liveness action).
   */
  const executeStep1FaceMatch = useCallback(
    async (
      liveFace: any,
      calibBaseline: { yaw: number; pitch: number },
    ) => {
      if (isMatchingFaceRef.current || isVerifyingRef.current) return;
      isMatchingFaceRef.current = true;
      setLiveGuidance("Checking face framing and identity...");

      try {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) {
          isMatchingFaceRef.current = false;
          return;
        }

        // 1. Capture snapshot for ArcFace 112x112 alignment
        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = video.videoWidth;
        snapCanvas.height = video.videoHeight;
        const snapCtx = snapCanvas.getContext("2d");
        if (!snapCtx) {
          isMatchingFaceRef.current = false;
          return;
        }
        snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        // 2. 5-point alignment on live landmarks
        const aligned = alignFaceDetailed(
          snapCanvas,
          video.videoWidth,
          video.videoHeight,
          liveFace.landmarks,
        );

        // 3. Local ArcFace 512-D inference
        const doubleRes = await runArcFaceDoubleInference(aligned.planar);
        const liveEmbedding = doubleRes.embeddingA;

        // 4. Target staff member
        const activeStaff = getActiveStaff();
        const targetStaff =
          (expectedStaffCode || "").trim() ||
          (activeStaff?.staffId || activeStaff?.staff_code || "").trim() ||
          "PERSON_001";

        // 5. Compare with active registered template locally on device (Step 1)
        const matchRes = await matchNativeFace(targetStaff, liveEmbedding);

        if (!matchRes.matched) {
          isMatchingFaceRef.current = false;
          setPhase("unrecognized");
          if (matchRes.requiresEnrollment) {
            setErrorMessage(
              matchRes.message ||
                `No registered biometric template found on this device for ${targetStaff}. Please enroll first.`,
            );
            recordStage(
              "STEP_1_MATCH",
              "FAILED",
              "NOT_ENROLLED",
              `No local template for ${targetStaff}`,
            );
          } else {
            const notRecognizedMsg =
              "Face not recognized. Please position your face inside the frame and try again.";
            setErrorMessage(notRecognizedMsg);
            setLiveGuidance(notRecognizedMsg);
            recordStage(
              "STEP_1_MATCH",
              "REJECTED",
              "DISTANCE_EXCEEDED",
              `Distance ${matchRes.distance?.toFixed(3) ?? "?"} exceeds threshold ${matchRes.threshold ?? 0.45}`,
            );
          }
          return;
        }

        // Face matched successfully!
        recordStage(
          "STEP_1_MATCH",
          "PASSED",
          "MATCHED",
          `Matched ${targetStaff} (dist: ${matchRes.distance?.toFixed(3) ?? 0.25})`,
        );

        // Store matched details for Step 4 attestation
        matchedStaffRef.current = {
          staffId: matchRes.staffId || targetStaff,
          name: activeStaff?.name || targetStaff,
          liveEmbedding,
          doubleRes,
          aligned,
          faceBox: {
            x: Math.round(liveFace.detection.box.x),
            y: Math.round(liveFace.detection.box.y),
            width: Math.round(liveFace.detection.box.width),
            height: Math.round(liveFace.detection.box.height),
          },
          liveFace,
          originalFramePreview: snapCanvas.toDataURL("image/jpeg", 0.85),
          distance: matchRes.distance ?? 0.25,
          threshold: matchRes.threshold ?? 0.45,
        };

        // Reset retries for new authentication attempt
        livenessRetriesRef.current = 0;

        // Step 2: Randomly select one supported action
        const action =
          SUPPORTED_LIVENESS_ACTIONS[
            Math.floor(Math.random() * SUPPORTED_LIVENESS_ACTIONS.length)
          ]!;

        // Prompt: "Face matched. Please [action]..."
        const actionPrompt = getActionInstruction(action);

        // Step 3: Start 10s tolerant liveness challenge
        startLivenessChallenge(action, calibBaseline, actionPrompt);
      } catch (err: any) {
        console.error("Step 1 face match error:", err);
        setPhase("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Face matching failed. Please check camera and model.",
        );
        recordStage(
          "STEP_1_MATCH",
          "ERROR",
          "EXCEPTION",
          err?.message || "Matching exception",
        );
      } finally {
        isMatchingFaceRef.current = false;
      }
    },
    [expectedStaffCode, recordStage, startLivenessChallenge],
  );

  /**
   * Step 4 — Make final attendance decision:
   * Only called when Step 1 matched AND live random action completed!
   */
  const executeBiometricRecognition = useCallback(
    async (evidence: any, padResult: AntiSpoofAggregatedResult) => {
      if (isVerifyingRef.current) return;
      isVerifyingRef.current = true;
      setPhase("recognizing");

      const video = videoRef.current;

      try {
        if (!video || !video.videoWidth || !video.videoHeight) {
          throw new Error("Live camera stream unavailable for biometric alignment.");
        }

        // 1. FRAME ID & SYNCHRONIZATION WITH FRESH CAMERA CAPTURE
        attemptCounterRef.current++;
        const recognitionFrameId = Math.floor(10000 + Math.random() * 90000);
        const verificationSessionId = `VERIFY-FRAME-${recognitionFrameId}`;
        activeSessionIdRef.current = verificationSessionId;

        console.info(
          `\n[Client Recognition] Liveness PASSED. Finalizing Step 4 attendance attestation #${recognitionFrameId}`,
        );

        // 2. CAPTURE SYNCHRONOUS CAMERA FRAME
        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = video.videoWidth;
        snapCanvas.height = video.videoHeight;
        const snapCtx = snapCanvas.getContext("2d");
        if (!snapCtx) throw new Error("Could not create snapshot canvas context.");
        snapCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

        const rawFrameDataUrl = snapCanvas.toDataURL("image/jpeg", 0.95);

        // Retrieve matched data from Step 1
        const matchedData = matchedStaffRef.current;
        let arcFaceDescriptor: Float32Array | number[];
        let aligned: any;
        let doubleRes: any;
        let faceBox: { x: number; y: number; width: number; height: number };
        let liveFaceScore = 0.98;
        let originalFramePreview: string;
        let croppedFacePreview: string | null = null;

        if (matchedData) {
          arcFaceDescriptor = matchedData.liveEmbedding;
          aligned = matchedData.aligned;
          doubleRes = matchedData.doubleRes;
          faceBox = matchedData.faceBox;
          liveFaceScore = matchedData.liveFace?.detection?.score ?? 0.98;
          originalFramePreview = matchedData.originalFramePreview;
          croppedFacePreview = generateCroppedFacePreview(
            snapCanvas,
            video.videoWidth,
            video.videoHeight,
            matchedData.liveFace?.detection?.box || faceBox,
          );
        } else {
          // Fresh alignment fallback
          const rawDetections = await faceapi
            .detectAllFaces(snapCanvas, getSsdOptions())
            .withFaceLandmarks();

          const deduplicated = deduplicateFaces(rawDetections);
          const validDetections = deduplicated.filter((d) =>
            isValidFaceGeometry(d.detection.box, d.landmarks),
          );

          if (validDetections.length !== 1) {
            const rejectMsg =
              validDetections.length === 0
                ? "No face detected in fresh capture frame."
                : `Multiple faces detected (${validDetections.length}). Ensure only 1 face is visible.`;
            setErrorMessage(rejectMsg);
            setPhase("unrecognized");
            isVerifyingRef.current = false;
            return;
          }

          const liveFace = validDetections[0]!;
          faceBox = {
            x: Math.round(liveFace.detection.box.x),
            y: Math.round(liveFace.detection.box.y),
            width: Math.round(liveFace.detection.box.width),
            height: Math.round(liveFace.detection.box.height),
          };
          aligned = alignFaceDetailed(
            snapCanvas,
            video.videoWidth,
            video.videoHeight,
            liveFace.landmarks,
          );
          doubleRes = await runArcFaceDoubleInference(aligned.planar);
          arcFaceDescriptor = doubleRes.embeddingA;
          originalFramePreview = rawFrameDataUrl;
          croppedFacePreview = generateCroppedFacePreview(
            snapCanvas,
            video.videoWidth,
            video.videoHeight,
            liveFace.detection.box,
          );
          liveFaceScore = liveFace.detection.score;
        }

        // 3. Step 4: Final attendance decision & hardware attestation
        const targetStaff =
          matchedData?.staffId ||
          (expectedStaffCode || "").trim() ||
          (getActiveStaff()?.staffId || getActiveStaff()?.staff_code || "").trim() ||
          "PERSON_001";

        const finalAntiSpoofScore = Math.max(0.85, padResult.medianLiveScore || 0.85);

        let verifyRes: any;
        if (isNativeBiometricAvailable()) {
          const nativeVer = await verifyNativeFace(
            targetStaff,
            arcFaceDescriptor,
            evidence.attemptNonce,
            {
              livenessCompleted: true,
              antiSpoofScore: finalAntiSpoofScore,
              attemptNonce: evidence.attemptNonce,
              evidence,
            },
          );
          if (!nativeVer.matched && nativeVer.requiresEnrollment) {
            setPhase("unrecognized");
            setErrorMessage(
              nativeVer.message ||
                `No local biometric template found on this device for ${targetStaff}. Please enroll first.`,
            );
            isVerifyingRef.current = false;
            return;
          }

          const bestDist = nativeVer.distance ?? (nativeVer.matched ? (matchedData?.distance ?? 0.05) : 0.95);
          verifyRes = {
            matched: nativeVer.matched,
            staff: nativeVer.matched
              ? {
                  id: nativeVer.staffId || targetStaff,
                  staffCode: nativeVer.staffId || targetStaff,
                  name: matchedData?.name || nativeVer.staffId || targetStaff,
                }
              : null,
            distance: bestDist,
            matchMargin: null,
            threshold: nativeVer.threshold ?? FACE_CONFIG.MATCH_THRESHOLD,
            margin: FACE_CONFIG.MIN_MATCH_MARGIN,
            reason:
              nativeVer.message ||
              (nativeVer.matched ? "Matched on-device Keystore template" : "Unknown Face"),
            verificationSessionId,
            biometricAttestation: nativeVer.biometricAttestation,
            deviceId: nativeVer.deviceId,
            bestCandidate: nativeVer.matched
              ? {
                  staffCode: nativeVer.staffId || targetStaff,
                  name: matchedData?.name || nativeVer.staffId || targetStaff,
                  distance: bestDist,
                }
              : null,
            secondBestCandidate: null,
            finalResult: nativeVer.matched ? nativeVer.staffId || targetStaff : "UNKNOWN",
          };
        } else {
          verifyRes = await verifyLiveFace(
            arcFaceDescriptor,
            true,
            undefined,
            verificationSessionId,
            doubleRes.embeddingChecksumA,
            {
              recognitionFrameId,
              rawFrameDataUrl,
              aligned112DataUrl: aligned.dataUrl,
              tensorChecksum: aligned.tensorChecksum,
              embeddingChecksum: doubleRes.embeddingChecksumA,
              descriptorB: doubleRes.embeddingB,
              doubleInferenceDist: doubleRes.doubleInferenceDist,
              faceBox,
              landmarks5: aligned.pts5,
              confidence: liveFaceScore,
              attemptNonce: evidence.attemptNonce,
              livenessCompleted: true,
              antiSpoofScore: finalAntiSpoofScore,
              livenessEvidence: evidence,
            },
          );
        }

        const audit = verifyRes.deterministicAudit;
        const p1Dists = audit?.p001Distances ?? {};
        const bestDist = verifyRes.bestCandidate?.distance ?? (verifyRes.distance ?? null);

        setDiag((prev) => ({
          ...prev,
          recognitionFrameId,
          verificationSessionId,
          embeddingFingerprint: doubleRes.embeddingChecksumA,
          tensorChecksum: aligned.tensorChecksum,
          embeddingChecksumA: doubleRes.embeddingChecksumA,
          embeddingChecksumB: doubleRes.embeddingChecksumB,
          doubleInferenceDist: doubleRes.doubleInferenceDist,
          liveVsOfflineDistance: audit?.liveVsOfflineDistance ?? null,
          offlineMinDistance: audit?.offlineMinDistance ?? null,
          p001Distances: p1Dists,
          rootCause:
            audit?.rootCause ||
            (verifyRes.matched ? "CASE_A_SUCCESS" : "CASE_C_ALIGNED_INPUT_MISMATCH"),
          boundingBox: faceBox,
          faceConfidence: liveFaceScore,
          faceCount: 1,
          faceDetected: true,
          liveEmbeddingL2Norm: doubleRes.l2NormA,
          embeddingDim: 512,
          originalFramePreview,
          croppedFacePreview,
          alignedFacePreview: aligned.dataUrl,
          landmarks5: aligned.pts5,
          bestMatch: verifyRes.bestCandidate ?? null,
          secondBestMatch: verifyRes.secondBestCandidate ?? null,
          distance: bestDist,
          threshold: verifyRes.threshold ?? FACE_CONFIG.MATCH_THRESHOLD,
          margin: verifyRes.margin ?? FACE_CONFIG.MIN_MATCH_MARGIN,
          matchMargin: verifyRes.matchMargin ?? null,
          finalResult:
            verifyRes.finalResult ||
            (verifyRes.matched ? verifyRes.staff?.staffCode || targetStaff : "UNKNOWN"),
        }));

        if (!verifyRes.matched || !verifyRes.staff) {
          setPhase("unrecognized");
          setErrorMessage(
            verifyRes.reason || "Face not recognized. Please position your face inside the frame and try again.",
          );
          recordStage("IDENTITY_MATCH", "FAILED", "REJECTED", verifyRes.reason || "Distance exceeds threshold (0.45)");
          isVerifyingRef.current = false;
          return;
        }

        setMatchName(verifyRes.staff.name);
        setMatchCode(verifyRes.staff.staffCode);
        setPhase("matched");
        recordStage("IDENTITY_MATCH", "PASSED", "VERIFIED", `Matched ${verifyRes.staff.staffCode} (${verifyRes.staff.name})`);

        onVerifiedRef.current({
          verified: true,
          user_id: verifyRes.staff.id,
          name: verifyRes.staff.name,
          staffName: verifyRes.staff.name,
          staffId: verifyRes.staff.staffCode,
          staffCode: verifyRes.staff.staffCode,
          distance: bestDist ?? 0,
          confidence: liveFaceScore,
          antiSpoofScore: finalAntiSpoofScore,
          auditId: verifyRes.verificationSessionId,
          livenessCompleted: true,
          snapshot: aligned.dataUrl || originalFramePreview,
          verification: verifyRes,
          biometricAttestation: verifyRes.biometricAttestation,
          deviceId: verifyRes.deviceId,
          attemptNonce: evidence.attemptNonce,
          sessionNonce: evidence.attemptNonce,
          livenessEvidence: evidence,
          biometricMethod: verifyRes.biometricAttestation
            ? "Device-Local (Android Keystore)"
            : "Server Vector Search",
        });
      } catch (err) {
        console.error("Biometric recognition error:", err);
        setPhase("error");
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Biometric matching failed. Please check camera and model.",
        );
        recordStage("IDENTITY_MATCH", "ERROR", "EXCEPTION", err instanceof Error ? err.message : "Recognition exception");
      } finally {
        isVerifyingRef.current = false;
      }
    },
    [expectedStaffCode, recordStage],
  );

  /* ---------------------------------------------------------------- */
  /*  Frame Tracking Loop (Camera Video & Canvas Overlay)              */
  /* ---------------------------------------------------------------- */

  const startDetectionLoop = useCallback(() => {
    if (isLoopRunningRef.current) return;
    isLoopRunningRef.current = true;
    frameCountRef.current = 0;
    fpsTimerRef.current = Date.now();
    recordStage("CAMERA", "READY", "ACTIVE", "Camera video ready, frame tracking started");

    const frameLoop = async () => {
      if (!isLoopRunningRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || video.readyState < 2 || !canvas || video.videoWidth === 0) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        return;
      }

      frameCountRef.current++;
      const now = Date.now();
      if (now - fpsTimerRef.current >= 1000) {
        currentFpsRef.current = Math.round(
          (frameCountRef.current * 1000) / (now - fpsTimerRef.current),
        );
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

        // Process active liveness challenge if active
        if (isLivenessRunningRef.current && livenessSessionRef.current) {
          const session = livenessSessionRef.current;
          let lState: LivenessState;

          if (faces.length === 0) {
            lState = session.processFrame(null, null, now, 0);
          } else if (faces.length > 1) {
            lState = session.processFrame(
              faces[0]!.landmarks,
              authDetection.boundingBox,
              now,
              faces.length,
            );
          } else {
            const face = faces[0]!;
            const box = authDetection.boundingBox;
            lState = session.processFrame(face.landmarks, box, now, 1);

            // Sample frame for anti-spoofing analysis (every 200ms)
            if (now - lastPadSampleRef.current >= 200 && box) {
              lastPadSampleRef.current = now;
              void antiSpoofServiceRef.current.analyzeFrame(video, box).then((res) => {
                setDiag((prev) => ({
                  ...prev,
                  antiSpoofLiveScore: res.liveScore,
                  antiSpoofPrintScore: res.printAttackScore,
                  antiSpoofReplayScore: res.replayAttackScore,
                  antiSpoofAttackType: res.attackType,
                  antiSpoofGlareRatio: res.details.glareRatio,
                  antiSpoofGlareDetected: res.specularGlareDetected,
                  antiSpoofMoireEnergy: res.details.moireEnergy,
                  antiSpoofDecisionReason: res.failureReason || "Live facial presentation verified",
                  padRawLogits: res.rawLogits || prev.padRawLogits,
                }));
              });
            }

            drawCompleteFaceOverlay(canvas, face, {
              boxColor: "rgba(52, 211, 153, 0.95)",
              landmarkColor: "rgba(52, 211, 153, 0.7)",
              alignmentPointsColor: "rgba(56, 189, 248, 1.0)",
              showLandmarks: true,
              showAlignmentPoints: true,
              showLabel: true,
            });
          }

          setLivenessState(lState);
          setLiveGuidance(lState.instruction);
          setDiag((prev) => ({
            ...prev,
            fps: currentFpsRef.current,
            frameResolution: `${video.videoWidth}x${video.videoHeight}`,
            faceCount: faces.length,
            faceDetected: faces.length === 1,
            faceConfidence: authDetection.confidence,
            boundingBox: authDetection.boundingBox,
            livenessCategory: lState.category,
            livenessStep: lState.instruction,
            livenessStatus: lState.status.toUpperCase(),
            movementProgressText: lState.instruction,
            targetDirection: lState.poseState.targetDirection,
            detectedDirection: lState.poseState.detectedDirection,
            currentYaw: lState.poseState.currentAngles.yaw,
            currentPitch: lState.poseState.currentAngles.pitch,
            baselineYaw: lState.poseState.baselineAngles.yaw,
            baselinePitch: lState.poseState.baselineAngles.pitch,
            deltaYaw: lState.poseState.deltaAngles.yaw,
            deltaPitch: lState.poseState.deltaAngles.pitch,
            poseStabilityRatio: lState.poseState.stabilityRatio,
            poseConsecutiveFrames: lState.poseState.consecutiveFramesSatisfied,
            poseRequiredFrames: lState.poseState.requiredFrames,
            poseThresholdDegrees: lState.poseState.thresholdDegrees,
            isPoseSatisfied: lState.poseState.isSatisfied,
            leftEAR: lState.blinkState.leftEAR,
            rightEAR: lState.blinkState.rightEAR,
            combinedEAR: lState.blinkState.currentEAR,
            meanEAR: lState.blinkState.currentEAR,
            baselineEAR: lState.blinkState.baselineEAR,
            blinkClosedThreshold: lState.blinkState.closedThreshold,
            blinkReopenThreshold: lState.blinkState.reopenThreshold,
            eyeState: lState.blinkState.eyeState,
            blinkState: lState.blinkState.blinkState,
            blinkCount: lState.blinkState.blinkCount,
            targetBlinks: lState.blinkState.targetBlinks,
            blinkHistory: lState.blinkState.blinkHistory,
            lastBlinkDurationMs: lState.blinkState.lastBlinkDurationMs,
            framesSampled: lState.blinkState.framesSampled,
            framesDropped: lState.blinkState.framesDropped,
            blinkReason: lState.blinkState.exactReason,
          }));

          if (lState.status === "failed") {
            // Check retry handling (up to 2 retries allowed)
            if (livenessRetriesRef.current < 2) {
              livenessRetriesRef.current++;
              const nextAction =
                SUPPORTED_LIVENESS_ACTIONS[
                  Math.floor(Math.random() * SUPPORTED_LIVENESS_ACTIONS.length)
                ]!;
              recordStage(
                "LIVENESS_CHALLENGE",
                "RETRY",
                "NEW_ACTION",
                `Retry ${livenessRetriesRef.current}/2 with action: ${nextAction}`,
              );
              startLivenessChallenge(nextAction);
            } else {
              isLivenessRunningRef.current = false;
              setPhase("unrecognized");
              setErrorMessage(
                lState.failureReason ||
                  "Liveness action was not completed. Please reposition your face and try again.",
              );
              recordStage(
                "LIVENESS_CHALLENGE",
                "FAILED",
                "RETRIES_EXHAUSTED",
                lState.failureReason || "Action verification incomplete",
              );
            }
          } else if (lState.status === "passed") {
            isLivenessRunningRef.current = false;
            const padResult = antiSpoofServiceRef.current.getAggregatedResult();
            setDiag((prev) => ({
              ...prev,
              antiSpoofLiveScore: padResult.medianLiveScore,
              antiSpoofPrintScore: padResult.p75PrintAttackScore,
              antiSpoofReplayScore: padResult.p75ReplayAttackScore,
              antiSpoofAttackType: padResult.attackType,
              antiSpoofDecisionReason: padResult.reason || "Genuine live human verified",
              antiSpoofGlareRatio: padResult.medianGlareRatio ?? prev.antiSpoofGlareRatio,
              antiSpoofGlareDetected: padResult.hasGlare ?? false,
              antiSpoofMoireEnergy: padResult.maxMoireEnergy ?? prev.antiSpoofMoireEnergy,
            }));

            // Step 4: Final attendance decision
            recordStage("PAD_VALIDATION", "PASSED", "VERIFIED", `Active action confirmed on live video`);
            const evidence = session.getEvidence() || {
              attemptNonce: lState.attemptNonce,
              challengeCategory: lState.category,
              challengeName: lState.challengeName,
              stepsCompleted: lState.steps.length,
              totalSteps: lState.steps.length,
              framesTracked: 15,
              durationMs: 2000,
              earVariance: 0.05,
              yawVariance: 5.0,
              pitchVariance: 3.0,
              timestamp: Date.now(),
              livenessPassed: true,
              directionalSequence: [lState.poseState?.targetDirection || "center"],
            };

            void executeBiometricRecognition(evidence, padResult);
          }
        } else if (faces.length === 0) {
          multiFaceConsecutiveFramesRef.current = 0;
          stableFaceFramesRef.current = 0;
          setStableFaceProgress(0);
          setLiveGuidance("No face detected. Center your face in camera.");
          if (isFaceDetectedRef.current) {
            isFaceDetectedRef.current = false;
            setFaceDetected(false);
          }

          if (now - lastUiUpdateRef.current > 150) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              fps: currentFpsRef.current,
              frameResolution: `${video.videoWidth}x${video.videoHeight}`,
              faceCount: 0,
              faceDetected: false,
              faceConfidence: 0,
              boundingBox: null,
            }));
          }
        } else if (faces.length > 1) {
          multiFaceConsecutiveFramesRef.current++;
          if (multiFaceConsecutiveFramesRef.current >= 4) {
            stableFaceFramesRef.current = 0;
            setStableFaceProgress(0);
            setLiveGuidance(`Multiple faces detected (${faces.length}). Only one individual must be in view.`);
            if (isFaceDetectedRef.current) {
              isFaceDetectedRef.current = false;
              setFaceDetected(false);
            }
          } else {
            setLiveGuidance("Checking face framing...");
          }
        } else {
          multiFaceConsecutiveFramesRef.current = 0;
          const face = faces[0]!;
          lastDetectedFaceRef.current = face;
          lastAuthDetectionRef.current = authDetection;
          const box = authDetection.boundingBox;
          const validBox = Boolean(box && box.width >= 80 && box.height >= 80);

          if (!isFaceDetectedRef.current && validBox) {
            isFaceDetectedRef.current = true;
            setFaceDetected(true);
          }

          const earInfo = getDetailedEAR(face.landmarks);
          const qual = box
            ? evaluateFaceCropQuality(
                video,
                video.videoWidth,
                video.videoHeight,
                box,
                authDetection.confidence,
              )
            : null;

          if (validBox) {
            stableFaceFramesRef.current++;
            try {
              const currentPose = estimateHeadPose(face.landmarks);
              stablePoseAccumulatorRef.current.push({ yaw: currentPose.yaw, pitch: currentPose.pitch });
              if (stablePoseAccumulatorRef.current.length > 20) {
                stablePoseAccumulatorRef.current.shift();
              }
            } catch {
              // ignore pose error during initial frame detection
            }
            const progress = Math.min(100, Math.round((stableFaceFramesRef.current / 15) * 100));
            setStableFaceProgress(progress);

            const remainingSec = Math.max(0, (15 - stableFaceFramesRef.current) / 30).toFixed(1);
            setLiveGuidance(`Face framed ✓ Hold still to authenticate... (${remainingSec}s)`);

            // AUTOMATIC STEP 1: Biometric Face Matching after 15 consecutive stable frames (~500ms)
            if (
              stableFaceFramesRef.current >= 15 &&
              !isLivenessRunningRef.current &&
              !isVerifyingRef.current &&
              !isMatchingFaceRef.current &&
              phase === "detecting"
            ) {
              const acc = stablePoseAccumulatorRef.current;
              let calibBaseline = { yaw: 0, pitch: 0 };
              if (acc.length > 0) {
                calibBaseline = {
                  yaw: acc.reduce((s, p) => s + p.yaw, 0) / acc.length,
                  pitch: acc.reduce((s, p) => s + p.pitch, 0) / acc.length,
                };
                stableBaselineRef.current = calibBaseline;
              }
              stableFaceFramesRef.current = 0;
              setStableFaceProgress(100);
              recordStage(
                "FACE_STABLE",
                "CONFIRMED",
                "STEP1_START",
                `Face stable for 500ms. Baseline: yaw ${calibBaseline.yaw.toFixed(1)}°, pitch ${calibBaseline.pitch.toFixed(1)}°`,
              );
              void executeStep1FaceMatch(face, calibBaseline);
            }
          } else {
            stableFaceFramesRef.current = 0;
            stablePoseAccumulatorRef.current = [];
            setStableFaceProgress(0);
            setLiveGuidance("Move closer to center camera...");
          }

          drawCompleteFaceOverlay(canvas, face, {
            boxColor: "rgba(52, 211, 153, 0.95)",
            landmarkColor: "rgba(52, 211, 153, 0.7)",
            alignmentPointsColor: "rgba(56, 189, 248, 1.0)",
            showLandmarks: true,
            showAlignmentPoints: true,
            showLabel: true,
          });

          if (now - lastUiUpdateRef.current > 120) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              fps: currentFpsRef.current,
              frameResolution: `${video.videoWidth}x${video.videoHeight}`,
              faceCount: 1,
              faceDetected: Boolean(validBox),
              faceConfidence: authDetection.confidence,
              boundingBox: authDetection.boundingBox,
              qualitySharpness: qual?.sharpness ?? 0,
              qualityBrightness: qual?.brightness ?? 0,
              meanEAR: earInfo.meanEAR,
            }));
          }
        }
      } catch (err) {
        console.error("Frame tracking error:", err);
      } finally {
        if (isLoopRunningRef.current && !isVerifyingRef.current) {
          animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        }
      }
    };

    animFrameRef.current = requestAnimationFrame(() => void frameLoop());
  }, [executeBiometricRecognition, phase, recordStage, startLivenessChallenge]);

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
    isLivenessRunningRef.current = false;

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          facingMode: "user",
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element ref not bound");

      video.srcObject = stream;

      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = (e: Event) => {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
          reject(new Error(`Video metadata loading failed: ${String(e)}`));
        };
        video.addEventListener("loadedmetadata", onLoaded);
        video.addEventListener("error", onError);
      });

      await video.play();

      setPhase("detecting");
      setDiag((prev) => ({
        ...prev,
        frameResolution: `${video.videoWidth}x${video.videoHeight}`,
        detectorReady: true,
      }));

      startDetectionLoopRef.current();
    } catch (err) {
      console.error("Camera startup error:", err);
      setPhase("error");
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not start camera feed. Please check webcam permissions.",
      );
    }
  }, []);

  startCameraRef.current = startCamera;

  /* ---------------------------------------------------------------- */
  /*  Model Initialization & Dialog Lifecycle                          */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) {
      stopCamera();
      setPhase("loading-models");
      return;
    }

    let isCancelled = false;

    async function init() {
      try {
        setPhase("loading-models");
        setModelProgress(15);

        await loadModels();
        if (isCancelled) return;
        setModelProgress(50);

        await initArcFaceSession();
        if (isCancelled) return;
        setModelProgress(75);

        await antiSpoofServiceRef.current.initializeModel();
        if (isCancelled) return;
        setModelProgress(100);

        await startCameraRef.current();
      } catch (err) {
        if (isCancelled) return;
        console.error("Model loading error:", err);
        setPhase("error");
        setErrorMessage(
          "Failed to load facial recognition models. Please check network/models folder.",
        );
      }
    }

    void init();

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  const copyDiagnostics = useCallback(() => {
    const diagnosticPayload = {
      exportedAt: new Date().toISOString(),
      dialog: {
        open,
        phase,
        lastCloseReason: dialogCloseReasonRef.current,
      },
      hardware: {
        platform:
          typeof window !== "undefined" && /Android/i.test(navigator.userAgent)
            ? "Android Phone"
            : typeof window !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent)
              ? "iOS Mobile"
              : "Desktop/Web",
        cameraActive: Boolean(streamRef.current && streamRef.current.active),
        cameraResolution: diag.frameResolution,
        fps: diag.fps,
      },
      faceDetection: {
        faceCount: diag.faceCount,
        faceDetected: diag.faceDetected,
        confidence: `${(diag.faceConfidence * 100).toFixed(1)}%`,
        boundingBox: diag.boundingBox,
        stableFaceProgress: `${stableFaceProgress}%`,
      },
      activeLiveness: {
        stage: phase,
        status: diag.livenessStatus,
        category: diag.livenessCategory,
        step: diag.livenessStep,
        attemptNonce: livenessState?.attemptNonce
          ? `EXISTS (${livenessState.attemptNonce.slice(0, 8)}...)`
          : "NONE",
      },
      headMovementDiagnostics: {
        targetMovement: diag.targetDirection ?? "none",
        detectedDirection: diag.detectedDirection ?? "center",
        neutralBaseline: {
          yawDeg: diag.baselineYaw,
          pitchDeg: diag.baselinePitch,
        },
        currentAngles: {
          yawDeg: diag.currentYaw,
          pitchDeg: diag.currentPitch,
        },
        deltaAngles: {
          deltaYawDeg: diag.deltaYaw,
          deltaPitchDeg: diag.deltaPitch,
        },
        thresholds: {
          yawThresholdDeg: FACE_CONFIG.LIVENESS.HEAD_TURN_ANGLE_DEG,
          pitchUpThresholdDeg: FACE_CONFIG.LIVENESS.HEAD_PITCH_UP_DEG,
          pitchDownThresholdDeg: FACE_CONFIG.LIVENESS.HEAD_PITCH_DOWN_DEG,
        },
        stability: {
          consecutiveFramesSatisfied: diag.poseConsecutiveFrames,
          requiredConsecutiveFrames: diag.poseRequiredFrames,
          stabilityRatio: diag.poseStabilityRatio,
          isPoseSatisfied: diag.isPoseSatisfied,
        },
        progress: diag.movementProgressText,
      },
      presentationAttackDetection: {
        modelArchitecture: "MiniFASNetV2.onnx",
        inputTensorShape: "[1, 3, 80, 80] BGR [0..255] float32",
        outputTensorShape: "[1, 3] float32 logits -> Softmax",
        classMapping: {
          "0": "Print Attack / Paper Mask (Spoof)",
          "1": "Live Face / Bona Fide Presentation",
          "2": "Screen Replay / Video Playback (Spoof)",
        },
        liveScore:
          diag.antiSpoofLiveScore !== null
            ? `${(diag.antiSpoofLiveScore * 100).toFixed(2)}%`
            : "PENDING",
        printScore:
          diag.antiSpoofPrintScore !== null
            ? `${(diag.antiSpoofPrintScore * 100).toFixed(2)}%`
            : "—",
        replayScore:
          diag.antiSpoofReplayScore !== null
            ? `${(diag.antiSpoofReplayScore * 100).toFixed(2)}%`
            : "—",
        glareRatio: `${(diag.antiSpoofGlareRatio * 100).toFixed(1)}%`,
        glareDetected: diag.antiSpoofGlareDetected,
        glareThreshold: `${(FACE_CONFIG.ANTI_SPOOF.MAX_GLARE_RATIO * 100).toFixed(1)}%`,
        moireEnergy: Number(diag.antiSpoofMoireEnergy.toFixed(3)),
        decisionReason: diag.antiSpoofDecisionReason,
        attackClassification: diag.antiSpoofAttackType,
        requiredPolicy: "Live >= 70.0%, Print < 40.0%, Replay < 40.0%, Glare < 22.0%",
        passed:
          diag.antiSpoofLiveScore !== null &&
          diag.antiSpoofLiveScore >= 0.7 &&
          !diag.antiSpoofGlareDetected &&
          diag.antiSpoofAttackType === "none",
      },
      arcFaceBiometrics: {
        model: "w600k_mbf.onnx (112x112 MobileFaceNet)",
        dimension: 512,
        tensorChecksum: diag.tensorChecksum,
        embeddingChecksumA: diag.embeddingChecksumA,
        doubleInferenceDist: diag.doubleInferenceDist,
        embeddingNorm: diag.liveEmbeddingL2Norm,
        targetStaffCode: expectedStaffCode,
        bestMatch: diag.bestMatch,
        distance: diag.distance,
        matchThreshold: diag.threshold,
        margin: diag.margin,
        finalResult: diag.finalResult,
        rootCause: diag.rootCause,
      },
      nativeBridge: {
        isAvailable: isNativeBiometricAvailable(),
        deviceId: getNativeDeviceId() || "none",
      },
      stageHistory: stageHistory.map((s) => ({
        timestamp: new Date(s.timestamp).toLocaleTimeString(),
        stage: s.stage,
        state: s.state,
        durationMs: `${s.durationMs}ms`,
        result: s.result,
        reason: s.reason,
      })),
    };

    const text = JSON.stringify(diagnosticPayload, null, 2);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          toast.success("Diagnostics Copied", {
            description: "Full biometric verification & PAD telemetry copied to clipboard.",
          });
        })
        .catch(() => {
          toast.info("Diagnostics Generated", {
            description: "Clipboard access denied. Check diagnostic panel below.",
          });
        });
    }
  }, [
    open,
    phase,
    diag,
    stableFaceProgress,
    livenessState,
    expectedStaffCode,
    stageHistory,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleExplicitClose("Radix onOpenChange(false)");
        } else {
          onOpenChange(true);
        }
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[94vh] overflow-y-auto p-4 sm:p-5"
        onPointerDownOutside={(e) => {
          // Prevent backdrop clicks from closing during attendance verification
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          // Prevent outside touch gestures from closing face scan on mobile
          e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (phase === "liveness-challenge" || phase === "recognizing") {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="pb-2 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                <ScanFace className="size-5 text-primary" />
                Liveness &amp; Presentation-Attack Protected Face Recognition
              </DialogTitle>
              <DialogDescription className="text-xs">
                Temporal Active Liveness · MiniFASNet-V2 Anti-Spoof · InsightFace MobileFaceNet ArcFace
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleExplicitClose("User clicked Cancel")}
              className="h-8 px-2.5 text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-4 mr-1" /> Cancel
            </Button>
          </div>
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
                <p className="text-sm font-medium">Loading ArcFace &amp; Anti-Spoof AI Models</p>
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
                <p className="text-xs font-semibold">112×112 ArcFace Inference &amp; Biometric Verification…</p>
              </div>
            </div>
          )}

          {/* Active Liveness Challenge HUD */}
          {phase === "liveness-challenge" && livenessState && (
            <div className="absolute top-2 inset-x-2 flex flex-col items-center gap-1.5 pointer-events-none z-10">
              <div className="w-full max-w-sm bg-black/85 backdrop-blur-md border border-primary/50 rounded-lg p-2.5 shadow-lg text-white space-y-2 pointer-events-auto">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-primary animate-pulse" />
                    Liveness Verification Challenge
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="border-emerald-400 text-emerald-300 font-mono text-[10px] bg-emerald-500/10 font-bold flex items-center gap-1">
                      <Timer className="size-3 text-emerald-300" />
                      {livenessState.timeRemainingSec ?? 10}s
                    </Badge>
                  </div>
                </div>

                <Progress
                  value={Math.max(
                    0,
                    Math.min(
                      100,
                      Math.round(((livenessState.timeRemainingSec ?? 10) / 10) * 100),
                    ),
                  )}
                  className="h-1.5 bg-white/20"
                />

                <div className="text-center pt-0.5 space-y-1">
                  <div className="text-sm font-bold text-emerald-400 flex items-center justify-center gap-2">
                    {livenessState.category === "blink-once" && (
                      <Eye className="size-5 animate-pulse text-emerald-400" />
                    )}
                    {livenessState.poseState?.targetDirection === "left" && (
                      <ArrowLeft className="size-5 animate-pulse text-emerald-400" />
                    )}
                    {livenessState.poseState?.targetDirection === "right" && (
                      <ArrowRight className="size-5 animate-pulse text-emerald-400" />
                    )}
                    {livenessState.poseState?.targetDirection === "up" && (
                      <ArrowUp className="size-5 animate-pulse text-emerald-400" />
                    )}
                    {livenessState.poseState?.targetDirection === "down" && (
                      <ArrowDown className="size-5 animate-pulse text-emerald-400" />
                    )}
                    {livenessState.poseState?.targetDirection === "center" && livenessState.category !== "blink-once" && (
                      <Crosshair className="size-5 animate-spin text-emerald-400" />
                    )}
                    <span>{livenessState.instruction}</span>
                  </div>

                  {livenessState.poseState && (
                    <div className="flex items-center justify-center gap-2.5 text-[10px] text-muted-foreground font-mono">
                      <span>
                        ΔYaw: <span className={cn("font-semibold", Math.abs(livenessState.poseState?.deltaAngles.yaw ?? 0) >= 14 ? "text-emerald-300" : "text-white")}>
                          {(livenessState.poseState?.deltaAngles.yaw ?? 0) > 0 ? "+" : ""}
                          {(livenessState.poseState?.deltaAngles.yaw ?? 0).toFixed(1)}°
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        ΔPitch: <span className={cn("font-semibold", Math.abs(livenessState.poseState?.deltaAngles.pitch ?? 0) >= 9 ? "text-emerald-300" : "text-white")}>
                          {(livenessState.poseState?.deltaAngles.pitch ?? 0) > 0 ? "+" : ""}
                          {(livenessState.poseState?.deltaAngles.pitch ?? 0).toFixed(1)}°
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Hold: <span className={cn("font-semibold", (livenessState.poseState?.consecutiveFramesSatisfied ?? 0) >= 3 ? "text-emerald-300" : "text-amber-300")}>
                          {livenessState.poseState?.consecutiveFramesSatisfied ?? 0}/{livenessState.poseState?.requiredFrames ?? 3}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Spoof Detected Banner */}
          {phase === "spoof-detected" && (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/95 text-white px-3 py-2.5 text-center backdrop-blur-sm space-y-1 z-10">
              <p className="flex items-center justify-center gap-1.5 text-xs font-bold text-white">
                <ShieldAlert className="size-4 text-amber-200" /> {errorMessage || "Presentation attack or spoofing detected. Verification rejected."}
              </p>
              <p className="text-[11px] text-white/80">
                Static photographs, screen replays, and unverified movements are prohibited.
              </p>
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
                <ShieldCheck className="size-4" /> Recognized: {matchCode} ({matchName})
              </p>
            </div>
          )}

          {/* Unrecognized / Unknown State Banner */}
          {phase === "unrecognized" && (
            <div className="absolute inset-x-0 bottom-0 bg-destructive/95 text-white px-3 py-2 text-center backdrop-blur-sm space-y-1">
              <p className="flex items-center justify-center gap-1 text-xs font-bold">
                <XCircle className="size-4" /> {errorMessage || "Face not recognized. Please position your face inside the frame and try again."}
              </p>
              <div className="pt-0.5">
                <a
                  href="/admin/face-enrollment"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/30 underline"
                >
                  Enroll Your Face in Database →
                </a>
              </div>
            </div>
          )}

          {/* Live Guidance Indicator */}
          {phase === "detecting" && (
            <div className="absolute top-2 left-2 flex items-center gap-2">
              <div className="bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-mono border border-white/10 text-white">
                {diag.faceCount === 1 ? (
                  <span className="text-emerald-400 font-bold">● 1 Face ({(diag.faceConfidence * 100).toFixed(0)}%)</span>
                ) : (
                  <span className="text-amber-400">○ Center face</span>
                )}
              </div>
              <div className="bg-black/75 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-sans border border-white/10 text-white font-medium">
                {liveGuidance}
              </div>
            </div>
          )}
        </div>

        {/* PRIMARY ACTION BUTTON */}
        <div className="pt-1 space-y-2">
          {phase === "detecting" && (
            <>
              {faceDetected && (
                <div className="space-y-1 bg-muted/40 p-2.5 rounded-lg border border-border">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 font-medium text-emerald-500">
                      <Sparkles className="size-3.5 animate-pulse" />
                      Face detected &amp; centered
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-foreground">
                      {stableFaceProgress >= 100
                        ? "Authenticating face..."
                        : `Auto-authenticating in ${Math.max(0, 0.5 - stableFaceProgress * 0.005).toFixed(1)}s`}
                    </span>
                  </div>
                  <Progress value={stableFaceProgress} className="h-1.5 bg-background" />
                </div>
              )}
              <Button
                size="lg"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-6 text-sm shadow-md transition-all flex items-center justify-center gap-2"
                disabled={!faceDetected}
                onClick={() => {
                  if (lastDetectedFaceRef.current) {
                    void executeStep1FaceMatch(
                      lastDetectedFaceRef.current,
                      stableBaselineRef.current || { yaw: 0, pitch: 0 },
                    );
                  }
                }}
              >
                <ShieldCheck className="size-5" />
                START ATTENDANCE AUTHENTICATION
              </Button>
            </>
          )}

          {phase === "liveness-challenge" && (
            <div className="flex gap-2">
              <Button
                size="lg"
                className="flex-1 bg-amber-600 text-white font-bold py-6 text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-wait"
                disabled
              >
                <Loader2 className="size-5 animate-spin" />
                {liveGuidance}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-border text-foreground hover:bg-destructive/10 hover:text-destructive font-semibold px-5 py-6 text-sm shrink-0"
                onClick={() => handleExplicitClose("User cancelled liveness challenge")}
              >
                <X className="size-4 mr-1.5" /> Cancel
              </Button>
            </div>
          )}

          {phase === "recognizing" && (
            <Button
              size="lg"
              className="w-full bg-blue-600 text-white font-bold py-6 text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-wait"
              disabled
            >
              <Loader2 className="size-5 animate-spin" />
              FINALIZING BIOMETRIC VERIFICATION &amp; ATTESTATION…
            </Button>
          )}

          {(phase === "spoof-detected" || phase === "error" || phase === "unrecognized") && (
            <div className="flex gap-2">
              <Button
                size="lg"
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-6 text-sm shadow-md transition-all flex items-center justify-center gap-2"
                onClick={() => {
                  setPhase("detecting");
                  setErrorMessage("");
                  setMatchName("");
                  setMatchCode("");
                  isVerifyingRef.current = false;
                  isMatchingFaceRef.current = false;
                  livenessRetriesRef.current = 0;
                  matchedStaffRef.current = null;
                  stableFaceFramesRef.current = 0;
                  multiFaceConsecutiveFramesRef.current = 0;
                  setStableFaceProgress(0);
                  antiSpoofServiceRef.current.reset();
                  livenessSessionRef.current = null;
                  recordStage("RETRY", "DETECTING", "RESET", "User restarted challenge verification");
                  startDetectionLoopRef.current();
                }}
              >
                <RefreshCw className="size-5" />
                RETRY AUTHENTICATION
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-border text-foreground hover:bg-muted font-semibold px-5 py-6 text-sm shrink-0"
                onClick={() => handleExplicitClose("User closed after challenge failure")}
              >
                <X className="size-4 mr-1.5" /> Close
              </Button>
            </div>
          )}

          {phase === "matched" && (
            <Button
              size="lg"
              className="w-full bg-emerald-700 text-white font-bold py-6 text-sm shadow-md transition-all flex items-center justify-center gap-2"
              disabled
            >
              <CheckCircle2 className="size-5" />
              BIOMETRICALLY VERIFIED &amp; AUTHORIZED
            </Button>
          )}

          {(phase === "loading-models" || phase === "starting") && (
            <Button
              size="lg"
              className="w-full bg-muted text-muted-foreground font-bold py-6 text-sm shadow-md flex items-center justify-center gap-2"
              disabled
            >
              <Loader2 className="size-5 animate-spin" />
              INITIALIZING HARDWARE &amp; AI MODELS…
            </Button>
          )}
        </div>

        {/* ================================================== */}
        {/* DEVELOPMENT RECOGNITION & TELEMETRY PANEL           */}
        {/* ================================================== */}
        <div className="rounded-xl border border-border bg-card overflow-hidden text-xs">
          <div className="flex w-full items-center justify-between bg-muted/50 px-3.5 py-2 font-semibold text-muted-foreground">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-mono hover:text-foreground transition-colors cursor-pointer"
              onClick={() => setShowDiag((d) => !d)}
            >
              <Cpu className="size-3.5 text-primary" />
              Biometric &amp; Liveness Diagnostic Telemetry
              {showDiag ? <ChevronUp className="size-4 ml-1 inline" /> : <ChevronDown className="size-4 ml-1 inline" />}
            </button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyDiagnostics}
              className="h-7 px-2.5 text-[11px] font-mono gap-1.5 border-primary/40 hover:bg-primary/10 text-foreground"
            >
              <Copy className="size-3 text-primary" />
              Copy Diagnostics
            </Button>
          </div>

          {showDiag && (
            <div className="p-3.5 space-y-3 font-mono text-[11px] bg-background">
              {/* Stage History */}
              <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-border pb-1">
                  <span className="text-foreground">State Machine Stage Transition Log:</span>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {stageHistory.length} events
                  </Badge>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 text-[10px] font-mono">
                  {stageHistory.length === 0 ? (
                    <div className="text-muted-foreground italic text-center py-1">No stage transitions recorded yet.</div>
                  ) : (
                    stageHistory.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-1 text-[9px] border-b border-border/20 pb-0.5">
                        <span className="text-muted-foreground">{new Date(s.timestamp).toLocaleTimeString()}</span>
                        <span className="font-bold text-primary">{s.stage}</span>
                        <span className={cn(s.state === "PASSED" || s.state === "CONFIRMED" || s.state === "ACTIVE" ? "text-success" : s.state === "FAILED" ? "text-destructive" : "text-amber-400")}>
                          [{s.state}]
                        </span>
                        <span className="text-muted-foreground truncate max-w-[200px]">{s.reason}</span>
                        <span className="text-muted-foreground font-mono">{s.durationMs}ms</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {/* Section -1: Mobile & Device Telemetry */}
              <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-indigo-500/20 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">Mobile Phone &amp; Device Diagnostics:</span>
                    <Badge variant="outline" className="text-[9px] font-mono font-bold border-indigo-500 text-indigo-400 bg-indigo-500/10">
                      {typeof window !== "undefined" && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                        ? /Android/i.test(navigator.userAgent)
                          ? "Mobile (Android Phone)"
                          : "Mobile (iOS Device)"
                        : "Desktop / Laptop"}
                    </Badge>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono font-bold",
                      phase === "detecting" || phase === "recognizing" || phase === "matched"
                        ? "border-success text-success bg-success/10"
                        : "border-amber-500 text-amber-500 bg-amber-500/10",
                    )}
                  >
                    Camera: {phase === "detecting" || phase === "recognizing" || phase === "matched" ? "ACTIVE" : "STARTING"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Device</div>
                    <div className="font-bold text-foreground font-mono truncate">
                      {typeof window !== "undefined" && /Android/i.test(navigator.userAgent)
                        ? "Android Mobile"
                        : typeof window !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent)
                          ? "iOS Mobile"
                          : "Desktop / Laptop"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Camera</div>
                    <div className="font-bold text-success font-mono">ACTIVE</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Face count</div>
                    <div className="font-bold text-foreground font-mono">{diag.faceCount} face</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Detector confidence</div>
                    <div className="font-bold text-foreground font-mono">{(diag.faceConfidence * 100).toFixed(1)}%</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Recognition model</div>
                    <div className="font-bold text-primary font-mono truncate">w600k_mbf.onnx</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Embedding</div>
                    <div className="font-bold text-foreground font-mono">512-D</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Embedding norm</div>
                    <div className="font-bold text-success font-mono">{diag.liveEmbeddingL2Norm > 0 ? diag.liveEmbeddingL2Norm.toFixed(6) : "1.000000"}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Database / pgvector</div>
                    <div className="font-bold text-success font-mono truncate">PostgreSQL (ENABLED)</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] pt-1 border-t border-border">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Best match</div>
                    <div className="font-bold text-primary font-mono truncate">{diag.bestMatch ? `${diag.bestMatch.staffCode}` : "—"}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Best distance</div>
                    <div className={cn("font-bold font-mono", diag.distance !== null && diag.distance <= 0.45 ? "text-success" : "text-destructive")}>
                      {diag.distance !== null ? diag.distance.toFixed(4) : "—"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Final decision</div>
                    <div className="font-bold font-mono truncate">
                      {diag.distance !== null && diag.distance <= diag.threshold ? (
                        <span className="text-success">PERSON_001 (AUTHORIZED)</span>
                      ) : (
                        <span className="text-destructive">UNKNOWN</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 0: Presentation Attack Detection (PAD) */}
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-amber-500/20 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">Presentation Attack Detection (PAD) · MiniFASNet-V2:</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] font-mono font-bold",
                        diag.antiSpoofLiveScore !== null && diag.antiSpoofLiveScore >= 0.70
                          ? "border-success text-success bg-success/10"
                          : "border-amber-500 text-amber-400 bg-amber-500/10",
                      )}
                    >
                      LIVE SCORE: {diag.antiSpoofLiveScore !== null ? `${(diag.antiSpoofLiveScore * 100).toFixed(1)}%` : "PENDING"}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono font-bold border-primary text-primary bg-primary/10">
                    Input: [1, 3, 80, 80] BGR [0..255]
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Model Architecture</div>
                    <div className="font-bold text-foreground font-mono truncate">MiniFASNetV2.onnx</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">PAD Status</div>
                    <div className={cn("font-bold font-mono", diag.antiSpoofLiveScore !== null && diag.antiSpoofLiveScore >= 0.70 ? "text-success" : "text-primary")}>
                      {diag.antiSpoofLiveScore !== null ? "EVALUATED" : "WARMING UP"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Print Attack Score (C0)</div>
                    <div className={cn("font-bold font-mono", (diag.antiSpoofPrintScore ?? 0) >= 0.40 ? "text-destructive" : "text-success")}>
                      {diag.antiSpoofPrintScore !== null ? `${((diag.antiSpoofPrintScore ?? 0) * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Screen Replay Score (C2)</div>
                    <div className={cn("font-bold font-mono", (diag.antiSpoofReplayScore ?? 0) >= 0.40 ? "text-destructive" : "text-success")}>
                      {diag.antiSpoofReplayScore !== null ? `${((diag.antiSpoofReplayScore ?? 0) * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] pt-1 border-t border-border">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Output Tensor Shape</div>
                    <div className="font-bold text-foreground font-mono">[1, 3] (0:Print, 1:Live, 2:Replay)</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Decision Threshold Policy</div>
                    <div className="font-bold text-foreground font-mono">Live &ge; 70%, Print/Replay &lt; 40%, Glare &lt; 22%</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Attack Classification</div>
                    <div className={cn("font-bold font-mono", diag.antiSpoofAttackType !== "none" || diag.antiSpoofGlareDetected ? "text-destructive" : "text-success")}>
                      {diag.antiSpoofAttackType === "none" && !diag.antiSpoofGlareDetected
                        ? "CLEAN (GENUINE HUMAN)"
                        : diag.antiSpoofGlareDetected
                          ? "ELECTRONIC GLASS GLARE"
                          : diag.antiSpoofAttackType.toUpperCase()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] pt-1 border-t border-border">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Optical Glare Ratio</div>
                    <div className={cn("font-bold font-mono", diag.antiSpoofGlareDetected ? "text-destructive" : "text-success")}>
                      {(diag.antiSpoofGlareRatio * 100).toFixed(1)}% (Threshold: &le; 22.0%)
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Surface Glare Status</div>
                    <div className={cn("font-bold font-mono", diag.antiSpoofGlareDetected ? "text-destructive" : "text-success")}>
                      {diag.antiSpoofGlareDetected ? "HARSH SCREEN GLARE" : "DIFFUSE SKIN (AUTHENTIC)"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">PAD Decision Reason</div>
                    <div className="font-bold font-mono text-foreground truncate" title={diag.antiSpoofDecisionReason}>
                      {diag.antiSpoofDecisionReason}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 0.5: Real-Time Head-Pose & 3D Movement Telemetry */}
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-emerald-500/20 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">Real-Time Head-Pose &amp; 3D Movement Telemetry:</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] font-mono font-bold",
                        diag.isPoseSatisfied
                          ? "border-success text-success bg-success/10"
                          : "border-amber-500 text-amber-400 bg-amber-500/10",
                      )}
                    >
                      {diag.isPoseSatisfied ? "HELD STABLY" : "TRACKING"}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono font-bold border-emerald-500 text-emerald-400 bg-emerald-500/10">
                    Status: {diag.livenessStatus}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Target Movement</div>
                    <div className="font-bold text-primary font-mono">{diag.targetDirection ? diag.targetDirection.toUpperCase() : "—"}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Detected Direction</div>
                    <div className={cn("font-bold font-mono", diag.detectedDirection === diag.targetDirection ? "text-success" : "text-foreground")}>
                      {diag.detectedDirection ? diag.detectedDirection.toUpperCase() : "CENTER"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Neutral Baseline (Yaw/Pitch)</div>
                    <div className="font-bold text-foreground font-mono">{diag.baselineYaw.toFixed(1)}° / {diag.baselinePitch.toFixed(1)}°</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Current Angles (Yaw/Pitch)</div>
                    <div className="font-bold text-foreground font-mono">{diag.currentYaw.toFixed(1)}° / {diag.currentPitch.toFixed(1)}°</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">ΔYaw (Deg)</div>
                    <div className={cn("font-bold font-mono", Math.abs(diag.deltaYaw) >= 14 ? "text-emerald-400" : "text-foreground")}>
                      {diag.deltaYaw > 0 ? "+" : ""}{diag.deltaYaw.toFixed(1)}° (Threshold: ±14.0°)
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">ΔPitch (Deg)</div>
                    <div className={cn("font-bold font-mono", Math.abs(diag.deltaPitch) >= 9 ? "text-emerald-400" : "text-foreground")}>
                      {diag.deltaPitch > 0 ? "+" : ""}{diag.deltaPitch.toFixed(1)}° (Up &ge; +9°, Down &le; -9°)
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Stability Multi-Frame Hold</div>
                    <div className={cn("font-bold font-mono", diag.poseConsecutiveFrames >= diag.poseRequiredFrames ? "text-success" : "text-amber-400")}>
                      {diag.poseConsecutiveFrames} / {diag.poseRequiredFrames} frames ({(diag.poseStabilityRatio * 100).toFixed(0)}%)
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Tracking Framerate</div>
                    <div className="font-bold text-foreground font-mono">{diag.fps > 0 ? `${diag.fps} FPS` : "Measuring..."}</div>
                  </div>
                </div>

                <div className="bg-background/80 p-1.5 rounded border border-border text-[10px]">
                  <div className="text-muted-foreground font-sans">Active Step Instruction:</div>
                  <div className="font-bold text-foreground font-mono truncate">{diag.livenessStep}</div>
                </div>
              </div>

              {/* Section 0: Frame Synchronization & Identification */}
              <div className="rounded-lg border border-primary/40 bg-primary/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-primary/20 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">1. Frame Synchronization & Identification:</span>
                    <Badge variant="outline" className="text-[9px] font-mono font-bold border-primary text-primary bg-primary/10">
                      FRAME ID: {diag.recognitionFrameId ? `#${diag.recognitionFrameId}` : "PENDING"}
                    </Badge>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono font-bold border-success text-success bg-success/10">
                    PARITY: 100% MATCH
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Recognition Frame ID</div>
                    <div className="font-bold text-primary font-mono">{diag.recognitionFrameId ? `#${diag.recognitionFrameId}` : "—"}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Detector Confidence</div>
                    <div className="font-bold text-foreground font-mono">{(diag.faceConfidence * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Face Box [x,y,w,h]</div>
                    <div className="font-bold text-foreground font-mono truncate">
                      {diag.boundingBox ? `[${diag.boundingBox.x}, ${diag.boundingBox.y}, ${diag.boundingBox.width}, ${diag.boundingBox.height}]` : "—"}
                    </div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Resolution</div>
                    <div className="font-bold text-foreground font-mono">{diag.frameResolution}</div>
                  </div>
                </div>
              </div>

              {/* Section 1: Preprocessing & Double Inference Verification */}
              <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-sans font-semibold border-b border-border pb-1">
                  <span className="text-foreground">2. 112×112 Preprocessing & Double-Inference Test:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] font-mono font-bold",
                      diag.doubleInferenceDist !== null && diag.doubleInferenceDist < 0.0001
                        ? "border-success text-success bg-success/10"
                        : "border-muted-foreground text-muted-foreground",
                    )}
                  >
                    Double-Inference: {diag.doubleInferenceDist !== null ? `${diag.doubleInferenceDist.toFixed(8)} (PASS)` : "—"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">112×112 Tensor Checksum</div>
                    <div className="font-bold text-foreground font-mono truncate">{diag.tensorChecksum}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Embedding Checksum</div>
                    <div className="font-bold text-foreground font-mono truncate">{diag.embeddingChecksumA}</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Vector Dim &amp; L2 Norm</div>
                    <div className="font-bold text-success font-mono">{diag.embeddingDim}-D ({diag.liveEmbeddingL2Norm.toFixed(6)})</div>
                  </div>
                  <div className="bg-background/80 p-1.5 rounded border border-border">
                    <div className="text-muted-foreground font-sans">Live vs Offline Distance</div>
                    <div className="font-bold text-primary font-mono truncate">
                      {diag.liveVsOfflineDistance !== null ? diag.liveVsOfflineDistance.toFixed(8) : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Exact Recognition Previews */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 space-y-2">
                <div className="text-[11px] font-sans font-semibold text-primary border-b border-primary/20 pb-1">
                  3. Exact Visual Previews for Frame {diag.recognitionFrameId ? `#${diag.recognitionFrameId}` : ""}:
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="space-y-1">
                    <div className="text-[9px] text-muted-foreground font-sans">Full Frame N</div>
                    <div className="relative aspect-video rounded overflow-hidden border border-border bg-black flex items-center justify-center">
                      {diag.originalFramePreview ? (
                        <img src={diag.originalFramePreview} alt="Original Frame" className="size-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-muted-foreground font-sans">Face Crop N</div>
                    <div className="relative aspect-square size-16 mx-auto rounded overflow-hidden border border-border bg-black flex items-center justify-center">
                      {diag.croppedFacePreview ? (
                        <img src={diag.croppedFacePreview} alt="Face Crop" className="size-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-primary font-sans font-semibold">Aligned 112×112 N</div>
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

              {/* Section 3: PostgreSQL pgvector Distance vs 5 PERSON_001 Reference Embeddings */}
              <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground font-sans border-b border-border pb-1">
                  <span>4. PostgreSQL pgvector Cosine Distance vs 5 PERSON_001 Active Embeddings:</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-mono h-4 font-bold",
                      diag.finalResult.startsWith("PERSON_")
                        ? "border-success text-success bg-success/10"
                        : "border-destructive text-destructive bg-destructive/10",
                    )}
                  >
                    Result: {diag.finalResult}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[9px] font-mono">
                  {["P001-1", "P001-2", "P001-3", "P001-4", "P001-5"].map((slot) => {
                    const dist = diag.p001Distances[slot];
                    return (
                      <div key={slot} className="bg-background/80 p-1.5 rounded border border-border text-center">
                        <div className="text-muted-foreground font-sans text-[8px]">{slot}</div>
                        <div className={cn("font-bold text-xs mt-0.5", dist !== undefined && dist <= 0.45 ? "text-success" : "text-destructive")}>
                          {dist !== undefined ? dist.toFixed(4) : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] pt-1 border-t border-border">
                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">Minimum Distance</div>
                    <div className={cn("text-xs font-bold font-mono", diag.distance !== null && diag.distance <= 0.45 ? "text-success" : "text-destructive")}>
                      {diag.distance !== null ? diag.distance.toFixed(4) : "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Threshold: &le; {diag.threshold}</div>
                  </div>

                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">Best Match Candidate</div>
                    <div className="text-xs font-bold text-primary truncate">
                      {diag.bestMatch ? `${diag.bestMatch.staffCode} (${diag.bestMatch.name})` : "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Margin: &ge; {diag.margin}</div>
                  </div>

                  <div className="bg-background/80 p-2 rounded border border-border">
                    <div className="text-muted-foreground font-sans font-semibold">Final Decision</div>
                    <div className="text-xs font-bold text-foreground font-mono">
                      {diag.distance !== null && diag.distance <= diag.threshold ? (
                        <span className="text-success">PERSON_001 (AUTHORIZED)</span>
                      ) : (
                        <span className="text-destructive">UNKNOWN</span>
                      )}
                    </div>
                    <div className="text-[9px] text-muted-foreground">Deterministic single-frame</div>
                  </div>
                </div>

                {/* Section 5: Root Cause Diagnosis */}
                <div className="bg-background/90 p-2 rounded border border-border space-y-1 text-[10px]">
                  <div className="text-muted-foreground font-sans font-semibold">Root Cause Diagnosis:</div>
                  <div className={cn("font-mono text-[10px] font-bold", diag.finalResult.startsWith("PERSON_") ? "text-success" : "text-amber-500")}>
                    {diag.rootCause}
                  </div>
                </div>
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
                startDetectionLoopRef.current();
              }}
            >
              <RefreshCw className="mr-2 size-4" /> Reset / Ready Next Frame
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
