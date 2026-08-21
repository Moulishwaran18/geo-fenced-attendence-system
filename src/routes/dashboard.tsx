import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { AppShell, PageHeader, Section } from "@/components/layout/AppShell";
import { staffNav } from "@/components/layout/nav-config";
import { StatCard } from "@/components/common/StatCard";
import { AttendanceTable } from "@/components/common/AttendanceTable";
import { AlertBanner } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { recentAttendance } from "@/mocks/data";
import { useProfile } from "@/lib/profile-store";
import { formatIndiaDate, formatIndiaTime, useIndiaTime } from "@/lib/india-time";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Staff Dashboard — CampusAttend" },
      {
        name: "description",
        content:
          "Daily attendance overview for college staff: today's status, marking time, monthly rate and campus location status.",
      },
      { property: "og:title", content: "Staff Dashboard — CampusAttend" },
      { property: "og:description", content: "Your attendance overview for today." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const now = useIndiaTime();
  const hour = now ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now)) : 9;
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  return (
    <AppShell nav={staffNav} role="staff">
      <PageHeader
        title={`${greeting}, ${profile.name.split(" ").slice(0, 2).join(" ")}`}
        description={now ? `${formatIndiaDate(now)} · ${formatIndiaTime(now)} IST` : "Your attendance overview for today."}
        actions={
          <Button asChild>
            <Link to="/mark-attendance">
              <MapPin className="mr-2 size-4" /> Mark Attendance
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's Status" value="Present" hint="Marked on time" icon={CheckCircle2} tone="success" />
        <StatCard label="Today's Marking Time" value="09:03 AM" hint="Window 8:45 – 9:10 AM" icon={Clock} tone="primary" />
        <StatCard label="Monthly Attendance" value="96%" hint="21 of 22 working days" icon={TrendingUp} tone="primary" />
        <StatCard label="Current Location" value="Inside Campus" hint="GPS accuracy 11 m" icon={Navigation} tone="success" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2">
          <div className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-success-soft text-success">
                  <ShieldCheck className="size-7" aria-hidden />
                </span>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Attendance Ready</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    All presence checks have passed for your registered device.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success">
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                Live
              </span>
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Location", value: "Inside Campus" },
                { label: "GPS Accuracy", value: "11 m" },
                { label: "Verification Status", value: "Ready" },
                { label: "Attendance Window", value: "8:45 – 9:10 AM" },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-secondary/60 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="mt-1 text-sm font-semibold">{row.value}</dd>
                </div>
              ))}
            </dl>

            <Button asChild size="lg" className="mt-6 w-full">
              <Link to="/mark-attendance">
                <MapPin className="mr-2 size-5" /> Mark Attendance
              </Link>
            </Button>
          </div>
        </Section>

        <div className="space-y-4">
          <AlertBanner
            tone="info"
            icon={CalendarCheck}
            title="Attendance window closes at 9:10 AM"
            description="Entries after the window need admin approval."
          />
          <Section title="This month">
            <ul className="divide-y divide-border text-sm">
              {[
                ["Working days", "22"],
                ["Present", "21"],
                ["Late", "2"],
                ["Absent", "1"],
                ["Attendance rate", "96%"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between px-5 py-3">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold tabular-nums">{v}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <Section
        className="mt-6"
        title="Recent attendance"
        description="Your last 5 marked entries"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/history">View all</Link>
          </Button>
        }
      >
        <AttendanceTable records={recentAttendance.slice(0, 5)} />
      </Section>
    </AppShell>
  );
}
