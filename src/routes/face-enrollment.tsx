import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  UploadCloud,
  XCircle,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  isNativeBiometricAvailable,
  getNativeEnrollmentStatus,
  getNativeDeviceId,
  enrollNativeTemplatesBatch,
  verifyNativePersistence,
  stageNativePendingEnrollment,
  stageNativeReplacement,
  commitNativeReplacement,
  getNativePendingEnrollmentStatus,
  activateNativePendingEnrollment,
  clearNativePendingEnrollment,
  type NativeEnrollmentStatus,
} from "@/lib/native-biometric-bridge";
import {
  getStaffFaceStatus,
  requestStaffFaceEnrollment,
  requestStaffFaceChange,
  requestStaffFacePermission,
  requestStaffFaceImageApproval,
  computeCanonicalTemplateDigest,
  cancelStaffFaceChange,
  submitStaffFaceEnrollment,
  type StaffFaceStatusResponse,
} from "@/lib/staff-face";
import { useActiveStaff } from "@/lib/staff-auth";

export const Route = createFileRoute("/face-enrollment")({
  head: () => ({
    meta: [
      { title: "Staff Face Enrollment — CampusAttend" },
      {
        name: "description",
        content:
          "Register and manage your institutional facial recognition profile locally on your Android device.",
      },
      { property: "og:title", content: "Staff Face Enrollment — CampusAttend" },
      {
        property: "og:description",
        content: "Hardware-isolated, on-device face biometric enrollment for CampusAttend staff.",
      },
    ],
  }),
  component: StaffFaceEnrollmentPage,
});

export interface EnrollmentSample {
  id: string;
  source: "camera" | "upload";
  filename: string;
  previewUrl: string;
  status: "validating" | "valid" | "rejected";
  message?: string | undefined;
  embedding?: number[] | undefined;
  faceConfidence?: number | undefined;
}

const MAX_SAMPLES = 5;
const MIN_SAMPLES = 1;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

