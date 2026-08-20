import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bluetooth,
  CheckCircle2,
  Fingerprint,
  Loader2,
  MapPin,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { VerificationCard } from "@/components/common/VerificationCard";
import { FaceScanDialog } from "@/components/common/FaceScanDialog";
import { MapPanel } from "@/components/common/MapPanel";
import { AlertBanner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSnapshot,
  markAttendance,
  scenarioLabels,
  type AttendanceReceipt,
  type VerificationScenario,
} from "@/mocks/attendance-service";

export const Route = createFileRoute("/mark-attendance")({
  head: () => ({
    meta: [
      { title: "Mark Attendance — CampusAttend" },
      {
        name: "description",
        content:
          "Verify campus location, network, beacon proximity and identity, then mark your college staff attendance.",
      },
      { property: "og:title", content: "Mark Attendance — CampusAttend" },
      { property: "og:description", content: "Multi-factor campus presence verification." },
    ],
  }),
  component: MarkAttendancePage,
});

const icons = {
  location: MapPin,
  wifi: Wifi,
  bluetooth: Bluetooth,
  identity: ScanFace,
} as const;

const titles = {
  location: "Location",
  wifi: "Wi-Fi",
  bluetooth: "Bluetooth",
  identity: "Identity",
} as const;

function MarkAttendancePage() {
  const [scenario, setScenario] = useState<VerificationScenario>("ready");
  const [status, setStatus] = useState<"idle" | "verifying" | "success">("idle");
  const [receipt, setReceipt] = useState<AttendanceReceipt | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const snapshot = getSnapshot(scenario);

  const run = async () => {
    setStatus("verifying");
    const result = await markAttendance();
    setReceipt(result);
    setStatus("success");
    toast.success("Attendance recorded", { description: `${result.time} · ${result.date}` });
  };

  return (
    <AppShell nav={staffNav} role="staff">
      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onVerified={(snap) => {
          setFace(snap);
          toast.success("Face verified", { description: "Live capture matched your staff record." });
        }}
      />
      <PageHeader
        title="Mark Attendance"
        description="Presence is confirmed with four independent checks before your entry is recorded."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="scenario" className="text-xs text-muted-foreground">
              Demo state
            </label>
            <Select
              value={scenario}
              onValueChange={(v) => {
                setScenario(v as VerificationScenario);
                setStatus("idle");
              }}
            >
              <SelectTrigger id="scenario" className="w-56 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(scenarioLabels).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {status === "success" && receipt ? (
        <SuccessPanel receipt={receipt} onReset={() => setStatus("idle")} />
      ) : (
        <div className="space-y-6">
          <AlertBanner
            tone={snapshot.tone === "success" && !snapshot.canMark ? "info" : snapshot.tone}
            icon={snapshot.tone === "success" ? ShieldCheck : AlertTriangle}
            title={snapshot.headline}
            description={snapshot.message}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {snapshot.signals.map((s) => (
              <VerificationCard
                key={s.key}
                title={titles[s.key]}
                value={s.value}
                detail={s.detail}
                state={s.state}
                icon={icons[s.key]}
              />
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Section
              className="xl:col-span-2"
              title="Campus boundary"
              description={
                snapshot.scenario === "outside-campus"
                  ? "You are outside the campus boundary"
                  : "You are inside the campus"
              }
            >
              <div className="p-4">
                <MapPanel height="h-[340px]" />
              </div>
            </Section>

            <Section title="Verification summary">
              <div className="space-y-4 p-5">
                <dl className="space-y-3 text-sm">
                  {[
                    ["Staff ID", "SCT-2417"],
                    ["Device", "Redmi Note 13 Pro"],
                    ["GPS accuracy", snapshot.accuracy],
                    ["Attendance window", "8:45 AM – 9:10 AM"],
                    ["Nearest beacon", "BLE-GATE-02"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    {face ? (
                      <img
                        src={face}
                        alt="Live face capture used for verification"
                        className="size-12 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid size-12 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <ScanFace className="size-5" aria-hidden />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {face ? "Face matched" : "Live face scan required"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {face ? "Captured just now on this device" : "Camera only — no uploads"}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                      {face ? "Rescan" : "Scan"}
                    </Button>
                  </div>
                </div>

                <Button
                  size="lg"
                  className="w-full"
                  disabled={!snapshot.canMark || status === "verifying"}
                  onClick={() => (face ? void run() : setScanOpen(true))}
                >
                  {status === "verifying" ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" /> Verifying presence…
                    </>
                  ) : face ? (
                    <>
                      <Fingerprint className="mr-2 size-5" /> Verify &amp; Mark Attendance
                    </>
                  ) : (
                    <>
                      <ScanFace className="mr-2 size-5" /> Scan face to continue
                    </>
                  )}
                </Button>
                {!snapshot.canMark && (
                  <p className="text-center text-xs text-muted-foreground">
                    Marking is disabled until every check passes.
                  </p>
                )}
              </div>
            </Section>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function SuccessPanel({ receipt, onReset }: { receipt: AttendanceReceipt; onReset: () => void }) {
  return (
    <Section>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="size-11" aria-hidden />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">Attendance Recorded</h2>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-success">{receipt.time}</p>
        <p className="text-sm text-muted-foreground">{receipt.date}</p>

        <ul className="mt-7 w-full max-w-md space-y-2 text-left">
          {[
            { icon: MapPin, label: "Location verified" },
            { icon: ScanFace, label: "Identity verified" },
            { icon: Smartphone, label: "Device verified" },
            { icon: CheckCircle2, label: "Attendance successfully recorded" },
          ].map((i) => (
            <li
              key={i.label}
              className="flex items-center gap-3 rounded-lg border border-success/20 bg-success-soft px-4 py-2.5 text-sm text-success"
            >
              <i.icon className="size-4" aria-hidden />
              {i.label}
            </li>
          ))}
        </ul>

        <p className="mt-6 rounded-lg bg-muted px-4 py-2 font-mono text-xs text-muted-foreground">
          Attendance ID: {receipt.attendanceId}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
          <Button variant="outline" onClick={onReset}>
            View verification panel
          </Button>
        </div>
      </div>
    </Section>
  );
}
