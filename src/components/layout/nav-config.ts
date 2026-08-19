import {
  Activity,
  CalendarCheck,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  Map,
  MapPin,
  Settings,
  Shield,
  Smartphone,
  User,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

export const staffNav: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mark Attendance", to: "/mark-attendance", icon: MapPin },
  { label: "Attendance History", to: "/history", icon: CalendarCheck },
  { label: "Profile", to: "/profile", icon: User },
  { label: "Settings", to: "/settings", icon: Settings },
];

export const adminNav: NavItem[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { label: "Staff", to: "/admin/staff", icon: Users },
  { label: "Attendance", to: "/admin/attendance", icon: ClipboardList },
  { label: "Campus Map", to: "/admin/campus-map", icon: Map },
  { label: "Devices", to: "/admin/devices", icon: Smartphone },
  { label: "Security", to: "/admin/security", icon: Shield },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: Activity },
  { label: "Reports", to: "/admin/reports", icon: FileBarChart },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];