function StaffFaceEnrollmentPage() {
  const activeStaff = useActiveStaff();

  // Native hardware status
  const isNative = isNativeBiometricAvailable();
  const [nativeStatus, setNativeStatus] = useState<NativeEnrollmentStatus | null>(null);
  const [loadingNative, setLoadingNative] = useState(true);
  const [nativeDeviceId, setNativeDeviceId] = useState<string | null>(null);

  // Server metadata status (approval tokens and change request review state only, NEVER biometrics)
  const [serverStatus, setServerStatus] = useState<StaffFaceStatusResponse | null>(null);

  // Neural network models state
  const [modelsReady, setModelsReady] = useState(areModelsLoaded() && isArcFaceLoaded());
  const [modelsLoading, setModelsLoading] = useState(!areModelsLoaded() || !isArcFaceLoaded());
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState(areModelsLoaded() && isArcFaceLoaded() ? 100 : 0);
  const isModelsReady = modelsReady || (areModelsLoaded() && isArcFaceLoaded());

  // Enrollment samples state (1 to 5 samples)
  const [samples, setSamples] = useState<EnrollmentSample[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReplacementMode, setIsReplacementMode] = useState(false);

  const [isActivating, setIsActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const activationInProgressRef = useRef(false);

  if (!activeStaff) {
    return (
      <AppShell nav={staffNav} role="staff">
        <PageHeader
          title="Face Biometric Enrollment"
          description="Hardware-bound biometric facial verification."
        />
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">You must be signed in with a registered staff account to manage biometric enrollment.</p>
          <Button className="mt-4" asChild>
            <Link to="/">Sign In with Staff ID</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const staffId = activeStaff.staffId;
  const hasActivatedTokenRef = useRef<string | null>(null);

  // File input ref for "Upload Photo Files"
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Change request modal state
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSubmitError, setRequestSubmitError] = useState<string | null>(null);

  // Reusable on-device model loader with full error capture and progress reporting
  const loadNeuralModels = useCallback(async (): Promise<boolean> => {
    if (areModelsLoaded() && isArcFaceLoaded()) {
      setModelsReady(true);
      setModelsLoading(false);
      setModelsError(null);
      setModelProgress(100);
      return true;
    }

    setModelsLoading(true);
    setModelsError(null);
    try {
      await Promise.all([loadModels(), initArcFaceSession()]);
      setModelsReady(true);
      setModelsLoading(false);
      setModelsError(null);
      setModelProgress(100);
      return true;
    } catch (err: any) {
      console.warn("[FaceEnrollment] Failed to load on-device neural network models:", err);
      const msg = err?.message || String(err);
      setModelsError(msg);
      setModelsLoading(false);
      if (areModelsLoaded() && isArcFaceLoaded()) {
        setModelsReady(true);
        return true;
      }
      return false;
    }
  }, []);

  // Load ArcFace ONNX model and landmark detector in background without blocking UI
  useEffect(() => {
    let mounted = true;
    if (areModelsLoaded() && isArcFaceLoaded()) {
      setModelsReady(true);
      setModelsLoading(false);
      setModelProgress(100);
      return;
    }

    const interval = setInterval(() => {
      if (mounted) {
        if (areModelsLoaded() && isArcFaceLoaded()) {
          setModelsReady(true);
          setModelsLoading(false);
          setModelProgress(100);
          clearInterval(interval);
        } else {
          setModelProgress((p) => Math.min(p + 15, 90));
        }
      }
    }, 150);

    loadNeuralModels()
      .then((ok) => {
        if (mounted && ok) {
          setModelProgress(100);
          setModelsReady(true);
          setModelsLoading(false);
        }
      })
      .finally(() => {
        if (mounted && areModelsLoaded() && isArcFaceLoaded()) {
          setModelsReady(true);
          setModelsLoading(false);
        }
        clearInterval(interval);
      });

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [loadNeuralModels]);

  // Fetch local Android status & server approval state
  const checkStatus = useCallback(async () => {
    setLoadingNative(true);
    try {
      const devId = getNativeDeviceId();
      setNativeDeviceId(devId);

      if (isNativeBiometricAvailable()) {
        const local = await getNativeEnrollmentStatus(staffId);
        setNativeStatus(local);
      } else {
        setNativeStatus({
          isAvailable: false,
          isEnrolled: false,
          count: 0,
        });
      }

      // Check server metadata for authorized face request state (NO biometrics)
      try {
        const srv = await getStaffFaceStatus();
        setServerStatus(srv);
      } catch {
        // Server unreachable; local Keystore status remains authoritative
      }
    } catch (err) {
      console.warn("[FaceEnrollment] Failed to query local status:", err);
    } finally {
      setLoadingNative(false);
    }
  }, [staffId]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  // Clean up camera stream
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Synchronize live camera stream when video element mounts into DOM
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [cameraActive]);

  // Start live camera stream
  const startCamera = async () => {
    setCameraPermissionDenied(false);
    setCameraError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      const msg =
        "Camera access is not supported by this browser environment or requires an HTTPS secure connection. Please use 'Upload Photo Files' instead.";
      setCameraError(msg);
      toast.error(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 720 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(console.error);
      }
    } catch (err: any) {
      console.warn("[FaceEnrollment] getUserMedia error:", err);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        setCameraPermissionDenied(true);
      } else {
        const msg = err?.message || String(err);
        setCameraError(msg);
        toast.error("Camera access failed", { description: msg });
      }
      stopCamera();
    }
  };

  // Validate and generate embedding for an image strictly in memory
  const processImage = async (
    url: string,
    filename: string
  ): Promise<{ valid: boolean; embedding?: number[]; confidence?: number; message?: string }> => {
    // Ensure neural network models are ready in memory before analyzing face
    if (!areModelsLoaded() || !isArcFaceLoaded()) {
      const ok = await loadNeuralModels();
      if (!ok && (!areModelsLoaded() || !isArcFaceLoaded())) {
        return {
          valid: false,
          message: `Neural face models are unavailable (${modelsError || "loading in progress"}). Please click 'Retry Loading Models'.`,
        };
      }
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        try {
          if (img.naturalWidth < 120 || img.naturalHeight < 120) {
            resolve({
              valid: false,
              message: "Image resolution too small (minimum 120x120px required).",
            });
            return;
          }

          const faces = await detectFaces(img);
          if (faces.length === 0) {
            resolve({
              valid: false,
              message: `No face detected in '${filename}'. Ensure the face is facing the camera in good lighting.`,
            });
            return;
          }
          if (faces.length > 1) {
            resolve({
              valid: false,
              message: `Multiple faces (${faces.length}) detected in '${filename}'. Only one person should be in the photo.`,
            });
            return;
          }

          const face = faces[0]!;
          if (face.confidence < FACE_CONFIG.MIN_FACE_CONFIDENCE) {
            resolve({
              valid: false,
              confidence: face.confidence,
              message: `Face confidence too low (${Math.round(face.confidence * 100)}%). Ensure photo is sharp and well-lit.`,
            });
            return;
          }

          const embedding = await generateArcFaceEmbedding(
            img,
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
            face.landmarks
          );

          const floatArray = Array.from(embedding);
          if (floatArray.length !== 512) {
            resolve({
              valid: false,
              message: "Invalid embedding vector dimension generated.",
            });
            return;
          }

          resolve({
            valid: true,
            embedding: floatArray,
            confidence: face.confidence,
          });
        } catch (err: any) {
          resolve({
            valid: false,
            message: `Failed to process image: ${err?.message || String(err)}`,
          });
        }
      };
      img.onerror = () => {
        resolve({
          valid: false,
          message: `Unable to read or decode image file '${filename}'.`,
        });
      };
      img.src = url;
    });
  };

  // Handle files selected via native Android picker or browser file input
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }

    const selectedFiles = Array.from(fileList);
    const currentCount = samples.length;
    const remainingSlots = MAX_SAMPLES - currentCount;

    if (remainingSlots <= 0) {
      toast.error(`Maximum of ${MAX_SAMPLES} reference photos reached. Remove an existing photo to add another.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    let filesToProcess = selectedFiles;
    if (selectedFiles.length > remainingSlots) {
      toast.warning(
        `You selected ${selectedFiles.length} photos, but only ${remainingSlots} more slot(s) remain. Processing the first ${remainingSlots}.`
      );
      filesToProcess = selectedFiles.slice(0, remainingSlots);
    }

    setIsProcessing(true);

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i]!;
      const tempId = `upload-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`;
      const url = URL.createObjectURL(file);

      // Validate format
      const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isFormatValid =
        validTypes.includes(file.type.toLowerCase()) ||
        ["jpg", "jpeg", "png", "webp"].includes(ext);

      if (!isFormatValid) {
        setSamples((prev) => [
          ...prev,
          {
            id: tempId,
            source: "upload",
            filename: file.name,
            previewUrl: url,
            status: "rejected",
            message: "Unsupported file format. Please upload JPG, PNG, or WebP images.",
          },
        ]);
        continue;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setSamples((prev) => [
          ...prev,
          {
            id: tempId,
            source: "upload",
            filename: file.name,
            previewUrl: url,
            status: "rejected",
            message: "File exceeds 15MB limit. Please upload a smaller photo.",
          },
        ]);
        continue;
      }

      // Add as validating
      const placeholder: EnrollmentSample = {
        id: tempId,
        source: "upload",
        filename: file.name,
        previewUrl: url,
        status: "validating",
      };
      setSamples((prev) => [...prev, placeholder]);

      // Run local face detection & ArcFace embedding in memory
      const result = await processImage(url, file.name);

      setSamples((prev) =>
        prev.map((s) =>
          s.id === tempId
            ? {
                ...s,
                status: result.valid ? "valid" : "rejected",
                embedding: result.embedding,
                faceConfidence: result.confidence,
                message: result.message,
              }
            : s
        )
      );

      if (result.valid) {
        toast.success(`Verified face in '${file.name}'`);
      } else {
        toast.error(result.message || `Face check failed for '${file.name}'`);
      }
    }

    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Capture a snapshot from active camera stream
  const captureCameraPhoto = async () => {
    if (!videoRef.current || isProcessing) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      toast.error("Camera stream not ready yet.");
      return;
    }

    if (samples.length >= MAX_SAMPLES) {
      toast.error(`Maximum of ${MAX_SAMPLES} reference photos reached.`);
      return;
    }

    setIsProcessing(true);
    const tempId = `snap-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const snapshotName = `Camera Snapshot #${samples.length + 1}`;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize canvas context");
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

      const placeholder: EnrollmentSample = {
        id: tempId,
        source: "camera",
        filename: snapshotName,
        previewUrl: dataUrl,
        status: "validating",
      };
      setSamples((prev) => [...prev, placeholder]);

      const result = await processImage(dataUrl, snapshotName);

      setSamples((prev) =>
        prev.map((s) =>
          s.id === tempId
            ? {
                ...s,
                status: result.valid ? "valid" : "rejected",
                embedding: result.embedding,
                faceConfidence: result.confidence,
                message: result.message,
              }
            : s
        )
      );

      if (result.valid) {
        toast.success("Camera snapshot verified!");
      } else {
        toast.error(result.message || "Face check failed for snapshot.");
      }
    } catch (err: any) {
      toast.error("Failed to capture snapshot", { description: err?.message || String(err) });
    } finally {
      setIsProcessing(false);
    }
  };

  // Remove a sample
  const removeSample = (id: string) => {
    setSamples((prev) => prev.filter((s) => s.id !== id));
  };

  // Save biometric enrollment locally & submit approval request to administrator
  const handleSaveRegistration = async () => {
    const validSamples = samples.filter((s) => s.status === "valid" && s.embedding);

    if (validSamples.length < MIN_SAMPLES) {
      toast.error(`Please add at least ${MIN_SAMPLES} valid reference photo with a verified face.`);
      return;
    }

    if (validSamples.length > MAX_SAMPLES) {
      toast.error(`Maximum of ${MAX_SAMPLES} reference photos permitted.`);
      return;
    }

    const hasRejected = samples.some((s) => s.status === "rejected");
    if (hasRejected) {
      toast.error("Please remove or replace rejected photos before saving face registration.");
      return;
    }

    if (samples.some((s) => s.status === "validating") || isProcessing) {
      toast.error("Photos are still validating. Please wait.");
      return;
    }

    setIsSaving(true);
    try {
      const embeddings = validSamples.map((s) => s.embedding!);
      const labels = validSamples.map((s, idx) => `sample_${idx + 1}`);
      const oneTimeToken = serverStatus?.oneTimeToken || null;

      // REPLACEMENT ENROLLMENT (Staff already enrolled & locked)
      if (isEnrolled) {
        // CASE 1: STAGE 2 APPROVED (Fresh single-use ftok_ token issued for exact digest) -> COMMIT REPLACEMENT
        if (serverStatus?.canSaveReplacement && oneTimeToken) {
          const approvedDigest = serverStatus?.approvedDigest;

          // STEP 1: COMMIT REPLACEMENT LOCALLY (Only after verifying staged digest matches approved digest)
          const commitRes = await commitNativeReplacement(staffId, oneTimeToken, approvedDigest || undefined);
          if (!commitRes.success) {
            toast.error(commitRes.message || "Failed to commit replacement templates. Digest mismatch or corrupted staged file.");
            return;
          }

          // STEP 2: VERIFY LOCAL PERSISTENCE IN ANDROID KEYSTORE
          const verifyCheck = await verifyNativePersistence(staffId);
          if (!verifyCheck.verified || verifyCheck.count === 0) {
            toast.error("Local persistence verification failed. Templates were not confirmed in secure device storage.");
            return;
          }

          // STEP 3: SERVER AUTHORIZATION & ATOMIC CONSUMPTION
          const serverEnrollRes = await submitStaffFaceEnrollment(
            {
              deviceId: nativeDeviceId || undefined,
              templateCount: verifyCheck.count,
              oneTimeToken,
              requestId: serverStatus?.approvedRequest?.id || serverStatus?.latestRequest?.id,
              digest: approvedDigest || undefined,
            },
            oneTimeToken
          );

          if (!serverEnrollRes.success) {
            toast.error(serverEnrollRes.error || "Failed to finalize face enrollment on server. Existing templates remain intact.");
            return;
          }

          // STEP 4: CONFIRM SUCCESS & RE-LOCK PROFILE
          toast.success("Face registration successfully replaced and locked!", {
            description: `${verifyCheck.count} face template(s) securely encrypted with AES-256-GCM in Android Keystore. Single-use authorization consumed.`,
          });

          stopCamera();
          setSamples([]);
          setIsReplacementMode(false);
          await checkStatus();
          return;
        }

        // CASE 2: STAGE 1 PREPARATION APPROVED -> STAGE TEMPLATES LOCALLY & SUBMIT STAGE 2 REQUEST
        if (
          (serverStatus?.hasStage1Permission || serverStatus?.canPrepareReplacement) &&
          !serverStatus?.canSaveReplacement &&
          !serverStatus?.hasPendingImageApproval
        ) {
          if (isPendingApproval || serverStatus?.hasPendingRequest || serverStatus?.hasPendingImageApproval) {
            toast.warning("A face image approval request is already pending administrator review.");
            return;
          }

          // Step 1: Compute canonical cryptographic digest of the newly verified embeddings
          const digest = await computeCanonicalTemplateDigest(embeddings);

          // Step 2: Encrypt and stage replacement templates locally in Android app-private storage
          // Existing active templates remain 100% untouched!
          const stageRes = await stageNativeReplacement(
            staffId,
            embeddings,
            labels,
            serverStatus?.prepToken || "preptok_staged",
            serverStatus?.permissionRequestId || undefined,
            digest
          );

          if (!stageRes.success) {
            toast.error(stageRes.message || "Failed to encrypt and stage replacement templates in Android Keystore.");
            return;
          }

          // Step 3: Submit Stage 2 Image Approval Request to administrator
          const res = await requestStaffFaceImageApproval({
            deviceId: nativeDeviceId || undefined,
            sampleCount: validSamples.length,
            linkedRequestId: serverStatus?.permissionRequestId || undefined,
            digest,
            reason: requestReason.trim() || undefined,
          });

          if (!res.success) {
            toast.error(res.error || "Failed to submit replacement face images to administrator.");
            return;
          }

          toast.success("Replacement face images submitted for administrator approval!", {
            description: `Request ID: ${res.requestId || res.request?.id || "Pending"}. Staged digest: ${digest.slice(0, 16)}… Existing face templates remain active until final approval.`,
          });

          stopCamera();
          setSamples([]);
          setIsReplacementMode(false);
          await checkStatus();
          return;
        }

        // CASE 3: NO APPROVAL TOKEN -> Prompt for Stage 1 Permission Request
        if (isPendingApproval || serverStatus?.hasPendingRequest || serverStatus?.hasPendingPermissionRequest) {
          toast.warning("A face request is already pending administrator approval. Please wait for an administrator to review your request.");
          return;
        }

        setRequestSubmitError(null);
        setRequestModalOpen(true);
        toast.info("Please submit a re-enrollment permission request to the administrator first.");
        return;
      }

      // INITIAL REGISTRATION: Direct local batch enrollment or staged request
      if (oneTimeToken) {
        const enrollResult = await enrollNativeTemplatesBatch(staffId, embeddings, labels, oneTimeToken);
        if (!enrollResult.success) {
          toast.error(enrollResult.message || "Failed to save templates to Android Keystore.");
          return;
        }

        const verifyCheck = await verifyNativePersistence(staffId);
        if (!verifyCheck.verified || verifyCheck.count === 0) {
          toast.error("Local persistence verification failed. Templates were not confirmed in secure device storage.");
          return;
        }

        const serverEnrollRes = await submitStaffFaceEnrollment(
          {
            deviceId: nativeDeviceId || undefined,
            templateCount: verifyCheck.count,
            oneTimeToken,
            requestId: serverStatus?.approvedRequest?.id || serverStatus?.latestRequest?.id,
          },
          oneTimeToken
        );

        if (!serverEnrollRes.success) {
          toast.error(serverEnrollRes.error || "Failed to finalize face enrollment on server.");
          return;
        }

        toast.success("Initial face registration approved and permanently locked!", {
          description: `${verifyCheck.count} template(s) securely encrypted with AES-256-GCM in Android Keystore.`,
        });

        stopCamera();
        setSamples([]);
        setIsReplacementMode(false);
        await checkStatus();
        return;
      }

      // Initial registration staging workflow
      const stageRes = await stageNativePendingEnrollment(staffId, embeddings, labels);
      if (!stageRes.success) {
        toast.error(stageRes.message || "Failed to encrypt and stage templates in Android Keystore.");
        return;
      }

      const reqRes = await requestStaffFaceEnrollment({
        deviceId: nativeDeviceId || "android-device",
        sampleCount: validSamples.length,
        reason: "Initial institutional face registration",
      });

      if (!reqRes.success) {
        toast.error(reqRes.error || "Failed to submit face approval request to administrator.");
        return;
      }

      toast.success("Face registration submitted for administrator approval!", {
        description: `Request ID: ${reqRes.requestId || reqRes.request?.id || "Pending"}. Your templates are safely encrypted on this device.`,
      });

      stopCamera();
      setIsReplacementMode(false);
      await checkStatus();
    } catch (err: any) {
      toast.error("Failed to save biometric enrollment", { description: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Activate pending templates staged locally after administrator approval
  const handleActivateApprovedProfile = useCallback(
    async (tokenOverride?: string) => {
      const token = tokenOverride || serverStatus?.oneTimeToken;
      if (!token) {
        return;
      }

      if (activationInProgressRef.current) {
        return;
      }

      activationInProgressRef.current = true;
      setIsActivating(true);
      setActivationError(null);

      try {
        // Step 0: Check if templates are ALREADY verified and active in local storage (Idempotency)
        const preCheck = await verifyNativePersistence(staffId);
        let templateCount = preCheck.count;

        if (!preCheck.verified || preCheck.count === 0) {
          // 1. Native bridge activates staged templates into Room DB
          const actResult = await activateNativePendingEnrollment(staffId, token);
          if (!actResult.success) {
            const errMsg = actResult.message || actResult.error || "Failed to activate templates on this device.";
            setActivationError(errMsg);
            toast.error(errMsg);
            return;
          }

          // 2. Read-back verification in Android Keystore Room DB
          const verifyCheck = await verifyNativePersistence(staffId);
          if (!verifyCheck.verified || verifyCheck.count === 0) {
            const errMsg = verifyCheck.message || "Local persistence verification failed. Templates were not confirmed in secure device storage.";
            setActivationError(errMsg);
            toast.error(errMsg);
            return;
          }
          templateCount = verifyCheck.count;
        }

        // 3. Notify server to consume single-use token and mark locked
        const serverRes = await submitStaffFaceEnrollment(
          {
            deviceId: nativeDeviceId || undefined,
            templateCount,
            oneTimeToken: token,
          },
          token
        );

        if (!serverRes.success) {
          const errMsg = serverRes.error || "Failed to complete server lock registration.";
          setActivationError(errMsg);
          toast.error(errMsg);
          return;
        }

        hasActivatedTokenRef.current = token;
        setActivationError(null);

        toast.success("Face Registration Approved and Active!", {
          description: `${templateCount} template(s) permanently locked with AES-256-GCM. You may now mark attendance with face recognition.`,
        });

        await checkStatus();
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        setActivationError(errMsg);
        toast.error("Activation failed", { description: errMsg });
      } finally {
        setIsActivating(false);
        activationInProgressRef.current = false;
      }
    },
    [serverStatus?.oneTimeToken, staffId, nativeDeviceId, checkStatus]
  );

  // Commit authorized replacement templates into Room DB upon Stage 2 approval
  const handleFinalCommit = async () => {
    const oneTimeToken = serverStatus?.oneTimeToken;
    if (!oneTimeToken) {
      toast.error("Missing one-time authorization token.");
      return;
    }
    const approvedDigest = serverStatus?.approvedDigest;
    setIsSaving(true);
    try {
      // 1. Commit replacement templates in Android Keystore / Room DB (verifying staged digest)
      const commitRes = await commitNativeReplacement(staffId, oneTimeToken, approvedDigest || undefined);
      if (!commitRes.success) {
        toast.error(commitRes.message || "Failed to commit replacement templates on this device. Digest mismatch or file corrupted.");
        return;
      }

      // 2. Read-back verification in secure storage: verify count AND cryptographic digest
      const verifyCheck = await verifyNativePersistence(staffId, approvedDigest || undefined);
      if (!verifyCheck.verified || verifyCheck.count === 0) {
        toast.error(verifyCheck.message || "Local persistence verification failed. Templates were not confirmed in secure device storage.");
        return;
      }
      if (approvedDigest && verifyCheck.activeDigest && verifyCheck.activeDigest.toLowerCase() !== approvedDigest.toLowerCase()) {
        toast.error(`Persistence digest mismatch: Active digest (${verifyCheck.activeDigest.slice(0, 16)}…) does not match approved digest (${approvedDigest.slice(0, 16)}…).`);
        return;
      }

      // 3. Complete server authorization and consume single-use token ONLY after verified local persistence
      const serverEnrollRes = await submitStaffFaceEnrollment(
        {
          deviceId: nativeDeviceId || undefined,
          templateCount: verifyCheck.count,
          oneTimeToken,
          requestId: serverStatus?.approvedRequest?.id || serverStatus?.latestRequest?.id,
          digest: approvedDigest || verifyCheck.activeDigest || undefined,
        },
        oneTimeToken
      );

      if (!serverEnrollRes.success) {
        toast.error(serverEnrollRes.error || "Failed to finalize face enrollment on server.");
        return;
      }

      toast.success("Face registration successfully replaced and locked!", {
        description: `${verifyCheck.count} face template(s) securely encrypted with AES-256-GCM in Android Keystore. Single-use authorization consumed.`,
      });

      stopCamera();
      setSamples([]);
      setIsReplacementMode(false);
      await checkStatus();
    } catch (err: any) {
      toast.error("Failed to commit biometric replacement", { description: err?.message || String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // Submit Stage 1 permission request to administrator (server metadata only, ZERO biometrics)
  const handleSubmitChangeRequest = async () => {
    const trimmed = requestReason.trim();
    if (!trimmed) {
      setRequestSubmitError("Please enter a justification for requesting a face registration change.");
      toast.error("Please enter a reason for the change request.");
      return;
    }
    if (trimmed.length < 5) {
      setRequestSubmitError("Reason is too short. Please provide at least 5 characters.");
      toast.error("Please provide a detailed reason (at least 5 characters).");
      return;
    }
    if (trimmed.length > 250) {
      setRequestSubmitError("Reason cannot exceed 250 characters.");
      toast.error("Reason cannot exceed 250 characters.");
      return;
    }
    if (!activeStaff?.token) {
      setRequestSubmitError("Session expired or missing authentication token. Please sign in again.");
      toast.error("Authentication required. Please sign in again.");
      return;
    }

    if (isPendingApproval || serverStatus?.hasPendingRequest || serverStatus?.hasPendingPermissionRequest) {
      toast.warning("A face request is already pending administrator approval.");
      setRequestModalOpen(false);
      return;
    }

    if (isSubmittingRequest) return;
    setIsSubmittingRequest(true);
    setRequestSubmitError(null);

    try {
      // Stage 1 Permission Request: Requests institutional permission without capturing images
      const res = await requestStaffFacePermission(trimmed, nativeDeviceId || undefined);

      if (res.success) {
        toast.success("Face re-enrollment permission request submitted to administrator!", {
          description: `Request ID: ${res.requestId || res.request?.id || "Pending"}. Awaiting administrator review.`,
        });
        setRequestModalOpen(false);
        setRequestReason("");
        setRequestSubmitError(null);
        stopCamera();
        setSamples([]);
        setIsReplacementMode(false);

        // Optimistically update status to pending immediately
        setServerStatus((prev) => ({
          ...(prev || {
            success: true,
            status: "pending_approval",
            isLocked: true,
            canEdit: false,
            embeddingCount: 0,
            samples: [],
            hasPendingRequest: true,
          }),
          success: true,
          status: "pending_approval",
          enrollmentStatus: "pending_approval",
          hasPendingRequest: true,
          hasPendingPermissionRequest: true,
          pendingRequest: res.request || {
            id: res.requestId || "req-pending",
            reason: trimmed,
            status: "pending",
            requestType: "permission_request",
            deviceId: nativeDeviceId || undefined,
            sampleCount: 1,
            created_at: new Date().toISOString(),
          },
        }));

        await checkStatus();
      } else {
        const errMsg = res.error || "Failed to submit request to administrator.";
        setRequestSubmitError(errMsg);
        toast.error(errMsg);
      }
    } catch (err: any) {
      const errMsg = err?.message || "Error submitting face change request.";
      setRequestSubmitError(errMsg);
      toast.error(errMsg);
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Cancel pending change request
  const handleCancelRequest = async () => {
    try {
      await clearNativePendingEnrollment(staffId);
      const res = await cancelStaffFaceChange();
      if (res.success) {
        toast.success("Face approval request cancelled.");
        await checkStatus();
      } else {
        toast.error(res.error || "Failed to cancel request.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error cancelling request.");
    }
  };

  const isEnrolledOnDevice = nativeStatus?.isEnrolled === true;
  const isEnrolledOnServer = Boolean(
    serverStatus?.isLocked ||
    serverStatus?.status === "approved" ||
    serverStatus?.enrollmentStatus === "approved"
  );
  const isEnrolled = isEnrolledOnDevice || isEnrolledOnServer;

  const latestReqStatus = (
    serverStatus?.latestRequest?.status ||
    serverStatus?.latestRequestStatus ||
    (serverStatus?.hasPendingRequest ? "pending" : (serverStatus?.status === "rejected" ? "rejected" : (serverStatus?.status === "expired" ? "expired" : "none")))
  ).toLowerCase();

  const isCompleted = latestReqStatus === "completed";

  const hasStage2Approval = Boolean(
    isEnrolled &&
    serverStatus?.canSaveReplacement === true &&
    Boolean(serverStatus?.oneTimeToken?.startsWith("ftok_"))
  );
  const hasPendingPermission = Boolean(
    serverStatus?.hasPendingPermissionRequest ||
    (serverStatus?.hasPendingRequest &&
      (serverStatus?.latestRequest?.requestType === "permission_request" ||
       serverStatus?.pendingRequest?.requestType === "permission_request"))
  );
  const hasPendingImage = Boolean(
    serverStatus?.hasPendingImageApproval ||
    (serverStatus?.hasPendingRequest &&
      (serverStatus?.latestRequest?.requestType === "image_approval" ||
       serverStatus?.pendingRequest?.requestType === "image_approval"))
  );

  const hasStage1Permission = Boolean(
    !isCompleted &&
    latestReqStatus !== "completed" &&
    !hasPendingImage &&
    !hasStage2Approval &&
    (serverStatus?.hasStage1Permission || serverStatus?.canPrepareReplacement)
  );

  // Strict replacement authorization: Requires active enrolled profile, Stage 2 server approval, and single-use token
  const isApprovedForReplacement = hasStage2Approval;

  const isPendingApproval =
    hasPendingPermission ||
    hasPendingImage ||
    latestReqStatus === "pending" ||
    serverStatus?.hasPendingRequest === true ||
    serverStatus?.status === "pending_approval" ||
    serverStatus?.enrollmentStatus === "pending_approval";
  const isRejected = latestReqStatus === "rejected" || serverStatus?.status === "rejected" || serverStatus?.enrollmentStatus === "rejected";
  const isExpiredRequest = latestReqStatus === "expired" || serverStatus?.status === "expired";
  const isApproved = hasStage2Approval;

  // 1. Polling for administrator decision while approval is pending
  useEffect(() => {
    if (!isPendingApproval || isActivating) return;

    const interval = setInterval(() => {
      void checkStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, [isPendingApproval, isActivating, checkStatus]);

  // 2. Automatically trigger activation for pending initial enrollment upon approval
  useEffect(() => {
    const token = serverStatus?.oneTimeToken;
    const isApprovedAndReady =
      (serverStatus?.status === "approved" || serverStatus?.canSaveReplacement === true) &&
      Boolean(token) &&
      (!isEnrolled || nativeStatus?.hasPendingEnrollment);

    if (
      isApprovedAndReady &&
      token &&
      !isActivating &&
      !activationInProgressRef.current &&
      hasActivatedTokenRef.current !== token &&
      !isReplacementMode &&
      !activationError
    ) {
      void handleActivateApprovedProfile(token);
    }
  }, [serverStatus, isEnrolled, nativeStatus, isActivating, handleActivateApprovedProfile, isReplacementMode, activationError]);

  const validCount = samples.filter((s) => s.status === "valid").length;
  const hasRejected = samples.some((s) => s.status === "rejected");
  const isValidating = samples.some((s) => s.status === "validating") || isProcessing;
  const canSave = validCount >= MIN_SAMPLES && validCount <= MAX_SAMPLES && !hasRejected && !isValidating && !isSaving;

  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title="Staff Face Enrollment"
        description="Hardware-isolated, on-device biometric security. Biometric templates are encrypted with Android Keystore and never stored in the cloud."
        actions={
          <Button variant="outline" size="sm" onClick={() => void checkStatus()} disabled={loadingNative}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loadingNative ? "animate-spin" : ""}`} />
            Refresh Device Status
          </Button>
        }
      />

      <div className="space-y-6 max-w-4xl">
        {/* Authenticated Staff Identity Card */}
        <div className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ScanFace className="size-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">{activeStaff.name}</h3>
                  <Badge variant="outline" className="font-mono text-xs">
                    {staffId}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {activeStaff.department}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Smartphone className="size-3.5 text-primary" />
                  <span>
                    Hardware Device:{" "}
                    <strong>{nativeDeviceId || (isNative ? "Active Android Device" : "Standard Web Client")}</strong>
                  </span>
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant={isNative ? "default" : "outline"}
                className={isNative ? "bg-emerald-600 text-white hover:bg-emerald-600" : "text-muted-foreground"}
              >
                {isNative ? "Android Keystore Active" : "Web Isolation Mode"}
              </Badge>
            </div>
          </div>
        </div>

        {/* Browser Simulation Notice when not in Android WebView */}
        {!isNative && (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500/20 text-sky-600 dark:text-sky-400">
                <Smartphone className="size-5" />
              </span>
              <div className="space-y-1 text-xs">
                <h4 className="font-semibold text-foreground text-sm">Browser Preview Mode</h4>
                <p className="text-muted-foreground leading-relaxed">
                  In this web browser session, biometric enrollment operates in browser isolation simulation mode.
                  On your Android phone, facial templates are encrypted using <strong>Android Keystore AES-256-GCM</strong> in app-private storage.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading state indicator */}
        {loadingNative ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Inspecting device hardware keystore biometric status…</p>
          </div>
        ) : isPendingApproval ? (
          /* STATE: Pending Administrator Approval */
          <div className="space-y-6">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    <Clock className="size-6" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">Pending Administrator Approval</h3>
                      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                        Awaiting Review
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        Req ID: {serverStatus?.pendingRequest?.id || serverStatus?.activeRequest?.id || "Pending"}
                      </Badge>
                    </div>

                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                      Your facial biometric templates have been safely encrypted using AES-256-GCM and staged in app-private storage on this device.
                      Your request is currently awaiting institutional administrator review.
                      Zero photos or facial vectors were uploaded to cloud servers.
                    </p>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Staff ID:</span> {staffId}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Staged Templates:</span>{" "}
                        {nativeStatus?.pendingCount || serverStatus?.pendingRequest?.sampleCount || (validCount > 0 ? validCount : 1)} sample(s)
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Hardware Device ID:</span>{" "}
                        {serverStatus?.pendingRequest?.deviceId || nativeDeviceId || "Active Device"}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Submitted At:</span>{" "}
                        {serverStatus?.pendingRequest?.created_at ? new Date(serverStatus.pendingRequest.created_at).toLocaleString() : "Just now"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-row sm:flex-col gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => void checkStatus()} disabled={loadingNative}>
                    <RefreshCw className={`mr-1.5 size-3.5 ${loadingNative ? "animate-spin" : ""}`} />
                    Refresh Approval
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCancelRequest} className="text-muted-foreground hover:text-destructive">
                    Withdraw Request
                  </Button>
                </div>
              </div>
            </div>

            {/* Offline / Fail-Closed Guarantee */}
            <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground flex items-center gap-3">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>
                Templates remain safely encrypted in local storage until administrator approval is verified. Biometric attendance matching will activate immediately upon approval.
              </span>
            </div>
          </div>
        ) : isApproved && !isReplacementMode && (!isEnrolledOnDevice || nativeStatus?.hasPendingEnrollment) ? (
          /* STATE: Administrator Approval Detected — Automatic Activation Flow */
          <div className="space-y-6">
            {activationError ? (
              /* Activation Error Card with Safe Automatic Retry */
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-destructive/20 text-destructive">
                      <AlertCircle className="size-6" />
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">Activation Interrupted</h3>
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          Safe Retry Available
                        </Badge>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          Token Preserved
                        </Badge>
                      </div>

                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        Automatic activation was interrupted: <span className="text-foreground font-medium">{activationError}</span>.
                        Your approval token was safely preserved on the server and has not been consumed.
                      </p>

                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                          <span className="font-medium text-foreground">Staff ID:</span> {staffId}
                        </div>
                        <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                          <span className="font-medium text-foreground">Device Bound:</span> {nativeDeviceId || "Active Device"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 shrink-0 self-start">
                    <Button
                      onClick={() => {
                        setActivationError(null);
                        void handleActivateApprovedProfile();
                      }}
                      disabled={isActivating}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      {isActivating ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Retrying…
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-2 size-4" />
                          Retry Activation
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setActivationError(null);
                        setIsReplacementMode(true);
                        setSamples([]);
                      }}
                      className="border-primary/40 text-primary hover:bg-primary/5"
                    >
                      <Camera className="mr-1.5 size-4" />
                      Re-capture Photos
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Activating Loading State (Automatic) */
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <Loader2 className="size-6 animate-spin" />
                  </span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">Activating approved enrollment…</h3>
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300 animate-pulse">
                        <Loader2 className="mr-1 size-3 animate-spin" /> In Progress
                      </Badge>
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                        Keystore AES-256-GCM
                      </Badge>
                    </div>

                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                      Administrator approval granted. Activating your encrypted face templates staged on this device into Android Keystore and locking your biometric profile…
                    </p>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Staff ID:</span> {staffId}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Device Bound:</span> {nativeDeviceId || "Active Device"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground flex items-center gap-3">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>
                Zero biometric templates or embeddings are downloaded from cloud servers. On-device hardware Keystore encryption verifies and locks your biometric enrollment atomically.
              </span>
            </div>
          </div>
        ) : isEnrolled && !isReplacementMode ? (
          /* STATE 1: Already Enrolled (Device or Server-Locked) */
          <div className="space-y-6">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-6" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">Face Registration Active</h3>
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                        <Lock className="mr-1 size-3" /> Locked
                      </Badge>
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                        Keystore AES-256-GCM
                      </Badge>
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                        Enrollment Approved and Activated
                      </Badge>
                    </div>

                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                      Your facial biometric templates are encrypted and stored in private app storage on this phone.
                      Automated face recognition is active for your attendance marking.
                    </p>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Enrolled Staff ID:</span> {staffId}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Stored Templates:</span> {nativeStatus?.count ?? serverStatus?.sampleCount ?? 3} samples
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Hardware Device ID:</span>{" "}
                        {nativeStatus?.deviceId || nativeDeviceId || "Active Device"}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50">
                        <span className="font-medium text-foreground">Enrolled At:</span>{" "}
                        {nativeStatus?.enrolledAt ? new Date(nativeStatus.enrolledAt).toLocaleString() : "Active"}
                      </div>
                      <div className="rounded-lg bg-background/60 p-2.5 border border-border/50 sm:col-span-2">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-medium text-foreground">Active Template Digest:</span>
                          {nativeStatus?.templateVersion && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                              v{nativeStatus.templateVersion}
                            </Badge>
                          )}
                        </div>
                        <span className="font-mono text-[11px] break-all text-muted-foreground mt-0.5 block">
                          {nativeStatus?.activeDigest
                            ? nativeStatus.activeDigest
                            : serverStatus?.latestRequest?.digest
                            ? serverStatus.latestRequest.digest
                            : "Hardware Keystore Isolated"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                    <Lock className="mr-1 size-3" /> Hardware Locked
                  </Badge>
                </div>
              </div>
            </div>

            {/* SEPARATE CARD: Face-Change Request Lifecycle Status */}
            {hasPendingPermission ? (
              <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <Clock className="size-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Pending Re-enrollment Permission (Stage 1)</h4>
                        <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">
                          Awaiting Permission Review
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs">
                          Req ID: {serverStatus?.latestRequest?.id || serverStatus?.pendingRequest?.id || "Pending"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Reason: <em>"{serverStatus?.latestRequest?.reason || serverStatus?.pendingRequest?.reason || "Face biometric re-enrollment permission request"}"</em>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Your request to change your face registration has been submitted to administration. Camera and upload controls will unlock after an administrator approves your permission request. Existing active face templates remain in use.
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancelRequest} className="text-muted-foreground hover:text-destructive shrink-0">
                    Withdraw Request
                  </Button>
                </div>
              </div>
            ) : hasPendingImage ? (
              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <Clock className="size-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">New Face Images Awaiting Administrator Approval (Stage 2)</h4>
                        <Badge variant="outline" className="border-purple-500/40 text-purple-700 dark:text-purple-300">
                          Pending Image Approval
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs">
                          Req ID: {serverStatus?.latestRequest?.id || serverStatus?.pendingRequest?.id || "Pending"}
                        </Badge>
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {(serverStatus?.latestRequest?.linkedRequestId || serverStatus?.pendingRequest?.linkedRequestId) && (
                          <p>
                            Linked Permission Req:{" "}
                            <span className="font-mono font-medium text-foreground">
                              {serverStatus?.latestRequest?.linkedRequestId || serverStatus?.pendingRequest?.linkedRequestId}
                            </span>
                          </p>
                        )}
                        {(serverStatus?.latestRequest?.digest || serverStatus?.pendingRequest?.digest) && (
                          <p>
                            Staged Cryptographic Digest:{" "}
                            <span className="font-mono font-medium text-foreground">
                              {serverStatus?.latestRequest?.digest || serverStatus?.pendingRequest?.digest}
                            </span>
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Your proposed replacement templates are safely encrypted and staged on this device. Existing active templates remain in use for attendance until the administrator approves these specific images.
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancelRequest} className="text-muted-foreground hover:text-destructive shrink-0">
                    Withdraw Request
                  </Button>
                </div>
              </div>
            ) : hasStage2Approval ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <KeyRound className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Replacement Face Images Authorized (Stage 2 Approved)</h4>
                        <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600">
                          Final Commit Ready
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Administrator approval granted for your replacement face images (Digest:{" "}
                        <span className="font-mono font-semibold text-foreground">{serverStatus?.approvedDigest || "Verified"}</span>).
                        Click <strong>Commit Replacement Registration</strong> to verify the cryptographic digest and finalize activation in Android Keystore.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleFinalCommit}
                    disabled={isSaving}
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isSaving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Lock className="mr-1.5 size-4" />}
                    Commit Replacement Registration
                  </Button>
                </div>
              </div>
            ) : latestReqStatus === "completed" || isCompleted ? (
              <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <CheckCircle2 className="size-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Latest Face Change Request Completed</h4>
                        <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">
                          Completed
                        </Badge>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          Single-Use Token Consumed
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Your previous face change was successfully finalized and locked to this device. A fresh administrator approval is required for any future face replacement.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="default"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        setRequestSubmitError(null);
                        setRequestModalOpen(true);
                      }}
                    >
                      <ScanFace className="mr-1.5 size-4" />
                      Re-enroll / Change Face
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void checkStatus()}
                      disabled={loadingNative}
                    >
                      <RefreshCw className={`mr-1.5 size-3.5 ${loadingNative ? "animate-spin" : ""}`} />
                      Refresh Status
                    </Button>
                  </div>
                </div>
              </div>
            ) : hasStage1Permission ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <ScanFace className="size-5 text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Re-enrollment Permission Approved (Stage 1)</h4>
                        <Badge variant="default" className="bg-primary text-primary-foreground">
                          Ready to Prepare Images
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Administrator permission granted. Click <strong>Prepare Replacement Face Images</strong> to open the live camera or upload photo files. Existing active templates remain untouched until new images are submitted, approved, and committed in Stage 2.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setIsReplacementMode(true);
                      setSamples([]);
                    }}
                    className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Camera className="mr-1.5 size-4" />
                    Prepare Replacement Face Images
                  </Button>
                </div>
              </div>
            ) : latestReqStatus === "rejected" || isRejected ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <XCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Face Change Request Rejected</h4>
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          Rejected
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {serverStatus?.latestRequest?.adminNotes || serverStatus?.rejectedRequest?.adminNotes || "The administrator declined the previous face change request."}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground font-medium">
                        You may submit a new face change request with updated justification.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="default"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        if (hasStage1Permission) {
                          setIsReplacementMode(true);
                          setSamples([]);
                        } else {
                          setRequestSubmitError(null);
                          setRequestModalOpen(true);
                        }
                      }}
                    >
                      <ScanFace className="mr-1.5 size-4" />
                      Re-enroll / Change Face
                    </Button>
                    <Button
                      variant="outline"
                      className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                      onClick={() => {
                        setRequestSubmitError(null);
                        setRequestModalOpen(true);
                      }}
                    >
                      Submit New Request
                    </Button>
                  </div>
                </div>
              </div>
            ) : latestReqStatus === "expired" || isExpiredRequest ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3.5">
                    <Clock className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Approval Window Expired</h4>
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Expired
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        The 24-hour approval window for your face change request has expired. A fresh administrator approval is required for face replacement.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="default"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        if (hasStage1Permission) {
                          setIsReplacementMode(true);
                          setSamples([]);
                        } else {
                          setRequestSubmitError(null);
                          setRequestModalOpen(true);
                        }
                      }}
                    >
                      <ScanFace className="mr-1.5 size-4" />
                      Re-enroll / Change Face
                    </Button>
                    <Button
                      variant="outline"
                      className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                      onClick={() => {
                        setRequestSubmitError(null);
                        setRequestModalOpen(true);
                      }}
                    >
                      Submit New Request
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Need to Change Your Face Registration?</h4>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      Biometric profiles are locked to prevent tampering. Click below to submit an institutional justification request to administration.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                      variant="default"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        if (hasStage1Permission) {
                          setIsReplacementMode(true);
                          setSamples([]);
                        } else {
                          setRequestSubmitError(null);
                          setRequestModalOpen(true);
                        }
                      }}
                    >
                      <ScanFace className="mr-1.5 size-4" />
                      Re-enroll / Change Face
                    </Button>
                    <Button
                      variant="outline"
                      className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                      onClick={() => {
                        setRequestSubmitError(null);
                        setRequestModalOpen(true);
                      }}
                    >
                      Request Face Change
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* STATE 2: Face Enrollment & Image Upload Interface (1 to 5 Reference Photos) */
          <div className="space-y-6">
            {/* Show Approved Authorization Alert when re-capturing with approved token */}
            {isApproved && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-sm">
                <div className="flex items-start gap-3.5">
                  <KeyRound className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-foreground">Administrator Approval Active</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your single-use approval token is active on this device. Add 1 to 5 photos below and click <strong>Save Face Registration</strong> to lock your biometric profile with Android Keystore encryption.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Show Rejection Alert if previously rejected */}
            {isRejected && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 shadow-sm">
                <div className="flex items-start gap-3.5">
                  <XCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-foreground">Face Registration Request Rejected</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {serverStatus?.rejectedRequest?.adminNotes || "The administrator declined the previous face registration request."}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium">
                      Please capture or upload 1 to 5 clear, well-lit reference photos and submit a new request.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <Section
              title="Add Reference Face Photos"
              description="Capture 1 to 5 clear, well-lit photos using your camera or upload image files."
            >
              <div className="p-6 space-y-6">
                {/* Model Loading Status Banner */}
                {modelsLoading && !isModelsReady && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
                    <Loader2 className="size-4 animate-spin shrink-0 text-sky-600 dark:text-sky-400" />
                    <div className="flex-1 flex flex-wrap items-center justify-between gap-2">
                      <span>Preparing on-device ArcFace 512-D neural models ({modelProgress}%)… You may open the camera or select photo files now.</span>
                    </div>
                  </div>
                )}

                {/* Model Loading Error Banner with Retry */}
                {modelsError && !isModelsReady && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <div>
                        <span className="font-medium text-foreground">Model Initialization Warning:</span>{" "}
                        <span>{modelsError}. Face verification will retry automatically upon capturing or uploading photos.</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadNeuralModels()}
                      className="shrink-0 h-7 text-xs border-amber-500/40 hover:bg-amber-500/10"
                    >
                      <RefreshCw className="mr-1 size-3" /> Retry Loading Models
                    </Button>
                  </div>
                )}

                {/* Camera Error Banner */}
                {cameraError && (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive flex items-start gap-2.5">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Camera Access Failed</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed">{cameraError}</p>
                    </div>
                  </div>
                )}

                {/* Control Action Buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  {!cameraActive ? (
                    <Button
                      id="open-live-camera-btn"
                      onClick={startCamera}
                      disabled={isProcessing}
                    >
                      <Camera className="mr-2 size-4" />
                      Open Live Camera
                    </Button>
                  ) : (
                    <Button id="close-live-camera-btn" variant="secondary" onClick={stopCamera}>
                      Close Camera
                    </Button>
                  )}

                  <Button
                    id="upload-face-photos-btn"
                    variant="outline"
                    onClick={() => {
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                        fileInputRef.current.click();
                      }
                    }}
                    disabled={isProcessing || samples.length >= MAX_SAMPLES}
                  >
                    <UploadCloud className="mr-2 size-4" />
                    Upload Photo Files
                  </Button>

                  <input
                    id="face-photo-file-input"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    aria-label="Upload reference face photos"
                    onClick={(e) => {
                      (e.target as HTMLInputElement).value = "";
                    }}
                    onChange={handleFilesSelected}
                  />

                  {samples.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSamples([])}
                      disabled={isProcessing || isSaving}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="mr-1.5 size-3.5" />
                      Clear All ({samples.length})
                    </Button>
                  )}

                  {isReplacementMode && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsReplacementMode(false);
                        stopCamera();
                        setSamples([]);
                      }}
                      className="ml-auto text-muted-foreground"
                    >
                      Back to Enrolled Profile
                    </Button>
                  )}
                </div>

                {/* Guidance Tips Box */}
                <div className="rounded-xl border border-border/80 bg-muted/40 p-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <ScanFace className="size-4 text-primary" />
                    <span>Reference Photo Requirements (1 to 5 Images)</span>
                  </div>
                  <ul className="grid gap-1.5 sm:grid-cols-2 list-disc list-inside">
                    <li>Frontal neutral face capture with clear eye-level gaze.</li>
                    <li>Slight angle / head turn (left or right) for natural variation.</li>
                    <li>Standard clear eyeglasses are recommended if worn regularly.</li>
                    <li>Normal indoor lighting without glare, backlighting, or deep shadows.</li>
                    <li>No face masks, caps, or dark-tinted sunglasses.</li>
                    <li>Accepted formats: JPEG, JPG, PNG, WebP (max 15MB each).</li>
                  </ul>
                </div>

                {/* Camera Permission Denied View */}
                {cameraPermissionDenied && (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-center space-y-2">
                    <ShieldAlert className="size-8 text-destructive mx-auto" />
                    <h4 className="font-semibold text-foreground text-sm">Camera Permission Denied</h4>
                    <p className="max-w-md mx-auto text-xs text-muted-foreground">
                      Please allow camera permission in Android app settings or use &quot;Upload Photo Files&quot; to pick reference images from your gallery.
                    </p>
                  </div>
                )}

                {/* Live Camera Viewfinder (if camera is active) */}
                {cameraActive && (
                  <div className="relative mx-auto flex max-w-md flex-col items-center overflow-hidden rounded-2xl border border-border bg-black p-2 shadow-inner">
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-950">
                      <video
                        ref={(el) => {
                          videoRef.current = el;
                          if (el && streamRef.current && el.srcObject !== streamRef.current) {
                            el.srcObject = streamRef.current;
                            el.play().catch(() => {});
                          }
                        }}
                        autoPlay
                        playsInline
                        muted
                        className="size-full object-cover -scale-x-100"
                      />
                      {/* Face Positioning Oval Guide */}
                      <div className="pointer-events-none absolute inset-0 grid place-items-center">
                        <div className="size-60 sm:size-64 rounded-[48%] border-2 border-dashed border-primary/80 bg-primary/5" />
                      </div>
                    </div>

                    <div className="mt-3 flex w-full items-center justify-between px-2">
                      <p className="text-xs text-zinc-300">Position face within the oval guide</p>
                      <Button
                        id="snap-camera-photo-btn"
                        size="sm"
                        onClick={captureCameraPhoto}
                        disabled={isProcessing || samples.length >= MAX_SAMPLES}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Verifying…
                          </>
                        ) : (
                          <>
                            <Camera className="mr-1.5 size-3.5" /> Snap Photo
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Samples Previews Gallery */}
                {samples.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Reference Photos ({samples.length} of {MAX_SAMPLES} selected · {validCount} valid)
                      </h4>
                      <Badge variant={validCount >= MIN_SAMPLES && !hasRejected ? "default" : "secondary"}>
                        {validCount >= MIN_SAMPLES && !hasRejected ? "Ready to Save" : `${validCount} / ${MIN_SAMPLES} minimum`}
                      </Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {samples.map((sample, idx) => (
                        <div
                          key={sample.id}
                          className={`relative flex flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-sm transition-all ${
                            sample.status === "valid"
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : sample.status === "rejected"
                              ? "border-destructive/40 bg-destructive/5"
                              : "border-border"
                          }`}
                        >
                          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
                            <img
                              src={sample.previewUrl}
                              alt={sample.filename}
                              className="size-full object-cover"
                            />
                            <span className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-mono text-white">
                              #{idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeSample(sample.id)}
                              disabled={isSaving}
                              className="absolute top-2 right-2 rounded-full bg-black/70 p-1 text-white hover:bg-destructive hover:text-white transition-colors"
                              title="Remove photo"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>

                          <div className="mt-2.5 space-y-1">
                            <p className="truncate text-xs font-medium text-foreground">{sample.filename}</p>
                            <div>
                              {sample.status === "validating" ? (
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Loader2 className="size-3 animate-spin text-primary" /> Validating face…
                                </span>
                              ) : sample.status === "valid" ? (
                                <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="size-3" /> Verified (512-D ArcFace)
                                </span>
                              ) : (
                                <span className="flex items-start gap-1 text-[11px] text-destructive leading-tight">
                                  <XCircle className="size-3 shrink-0 mt-0.5" />
                                  <span>{sample.message || "Face check rejected"}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Privacy Guarantee Banner */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium">
                    <ShieldCheck className="size-4" />
                    <span>Strict On-Device Biometric Storage</span>
                  </div>
                  <p className="mt-1 leading-relaxed">
                    All face embeddings are processed in memory and encrypted directly in Android Keystore AES-256-GCM private app storage.
                    Raw face photos and vectors are <strong>NEVER transmitted to Supabase, Vercel, or cloud servers</strong>.
                  </p>
                </div>

                {/* Save Face Registration Action Button */}
                <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {isReplacementMode && isEnrolled ? (
                      <>
                        <p>
                          Submitting will stage encrypted templates locally and request <strong>Administrator Image Approval (Stage 2)</strong>.
                        </p>
                        <p className="text-[11px] text-muted-foreground/80">
                          Your existing face registration remains <strong>active and unchanged</strong> until administrator approval.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Saving will lock this biometric profile to <strong>{activeStaff.staffId}</strong> on this phone.
                        </p>
                        <p className="text-[11px] text-muted-foreground/80">
                          The profile will be <strong>permanently locked</strong> immediately upon saving.
                        </p>
                      </>
                    )}
                  </div>

                  <Button
                    id="save-face-registration-btn"
                    size="lg"
                    disabled={!canSave}
                    onClick={handleSaveRegistration}
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {isReplacementMode ? "Staging & Requesting Approval…" : "Encrypting & Saving Face…"}
                      </>
                    ) : (
                      <>
                        <Lock className="mr-2 size-4" />
                        {isReplacementMode && isEnrolled
                          ? `Submit Replacement for Admin Approval (${validCount} Photo${validCount === 1 ? "" : "s"})`
                          : `Save Face Registration (${validCount} Photo${validCount === 1 ? "" : "s"})`}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* Request Face Change Modal Dialog */}
      <Dialog
        open={requestModalOpen}
        onOpenChange={(open) => {
          setRequestModalOpen(open);
          if (!open) {
            setRequestSubmitError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="size-5 text-primary" />
              Request Re-enrollment Permission (Stage 1)
            </DialogTitle>
            <DialogDescription>
              To maintain campus security, face biometric profiles are permanently locked on the device.
              Please provide the institutional justification for re-enrolling your face. Once approved by an administrator,
              you will receive authorization to capture and stage new reference photos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">

            {requestSubmitError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">Submission Failed</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">{requestSubmitError}</p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="reason" className="text-xs font-medium text-foreground">
                  Reason for Change Request <span className="text-destructive">*</span>
                </label>
                <span
                  className={`text-[10px] ${
                    requestReason.trim().length > 0 && (requestReason.trim().length < 5 || requestReason.trim().length > 250)
                      ? "text-amber-600 dark:text-amber-400 font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  {requestReason.trim().length}/250 characters (min 5)
                </span>
              </div>
              <Textarea
                id="reason"
                placeholder="e.g. Appearance changed, new spectacles, or camera quality upgrade."
                value={requestReason}
                onChange={(e) => {
                  setRequestReason(e.target.value);
                  if (requestSubmitError) setRequestSubmitError(null);
                }}
                rows={4}
                disabled={isSubmittingRequest}
              />
              <p className="text-[11px] text-muted-foreground">
                This request will be reviewed by college administration. If approved, you will receive single-use authorization
                to enroll fresh samples on your device.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => {
                setRequestModalOpen(false);
                setRequestSubmitError(null);
              }}
              disabled={isSubmittingRequest}
            >
              Cancel
            </Button>
            <Button
              id="submit-face-change-request-btn"
              onClick={handleSubmitChangeRequest}
              disabled={isSubmittingRequest || requestReason.trim().length < 5 || requestReason.trim().length > 250}
            >
              {isSubmittingRequest && <Loader2 className="mr-2 size-4 animate-spin" />}
              {isSubmittingRequest ? "Submitting Request…" : "Submit Request to Administrator"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
