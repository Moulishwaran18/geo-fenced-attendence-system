import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bluetooth,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  User,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MapPanel } from "@/components/common/MapPanel";
import { loginAdmin, getAdminToken } from "@/lib/admin-auth";

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
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, string>;
  const redirectTarget = search["redirect"] || search["admin_redirect"] || "/admin";
  const initialMode =
    search["tab"] === "admin" ||
    search["role"] === "admin" ||
    search["unauthorized"] === "true"
      ? "admin"
      : "staff";

  const [authMode, setAuthMode] = useState<"staff" | "admin">(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Staff credentials state
  const [staffId, setStaffId] = useState("SCT-2417");
  const [staffPassword, setStaffPassword] = useState("campusattend");

  // Administrator credentials state (no hardcoded password)
  const [adminId, setAdminId] = useState("moulish");
  const [adminPassword, setAdminPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(
    search["unauthorized"] === "true"
      ? "Administrator credentials required to access the requested page."
      : null,
  );

  useEffect(() => {
    if (search["tab"] === "admin" || search["role"] === "admin" || search["unauthorized"] === "true") {
      setAuthMode("admin");
    }
  }, [search]);

  const submitStaff = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAuthNotice(null);

    // If user enters 'moulish' in staff field, switch to administrator authentication
    if (staffId.trim().toLowerCase() === "moulish") {
      setAuthMode("admin");
      setAdminId("moulish");
      setAdminPassword(staffPassword);
      handleAdminLogin("moulish", staffPassword);
      return;
    }

    if (!staffId || !staffPassword) {
      setError("Enter both your Staff ID and password.");
      return;
    }
    setLoading(true);
    setTimeout(() => navigate({ to: "/dashboard" }), 900);
  };

  const handleAdminLogin = async (idToUse: string, passToUse: string) => {
    if (!idToUse || !passToUse) {
      setError("Enter both your Administrator ID and password.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setAuthNotice(null);

    try {
      const result = await loginAdmin(idToUse, passToUse);

      if (result.success) {
        navigate({ to: redirectTarget as "/" });
      } else {
        setError(result.error || "Invalid administrator credentials. Please check your ID and password.");
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during authentication. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    handleAdminLogin(adminId, adminPassword);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Branding Column */}
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
              { icon: ScanFace, label: "Face verification" },
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

      {/* Form Column */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-[var(--shadow-card)] sm:p-9">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-accent-foreground">
              {authMode === "admin" ? (
                <ShieldCheck className="size-7 text-primary" aria-hidden />
              ) : (
                <GraduationCap className="size-7" aria-hidden />
              )}
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              {authMode === "admin" ? "Administration Console" : "CampusAttend"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {authMode === "admin"
                ? "Authorized Administrator Authentication"
                : "Secure Staff Attendance System"}
            </p>
          </div>

          {/* Role Mode Toggle */}
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setAuthMode("staff");
                setError(null);
                setAuthNotice(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 transition-all ${
                authMode === "staff"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="size-3.5" /> Staff Portal
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("admin");
                setError(null);
                setAuthNotice(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 transition-all ${
                authMode === "admin"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ShieldCheck className="size-3.5" /> Administrator
            </button>
          </div>

          {authNotice && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
            >
              <ShieldAlert className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>{authNotice}</span>
            </div>
          )}

          {authMode === "admin" ? (
            /* Administrator Sign-In Form */
            <form className="mt-6 space-y-4" onSubmit={submitAdmin}>
              <div className="space-y-2">
                <Label htmlFor="adminId">Administrator ID</Label>
                <div className="relative">
                  <Input
                    id="adminId"
                    autoComplete="username"
                    placeholder="e.g. moulish"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="adminPassword">Password</Label>
                </div>
                <div className="relative">
                  <Input
                    id="adminPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="pr-10"
                    required
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
                <p
                  role="alert"
                  className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? "Authenticating…" : "Sign In as Administrator"}
              </Button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setAuthMode("staff")}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
                >
                  Return to Staff Sign In
                </button>
              </div>
            </form>
          ) : (
            /* Staff Sign-In Form */
            <form className="mt-6 space-y-5" onSubmit={submitStaff}>
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
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
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
                <p
                  role="alert"
                  className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive"
                >
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

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (getAdminToken()) {
                    navigate({ to: "/admin" });
                  } else {
                    setAuthMode("admin");
                    setError(null);
                    setAuthNotice("Please sign in with administrator credentials.");
                  }
                }}
              >
                Continue as Administrator
              </Button>
            </form>
          )}

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Encrypted • Location Verified • Role Protected
          </p>
        </div>
      </div>
    </div>
  );
}
