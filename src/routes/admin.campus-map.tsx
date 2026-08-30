import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, MapPinned, RefreshCcw, ShieldCheck, UserX } from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { MapPanel } from "@/components/common/MapPanel";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { campusZones, staffMarkers } from "@/mocks/data";

import { useGeofence } from "@/hooks/use-geofence";
import { GeofenceMap } from "@/components/common/GeofenceMap";
import { GpsDiagnosticPanel } from "@/components/common/GpsDiagnosticPanel";

export const Route = createFileRoute("/admin/campus-map")({
  head: () => ({
    meta: [
      { title: "Campus Map — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Live campus geofence view with authoritative 5-point polygon across Sona College of Technology.",
      },
      { property: "og:title", content: "Campus Map — CampusAttend Admin" },
      { property: "og:description", content: "Live campus boundary and staff presence map." },
    ],
  }),
  component: CampusMapPage,
});

function CampusMapPage() {
  const geofence = useGeofence(true);
  const inside = staffMarkers.filter((m) => m.state === "inside").length;
  const outside = staffMarkers.filter((m) => m.state === "outside").length;

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Campus Map"
        description="Authoritative 5-point GPS Geofence covering Sona College of Technology."
        actions={
          <Button variant="outline" onClick={() => void geofence.checkLocation(true)}>
            <RefreshCcw className={`mr-2 size-4 ${geofence.isChecking ? "animate-spin" : ""}`} /> Refresh GPS
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Staff inside campus" value={172} icon={MapPinned} tone="success" />
        <StatCard label="Staff outside campus" value={12} icon={UserX} tone="danger" />
        <StatCard label="Boundary status" value="Active" hint="5 Vertices Enforced" icon={ShieldCheck} tone="primary" />
        <StatCard label="Live GPS Status" value={geofence.isInside === true ? "Inside" : geofence.isInside === false ? "Outside" : "Acquiring"} hint={geofence.accuracy ? `±${geofence.accuracy.toFixed(1)}m` : "Awaiting fix"} icon={RefreshCcw} tone="neutral" />
      </div>

      <div className="mt-6">
        <GpsDiagnosticPanel geofence={geofence} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Live Authoritative Geofence View">
          <div className="p-4">
            <GeofenceMap geofence={geofence} height="h-[460px]" />
          </div>
        </Section>

        <div className="space-y-6">
          <Section title="Campus zones">
            <ul className="divide-y divide-border text-sm">
              {campusZones.map((z) => (
                <li key={z.name} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <span className="truncate">{z.name}</span>
                  <StatusBadge status="Active" />
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Marker list" description={`${inside} inside · ${outside} outside`}>
            <ul className="divide-y divide-border text-sm">
              {staffMarkers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.id}</p>
                  </div>
                  {m.state === "warning" ? (
                    <StatusBadge status="Warning" tone="warning" />
                  ) : (
                    <StatusBadge status={m.state === "inside" ? "Inside campus" : "Outside campus"} />
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <div className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning-soft p-4 text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-sm">
              1 staff marker is flagged for verification review inside the polytechnic block.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
