import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, MapPinned, RefreshCcw, ShieldCheck, UserX } from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { adminNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { MapPanel } from "@/components/common/MapPanel";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { campusZones, staffMarkers } from "@/mocks/data";

export const Route = createFileRoute("/admin/campus-map")({
  head: () => ({
    meta: [
      { title: "Campus Map — CampusAttend Admin" },
      {
        name: "description",
        content:
          "Live campus geofence view with staff markers across Sona College of Technology, Incubation Foundation, Arts & Science and Thiagarajar Polytechnic.",
      },
      { property: "og:title", content: "Campus Map — CampusAttend Admin" },
      { property: "og:description", content: "Live campus boundary and staff presence map." },
    ],
  }),
  component: CampusMapPage,
});

function CampusMapPage() {
  const inside = staffMarkers.filter((m) => m.state === "inside").length;
  const outside = staffMarkers.filter((m) => m.state === "outside").length;

  return (
    <AppShell nav={adminNav} role="admin">
      <PageHeader
        title="Campus Map"
        description="Geofence covering all four institutional blocks."
        actions={
          <Button variant="outline">
            <RefreshCcw className="mr-2 size-4" /> Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Staff inside campus" value={172} icon={MapPinned} tone="success" />
        <StatCard label="Staff outside campus" value={12} icon={UserX} tone="danger" />
        <StatCard label="Boundary status" value="Active" hint="4 zones enforced" icon={ShieldCheck} tone="primary" />
        <StatCard label="Last updated" value="09:14 AM" hint="Auto-refresh every 60 s" icon={RefreshCcw} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title="Live boundary view">
          <div className="p-4">
            <MapPanel height="h-[460px]" showControls showAllStaff />
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
