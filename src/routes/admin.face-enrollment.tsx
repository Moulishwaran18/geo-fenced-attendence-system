import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { AlertBanner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  fetchAllStaff,
  enrollStaffFace,
  deleteStaffEmbedding,
  verifyLiveFace,
  type StaffProfile,
} from "@/lib/face-recognition/staff-store";

export const Route = createFileRoute("/admin/face-enrollment")({
  head: () => ({
    meta: [
      { title: "Face Enrollment & Biometric Database — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Admin-controlled face enrollment and vector database management for authorized staff members.",
      },
      { property: "og:title", content: "Face Enrollment — CampusAttend Admin" },
      {
        property: "og:description",
        content: "Enroll staff face embeddings into scalable PostgreSQL biometric database.",
      },
    ],
  }),
  component: AdminFaceEnrollmentPage,
});

interface BatchItem {
  id: string;
  name: string;
  url: string;
  status: "pending" | "processing" | "valid" | "rejected";
  message?: string;
  confidence?: number;
}

function AdminFaceEnrollmentPage() {
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [modelProgress, setModelProgress] = useState(0);
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("PERSON_001");
  const [loadingStaff, setLoadingStaff] = useState(true);

  // Enrollment batch state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Camera snap state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live test bench state
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    name?: string | undefined;
    staffCode?: string | undefined;
    distance?: number | undefined;
    margin?: number | null | undefined;
    reason?: string | undefined;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // 1. Load Face-API neural network models
  useEffect(() => {
    if (areModelsLoaded() && isArcFaceLoaded()) {
      setModelsReady(true);
      return;
    }

    let cancelled = false;
    const progressInterval = setInterval(() => {
      if (!cancelled) setModelProgress((p) => Math.min(p + 10, 90));
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
          toast.error("Failed to load face recognition models", {
            description: String(err),
          });
        }
      })
      .finally(() => clearInterval(progressInterval));

    return () => {
      cancelled = true;
      clearInterval(progressInterval);
    };
  }, [modelsReady]);

  // 2. Fetch staff list from backend
  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    try {
      const data = await fetchAllStaff();
      setStaffList(data);
      if (data.length > 0) {
        setSelectedStaffId((prev) => (data.some((d) => d.id === prev) ? prev : data[0]!.id));
      }
    } catch {
      toast.error("Failed to load staff list from database");
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  // 3. Camera lifecycle for photo snap
  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      toast.error("Camera access failed", { description: String(err) });
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !selectedStaff) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

    stopCamera();

    // Process immediately
    await processSinglePhoto(dataUrl, `webcam_snap_${Date.now()}.jpg`, selectedStaff.id);
  };

  // 4. Single Photo Processing Pipeline
  const processSinglePhoto = async (
    url: string,
    filename: string,
    targetStaffId: string,
  ): Promise<boolean> => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image element"));
        img.src = url;
      });

      // 1. Detect faces
      const faces = await detectFaces(img);

      // 2. Validate single face
      if (faces.length === 0) {
        toast.error(`Rejected: No face detected in ${filename}`);
        return false;
      }
      if (faces.length > 1) {
        toast.error(`Rejected: Multiple faces (${faces.length}) detected in ${filename}`);
        return false;
      }

      const singleFace = faces[0]!;
      if (singleFace.confidence < FACE_CONFIG.MIN_FACE_CONFIDENCE) {
        toast.error(`Rejected: Quality too low in ${filename}`);
        return false;
      }

      // 3. Generate 512-dimensional ArcFace embedding
      const arcFaceDescriptor = await generateArcFaceEmbedding(
        img,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        singleFace.landmarks,
      );

      // 4. Store embedding in backend PostgreSQL database
      const success = await enrollStaffFace(targetStaffId, arcFaceDescriptor, url);
      if (success) {
        toast.success(`✓ 512-d ArcFace embedding saved for ${targetStaffId}`);
        void loadStaff();
        return true;
      } else {
        toast.error(`Backend failed to save embedding for ${targetStaffId}`);
        return false;
      }
    } catch (err) {
      toast.error(`Error processing ${filename}: ${String(err)}`);
      return false;
    }
  };

  // 5. Multi-photo file selection & batch enrollment
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedStaff) return;

    const newItems: BatchItem[] = Array.from(files).map((f) => ({
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: f.name,
      url: URL.createObjectURL(f),
      status: "pending",
    }));

    setBatchItems(newItems);
    setIsProcessingBatch(true);

    let successCount = 0;
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i]!;
      setBatchItems((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "processing" } : it)),
      );

      const passed = await processSinglePhoto(item.url, item.name, selectedStaff.id);
      if (passed) successCount++;

      setBatchItems((prev) =>
        prev.map((it, idx) =>
          idx === i
            ? {
                ...it,
                status: passed ? "valid" : "rejected",
                message: passed
                  ? "✓ Face detected & 128-d embedding stored"
                  : "❌ Rejected (face count / quality check failed)",
              }
            : it,
        ),
      );
    }

    setIsProcessingBatch(false);
    toast.success(`Processed ${newItems.length} photos: ${successCount} embeddings enrolled.`);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void loadStaff();
  };

  // 6. Delete reference embedding
  const handleDeleteEmbedding = async (embeddingId: string) => {
    if (!selectedStaff) return;
    const success = await deleteStaffEmbedding(selectedStaff.id, embeddingId);
    if (success) {
      toast.success("Reference photo deleted from database");
      void loadStaff();
    } else {
      toast.error("Failed to delete reference photo");
    }
  };

  // 7. Live Test Bench (Test any photo or live face against vector search)
  const handleTestPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.src = url;
      });

      const faces = await detectFaces(img);
      if (faces.length !== 1) {
        setTestResult({
          matched: false,
          reason:
            faces.length === 0
              ? "No face detected in test photo"
              : `Multiple faces (${faces.length}) in test photo`,
        });
        setIsTesting(false);
        return;
      }

      // Generate 512-dimensional ArcFace embedding
      const arcFaceDescriptor = await generateArcFaceEmbedding(
        img,
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        faces[0]!.landmarks,
      );

      // Call backend vector search
      const result = await verifyLiveFace(arcFaceDescriptor, true);
      setTestResult({
        matched: result.matched,
        name: result.staff?.name,
        staffCode: result.staff?.staffCode,
        distance: result.distance,
        margin: result.matchMargin,
        reason: result.reason,
      });
    } catch (err) {
      setTestResult({ matched: false, reason: `Test error: ${String(err)}` });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Scalable Face Database & Enrollment"
        description="Admin-only biometric enrollment console supporting 100+ staff with 128-dimensional vector search"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              PostgreSQL + pgvector (128-d)
            </Badge>
          </div>
        }
      />

      {!modelsReady && (
        <Section title="Loading face recognition neural network">
          <div className="space-y-3 p-6">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              Downloading face-api.js models ({modelProgress}%)
            </div>
            <Progress value={modelProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              ResNet-34 & SSD MobileNet neural network weights are cached.
            </p>
          </div>
        </Section>
      )}

      <AlertBanner
        tone="info"
        icon={ScanFace}
        title="Scalable Multi-Embedding Biometric Architecture"
        description="Every staff member stores multiple 128-dimensional face embeddings across diverse angles, lighting, and expressions. The database scales to 100+, 500+, 1000+ staff without schema changes. Unknown faces are strictly rejected."
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left Column: Staff Selector & Details */}
        <div className="space-y-6 lg:col-span-1">
          <Section title="Select Staff Member" description="Choose identity to enroll or inspect">
            <div className="space-y-4 p-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase">
                  Staff Member
                </label>
                <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select staff..." />
                  </SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.staffId} — {s.name} ({s.embeddingCount} samples)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedStaff && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{selectedStaff.name}</h3>
                      <p className="font-mono text-xs text-primary font-bold">
                        {selectedStaff.staffId}
                      </p>
                    </div>
                    <Badge
                      className={
                        selectedStaff.embeddingCount > 0
                          ? "bg-success text-white"
                          : "bg-warning/20 text-warning"
                      }
                    >
                      {selectedStaff.embeddingCount > 0
                        ? `Enrolled (${selectedStaff.embeddingCount})`
                        : "Pending"}
                    </Badge>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs border-t border-border pt-3">
                    <div>
                      <dt className="text-muted-foreground">Department</dt>
                      <dd className="font-medium text-foreground truncate">
                        {selectedStaff.department || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Designation</dt>
                      <dd className="font-medium text-foreground truncate">
                        {selectedStaff.designation || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Embeddings</dt>
                      <dd className="font-mono font-bold text-foreground">
                        {selectedStaff.embeddingCount} stored
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="font-medium text-foreground">
                        {selectedStaff.active ? "Active" : "Inactive"}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Staff Switcher Quick Pills */}
              <div>
                <label className="mb-2 block text-xs font-semibold text-muted-foreground uppercase">
                  Quick Switch:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {staffList.slice(0, 6).map((s) => (
                    <Button
                      key={s.id}
                      variant={selectedStaffId === s.id ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setSelectedStaffId(s.id)}
                    >
                      {s.staffId}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Biometric Diagnostic & Live Vector Search Tester */}
          <Section
            title="Biometric Vector Search Tester"
            description="Test live face vector matching against the database"
          >
            <div className="space-y-4 p-5">
              <p className="text-xs text-muted-foreground">
                Upload any face photo to execute real-time vector similarity search against all enrolled staff embeddings in PostgreSQL.
              </p>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  id="test-upload"
                  className="hidden"
                  onChange={handleTestPhotoUpload}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={!modelsReady || isTesting}
                  onClick={() => document.getElementById("test-upload")?.click()}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Searching Database…
                    </>
                  ) : (
                    <>
                      <ScanFace className="mr-2 size-4 text-primary" /> Test Photo Match
                    </>
                  )}
                </Button>
              </div>

              {testResult && (
                <div
                  className={`rounded-xl border p-4 text-xs ${
                    testResult.matched
                      ? "border-success/30 bg-success-soft text-success"
                      : "border-destructive/30 bg-danger-soft text-destructive"
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    {testResult.matched ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <XCircle className="size-4" />
                    )}
                    {testResult.matched
                      ? `MATCHED: ${testResult.name} (${testResult.staffCode})`
                      : "REJECTED: Face Not Recognized"}
                  </div>

                  <dl className="mt-2 space-y-1 font-mono text-[11px]">
                    {testResult.distance !== undefined && (
                      <div className="flex justify-between">
                        <span>Euclidean Distance:</span>
                        <span className="font-bold">{testResult.distance.toFixed(4)}</span>
                      </div>
                    )}
                    {testResult.margin != null && (
                      <div className="flex justify-between">
                        <span>Match Margin:</span>
                        <span className="font-bold">{testResult.margin.toFixed(4)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Threshold:</span>
                      <span>{FACE_CONFIG.MATCH_THRESHOLD}</span>
                    </div>
                    {testResult.reason && (
                      <div className="mt-1 text-[10px] text-destructive/90 font-sans">
                        {testResult.reason}
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right Column: Enrollment Workstation & Gallery */}
        <div className="space-y-6 lg:col-span-2">
          {/* Enrollment Actions */}
          <Section
            title={`Enroll Reference Photos for ${selectedStaff?.name || selectedStaffId}`}
            description="Upload single or multiple reference photos, or capture live camera snapshots (no special folder structure needed)"
          >
            <div className="space-y-5 p-5">
              {/* Controls */}
              <div className="flex flex-wrap gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={handleFilesSelected}
                />
                <Button
                  disabled={!modelsReady || isProcessingBatch || cameraActive}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud className="mr-2 size-4" />
                  Select / Upload Photos
                </Button>

                {!cameraActive ? (
                  <Button
                    variant="outline"
                    disabled={!modelsReady || isProcessingBatch}
                    onClick={() => void startCamera()}
                  >
                    <Camera className="mr-2 size-4" />
                    Snap Camera Photo
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="default" onClick={() => void capturePhoto()}>
                      Capture Snapshot
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* Camera Preview */}
              {cameraActive && (
                <div className="relative aspect-video max-w-md overflow-hidden rounded-xl border border-border bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover scale-x-[-1]" />
                </div>
              )}

              {/* Batch Processing Indicator */}
              {isProcessingBatch && (
                <div className="flex items-center gap-2 rounded-lg bg-primary-soft p-3 text-xs font-medium text-primary">
                  <Loader2 className="size-4 animate-spin" />
                  Processing reference photos: single-face validation & 128-d descriptor extraction…
                </div>
              )}

              {/* Batch Results Feedback */}
              {batchItems.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                    Upload Batch Status ({batchItems.length} photos)
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {batchItems.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-3 rounded-lg border p-2 text-xs ${
                          item.status === "valid"
                            ? "border-success/30 bg-success-soft text-success"
                            : item.status === "rejected"
                              ? "border-destructive/30 bg-danger-soft text-destructive"
                              : "border-border bg-muted"
                        }`}
                      >
                        <img
                          src={item.url}
                          alt={item.name}
                          className="size-10 rounded-md object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.message || item.status}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reference Samples Gallery */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                    Stored Reference Gallery ({selectedStaff?.referenceSamples.length || 0} samples)
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void loadStaff()}
                  >
                    <RefreshCw className="mr-1 size-3" /> Refresh
                  </Button>
                </div>

                {!selectedStaff?.referenceSamples || selectedStaff.referenceSamples.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                    <ImageIcon className="mb-2 size-8 text-muted-foreground/50" />
                    <p className="font-medium text-foreground">No reference photos enrolled yet</p>
                    <p className="mt-1">
                      Upload photos or snap via camera to store 128-d face embeddings for {selectedStaff?.name}.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {selectedStaff.referenceSamples.map((sample, idx) => (
                      <div
                        key={sample.id || idx}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted shadow-xs"
                      >
                        <img
                          src={sample.photoUrl}
                          alt={`Reference ${idx + 1} for ${selectedStaff.staffId}`}
                          className="size-full object-cover transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2 text-center text-[10px] font-medium text-white flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="size-3 text-success" />
                            #{idx + 1}
                          </span>
                          <button
                            type="button"
                            className="text-white/80 hover:text-destructive transition-colors p-1"
                            title="Delete this sample"
                            onClick={() => void handleDeleteEmbedding(sample.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
