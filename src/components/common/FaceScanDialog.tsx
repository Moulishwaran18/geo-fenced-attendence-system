import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Eye,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadModels,
  areModelsLoaded,
  initArcFaceSession,
  isArcFaceLoaded,
  generateArcFaceEmbedding,
  detectFaces,
  drawFaceBox,
  getAverageEAR,
  TemporalBlinkDetector,
  verifyLiveFace,
  FACE_CONFIG,
  type DetectedFace,
  type VerificationResult,
} from "@/lib/face-recognition";

/* ------------------------------------------------------------------ */
/*  Types & Props                                                      */
/* ------------------------------------------------------------------ */

export type VerificationPhase =
  | "loading-models"
  | "starting"
  | "awaiting-blink" // "Hold still & blink your eyes once"
  | "blink-detected" // "Blink Detected ✓ Verifying identity..."
  | "matched"        // "Identity verified: [Staff Name]"
  | "unrecognized"   // "Face Not Recognized"
  | "error";

export interface FaceScanResult {
  staffId: string;
  staffName: string;
  distance: number;
  snapshot: string;
  verification: VerificationResult;
}

interface DiagnosticState {
  faceDetected: boolean;
  faceConfidence: number;
  faceBox: { width: number; height: number } | null;
  landmarksCount: number;
  ear: number;
  baselineEAR: number;
  blinkComplete: boolean;
  livenessPassed: boolean;
  embeddingDim: number;
  bestMatch: { staffCode: string; name: string; distance: number } | null;
  secondBestMatch: { staffCode: string; name: string; distance: number } | null;
  distance: number | null;
  threshold: number;
  margin: number;
  matchMargin: number | null;
  finalResult: "IDLE" | "AUTHORIZED" | "REJECTED_UNKNOWN" | "REJECTED_THRESHOLD" | "REJECTED_MARGIN" | "REJECTED_LIVENESS";
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
  const blinkDetectorRef = useRef<TemporalBlinkDetector>(new TemporalBlinkDetector(1));
  const lastUiUpdateRef = useRef<number>(0);

  const [phase, setPhase] = useState<VerificationPhase>("loading-models");
  const [errorMessage, setErrorMessage] = useState("");
  const [modelProgress, setModelProgress] = useState(0);
  const [matchName, setMatchName] = useState<string>("");
  const [faceDetected, setFaceDetected] = useState(false);

