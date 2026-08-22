import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, GraduationCap, LogOut, Menu, Search, User, X } from "lucide-react";
import type { NavItem } from "./nav-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { currentStaff } from "@/mocks/data";
import { useProfile } from "@/lib/profile-store";

interface AppShellProps {
  nav: NavItem[];
  children: ReactNode;
  role: "staff" | "admin";
  showSearch?: boolean;
}

export function AppShell({ nav, children, role, showSearch = role === "admin" }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile } = useProfile();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string) => (to === "/admin" ? pathname === "/admin" : pathname.startsWith(to));

  const user =
    role === "admin"
      ? { name: "S. Gopinath", meta: "Administrator · ADM-1002" }
      : { name: profile.name, meta: `${currentStaff.designation} · ${currentStaff.staffId}` };

  return (
    <div className="min-h-screen bg-background">
      {/* Top navbar */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <Link to={(role === "admin" ? "/admin" : "/dashboard") as "/"} className="flex items-center gap-2.5">
            <img src="/logo.png" alt="CampusAttend Logo" className="h-9 w-auto" />
            <span className="leading-tight">
              <span className="block text-base font-semibold tracking-tight">CampusAttend</span>
              <span className="hidden text-[11px] text-muted-foreground sm:block">
                {role === "admin" ? "Administration Console" : "Staff Portal"}
              </span>
            </span>
          </Link>

          {showSearch && (
            <div className="ml-6 hidden max-w-sm flex-1 md:block">
              <label htmlFor="global-search" className="sr-only">
                Search staff, devices or records
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="global-search" placeholder="Search staff, devices, records…" className="pl-9" />
              </div>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" aria-label="Notifications" title="Notifications" className="relative">
              <Bell className="size-5" />
              <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive" aria-hidden />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-label="Open profile menu"
                >
                  <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-accent-foreground">
                    {user.name.split(" ").slice(-1)[0]?.[0]}
                  </span>
                  <span className="hidden leading-tight sm:block">
                    <span className="block text-sm font-medium">{user.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{user.meta}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={"/profile" as "/"}>
                    <User className="mr-2 size-4" /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={role === "admin" ? "/dashboard" : "/admin"}>
                    Switch to {role === "admin" ? "staff" : "admin"} view
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/">
                    <LogOut className="mr-2 size-4" /> Logout
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-border bg-sidebar p-3 lg:block">
          <SidebarNav nav={nav} isActive={isActive} />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-foreground/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <nav
              aria-label="Main navigation"
              className="absolute inset-y-0 left-0 w-72 bg-sidebar p-3 shadow-[var(--shadow-raised)]"
            >
              <div className="mb-2 flex items-center justify-between px-2 py-2">
                <span className="font-semibold">Menu</span>
                <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
                  <X className="size-5" />
                </Button>
              </div>
              <SidebarNav nav={nav} isActive={isActive} onNavigate={() => setMobileOpen(false)} />
            </nav>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 pt-6 pb-24 lg:px-8 lg:pb-10">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {nav.slice(0, 5).map((item) => (
            <li key={item.to}>
              <Link
                to={item.to as "/"}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors",
                  isActive(item.to) ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                <span className="truncate">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SidebarNav({
  nav,
  isActive,
  onNavigate,
}: {
  nav: NavItem[];
  isActive: (to: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-1">
      {nav.map((item) => (
        <li key={item.to}>
          <Link
            to={item.to as "/"}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive(item.to)
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-muted",
            )}
          >
            <item.icon className="size-4.5 shrink-0" aria-hidden />
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card shadow-[var(--shadow-card)]", className)}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
