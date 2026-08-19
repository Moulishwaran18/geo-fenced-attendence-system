import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneMap: Record<Tone, string> = {
  success: "bg-success-soft text-success border-success/20",
  warning: "bg-warning-soft text-warning-foreground border-warning/30",
  danger: "bg-danger-soft text-destructive border-destructive/20",
  info: "bg-primary-soft text-accent-foreground border-primary/20",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function toneForStatus(status: string): Tone {
  const s = status.toLowerCase();
  if (["present", "verified", "active", "success", "connected", "inside campus", "allowed", "detected", "enabled", "low"].includes(s))
    return "success";
  if (["late", "warning", "pending", "flagged", "medium"].includes(s)) return "warning";
  if (["absent", "failed", "blocked", "error", "outside campus", "inactive", "high"].includes(s))
    return "danger";
  return "neutral";
}

export function StatusBadge({
  status,
  tone,
  className,
  dot = true,
}: {
  status: string;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  const resolved = tone ?? toneForStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneMap[resolved],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {status}
    </span>
  );
}
