import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, ScanFace, Smartphone, MapPin, User } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currentStaff } from "@/mocks/data";
import { useProfile, validateProfile } from "@/lib/profile-store";
import { useDevice } from "@/lib/use-device";

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
  const { profile, saveProfile } = useProfile();
  const device = useDevice();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  const fields = [
    ["Staff Name", profile.name],
    ["Staff ID", currentStaff.staffId],
    ["Department", currentStaff.department],
    ["Designation", currentStaff.designation],
    ["Email", profile.email],
    ["Phone", currentStaff.phone],
  ];

  const handleSave = () => {
    const error = validateProfile(draft);
    if (error) {
      toast.error(error);
      return;
    }
    saveProfile(draft);
    setOpen(false);
    toast.success("Profile updated");
  };

  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title="Profile"
        description="Your institutional record as registered with the administration office."
        actions={
          <Button onClick={() => setOpen(true)}>
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
              <h2 className="text-xl font-semibold tracking-tight">{profile.name}</h2>
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
          <Section title="Device information" description="Detected from the browser you are signed in with">
            <div className="space-y-4 p-5 text-sm">
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                  <Smartphone className="size-4.5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{device.model}</p>
                  <p className="text-xs text-muted-foreground">{device.deviceId}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Operating system</span>
                <span className="text-right font-medium">{device.platform}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Browser</span>
                <span className="text-right font-medium">{device.browser}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Device status</span>
                <StatusBadge status="Active" />
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>Update the name and email shown across CampusAttend.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Staff name</Label>
              <Input
                id="edit-name"
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={draft.email}
                maxLength={254}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
