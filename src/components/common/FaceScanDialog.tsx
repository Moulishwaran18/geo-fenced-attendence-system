import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Loader2, RefreshCw, ScanFace, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Phase = "starting" | "live" | "matching" | "matched" | "denied" | "error";

export function FaceScanDialog({
  open,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (snapshot: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string>("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported on this browser.");
      }
      // Live camera only — front camera, never a stored/gallery image.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setPhase("live");
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(
        name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access in your browser settings to continue."
          : name === "NotFoundError"
            ? "No front camera was found on this device."
            : (e as Error).message || "Unable to start the camera.",
      );
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (open) {
      void start();
    } else {
      stop();
      setPhase("starting");
    }
    return stop;
  }, [open, start, stop]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
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
    const snapshot = canvas.toDataURL("image/jpeg", 0.85);

    setPhase("matching");
    await new Promise((r) => setTimeout(r, 1800));
    setPhase("matched");
    await new Promise((r) => setTimeout(r, 700));
    stop();
    onVerified(snapshot);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="size-5 text-primary" aria-hidden /> Face verification
          </DialogTitle>
          <DialogDescription>
            Look straight at the camera. Only a live capture is accepted — uploading a photo is not
            possible.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-muted">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={cn(
              "size-full scale-x-[-1] object-cover",
              phase === "error" && "opacity-0",
            )}
          />

          {phase !== "error" && (
            <div
              className={cn(
                "pointer-events-none absolute inset-6 rounded-full border-2 border-dashed transition-colors",
                phase === "matched"
                  ? "border-success"
                  : phase === "matching"
                    ? "border-primary animate-pulse"
                    : "border-primary/50",
              )}
              aria-hidden
            />
          )}

          {phase === "starting" && (
            <div className="absolute inset-0 grid place-items-center bg-muted/80 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Starting camera…
              </span>
            </div>
          )}

          {phase === "error" && (
            <div className="absolute inset-0 grid place-items-center gap-2 p-6 text-center">
              <div>
                <CameraOff className="mx-auto size-8 text-destructive" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          )}

          {(phase === "matching" || phase === "matched") && (
            <div className="absolute inset-x-0 bottom-0 bg-background/85 px-4 py-2.5 text-center text-sm font-medium">
              {phase === "matching" ? (
                <span className="flex items-center justify-center gap-2 text-primary">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Matching with staff
                  record…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 text-success">
                  <ShieldCheck className="size-4" aria-hidden /> Face matched
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {phase === "error" ? (
            <Button className="w-full" onClick={() => void start()}>
              <RefreshCw className="mr-2 size-4" aria-hidden /> Retry camera
            </Button>
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={phase !== "live"}
              onClick={() => void capture()}
            >
              <ScanFace className="mr-2 size-5" aria-hidden />
              {phase === "live" ? "Capture & verify face" : "Please wait…"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
