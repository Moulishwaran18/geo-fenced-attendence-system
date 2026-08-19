import { useState } from "react";
import { Crosshair, Eye, EyeOff, Minus, Plus } from "lucide-react";
import { campusPolygon, campusZones, staffMarkers } from "@/mocks/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const markerColors = {
  inside: "fill-[var(--success)]",
  outside: "fill-[var(--destructive)]",
  warning: "fill-[var(--warning)]",
} as const;

export function MapPanel({
  showControls = false,
  showAllStaff = false,
  height = "h-[320px]",
}: {
  showControls?: boolean;
  showAllStaff?: boolean;
  height?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [staffVisible, setStaffVisible] = useState(true);

  const markers = showAllStaff ? staffMarkers : staffMarkers.slice(0, 1);

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-secondary", height)}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="size-full"
        role="img"
        aria-label="Stylized campus map showing the campus boundary and staff locations"
      >
        <defs>
          <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0 L0 0 0 5" fill="none" stroke="var(--border)" strokeWidth="0.2" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />
        <g style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}>
          <polygon
            points={campusPolygon}
            className="fill-[var(--primary)]/10 stroke-[var(--primary)]"
            strokeWidth="0.6"
            strokeDasharray="1.6 1"
          />
          {campusZones.map((z) => (
            <g key={z.name}>
              <rect
                x={z.x}
                y={z.y}
                width={z.w}
                height={z.h}
                rx="1.5"
                className="fill-[var(--card)] stroke-[var(--border)]"
                strokeWidth="0.3"
              />
              <text
                x={z.x + z.w / 2}
                y={z.y + z.h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-[var(--muted-foreground)]"
                style={{ fontSize: 1.9 }}
              >
                {z.name.replace("Sona ", "")}
              </text>
            </g>
          ))}
          {staffVisible &&
            markers.map((m) => (
              <g key={m.id}>
                <circle cx={m.x} cy={m.y} r="2.6" className={cn(markerColors[m.state], "opacity-25")} />
                <circle cx={m.x} cy={m.y} r="1.3" className={markerColors[m.state]} />
                <title>{`${m.name} — ${m.state}`}</title>
              </g>
            ))}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-[var(--shadow-card)]">
        <Legend color="bg-success" label="Inside" />
        <Legend color="bg-destructive" label="Outside" />
        <Legend color="bg-warning" label="Verification issue" />
      </div>

      {showControls && (
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          <MapButton label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}>
            <Plus className="size-4" />
          </MapButton>
          <MapButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>
            <Minus className="size-4" />
          </MapButton>
          <MapButton label="Center campus" onClick={() => setZoom(1)}>
            <Crosshair className="size-4" />
          </MapButton>
          <MapButton
            label={staffVisible ? "Hide staff markers" : "Show staff markers"}
            onClick={() => setStaffVisible((v) => !v)}
          >
            {staffVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </MapButton>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("size-2 rounded-full", color)} aria-hidden />
      {label}
    </span>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="size-8 bg-card"
    >
      {children}
    </Button>
  );
}
