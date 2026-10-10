import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bluetooth,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  User,
  UserCheck,
  UserPlus,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPanel } from "@/components/common/MapPanel";
import { loginAdmin, getAdminToken } from "@/lib/admin-auth";
import { loginStaff, registerStaff } from "@/lib/staff-auth";
import { departments } from "@/mocks/data";

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
  const [staffView, setStaffView] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Staff login credentials state
  const [staffId, setStaffId] = useState("SCT-2417");
  const [staffPassword, setStaffPassword] = useState("campusattend");

  // Staff self-registration form state
  const [regStaffId, setRegStaffId] = useState("");
  const [regName, setRegName] = useState("");
  const [regDepartment, setRegDepartment] = useState(departments[0] || "Computer Science & Engineering");
  const [regCustomDepartment, setRegCustomDepartment] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regSharedCode, setRegSharedCode] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [showRegSharedCode, setShowRegSharedCode] = useState(false);

  // Administrator credentials state (no hardcoded password)
  const [adminId, setAdminId] = useState("moulish");
  const [adminPassword, setAdminPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
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

  // Handle staff login submission
  const submitStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAuthNotice(null);
    setRegSuccess(null);

    // If user enters 'moulish' in staff field, switch to administrator authentication
    if (staffId.trim().toLowerCase() === "moulish") {
      setAuthMode("admin");
      setAdminId("moulish");
      setAdminPassword(staffPassword);
      handleAdminLogin("moulish", staffPassword);
      return;
    }

    if (!staffId.trim() || !staffPassword) {
      setError("Enter both your Staff ID and personal password.");
      return;
    }

    setLoading(true);
    try {
      const result = await loginStaff(staffId.trim(), staffPassword);
      if (result.success) {
        navigate({ to: "/dashboard" });
      } else {
        setError(result.error || "Invalid Staff ID or password. Please verify your credentials.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to complete login. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Handle staff self-registration submission
  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setRegSuccess(null);

    const cleanId = regStaffId.trim().toUpperCase();
    const cleanName = regName.trim();
    const finalDept = regDepartment === "Other" ? regCustomDepartment.trim() : regDepartment.trim();

    if (!cleanId) {
      setError("Please provide a valid Staff ID.");
      return;
    }

    if (!cleanName) {
      setError("Please enter your full name.");
      return;
    }

    if (!finalDept) {
      setError("Please select or enter your department.");
      return;
    }

    if (!regPassword) {
      setError("Please create a personal password.");
      return;
    }

    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError("Passwords do not match. Please verify your password confirmation.");
      return;
    }

    if (!regSharedCode.trim()) {
      setError("Please enter the shared account-creation authorization password.");
      return;
    }

    setLoading(true);
    try {
      const res = await registerStaff({
        staff_code: cleanId,
        name: cleanName,
        department: finalDept,
        password: regPassword,
        confirmPassword: regConfirmPassword,
        registrationCode: regSharedCode.trim(),
      });

      if (res.success) {
        setRegSuccess(
          `Account for ${cleanId} created successfully! You can now sign in with your Staff ID and personal password.`,
        );
        // Switch to login tab and prefill Staff ID
        setStaffId(cleanId);
        setStaffPassword("");
        setStaffView("login");

        // Reset registration fields
        setRegStaffId("");
        setRegName("");
        setRegPassword("");
        setRegConfirmPassword("");
        setRegSharedCode("");
        setRegCustomDepartment("");
      } else {
        setError(res.error || "Staff account registration failed.");
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during registration.");
    } finally {
      setLoading(false);
    }
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
    setRegSuccess(null);

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
            proximity beacons and biometric identity checks.
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
              ) : staffView === "register" ? (
                <UserPlus className="size-7 text-primary" aria-hidden />
              ) : (
                <GraduationCap className="size-7" aria-hidden />
              )}
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              {authMode === "admin"
                ? "Administration Console"
                : staffView === "register"
                ? "Create Staff Account"
                : "CampusAttend"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {authMode === "admin"
                ? "Authorized Administrator Authentication"
                : staffView === "register"
                ? "Self-Registration with Institutional Authorization"
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

          {regSuccess && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>{regSuccess}</span>
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
                    placeholder="Enter administrator password"
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
          ) : staffView === "register" ? (
            /* Staff Self-Registration Form (Option B) */
            <form className="mt-6 space-y-4" onSubmit={submitRegister}>
              <div className="space-y-2">
                <Label htmlFor="regStaffId">Unique Staff ID</Label>
                <Input
                  id="regStaffId"
                  placeholder="e.g. SCT-2450"
                  value={regStaffId}
                  onChange={(e) => setRegStaffId(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="regName">Full Name</Label>
                <Input
                  id="regName"
                  placeholder="e.g. Dr. Priya Ramanathan"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="regDepartment">Department</Label>
                <Select
                  value={regDepartment}
                  onValueChange={(val) => setRegDepartment(val)}
                >
                  <SelectTrigger id="regDepartment">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                    <SelectItem value="Other">Other / Custom Department</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {regDepartment === "Other" && (
                <div className="space-y-2">
                  <Label htmlFor="regCustomDept">Specify Department</Label>
                  <Input
                    id="regCustomDept"
                    placeholder="Enter your department name"
                    value={regCustomDepartment}
                    onChange={(e) => setRegCustomDepartment(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="regPassword">Personal Password</Label>
                <div className="relative">
                  <Input
                    id="regPassword"
                    type={showRegPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Create a personal password (min. 6 chars)"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword((v) => !v)}
                    aria-label={showRegPassword ? "Hide password" : "Show password"}
                    title={showRegPassword ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {showRegPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="regConfirmPassword">Confirm Personal Password</Label>
                <div className="relative">
                  <Input
                    id="regConfirmPassword"
                    type={showRegConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter personal password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegConfirmPassword((v) => !v)}
                    aria-label={showRegConfirmPassword ? "Hide password" : "Show password"}
                    title={showRegConfirmPassword ? "Hide password" : "Show password"}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {showRegConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="regSharedCode" className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5 text-primary" />
                    Shared Account-Creation Password
                  </Label>
                </div>
                <div className="relative">
                  <Input
                    id="regSharedCode"
                    type={showRegSharedCode ? "text" : "password"}
                    autoComplete="off"
                    placeholder="Enter institution authorization password"
                    value={regSharedCode}
                    onChange={(e) => setRegSharedCode(e.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegSharedCode((v) => !v)}
                    aria-label={showRegSharedCode ? "Hide authorization code" : "Show authorization code"}
                    title={showRegSharedCode ? "Hide authorization code" : "Show authorization code"}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {showRegSharedCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Provided by college administration for authorized staff onboarding.
                </p>
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
                {loading ? "Registering Staff Account…" : "Register Staff Account"}
              </Button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStaffView("login");
                    setError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
                >
                  Already have an account? Sign In
                </button>
              </div>
            </form>
          ) : (
            /* Staff Sign-In Form */
            <form className="mt-6 space-y-4" onSubmit={submitStaff}>
              <div className="space-y-2">
                <Label htmlFor="staffId">Staff ID</Label>
                <Input
                  id="staffId"
                  autoComplete="username"
                  placeholder="e.g. SCT-2417"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Personal Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your personal password"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
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

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox id="remember" defaultChecked />
                  <Label htmlFor="remember" className="text-sm font-normal">
                    Remember me
                  </Label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError("Contact college administration to reset credentials.");
                  }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? "Signing in…" : "Sign In"}
              </Button>

              {/* Option B: Prominent Staff Self-Registration Action */}
              <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-center">
                <p className="text-xs text-muted-foreground">
                  New faculty or staff member without an account?
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full font-medium text-primary hover:bg-primary/5 hover:text-primary"
                  onClick={() => {
                    setStaffView("register");
                    setError(null);
                    setRegSuccess(null);
                  }}
                >
                  <UserPlus className="mr-1.5 size-4" />
                  Create Staff Account
                </Button>
              </div>

              <Button
                type="button"
                variant="ghost"
                className="w-full text-xs text-muted-foreground hover:text-foreground"
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
