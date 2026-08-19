import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground", className)}
    >
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-2 text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function AlertBanner({
  tone,
  title,
  description,
  icon: Icon = AlertTriangle,
  action,
}: {
  tone: "success" | "warning" | "error" | "info";
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  const tones = {
    success: "border-success/25 bg-success-soft text-success",
    warning: "border-warning/35 bg-warning-soft text-warning-foreground",
    error: "border-destructive/25 bg-danger-soft text-destructive",
    info: "border-primary/20 bg-primary-soft text-accent-foreground",
  } as const;
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-xl border p-4", tones[tone])}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && <p className="mt-0.5 text-sm opacity-90">{description}</p>}
      </div>
      {action}
    </div>
  );
}
