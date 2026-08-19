import type { LucideIcon } from "lucide-react";
import { CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type VerificationState = "verified" | "warning" | "error" | "pending";

const stateStyles: Record<VerificationState, { ring: string; chip: string; label: string; Icon: LucideIcon }> = {
  verified: {
    ring: "border-success/30",
    chip: "bg-success-soft text-success",
    label: "Verified",
    Icon: CheckCircle2,
  },
  warning: {
    ring: "border-warning/40",
    chip: "bg-warning-soft text-warning-foreground",
    label: "Attention",
    Icon: AlertTriangle,
  },
  error: {
    ring: "border-destructive/30",
    chip: "bg-danger-soft text-destructive",
    label: "Failed",
    Icon: XCircle,
  },
  pending: {
    ring: "border-border",
    chip: "bg-muted text-muted-foreground",
    label: "Ready",
    Icon: Clock,
  },
};

export function VerificationCard({
  title,
  value,
  detail,
  state,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  state: VerificationState;
  icon: LucideIcon;
}) {
  const s = stateStyles[state];
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] transition-colors",
        s.ring,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("grid size-9 place-items-center rounded-lg", s.chip)}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <span
          className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", s.chip)}
        >
          <s.Icon className="size-3.5" aria-hidden />
          {s.label}
        </span>
      </div>
      <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-0.5 text-sm font-semibold text-card-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
