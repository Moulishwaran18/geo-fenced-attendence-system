import {
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Laptop,
  MapPin,
  Navigation,
  ShieldCheck,
  Smartphone,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import type { AttendanceRecord } from "@/hooks/use-attendance";

interface AttendanceDetailDialogProps {
  record: AttendanceRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AttendanceDetailDialog({
  record,
  open,
  onOpenChange,
}: AttendanceDetailDialogProps) {
  if (!record) return null;

  const copyId = () => {
    navigator.clipboard.writeText(record.id);
    toast.success("Attendance ID copied to clipboard", {
      description: record.id,
    });
  };

  const hasCoords =
    typeof record.latitude === "number" && typeof record.longitude === "number";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-xl">
        <DialogHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary-soft px-2.5 py-1 font-mono text-xs font-semibold text-accent-foreground">
              {record.id}
            </span>
            <div className="flex items-center gap-2">
              <StatusBadge status={record.status} />
              <StatusBadge status={record.verification} />
            </div>
          </div>
          <DialogTitle className="mt-2 text-xl font-semibold">
            Attendance Record Details
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Authoritative presence verification log for {record.date} ({record.day}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Staff Information */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <User className="size-3.5" /> Staff Identity
            </div>
            <dl className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Staff Code</dt>
                <dd className="font-medium font-mono text-foreground">{record.staff_code}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="font-medium text-foreground">{record.staff_name}</dd>
              </div>
              {record.email && (
                <div>
                  <dt className="text-xs text-muted-foreground">Email</dt>
                  <dd className="truncate text-xs font-medium text-foreground">{record.email}</dd>
                </div>
              )}
              {record.department && (
                <div>
                  <dt className="text-xs text-muted-foreground">Department</dt>
                  <dd className="text-xs font-medium text-foreground">{record.department}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Time & Date Information */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Clock className="size-3.5" /> Timestamp & Window
            </div>
            <dl className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Attendance Date</dt>
                <dd className="font-medium text-foreground">{record.date}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Day of Week</dt>
                <dd className="font-medium text-foreground">{record.day}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Check-in Time</dt>
                <dd className="font-medium tabular-nums text-foreground">{record.time}</dd>
              </div>
              {record.created_at && (
                <div>
                  <dt className="text-xs text-muted-foreground">Server Timestamp</dt>
                  <dd className="truncate text-xs text-muted-foreground font-mono">
                    {new Date(record.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Location & GPS Information */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <MapPin className="size-3.5" /> Campus Location & Coordinates
            </div>
            <dl className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Location</dt>
                <dd className="font-medium text-foreground">{record.location}</dd>
              </div>
              {hasCoords ? (
                <>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latitude</dt>
                    <dd className="font-mono text-xs font-medium text-foreground">
                      {record.latitude?.toFixed(6)}° N
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Longitude</dt>
                    <dd className="font-mono text-xs font-medium text-foreground">
                      {record.longitude?.toFixed(6)}° E
                    </dd>
                  </div>
                </>
              ) : (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Geofence Position</dt>
                  <dd className="text-xs text-muted-foreground">Inside Authoritative Campus Perimeter</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Verification & Security Factors */}
          <div className="rounded-lg border border-border bg-secondary/30 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <ShieldCheck className="size-3.5" /> Multi-Factor Verification
            </div>
            <dl className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-0.5">
                  <span className="font-medium">{record.status}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Verification State</dt>
                <dd className="mt-0.5">
                  <span className="font-medium">{record.verification}</span>
                </dd>
              </div>
              {record.device_id && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Registered Device ID</dt>
                  <dd className="font-mono text-xs text-foreground">{record.device_id}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <DialogFooter className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-0">
          <Button variant="outline" size="sm" onClick={copyId} className="w-full sm:w-auto">
            <Copy className="mr-2 size-3.5" /> Copy Record ID
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
