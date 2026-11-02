import {
  Activity,
  BellRing,
  CalendarCheck,
  ClipboardList,
  FileBarChart,
  FileDown,
  LayoutDashboard,
  Map,
  MapPin,
  ScanFace,
  Settings,
  Shield,
  Smartphone,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string | number;
}

export const staffNav: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Mark Attendance", to: "/mark-attendance", icon: MapPin },
  { label: "Attendance History", to: "/history", icon: CalendarCheck },
  { label: "Export Monthly Attendance PDF", to: "/export-monthly-pdf", icon: FileDown },
  { label: "Profile", to: "/profile", icon: User },
  { label: "Face Enrollment", to: "/face-enrollment", icon: ScanFace },
  { label: "Notification Diagnostics", to: "/notification-diagnostic", icon: Activity },
  { label: "Settings", to: "/settings", icon: Settings },
];

export const adminNav: NavItem[] = [
  { label: "Dashboard", to: "/admin", icon: LayoutDashboard },
  { label: "Staff", to: "/admin/staff", icon: Users },
  { label: "Attendance", to: "/admin/attendance", icon: ClipboardList },
  { label: "Attendance Reminder Settings", to: "/admin/attendance-reminders", icon: BellRing },
  { label: "Notification Diagnostics", to: "/notification-diagnostic", icon: Activity },
  { label: "Export Monthly Attendance PDF", to: "/export-monthly-pdf", icon: FileDown },
  { label: "Campus Map", to: "/admin/campus-map", icon: Map },
  { label: "Coordinate Points", to: "/admin/coordinate-points", icon: MapPin },
  { label: "Face Enrollment", to: "/admin/face-enrollment", icon: ScanFace },
  { label: "Face Change Approvals", to: "/admin/face-requests", icon: UserCheck },
  { label: "Devices", to: "/admin/devices", icon: Smartphone },
  { label: "Security", to: "/admin/security", icon: Shield },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: Activity },
  { label: "Reports", to: "/admin/reports", icon: FileBarChart },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];
