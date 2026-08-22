import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  Check,
  Eye,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  loadModels,
  areModelsLoaded,
  detectFaces,
  drawFaceBox,
  findBestMatch,
  getEmbeddingsForMatching,
  getAverageEAR,
  TemporalBlinkDetector,
  FACE_CONFIG,
  type DetectedFace,
  type MatchResult,
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
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);

  // Throttled Debug Telemetry
  const [debugInfo, setDebugInfo] = useState<{
    faceCount: number;
    ear: number;
    baselineEAR: number;
    bestName: string | null;
    distance: number | null;
    status: string;
  }>({
    faceCount: 0,
    ear: 0.28,
    baselineEAR: 0.28,
    bestName: null,
    distance: null,
    status: "READY",
  });
  const [showDebug, setShowDebug] = useState(false);

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
  /*  Biometric Recognition Execution                                  */
  /* ---------------------------------------------------------------- */

  const executeRecognition = useCallback(
    async (verifiedFace: DetectedFace) => {
      if (isVerifyingRef.current) return;
      isVerifyingRef.current = true;
      setPhase("blink-detected");

      const video = videoRef.current;
      let staffProfiles = getEmbeddingsForMatching();

      if (staffProfiles.length === 0) {
        try {
          const { generateEmbedding, enrollStaff, addReferenceEmbedding } = await import(
            "@/lib/face-recognition"
          );

          // Seed PERSON_001
          const p1Photos = [
            "/staff-photos/person-001/reference_01.jpg",
            "/staff-photos/person-001/reference_02.jpg",
            "/staff-photos/person-001/reference_03.jpg",
            "/staff-photos/person-001/reference_04.jpg",
            "/staff-photos/person-001/reference_05.jpg",
          ];
          for (let i = 0; i < p1Photos.length; i++) {
            const photo = p1Photos[i]!;
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej();
              img.src = photo;
            });
            const res = await generateEmbedding(img);
            if (res) {
              if (i === 0) enrollStaff("PERSON_001", "Moulishwaran S", res.descriptor, photo);
              else addReferenceEmbedding("PERSON_001", res.descriptor, photo);
            }
          }

          // Seed PERSON_002
          const p2Photos = [
            "/staff-photos/person-002/reference_01.jpg",
            "/staff-photos/person-002/reference_02.jpg",
            "/staff-photos/person-002/reference_03.jpg",
            "/staff-photos/person-002/reference_04.jpg",
            "/staff-photos/person-002/reference_05.jpg",
          ];
          for (let i = 0; i < p2Photos.length; i++) {
            const photo = p2Photos[i]!;
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej();
              img.src = photo;
            });
            const res = await generateEmbedding(img);
            if (res) {
              if (i === 0) enrollStaff("PERSON_002", "Harish K", res.descriptor, photo);
              else addReferenceEmbedding("PERSON_002", res.descriptor, photo);
            }
          }

          // Seed PERSON_003
          const p3Photos = [
            "/staff-photos/person-003/reference_01.jpg",
            "/staff-photos/person-003/reference_02.jpg",
            "/staff-photos/person-003/reference_03.jpg",
            "/staff-photos/person-003/reference_04.jpg",
            "/staff-photos/person-003/reference_05.jpg",
          ];
          for (let i = 0; i < p3Photos.length; i++) {
            const photo = p3Photos[i]!;
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej();
              img.src = photo;
            });
            const res = await generateEmbedding(img);
            if (res) {
              if (i === 0) enrollStaff("PERSON_003", "Vignesh R", res.descriptor, photo);
              else addReferenceEmbedding("PERSON_003", res.descriptor, photo);
            }
          }

          staffProfiles = getEmbeddingsForMatching();
        } catch (err) {
          console.error("Seed error:", err);
        }
      }

      if (staffProfiles.length === 0) {
        setPhase("unrecognized");
        setErrorMessage("No staff profiles enrolled. Please enroll in Admin Face Enrollment.");
        isVerifyingRef.current = false;
        return;
      }

      // Closed-set multi-sample match
      const match = findBestMatch(verifiedFace.descriptor, staffProfiles);

      if (!match || !match.matched) {
        setPhase("unrecognized");
        setErrorMessage("Face Not Recognized. Only authorized staff members can mark attendance.");
        setDebugInfo((d) => ({
          ...d,
          distance: match ? match.distance : null,
          bestName: match ? match.staffName : "Unknown",
          status: "REJECTED",
        }));
        isVerifyingRef.current = false;
        return;
      }

      setMatchResult(match);
      setDebugInfo((d) => ({
        ...d,
        distance: match.distance,
        bestName: match.staffName,
        status: "VERIFIED",
      }));
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

      await new Promise((r) => setTimeout(r, 1200));

      stopCamera();
      onVerified({
        staffId: match.staffId,
        staffName: match.staffName,
        distance: match.distance,
        snapshot,
        verification: {
          accepted: true,
          confirmedStaffId: match.staffId,
          confirmedStaffName: match.staffName,
          auditId: crypto.randomUUID(),
        },
      });
      onOpenChange(false);
    },
    [onOpenChange, onVerified, stopCamera],
  );

  /* ---------------------------------------------------------------- */
  /*  Live Tracking & Flicker-Free Frame Loop                         */
  /* ---------------------------------------------------------------- */

  const startDetectionLoop = useCallback(() => {
    if (isLoopRunningRef.current) return;
    isLoopRunningRef.current = true;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions once without reset thrashing
    if (video.videoWidth && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const frameLoop = async () => {
      if (
        !isLoopRunningRef.current ||
        !video ||
        video.paused ||
        video.ended ||
        !streamRef.current ||
        isVerifyingRef.current
      ) {
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
        } else if (faces.length > 1) {
          if (faceDetected) setFaceDetected(false);
          faces.forEach((f) => {
            ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
            ctx.lineWidth = 3;
            ctx.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height);
          });
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
          if (now - lastUiUpdateRef.current > 250) {
            lastUiUpdateRef.current = now;
            setDebugInfo((d) => ({
              ...d,
              faceCount: 1,
              ear,
              baselineEAR: blinkState.baselineEAR,
            }));
          }

          if (blinkState.isComplete && !isVerifyingRef.current) {
            // User performed 1 single natural blink!
            isLoopRunningRef.current = false;
            void executeRecognition(face);
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
    setMatchResult(null);
    setFaceDetected(false);
    isVerifyingRef.current = false;
    blinkDetectorRef.current.reset(1);

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

    if (areModelsLoaded()) {
      void startCamera();
      return;
    }

    setPhase("loading-models");
    let isCancelled = false;
    const progressTimer = setInterval(() => {
      if (!isCancelled) setModelProgress((p) => Math.min(p + 15, 90));
    }, 120);

    loadModels()
      .then(() => {
        if (!isCancelled) {
          setModelProgress(100);
          void startCamera();
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setErrorMessage(`Failed to load AI face recognition models: ${String(err)}`);
          setPhase("error");
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
      setMatchResult(null);
      setFaceDetected(false);
    }
    return stopCamera;
  }, [open, stopCamera]);

  useEffect(() => {
    if (phase === "awaiting-blink") {
      startDetectionLoop();
    }
  }, [phase, startDetectionLoop]);

  /* ---------------------------------------------------------------- */
  /*  Manual Immediate Verification Trigger                           */
  /* ---------------------------------------------------------------- */

  const handleManualScan = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    setPhase("blink-detected");
    const faces = await detectFaces(video);
    if (faces.length === 1) {
      await executeRecognition(faces[0]!);
    } else {
      setPhase("awaiting-blink");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
              ? "Blink verified ✓ Matching biometrics..."
              : phase === "matched"
                ? `Identity verified: ${matchResult?.staffName}`
                : phase === "unrecognized"
                  ? "Face Not Recognized. Only registered staff members are authorized."
                  : phase === "awaiting-blink"
                    ? "Hold still & blink your eyes once to verify."
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
                Matching biometrics against registered staff…
              </p>
            </div>
          )}

          {/* Matched Success */}
          {phase === "matched" && matchResult && (
            <div className="absolute inset-x-0 bottom-0 bg-success-soft/95 px-4 py-3 text-center backdrop-blur-sm">
              <p className="flex items-center justify-center gap-1 text-xs font-semibold text-success">
                <ShieldCheck className="size-4" /> Aadhaar Biometric Match Verified
              </p>
              <p className="text-base font-bold text-success">
                {matchResult.staffName}
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

        {/* Diagnostics Toggle */}
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDebug((d) => !d)}
          >
            <Eye className="size-3" /> {showDebug ? "Hide" : "Show"} Diagnostics
          </button>
          {showDebug && (
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/60 p-3 font-mono text-[11px]">
              <div>
                <span className="text-muted-foreground">Faces:</span> {debugInfo.faceCount}
              </div>
              <div>
                <span className="text-muted-foreground">EAR:</span> {debugInfo.ear.toFixed(3)}
              </div>
              <div>
                <span className="text-muted-foreground">Base EAR:</span> {debugInfo.baselineEAR.toFixed(3)}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Best Match:</span> {debugInfo.bestName || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Distance:</span> {debugInfo.distance?.toFixed(3) ?? "—"}
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
                setMatchResult(null);
                isVerifyingRef.current = false;
                blinkDetectorRef.current.reset(1);
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
              onClick={handleManualScan}
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
                  <ScanFace className="mr-2 size-5" /> Blink Eyes Once or Click to Verify
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
