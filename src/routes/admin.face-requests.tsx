import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
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
  getAdminFaceRequests,
  approveFaceChangeRequest,
  rejectFaceChangeRequest,
  type FaceChangeRequest,
} from "@/lib/staff-face";

export const Route = createFileRoute("/admin/face-requests")({
  head: () => ({
    meta: [
      { title: "Face Change Approvals — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Administrator approval workflow for staff facial biometric change requests.",
      },
      { property: "og:title", content: "Face Change Approvals — CampusAttend Admin" },
      {
        property: "og:description",
        content: "Approve or reject locked face re-enrollment requests.",
      },
    ],
  }),
  component: AdminFaceRequestsPage,
});

function AdminFaceRequestsPage() {
  const [requests, setRequests] = useState<FaceChangeRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Dialog action state
  const [activeReq, setActiveReq] = useState<FaceChangeRequest | null>(null);
  const [dialogAction, setDialogAction] = useState<"approve" | "reject" | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAdminFaceRequests();
      if (res.success) {
        setRequests(res.requests);
        setPendingCount(res.pendingCount);
      } else {
        toast.error(res.error || "Failed to load face change requests.");
      }
    } catch {
      toast.error("Network error loading face change requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // Prevent background scroll and touch drift when decision dialog is open on mobile
  useEffect(() => {
    if (!dialogAction || !activeReq) return undefined;
    const origOverflow = document.body.style.overflow;
    const origTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = origOverflow;
      document.body.style.touchAction = origTouchAction;
    };
  }, [dialogAction, activeReq]);

  const handleDecision = async () => {
    if (!activeReq || !dialogAction) return;
    setSubmitting(true);

    try {
      if (dialogAction === "approve") {
        const res = await approveFaceChangeRequest(activeReq.id, adminNote.trim());
        if (res.success) {
          toast.success(`Request for ${activeReq.staff_code} approved! Single-use token issued.`);
          setDialogAction(null);
          setActiveReq(null);
          setAdminNote("");
          await fetchRequests();
        } else {
          toast.error(res.error || "Failed to approve request.");
        }
      } else {
        const res = await rejectFaceChangeRequest(activeReq.id, adminNote.trim());
        if (res.success) {
          toast.success(`Request for ${activeReq.staff_code} rejected. Existing profile unchanged.`);
          setDialogAction(null);
          setActiveReq(null);
          setAdminNote("");
          await fetchRequests();
        } else {
          toast.error(res.error || "Failed to reject request.");
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "Error processing decision.");
    } finally {
      setSubmitting(false);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const processedRequests = requests.filter((r) => r.status !== "pending");

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Face Change Approvals"
        description="Review and authorize staff requests to update locked facial recognition profiles. Approvals grant exactly one successful replacement within 24 hours."
        actions={
          <Button variant="outline" size="sm" onClick={() => void fetchRequests()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Metric Badges */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Pending Decisions
              </span>
              <span className="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Clock className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{pendingCount}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Awaiting administrator approval</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Approved (Single-Use)
              </span>
              <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {requests.filter((r) => r.status === "approved" || r.status === "consumed").length}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Tokens issued & consumed</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Rejected Requests
              </span>
              <span className="grid size-8 place-items-center rounded-lg bg-destructive/10 text-destructive">
                <XCircle className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {requests.filter((r) => r.status === "rejected").length}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Profiles kept locked</p>
          </div>
        </div>

        {/* Section 1: Pending Requests */}
        <Section
          title="Pending Requests Awaiting Decision"
          description="Staff members who have requested permission to change their locked facial profile."
        >
          {loading ? (
            <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin text-primary" />
              Loading change requests…
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto size-8 text-emerald-500/70" />
              <p className="mt-2 font-medium text-foreground">No pending requests</p>
              <p className="text-xs text-muted-foreground">All staff biometric profiles are locked and up to date.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pendingRequests.map((req) => (
                <div key={req.id} className="p-6 transition-colors hover:bg-muted/30">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{req.staff_name}</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {req.staff_code}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            req.requestType === "initial"
                              ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10"
                              : "border-indigo-500/40 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10"
                          }
                        >
                          {req.requestType === "initial"
                            ? "Initial Registration"
                            : "Face Re-enrollment"}
                        </Badge>
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Pending Decision
                        </Badge>
                      </div>

                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>
                          Request ID: <span className="font-mono font-medium text-foreground">{req.id}</span> · {req.department} · Device:{" "}
                          <span className="font-mono font-medium text-foreground">
                            {req.maskedDeviceId || req.deviceId || "Registered Device"}
                          </span>{" "}
                          · Requested on{" "}
                          {new Date(req.created_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>

                      <div className="mt-2.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                        <span className="font-medium text-foreground">Reason provided: </span>
                        <span className="text-muted-foreground">{req.reason}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => {
                          setActiveReq(req);
                          setDialogAction("approve");
                          setAdminNote("");
                        }}
                      >
                        <UserCheck className="mr-1.5 size-4" />
                        Approve Request
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setActiveReq(req);
                          setDialogAction("reject");
                          setAdminNote("");
                        }}
                      >
                        <UserX className="mr-1.5 size-4" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Section 2: Decision History */}
        {processedRequests.length > 0 && (
          <Section
            title="Request Decision History"
            description="Audit log of previous face change approvals and rejections."
          >
            <div className="divide-y divide-border">
              {processedRequests.map((req) => (
                <div key={req.id} className="p-5 text-sm">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{req.staff_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">({req.staff_code})</span>
                      <span className="font-mono text-[11px] text-muted-foreground">ID: {req.id}</span>
                      <Badge
                        variant="outline"
                        className={
                          req.requestType === "initial"
                            ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                            : "border-indigo-500/40 text-indigo-700 dark:text-indigo-300"
                        }
                      >
                        {req.requestType === "initial"
                          ? "Initial"
                          : "Face Re-enrollment"}
                      </Badge>
                      {req.status === "approved" ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                          Approved (24-Hour Active)
                        </Badge>
                      ) : req.status === "expired" ? (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                          Expired
                        </Badge>
                      ) : req.status === "consumed" ? (
                        <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">
                          Committed & Re-locked
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          Rejected
                        </Badge>
                      )}
                    </div>

                    <span className="text-xs text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong>Reason:</strong> {req.reason}
                  </p>
                  {req.maskedDigest && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <strong>Digest:</strong> <span className="font-mono">{req.maskedDigest}</span>
                    </p>
                  )}
                  {req.admin_notes && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <strong>Admin note:</strong> {req.admin_notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Decision Confirmation Full-Screen Modal Overlay */}
      <Dialog
        open={Boolean(dialogAction && activeReq)}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setDialogAction(null);
            setActiveReq(null);
            setAdminNote("");
          }
        }}
      >
        <DialogContent
          fullScreen={true}
          hideCloseButton={true}
          overlayClassName="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm"
          className="fixed inset-0 z-50 flex flex-col w-full h-full h-[100dvh] bg-background/95 sm:bg-transparent text-foreground border-none shadow-none p-0 overflow-y-auto overflow-x-hidden m-0 rounded-none [transform:none]"
        >
          <div
            className="w-full min-h-[100dvh] flex flex-col justify-center items-center p-3.5 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] box-border min-w-0"
            onClick={(e) => {
              // Click outside card on desktop closes the modal
              if (e.target === e.currentTarget && !submitting) {
                setDialogAction(null);
                setActiveReq(null);
                setAdminNote("");
              }
            }}
          >
            <div
              className="w-full max-w-lg my-auto rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-2xl relative space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <DialogHeader className="space-y-2 text-left">
                <div className="flex items-center justify-between gap-2">
                  <DialogTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold text-foreground">
                    {dialogAction === "approve" ? (
                      <>
                        <UserCheck className="size-5 text-emerald-600 shrink-0" />
                        <span>
                          {activeReq?.requestType === "initial"
                            ? "Approve Initial Face Registration"
                            : "Approve Face Re-enrollment"}
                        </span>
                      </>
                    ) : (
                      <>
                        <UserX className="size-5 text-destructive shrink-0" />
                        <span>
                          Reject {activeReq?.requestType === "initial" ? "Face Registration" : "Face Re-enrollment"}
                        </span>
                      </>
                    )}
                  </DialogTitle>
                  <button
                    type="button"
                    onClick={() => {
                      if (!submitting) {
                        setDialogAction(null);
                        setActiveReq(null);
                        setAdminNote("");
                      }
                    }}
                    disabled={submitting}
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring shrink-0 -mr-1"
                    aria-label="Close dialog"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <DialogDescription className="text-xs sm:text-sm text-muted-foreground leading-relaxed text-left">
                  {dialogAction === "approve" ? (
                    <>
                      Approving this request authorizes <strong>{activeReq?.staff_name}</strong> ({activeReq?.staff_code}) to capture and save replacement face images on their registered device (<strong>{activeReq?.maskedDeviceId || activeReq?.deviceId}</strong>).
                      <br />
                      <span className="text-muted-foreground mt-1 inline-block">
                        A single-use 24-hour authorization will be issued. Existing active templates remain in use until the staff member completes and saves the new registration.
                      </span>
                    </>
                  ) : (
                    <>
                      Rejecting this request will decline face re-enrollment for <strong>{activeReq?.staff_name}</strong> ({activeReq?.staff_code}). The staff member&apos;s existing face registration remains completely unchanged.
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
                  <p>
                    <strong className="text-foreground">Staff Reason:</strong> <span className="text-muted-foreground">{activeReq?.reason}</span>
                  </p>
                  <p>
                    <strong className="text-foreground">Staff Code:</strong> <span className="font-mono text-muted-foreground">{activeReq?.staff_code}</span> · <strong className="text-foreground">Department:</strong> <span className="text-muted-foreground">{activeReq?.department}</span>
                  </p>
                  {activeReq?.maskedDigest && (
                    <p className="font-mono text-[11px] text-purple-700 dark:text-purple-300">
                      <strong>Staged Digest:</strong> {activeReq.maskedDigest}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="adminNote" className="text-xs font-medium text-foreground">
                    Administrative Note (Optional)
                  </label>
                  <Textarea
                    id="adminNote"
                    placeholder={
                      dialogAction === "approve"
                        ? "e.g. Identity verified. Authorized to replace face registration."
                        : "e.g. Current reference photos are sufficiently clear."
                    }
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogAction(null);
                    setActiveReq(null);
                    setAdminNote("");
                  }}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  id="admin-decision-confirm-btn"
                  variant={dialogAction === "approve" ? "default" : "destructive"}
                  onClick={handleDecision}
                  disabled={submitting}
                  className={`w-full sm:w-auto ${dialogAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                >
                  {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {submitting
                    ? "Processing…"
                    : dialogAction === "approve"
                    ? activeReq?.requestType === "permission_request" || activeReq?.stage === 1
                      ? "Grant Preparation Permission"
                      : activeReq?.requestType === "initial"
                      ? "Approve Initial Registration"
                      : "Grant Re-enrollment Permission"
                    : "Confirm Rejection"}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
