import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { SettingsSections } from "@/components/common/SettingsSections";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CampusAttend" },
      {
        name: "description",
        content:
          "Manage account details, security options, notification preferences and attendance preferences in CampusAttend.",
      },
      { property: "og:title", content: "Settings — CampusAttend" },
      { property: "og:description", content: "Account, security and notification preferences." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title="Settings"
        description="Preferences apply to your registered CampusAttend device."
        actions={<Button onClick={() => toast.success("Preferences saved")}>Save changes</Button>}
      />
      <SettingsSections />
      <Section className="mt-6" title="Danger zone">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">
            Unregister this device. You will need admin approval to re-register.
          </p>
          <Button variant="destructive" onClick={() => toast.error("Device unregister requires admin approval")}>
            Unregister device
          </Button>
        </div>
      </Section>
    </AppShell>
  );
}