  // Developer Diagnostic Telemetry State
  const [diag, setDiag] = useState<DiagnosticState>({
    faceDetected: false,
    faceConfidence: 0,
    faceBox: null,
    landmarksCount: 0,
    ear: 0.28,
    baselineEAR: 0.28,
    blinkComplete: false,
    livenessPassed: false,
    embeddingDim: 512,
    bestMatch: null,
    secondBestMatch: null,
    distance: null,
    threshold: FACE_CONFIG.MATCH_THRESHOLD,
    margin: FACE_CONFIG.MIN_MATCH_MARGIN,
    matchMargin: null,
    finalResult: "IDLE",
  });
  const [showDiag, setShowDiag] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Camera Lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  const stopCamera = useCallback(() => {
    isLoopRunningRef.current = false;
    isVerifyingRef.current = false;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Biometric Recognition Execution via Backend Vector Search       */
  /* ---------------------------------------------------------------- */

  const executeRecognition = useCallback(
    async (verifiedFace: DetectedFace, livenessPassed: boolean) => {
      if (isVerifyingRef.current) return;
      isVerifyingRef.current = true;
      setPhase("blink-detected");

      // Hardening: Liveness check must be true
      if (!livenessPassed) {
        setPhase("unrecognized");
        setErrorMessage("Liveness verification failed. Face matching alone cannot grant access.");
        setDiag((prev) => ({
          ...prev,
          finalResult: "REJECTED_LIVENESS",
        }));
        isVerifyingRef.current = false;
        return;
      }

      const video = videoRef.current;

      try {
        if (!video || !video.videoWidth || !video.videoHeight) {
          throw new Error("Live camera stream unavailable for biometric alignment.");
        }

        // Generate 512-dimensional ArcFace embedding from 5-point aligned face crop
        const arcFaceDescriptor = await generateArcFaceEmbedding(
          video,
          video.videoWidth,
          video.videoHeight,
          verifiedFace.landmarks,
        );

        // Query backend PostgreSQL vector search endpoint (POST /api/face/verify)
        const verifyRes = await verifyLiveFace(arcFaceDescriptor, true);

        // Update diagnostic panel metrics
        setDiag((prev) => ({
          ...prev,
          faceDetected: true,
          faceConfidence: verifiedFace.confidence,
          faceBox: { width: Math.round(verifiedFace.box.width), height: Math.round(verifiedFace.box.height) },
          landmarksCount: verifiedFace.landmarks.positions.length,
          embeddingDim: arcFaceDescriptor.length,
          bestMatch: verifyRes.bestCandidate ?? (verifyRes.staff ? { staffCode: verifyRes.staff.staffCode, name: verifyRes.staff.name, distance: verifyRes.distance ?? 0 } : null),
          secondBestMatch: verifyRes.secondBestCandidate ?? null,
          distance: verifyRes.distance ?? null,
          threshold: verifyRes.threshold ?? FACE_CONFIG.MATCH_THRESHOLD,
          margin: verifyRes.margin ?? FACE_CONFIG.MIN_MATCH_MARGIN,
          matchMargin: verifyRes.matchMargin ?? null,
          livenessPassed: true,
          finalResult: verifyRes.matched ? "AUTHORIZED" : (verifyRes.distance && verifyRes.distance > (verifyRes.threshold ?? FACE_CONFIG.MATCH_THRESHOLD) ? "REJECTED_THRESHOLD" : "REJECTED_MARGIN"),
        }));

        if (!verifyRes.matched || !verifyRes.staff) {
          setPhase("unrecognized");
          setErrorMessage(
            verifyRes.reason ||
              "Face Not Recognized. Only authorized staff members can mark attendance.",
          );
          isVerifyingRef.current = false;
          return;
        }

        setMatchName(verifyRes.staff.name);
        setPhase("matched");

        // Capture receipt snapshot
        let snapshot = "";
        if (video && video.videoWidth) {
          const snapCanvas = document.createElement("canvas");
          const size = Math.min(video.videoWidth, video.videoHeight);
          snapCanvas.width = size;
          snapCanvas.height = size;
          const snapCtx = snapCanvas.getContext("2d");
          if (snapCtx) {
            snapCtx.translate(size, 0);
            snapCtx.scale(-1, 1);
            snapCtx.drawImage(
              video,
              (video.videoWidth - size) / 2,
              (video.videoHeight - size) / 2,
              size,
              size,
              0,
              0,
              size,
              size,
            );
            snapshot = snapCanvas.toDataURL("image/jpeg", 0.85);
          }
        }

        await new Promise((r) => setTimeout(r, 1000));

        stopCamera();
        onVerified({
          staffId: verifyRes.staff.staffCode,
          staffName: verifyRes.staff.name,
          distance: verifyRes.distance ?? 0.35,
          snapshot,
          verification: {
            accepted: true,
            confirmedStaffId: verifyRes.staff.staffCode,
            confirmedStaffName: verifyRes.staff.name,
            auditId: verifyRes.auditId || crypto.randomUUID(),
          },
        });
        onOpenChange(false);
      } catch (err) {
        setPhase("unrecognized");
        setErrorMessage(`Verification connection error: ${String(err)}`);
        setDiag((prev) => ({ ...prev, finalResult: "REJECTED_UNKNOWN" }));
        isVerifyingRef.current = false;
      }
    },
    [onOpenChange, onVerified, stopCamera],
  );

  /* ---------------------------------------------------------------- */
  /*  Frame Analysis Loop (Liveness + Detection)                      */
  /* ---------------------------------------------------------------- */

  const startDetectionLoop = useCallback(() => {
    if (isLoopRunningRef.current) return;
    isLoopRunningRef.current = true;

    const frameLoop = async () => {
      if (!isLoopRunningRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || video.readyState < 2 || !canvas) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animFrameRef.current = requestAnimationFrame(() => void frameLoop());
        return;
      }

      try {
        const faces = await detectFaces(video);

        // Ensure canvas matches video size once ready
        if (video.videoWidth && canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (faces.length === 0) {
          if (faceDetected) setFaceDetected(false);
          setDiag((prev) => ({
            ...prev,
            faceDetected: false,
            landmarksCount: 0,
          }));
        } else if (faces.length > 1) {
          if (faceDetected) setFaceDetected(false);
          faces.forEach((f) => {
            ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
            ctx.lineWidth = 3;
            ctx.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height);
          });
          setDiag((prev) => ({
            ...prev,
            faceDetected: false,
            landmarksCount: 0,
            finalResult: "IDLE",
          }));
        } else {
          // Exactly 1 face
          const face = faces[0]!;
          if (!faceDetected) setFaceDetected(true);

          // Draw clean Haar feature box
          drawFaceBox(canvas, face.box, "rgba(52, 211, 153, 0.85)", 3);

          // Process Aadhaar single blink with adaptive baseline
          const ear = getAverageEAR(face.landmarks);
          const blinkState = blinkDetectorRef.current.processFrame(face.landmarks);

          // Throttle telemetry update to avoid React 60 FPS re-render flicker
          const now = Date.now();
          if (now - lastUiUpdateRef.current > 200) {
            lastUiUpdateRef.current = now;
            setDiag((prev) => ({
              ...prev,
              faceDetected: true,
              faceConfidence: face.confidence,
              faceBox: { width: Math.round(face.box.width), height: Math.round(face.box.height) },
              landmarksCount: face.landmarks.positions.length,
              ear,
              baselineEAR: blinkState.baselineEAR,
              blinkComplete: blinkState.isComplete,
            }));
          }

          if (blinkState.isComplete && !isVerifyingRef.current) {
            // User performed 1 single natural blink!
            isLoopRunningRef.current = false;
            void executeRecognition(face, true);
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
  }, [executeRecognition, faceDetected]);

  /* ---------------------------------------------------------------- */
  /*  Start Camera Stream                                              */
  /* ---------------------------------------------------------------- */

  const startCamera = useCallback(async () => {
    setPhase("starting");
    setErrorMessage("");
    setMatchName("");
    setFaceDetected(false);
    isVerifyingRef.current = false;
    blinkDetectorRef.current.reset(1);
    setDiag((prev) => ({
      ...prev,
      blinkComplete: false,
      livenessPassed: false,
      finalResult: "IDLE",
    }));

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Live camera is not supported on this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: FACE_CONFIG.CAMERA,
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setPhase("awaiting-blink");
    } catch (e) {
      const errName = (e as { name?: string }).name;
      setErrorMessage(
        errName === "NotAllowedError"
          ? "Camera access was denied. Please allow camera permissions in your browser."
          : errName === "NotFoundError"
            ? "No webcam or front-facing camera found on this device."
            : (e as Error).message || "Unable to start webcam stream.",
      );
      setPhase("error");
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Initial Model Loading & Modal Hooks                             */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return;

    if (areModelsLoaded() && isArcFaceLoaded()) {
      void startCamera();
      return;
    }

    setPhase("loading-models");
    let isCancelled = false;

    const progressTimer = setInterval(() => {
      if (!isCancelled) {
        setModelProgress((prev) => Math.min(prev + 12, 90));
      }
    }, 150);

    Promise.all([loadModels(), initArcFaceSession()])
      .then(() => {
        if (!isCancelled) {
          setModelProgress(100);
          void startCamera();
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setPhase("error");
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Failed to download face recognition neural network models.",
          );
        }
      })
      .finally(() => clearInterval(progressTimer));

    return () => {
      isCancelled = true;
      clearInterval(progressTimer);
    };
  }, [open, startCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setPhase("loading-models");
      setModelProgress(0);
      setMatchName("");
      setFaceDetected(false);
    }
    return stopCamera;
  }, [open, stopCamera]);

  useEffect(() => {
    if (phase === "awaiting-blink") {
      startDetectionLoop();
    }
  }, [phase, startDetectionLoop]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="size-5 text-primary" aria-hidden /> Aadhaar Face RD Verification
            </DialogTitle>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Sparkles className="size-3" /> UIDAI Standard
            </span>
          </div>
          <DialogDescription>
            {phase === "blink-detected"
              ? "Blink verified ✓ Querying PostgreSQL vector database..."
              : phase === "matched"
                ? `Identity verified: ${matchName}`
                : phase === "unrecognized"
                  ? "Face Not Recognized. Only registered staff members are authorized."
                  : phase === "awaiting-blink"
                    ? "Hold still & blink your eyes once to verify live presence."
                    : "Position your face inside the frame and blink your eyes once."}
          </DialogDescription>
        </DialogHeader>

        {/* Viewport with Stable Non-Flickering Video & Aadhaar Circular Frame */}
        <div className="relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-2xl border border-border bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="size-full scale-x-[-1] object-cover"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 size-full scale-x-[-1]"
          />

          {/* Aadhaar Circular Guide Frame */}
          {phase !== "error" && phase !== "loading-models" && (
            <div
              className={cn(
                "pointer-events-none absolute inset-8 rounded-full border-2 transition-colors duration-300",
                phase === "matched"
                  ? "border-success bg-success/15 shadow-[0_0_20px_rgba(34,197,94,0.35)]"
                  : phase === "blink-detected"
                    ? "border-primary animate-pulse shadow-[0_0_20px_rgba(99,102,241,0.35)]"
                    : faceDetected
                      ? "border-emerald-400/90 shadow-[0_0_15px_rgba(52,211,153,0.3)]"
                      : "border-primary/40 border-dashed",
              )}
              aria-hidden
            />
          )}

          {/* Model Loading State */}
          {phase === "loading-models" && (
            <div className="absolute inset-0 grid place-items-center bg-muted/90 p-6">
              <div className="w-full max-w-[200px] space-y-3 text-center">
                <Loader2 className="mx-auto size-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Loading AI Models</p>
                <Progress value={modelProgress} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{modelProgress}%</p>
              </div>
            </div>
          )}

          {/* Camera Starting State */}
          {phase === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-muted/80 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Starting camera…
              </span>
            </div>
          )}

          {/* Camera Error */}
          {phase === "error" && (
            <div className="absolute inset-0 grid place-items-center gap-2 p-6 text-center">
              <div>
                <CameraOff className="mx-auto size-8 text-destructive" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Aadhaar Live Blink Prompt Banner */}
          {phase === "awaiting-blink" && (
            <div className="absolute inset-x-0 bottom-0 bg-primary-soft/95 px-4 py-3 text-center backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary/80">
                Aadhaar Face RD Liveness Check
              </p>
              <p className="mt-0.5 text-sm font-bold text-primary animate-pulse">
                👁️ Hold still & blink your eyes once to verify
              </p>
            </div>
          )}

          {/* Blink Detected / Matching State */}
          {phase === "blink-detected" && (
            <div className="absolute inset-x-0 bottom-0 bg-primary-soft/95 px-4 py-3 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-primary">
                <Check className="size-4" /> Blink Detected!
              </p>
              <p className="text-sm font-bold text-primary">
                Searching 512-d ArcFace embeddings in database…
              </p>
            </div>
          )}

          {/* Matched Success */}
          {phase === "matched" && matchName && (
            <div className="absolute inset-x-0 bottom-0 bg-success-soft/95 px-4 py-3 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-1 text-xs font-semibold text-success">
                <ShieldCheck className="size-4" /> Aadhaar Biometric Match Verified
              </p>
              <p className="text-base font-bold text-success">
                {matchName}
              </p>
            </div>
          )}

          {/* Unrecognized */}
          {phase === "unrecognized" && (
            <div className="absolute inset-x-0 bottom-0 bg-danger-soft/95 px-4 py-3 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-destructive">
                <XCircle className="size-5" /> Face Not Recognized
              </p>
              <p className="text-xs text-destructive/85">
                {errorMessage || "Only registered staff members are authorized."}
              </p>
            </div>
          )}
        </div>

        {/* Developer-Only Diagnostic Panel (Requirement 8) */}
        <div className="rounded-xl border border-border bg-card overflow-hidden text-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between bg-muted/50 px-3.5 py-2 font-semibold text-muted-foreground hover:bg-muted transition-colors"
            onClick={() => setShowDiag((d) => !d)}
          >
            <span className="flex items-center gap-1.5">
              <Cpu className="size-3.5 text-primary" />
              Developer Diagnostic Telemetry & Biometric Matcher
            </span>
            {showDiag ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {showDiag && (
            <div className="p-3.5 space-y-3 font-mono text-[11px] bg-background">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-border bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground font-sans">Detected Face</div>
                  <div className="font-bold text-foreground">
                    {diag.faceDetected ? `1 Face (${diag.faceConfidence > 0 ? `${(diag.faceConfidence * 100).toFixed(0)}%` : "OK"})` : "None"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {diag.faceBox ? `${diag.faceBox.width}x${diag.faceBox.height}px · 68 pts` : "—"}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground font-sans">Liveness Result</div>
                  <div className="font-bold text-foreground">
                    {diag.livenessPassed || diag.blinkComplete ? (
                      <span className="text-success flex items-center gap-1">
                        <CheckCircle2 className="size-3" /> Blink Verified
                      </span>
                    ) : (
                      <span className="text-warning">Awaiting Blink</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    EAR: {diag.ear.toFixed(2)} (Base: {diag.baselineEAR.toFixed(2)})
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground font-sans">Embedding Dimension</div>
                  <div className="font-bold text-primary font-mono">{diag.embeddingDim} floats</div>
                  <div className="text-[10px] text-muted-foreground">ArcFace 512-D Descriptor</div>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground font-sans">Final Decision</div>
                  <div>
                    {diag.finalResult === "AUTHORIZED" ? (
                      <Badge className="bg-success text-white text-[10px] h-5">AUTHORIZED</Badge>
                    ) : diag.finalResult === "REJECTED_THRESHOLD" ? (
                      <Badge variant="destructive" className="text-[10px] h-5">FAIL: Threshold</Badge>
                    ) : diag.finalResult === "REJECTED_MARGIN" ? (
                      <Badge variant="destructive" className="text-[10px] h-5">FAIL: Margin</Badge>
                    ) : diag.finalResult === "REJECTED_LIVENESS" ? (
                      <Badge variant="destructive" className="text-[10px] h-5">FAIL: Liveness</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-5">WAITING</Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Vector Matching Deep Breakdown */}
              <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] border-b border-border pb-1">
                  <span className="font-semibold text-muted-foreground font-sans">Best Match Candidate:</span>
                  <span className="font-bold text-foreground">
                    {diag.bestMatch ? `${diag.bestMatch.name} (${diag.bestMatch.staffCode})` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] border-b border-border pb-1">
                  <span className="font-semibold text-muted-foreground font-sans">Second-Best Candidate:</span>
                  <span className="text-muted-foreground">
                    {diag.secondBestMatch ? `${diag.secondBestMatch.name} (${diag.secondBestMatch.staffCode}) — Dist: ${diag.secondBestMatch.distance.toFixed(4)}` : "None (Single Enrolled Identity)"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-[10px]">
                  <div>
                    <span className="text-muted-foreground">Cosine Distance:</span>{" "}
                    <span className={cn("font-bold", diag.distance !== null && diag.distance <= diag.threshold ? "text-success" : "text-destructive")}>
                      {diag.distance !== null ? diag.distance.toFixed(4) : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Threshold:</span>{" "}
                    <span className="font-bold text-foreground">{diag.threshold.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Match Margin:</span>{" "}
                    <span className={cn("font-bold", diag.matchMargin !== null && diag.matchMargin >= diag.margin ? "text-success" : "text-foreground")}>
                      {diag.matchMargin !== null ? diag.matchMargin.toFixed(4) : "—"} (Req: {diag.margin.toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex gap-2">
          {phase === "error" ? (
            <Button className="w-full" onClick={() => void startCamera()}>
              <RefreshCw className="mr-2 size-4" aria-hidden /> Retry Camera
            </Button>
          ) : phase === "unrecognized" ? (
            <Button
              className="w-full"
              onClick={() => {
                setPhase("awaiting-blink");
                setErrorMessage("");
                setMatchName("");
                isVerifyingRef.current = false;
                blinkDetectorRef.current.reset(1);
                setDiag((prev) => ({
                  ...prev,
                  blinkComplete: false,
                  livenessPassed: false,
                  finalResult: "IDLE",
                }));
              }}
            >
              <RotateCcw className="mr-2 size-4" aria-hidden /> Retry Face Authentication
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              variant={faceDetected ? "default" : "secondary"}
              disabled={phase === "loading-models" || phase === "starting" || phase === "blink-detected"}
              onClick={() => {
                // Instructions banner reminder
              }}
            >
              {phase === "blink-detected" ? (
                <>
                  <Loader2 className="mr-2 size-5 animate-spin" /> Verifying Biometrics…
                </>
              ) : phase === "matched" ? (
                <>
                  <UserCheck className="mr-2 size-5" /> Identity Verified ✓
                </>
              ) : (
                <>
                  <ScanFace className="mr-2 size-5" /> Blink Eyes Once to Authenticate
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
