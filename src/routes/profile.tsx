import { createFileRoute } from "@tanstack/react-router";
import { Pencil, ScanFace, Smartphone, MapPin, User } from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { currentStaff } from "@/mocks/data";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Staff Profile — CampusAttend" },
      {
        name: "description",
        content:
          "Staff profile details, registered device information and enabled verification methods in CampusAttend.",
      },
      { property: "og:title", content: "Staff Profile — CampusAttend" },
      { property: "og:description", content: "Profile, device and verification settings." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const fields = [
    ["Staff Name", currentStaff.name],
    ["Staff ID", currentStaff.staffId],
    ["Department", currentStaff.department],
    ["Designation", currentStaff.designation],
    ["Email", currentStaff.email],
    ["Phone", currentStaff.phone],
  ];

  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title="Profile"
        description="Your institutional record as registered with the administration office."
        actions={
          <Button>
            <Pencil className="mr-2 size-4" /> Edit Profile
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Section className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-5 border-b border-border p-6">
            <span className="grid size-20 place-items-center rounded-full bg-primary-soft text-accent-foreground">
              <User className="size-9" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{currentStaff.name}</h2>
              <p className="text-sm text-muted-foreground">
                {currentStaff.designation} · {currentStaff.department}
              </p>
              <div className="mt-2 flex gap-2">
                <StatusBadge status="Active" />
                <StatusBadge status={currentStaff.staffId} tone="info" dot={false} />
              </div>
            </div>
          </div>
          <dl className="grid gap-x-8 gap-y-5 p-6 sm:grid-cols-2">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{k}</dt>
                <dd className="mt-1 text-sm font-medium break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="space-y-6">
          <Section title="Device information">
            <div className="space-y-4 p-5 text-sm">
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                  <Smartphone className="size-4.5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{currentStaff.device}</p>
                  <p className="text-xs text-muted-foreground">{currentStaff.deviceId}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Device status</span>
                <StatusBadge status="Active" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Registered on</span>
                <span className="font-medium">04 Jul 2026</span>
              </div>
            </div>
          </Section>

          <Section title="Verification">
            <ul className="divide-y divide-border text-sm">
              <li className="flex items-center justify-between px-5 py-3.5">
                <span className="flex items-center gap-2">
                  <ScanFace className="size-4 text-muted-foreground" aria-hidden /> Face verification
                </span>
                <StatusBadge status="Enabled" />
              </li>
              <li className="flex items-center justify-between px-5 py-3.5">
                <span className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden /> Location verification
                </span>
                <StatusBadge status="Enabled" />
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
