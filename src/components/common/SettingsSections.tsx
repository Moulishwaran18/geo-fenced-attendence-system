import { Section } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currentStaff } from "@/mocks/data";

function ToggleRow({
  id,
  label,
  description,
  defaultChecked,
}: {
  id: string;
  label: string;
  description: string;
  defaultChecked?: boolean | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} defaultChecked={defaultChecked ?? false} />
    </div>
  );
}

export function SettingsSections() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Account" description="Basic information used across the institution">
        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Display name</Label>
            <Input id="acc-name" defaultValue={currentStaff.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">Email</Label>
            <Input id="acc-email" type="email" defaultValue={currentStaff.email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-lang">Language</Label>
            <Select defaultValue="en">
              <SelectTrigger id="acc-lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ta">Tamil</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Section>

      <Section title="Security" description="Protect your attendance account">
        <div className="divide-y divide-border">
          <ToggleRow
            id="two-factor"
            label="Two-factor authentication"
            description="Require an OTP when signing in from a new device."
            defaultChecked
          />
          <ToggleRow
            id="biometric"
            label="Biometric unlock"
            description="Use device biometrics before marking attendance."
            defaultChecked
          />
          <ToggleRow
            id="session"
            label="Auto sign-out"
            description="Sign out automatically after 30 minutes of inactivity."
          />
        </div>
      </Section>

      <Section title="Notifications" description="Choose what CampusAttend sends you">
        <div className="divide-y divide-border">
          <ToggleRow
            id="notif-email"
            label="Email notifications"
            description="Daily attendance summary to your institutional inbox."
            defaultChecked
          />
          <ToggleRow
            id="notif-reminder"
            label="Attendance reminders"
            description="Reminder at 8:45 AM when the marking window opens."
            defaultChecked
          />
          <ToggleRow
            id="notif-security"
            label="Security alerts"
            description="Alerts for new device logins and blocked attempts."
            defaultChecked
          />
        </div>
      </Section>

      <Section title="Attendance preferences" description="How marking behaves on your device">
        <div className="divide-y divide-border">
          <ToggleRow
            id="pref-auto"
            label="Auto-detect campus entry"
            description="Prompt to mark attendance when campus geofence is entered."
            defaultChecked
          />
          <ToggleRow
            id="pref-face"
            label="Always require face verification"
            description="Add identity match on top of location checks."
            defaultChecked
          />
          <div className="space-y-1.5 px-5 py-4">
            <Label htmlFor="pref-window">Preferred reminder time</Label>
            <Separator className="my-2" />
            <Input id="pref-window" type="time" defaultValue="08:45" className="w-40" />
          </div>
        </div>
      </Section>
    </div>
  );
}
