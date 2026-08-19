import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bluetooth,
  Eye,
  EyeOff,
  Fingerprint,
  GraduationCap,
  Loader2,
  MapPin,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPanel } from "@/components/common/MapPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign In — CampusAttend Staff Attendance" },
      {
        name: "description",
        content:
          "CampusAttend secure staff attendance sign-in for college faculty and administration. Location verified, institution managed.",
      },
      { property: "og:title", content: "Sign In — CampusAttend Staff Attendance" },
      {
        property: "og:description",
        content: "Secure, location-verified staff attendance for colleges.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [staffId, setStaffId] = useState("SCT-2417");
  const [password, setPassword] = useState("campusattend");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!staffId || !password) {
      setError("Enter both your Staff ID and password.");
      return;
    }
    setLoading(true);
    setTimeout(() => navigate({ to: "/dashboard" }), 900);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Branding */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-foreground/15">
            <GraduationCap className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">CampusAttend</p>
            <p className="text-xs text-primary-foreground/70">Sona Group of Institutions</p>
          </div>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight">
            Attendance that only works inside campus.
          </h2>
          <p className="mt-3 text-sm text-primary-foreground/80">
            Multi-factor presence verification combining campus geofence, institutional network,
            proximity beacons and identity checks.
          </p>
          <div className="mt-8 overflow-hidden rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 p-2">
            <MapPanel height="h-[220px]" />
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-sm">
            {[
              { icon: MapPin, label: "Campus geofence" },
              { icon: Wifi, label: "Institutional Wi-Fi" },
              { icon: Bluetooth, label: "Beacon proximity" },
              { icon: Fingerprint, label: "Identity match" },
            ].map((f) => (
              <li key={f.label} className="flex items-center gap-2 text-primary-foreground/85">
                <f.icon className="size-4" aria-hidden />
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/60">
          © 2026 Sona Group of Institutions · Internal use only
        </p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-card)] sm:p-9">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-accent-foreground">
              <GraduationCap className="size-7" aria-hidden />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">CampusAttend</h1>
            <p className="mt-1 text-sm text-muted-foreground">Secure Staff Attendance System</p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="staffId">Staff ID</Label>
              <Input
                id="staffId"
                autoComplete="username"
                placeholder="e.g. SCT-2417"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" defaultChecked />
                <Label htmlFor="remember" className="text-sm font-normal">
                  Remember me
                </Label>
              </div>
              <button type="button" className="text-sm font-medium text-primary hover:underline">
                Forgot password?
              </button>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {loading ? "Signing in…" : "Sign In"}
            </Button>

            <Button type="button" variant="outline" className="w-full" asChild>
              <Link to="/admin">Continue as Administrator</Link>
            </Button>
          </form>

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            Secure • Location Verified • Institution Managed
          </p>
        </div>
      </div>
    </div>
  );
}
