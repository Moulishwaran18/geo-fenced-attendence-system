import type { LucideIcon } from "lucide-react";
import type { ReactNode, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

const iconTones: Record<Tone, string> = {
  primary: "bg-primary-soft text-accent-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning-foreground",
  danger: "bg-danger-soft text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  className,
  onClick,
  loading = false,
  badge,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  className?: string;
  onClick?: () => void;
  loading?: boolean;
  badge?: ReactNode;
}) {
  const isClickable = Boolean(onClick);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isClickable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label={isClickable ? `${label}: ${value}. Click for details.` : undefined}
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-all",
        isClickable &&
          "cursor-pointer hover:border-primary/40 hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {badge}
          </div>
          {loading ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <>
              <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-card-foreground">
                {value}
              </p>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </>
          )}
        </div>
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-lg transition-transform",
            isClickable && "group-hover:scale-105",
            iconTones[tone],
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
    </div>
  );
}

