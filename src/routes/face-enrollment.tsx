import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  loadModels,
  areModelsLoaded,
  initArcFaceSession,
  isArcFaceLoaded,
  generateArcFaceEmbedding,
  detectFaces,
  FACE_CONFIG,
} from "@/lib/face-recognition";
import {
  getStaffFaceStatus,
  submitStaffFaceEnrollment,
  requestStaffFaceChange,
  cancelStaffFaceChange,
  type StaffFaceStatusResponse,
} from "@/lib/staff-face";
import { useActiveStaff } from "@/lib/staff-auth";

export const Route = createFileRoute("/face-enrollment")({
  head: () => ({
    meta: [
      { title: "Face Registration & Biometrics — CampusAttend" },
      {
        name: "description",
        content:
          "Register and manage your institutional facial recognition profile for instant location-verified attendance.",
      },
      { property: "og:title", content: "Face Registration — CampusAttend" },
      {
        property: "og:description",
        content: "Register, lock and manage staff face biometric authentication.",
      },
    ],
  }),
  component: StaffFaceEnrollmentPage,
});

interface LocalSample {
  id: string;
  url: string;
  filename: string;
  status: "pending" | "processing" | "valid" | "rejected";
  message?: string;
  embedding?: number[];
  photoData?: string;
}

function StaffFaceEnrollmentPage() {
  const navigate = useNavigate();
  const activeStaff = useActiveStaff();

  // Biometric status from server
  const [faceStatus, setFaceStatus] = useState<StaffFaceStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Models state
  const [modelsReady, setModelsReady] = useState(areModelsLoaded() && isArcFaceLoaded());
  const [modelProgress, setModelProgress] = useState(0);

  // Enrollment samples draft
  const [samples, setSamples] = useState<LocalSample[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Camera capture state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Change request modal state
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Load ArcFace neural network models
  useEffect(() => {
    if (areModelsLoaded() && isArcFaceLoaded()) {
      setModelsReady(true);
      return;
    }

    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) setModelProgress((p) => Math.min(p + 15, 90));
    }, 150);

    Promise.all([loadModels(), initArcFaceSession()])
      .then(() => {
        if (!cancelled) {
          setModelProgress(100);
          setModelsReady(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error("Failed to load face recognition neural network", { description: String(err) });
        }
      })
      .finally(() => clearInterval(interval));

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fetch face status from server
  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const data = await getStaffFaceStatus();
      setFaceStatus(data);
    } catch {
      toast.error("Failed to fetch face enrollment status.");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Camera stream controls
  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(console.error);
      }
    } catch (err) {
      toast.error("Camera access failed", { description: String(err) });
      setCameraActive(false);
    }
  };

  useEffect(() => {
    if (cameraActive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [cameraActive]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // Process a photo with face detection and ArcFace 512-D embedding
  const processImage = async (
    dataUrl: string,
    filename: string,
  ): Promise<{ valid: boolean; embedding?: number[]; message?: string }> => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = dataUrl;
      });

      // 1. Detect faces & landmarks
      const faces = await detectFaces(img);

      if (faces.length === 0) {
        return { valid: false, message: "No face detected in photo. Ensure clear frontal lighting." };
      }
      if (faces.length > 1) {
        return { valid: false, message: `Multiple faces (${faces.length}) detected. Must show only you.` };
      }

      const singleFace = faces[0]!;
      if (singleFace.confidence < FACE_CONFIG.MIN_FACE_CONFIDENCE) {
        return { valid: false, message: "Face detection confidence too low. Avoid extreme angles." };
      }

      // 2. Compute 512-D ArcFace descriptor
      const embedding = await generateArcFaceEmbedding(
        img,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        singleFace.landmarks,
      );

      const embArray = Array.from(embedding);
      return { valid: true, embedding: embArray, message: "Face detected & 512-D ArcFace vector computed" };
    } catch (err: any) {
      return { valid: false, message: err?.message || "Error processing image" };
    }
  };

  // Capture photo from camera
  const captureCameraPhoto = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error("Camera stream not ready yet.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    const tempId = `snap-${Date.now()}`;
    const filename = `camera_snap_${samples.length + 1}.jpg`;

    const newSample: LocalSample = {
      id: tempId,
      url: dataUrl,
      filename,
      status: "processing",
      photoData: dataUrl,
    };

    setSamples((prev) => [...prev, newSample]);
    setIsProcessing(true);

    const result = await processImage(dataUrl, filename);
    setSamples((prev) =>
      prev.map((s) =>
        s.id === tempId
          ? {
              ...s,
              status: result.valid ? "valid" : "rejected",
              embedding: result.embedding,
              message: result.message,
            }
          : s,
      ),
    );
    setIsProcessing(false);

    if (result.valid) {
      toast.success("Photo captured and face verified!");
    } else {
      toast.error(result.message || "Face check failed for snapshot.");
    }
  };

  // Upload photos via file input
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const url = URL.createObjectURL(file);
      const tempId = `file-${Date.now()}-${i}`;

      const newSample: LocalSample = {
        id: tempId,
        url,
        filename: file.name,
        status: "processing",
        photoData: url,
      };

      setSamples((prev) => [...prev, newSample]);

      const result = await processImage(url, file.name);
      setSamples((prev) =>
        prev.map((s) =>
          s.id === tempId
            ? {
                ...s,
                status: result.valid ? "valid" : "rejected",
                embedding: result.embedding,
                message: result.message,
              }
            : s,
        ),
      );
    }
    setIsProcessing(false);
  };

  const removeSample = (id: string) => {
    setSamples((prev) => prev.filter((s) => s.id !== id));
  };

  // Save Face Registration (Initial OR One-Time Replacement)
  const handleSaveRegistration = async () => {
    const validSamples = samples.filter((s) => s.status === "valid" && s.embedding);
    if (validSamples.length === 0) {
      toast.error("Please add at least 1 valid reference photo with a verified face.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = validSamples.map((s) => ({
        embedding: s.embedding!,
        referenceImagePath: s.filename,
        photoData: s.photoData || s.url,
      }));

      const res = await submitStaffFaceEnrollment(payload, faceStatus?.oneTimeToken);
      if (res.success) {
        toast.success(res.message || "Face registration successfully saved and locked!");
        setSamples([]);
        stopCamera();
        await fetchStatus();
      } else {
        toast.error(res.error || "Failed to save face registration.");
      }
    } catch (err: any) {
      toast.error(err?.message || "An error occurred while saving face registration.");
    } finally {
      setIsSaving(false);
    }
  };

  // Submit request to change face
  const handleSubmitChangeRequest = async () => {
    if (!requestReason.trim() || requestReason.trim().length < 5) {
      toast.error("Please provide a detailed reason (at least 5 characters).");
      return;
    }

    setIsSubmittingRequest(true);
    try {
      const res = await requestStaffFaceChange(requestReason.trim());
      if (res.success) {
        toast.success("Face change request submitted to administrator!");
        setRequestModalOpen(false);
        setRequestReason("");
        await fetchStatus();
      } else {
        toast.error(res.error || "Failed to submit request.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error submitting face change request.");
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Cancel pending request
  const handleCancelRequest = async () => {
    try {
      const res = await cancelStaffFaceChange();
      if (res.success) {
        toast.success("Face change request cancelled.");
        await fetchStatus();
      } else {
        toast.error(res.error || "Failed to cancel request.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error cancelling request.");
    }
  };

  const isLocked = faceStatus?.isLocked === true;
  const canEdit = faceStatus?.canEdit === true;
  const status = faceStatus?.status || "not_registered";
  const validCount = samples.filter((s) => s.status === "valid").length;

  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title="Face Authentication & Biometrics"
        description="Register, lock and manage your institutional facial recognition profile for geofenced attendance."
        action={
          <Button variant="outline" size="sm" onClick={() => void fetchStatus()} disabled={loadingStatus}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loadingStatus ? "animate-spin" : ""}`} />
            Refresh Status
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Status Alert Banner */}
        {loadingStatus ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Checking biometric enrollment lock status…</p>
          </div>
        ) : status === "approved" && isLocked && !canEdit ? (
          /* Profile is Locked and Approved */
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-6" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Face Registration Locked & Active</h3>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                      <Lock className="mr-1 size-3" /> Locked
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your face registration is locked. Request administrator approval to change it.
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {faceStatus?.embeddingCount || 0} reference biometric samples verified for{" "}
                    <strong>{activeStaff.name}</strong> ({activeStaff.staffId}).
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                className="shrink-0 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                onClick={() => setRequestModalOpen(true)}
              >
                Request Face Change
              </Button>
            </div>
          </div>
        ) : status === "pending_approval" ? (
          /* Change Request Pending Approval */
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <Clock className="size-6" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Face Change Request Pending Approval</h3>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                      Pending Administrator Review
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your request to update your face registration has been submitted. Existing approved templates remain
                    active for attendance until a decision is made.
                  </p>
                  {faceStatus?.pendingRequest?.reason && (
                    <p className="mt-2 rounded-lg bg-background/50 px-3 py-1.5 text-xs text-muted-foreground">
                      <strong>Reason:</strong> {faceStatus.pendingRequest.reason}
                    </p>
                  )}
                </div>
              </div>

              <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={handleCancelRequest}>
                Withdraw Request
              </Button>
            </div>
          </div>
        ) : canEdit && faceStatus?.oneTimeToken ? (
          /* Approved for One-Time Replacement */
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/20 text-primary">
                <KeyRound className="size-6" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">Administrator Approved — Single-Use Update Authorized</h3>
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    One-Time Token Active
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The administrator approved your face change request. Capture or upload your replacement photos below and click{" "}
                  <strong>Save Face Registration</strong>. Once saved, your profile will immediately re-lock.
                </p>
              </div>
            </div>
          </div>
        ) : status === "rejected" ? (
          /* Change Request Rejected */
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-destructive/20 text-destructive">
                  <XCircle className="size-6" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Face Change Request Rejected</h3>
                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                      Decision: Rejected
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your previous request to change your face profile was not approved. Your existing registered face remains
                    active for attendance.
                  </p>
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={() => setRequestModalOpen(true)}>
                Submit New Request
              </Button>
            </div>
          </div>
        ) : (
          /* Initial Registration (Not Registered) */
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-accent-foreground">
                <ScanFace className="size-6" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">Initial Face Registration</h3>
                  <Badge variant="secondary">Not Registered Yet</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Register your face using clear frontal lighting to enable instant biometric attendance verification. Once
                  saved, your face registration will be permanently locked for security.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Neural Network Status Badge */}
        {!modelsReady && (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/50 p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Loading ArcFace 512-D neural network weights ({modelProgress}%)…</span>
            </div>
          </div>
        )}

        {/* Enrollment Controls (Enabled only if canEdit is true) */}
        {canEdit ? (
          <div className="space-y-6">
            <Section
              title="Add Reference Face Photos"
              description="Capture 1 to 3 clear, well-lit photos using your camera or upload image files."
            >
              <div className="p-6 space-y-6">
                <div className="flex flex-wrap gap-3">
                  {!cameraActive ? (
                    <Button onClick={startCamera} disabled={!modelsReady}>
                      <Camera className="mr-2 size-4" />
                      Open Live Camera
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={stopCamera}>
                      Close Camera
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!modelsReady || isProcessing}
                  >
                    <UploadCloud className="mr-2 size-4" />
                    Upload Photo Files
                  </Button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFilesSelected}
                  />
                </div>

                {/* Live Camera Viewfinder */}
                {cameraActive && (
                  <div className="relative mx-auto flex max-w-md flex-col items-center overflow-hidden rounded-2xl border border-border bg-black p-2">
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="size-full object-cover -scale-x-100"
                      />
                      {/* Face Positioning Guide */}
                      <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <div className="size-56 rounded-full border-2 border-dashed border-primary/70 bg-primary/5" />
                      </div>
                    </div>

                    <div className="mt-3 flex w-full items-center justify-between px-2">
                      <p className="text-xs text-zinc-400">Position face within the oval</p>
                      <Button size="sm" onClick={captureCameraPhoto} disabled={isProcessing}>
                        {isProcessing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Camera className="mr-1.5 size-3.5" />}
                        Snap Photo
                      </Button>
                    </div>
                  </div>
                )}

                {/* Previews of Draft Samples */}
                {samples.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Selected Photos ({samples.length}) · Valid for Save: {validCount}
                      </h4>
                      {validCount > 0 && (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          Ready to enroll
                        </span>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {samples.map((s) => (
                        <div
                          key={s.id}
                          className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm"
                        >
                          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
                            <img src={s.url} alt={s.filename} className="size-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeSample(s.id)}
                              className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-destructive transition-colors"
                              title="Remove photo"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>

                          <div className="mt-2.5 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">{s.filename}</p>
                            <div className="mt-1 flex items-center gap-1.5">
                              {s.status === "processing" ? (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Loader2 className="size-3 animate-spin" /> Checking face…
                                </span>
                              ) : s.status === "valid" ? (
                                <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="size-3" /> Verified (512-D)
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-[11px] text-destructive">
                                  <XCircle className="size-3" /> {s.message || "Rejected"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Save Face Registration Action Button */}
                <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    <p>
                      Saving will link this biometric profile to <strong>{activeStaff.staffId}</strong>.
                    </p>
                    <p className="text-[11px] text-muted-foreground/80">
                      The profile will be <strong>permanently locked</strong> immediately upon saving.
                    </p>
                  </div>

                  <Button
                    size="lg"
                    disabled={validCount === 0 || isSaving || isProcessing}
                    onClick={handleSaveRegistration}
                    className="w-full sm:w-auto"
                  >
                    {isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {isSaving ? "Saving & Locking Face…" : "Save Face Registration"}
                  </Button>
                </div>
              </div>
            </Section>
          </div>
        ) : (
          /* Profile is Locked — Show Locked Reference Gallery */
          <Section
            title="Enrolled Face Profile"
            description="Active reference photos verified for automated attendance matching."
          >
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <Lock className="mx-auto size-8 text-muted-foreground/60" />
                <h4 className="mt-2 text-sm font-semibold text-foreground">Biometric Editing Disabled</h4>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Your facial templates are securely encrypted and locked in the institutional biometric store.
                  To update your photos, click below to request administrator approval.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                  onClick={() => setRequestModalOpen(true)}
                  disabled={status === "pending_approval"}
                >
                  {status === "pending_approval" ? "Request Already Pending" : "Request Face Change"}
                </Button>
              </div>

              {faceStatus?.samples && faceStatus.samples.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Enrolled Reference Samples ({faceStatus.samples.length})
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {faceStatus.samples.map((sample, idx) => (
                      <div key={sample.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-accent-foreground font-mono text-xs">
                            #{idx + 1}
                          </span>
                          <div className="overflow-hidden">
                            <p className="truncate text-xs font-medium">{sample.reference_image_path}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(sample.created_at).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}
      </div>

      {/* Request Face Change Modal Dialog */}
      <Dialog open={requestModalOpen} onOpenChange={setRequestModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="size-5 text-primary" />
              Request Face Registration Change
            </DialogTitle>
            <DialogDescription>
              To maintain campus security, face biometric profiles are permanently locked. Please explain why you need
              to re-register your face.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label htmlFor="reason" className="text-xs font-medium text-foreground">
                Reason for Change Request <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="reason"
                placeholder="e.g. Appearance changed, new spectacles, or camera quality upgrade."
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                This request will be reviewed by college administration. If approved, you will receive single-use permission
                to save a new face registration.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRequestModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitChangeRequest} disabled={isSubmittingRequest || !requestReason.trim()}>
              {isSubmittingRequest && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isSubmittingRequest ? "Submitting…" : "Submit Request to Administrator"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
