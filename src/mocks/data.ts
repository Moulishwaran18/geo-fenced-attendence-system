/**
 * Mock data layer. Everything here is fake and will be replaced by real
 * API calls once the backend is connected.
 */

export type AttendanceStatus = "Present" | "Late" | "Absent";
export type Severity = "Low" | "Medium" | "High";

export interface StaffMember {
  id: string;
  name: string;
  department: string;
  designation: string;
  email: string;
  phone: string;
  device: string;
  deviceStatus: "Active" | "Pending" | "Blocked";
  status: "Active" | "Inactive";
  lastAttendance: string;
  insideCampus: boolean;
  verificationIssue?: boolean;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  day: string;
  time: string;
  status: AttendanceStatus;
  location: string;
  verification: "Verified" | "Failed" | "Manual";
}

export const currentStaff = {
  name: "Dr. Priya Ramanathan",
  staffId: "SCT-2417",
  department: "Computer Science & Engineering",
  designation: "Associate Professor",
  email: "priya.r@sonatech.ac.in",
  phone: "+91 98xxx 41220",
  device: "Redmi Note 13 Pro (Android 14)",
  deviceId: "DEV-8842-AX",
};

export const departments = [
  "Computer Science & Engineering",
  "Electronics & Communication",
  "Mechanical Engineering",
  "Information Technology",
  "Mathematics & Science",
  "Administration",
];

export const staffDirectory: StaffMember[] = [
  ["SCT-2417", "Dr. Priya Ramanathan", 0, "Associate Professor", "Redmi Note 13 Pro", true],
  ["SCT-2418", "Prof. Karthik Subramanian", 1, "Assistant Professor", "iPhone 14", true],
  ["SCT-2419", "Dr. Meenakshi Iyer", 2, "Professor", "Samsung Galaxy S23", false],
  ["SCT-2420", "Mr. Arun Vijaykumar", 3, "Lab Instructor", "Realme 11 Pro", true],
  ["SCT-2421", "Dr. Lakshmi Narayanan", 4, "Professor & Head", "OnePlus 12R", true],
  ["SCT-2422", "Ms. Divya Balakrishnan", 0, "Assistant Professor", "iPhone 13", true],
  ["SCT-2423", "Mr. Senthil Kumaravel", 5, "Administrative Officer", "Moto G84", false],
  ["SCT-2424", "Dr. Anitha Rajendran", 1, "Associate Professor", "Pixel 8", true],
  ["SCT-2425", "Mr. Vignesh Palanisamy", 2, "Workshop Supervisor", "Vivo V29", true],
  ["SCT-2426", "Ms. Kavipriya Selvam", 3, "Assistant Professor", "iPhone 15", true],
  ["SCT-2427", "Dr. Ravi Shankar Muthu", 4, "Associate Professor", "Galaxy A54", true],
  ["SCT-2428", "Ms. Nandhini Chandrasekar", 0, "Assistant Professor", "Nothing Phone 2", true],
].map(([id, name, dept, designation, device, inside], i) => ({
  id: id as string,
  name: name as string,
  department: departments[dept as number],
  designation: designation as string,
  email: `${(name as string).split(" ").pop()!.toLowerCase()}@sonatech.ac.in`,
  phone: `+91 98xxx ${41000 + i * 37}`,
  device: device as string,
  deviceStatus: i === 6 ? "Pending" : "Active",
  status: i === 6 ? "Inactive" : "Active",
  lastAttendance: i === 6 ? "18 Aug 2026, 09:12 AM" : "19 Aug 2026, 08:5" + (i % 9) + " AM",
  insideCampus: inside as boolean,
  verificationIssue: i === 4,
})) as StaffMember[];

export const recentAttendance: AttendanceRecord[] = [
  {
    id: "ATT-20260819-001",
    date: "19 Aug 2026",
    day: "Wednesday",
    time: "09:03 AM",
    status: "Present",
    location: "Main Block, Gate 2",
    verification: "Verified",
  },
  {
    id: "ATT-20260818-014",
    date: "18 Aug 2026",
    day: "Tuesday",
    time: "08:52 AM",
    status: "Present",
    location: "Main Block, Gate 1",
    verification: "Verified",
  },
  {
    id: "ATT-20260817-009",
    date: "17 Aug 2026",
    day: "Monday",
    time: "09:14 AM",
    status: "Late",
    location: "CSE Block",
    verification: "Verified",
  },
  {
    id: "ATT-20260814-021",
    date: "14 Aug 2026",
    day: "Friday",
    time: "08:47 AM",
    status: "Present",
    location: "Main Block, Gate 2",
    verification: "Verified",
  },
  {
    id: "ATT-20260813-032",
    date: "13 Aug 2026",
    day: "Thursday",
    time: "—",
    status: "Absent",
    location: "—",
    verification: "Manual",
  },
  {
    id: "ATT-20260812-018",
    date: "12 Aug 2026",
    day: "Wednesday",
    time: "08:58 AM",
    status: "Present",
    location: "Incubation Foundation",
    verification: "Verified",
  },
  {
    id: "ATT-20260811-007",
    date: "11 Aug 2026",
    day: "Tuesday",
    time: "09:08 AM",
    status: "Late",
    location: "Main Block, Gate 2",
    verification: "Verified",
  },
  {
    id: "ATT-20260810-003",
    date: "10 Aug 2026",
    day: "Monday",
    time: "08:44 AM",
    status: "Present",
    location: "Arts & Science Block",
    verification: "Verified",
  },
];

export const todaysAttendance = staffDirectory.slice(0, 8).map((s, i) => ({
  staffId: s.id,
  name: s.name,
  department: s.department,
  time: i === 2 ? "—" : `08:${45 + i} AM`,
  location: s.insideCampus ? "Inside Campus" : "Outside Campus",
  status: (i === 2 ? "Absent" : i === 5 ? "Late" : "Present") as AttendanceStatus,
  verification: i === 4 ? "Warning" : i === 2 ? "—" : "Verified",
}));

export const weeklyAttendance = [
  { day: "Thu 13", present: 168, absent: 16 },
  { day: "Fri 14", present: 175, absent: 9 },
  { day: "Sat 15", present: 121, absent: 63 },
  { day: "Mon 17", present: 170, absent: 14 },
  { day: "Tue 18", present: 178, absent: 6 },
  { day: "Wed 19", present: 172, absent: 12 },
  { day: "Today", present: 172, absent: 12 },
];

export const departmentSummary = [
  { department: "Computer Science & Engineering", total: 42, present: 40, rate: 95 },
  { department: "Electronics & Communication", total: 36, present: 33, rate: 92 },
  { department: "Mechanical Engineering", total: 31, present: 28, rate: 90 },
  { department: "Information Technology", total: 28, present: 27, rate: 96 },
  { department: "Mathematics & Science", total: 24, present: 23, rate: 96 },
  { department: "Administration", total: 23, present: 21, rate: 91 },
];

export const monthlyTrend = [
  { month: "Mar", rate: 93 },
  { month: "Apr", rate: 95 },
  { month: "May", rate: 91 },
  { month: "Jun", rate: 88 },
  { month: "Jul", rate: 94 },
  { month: "Aug", rate: 96 },
];

export interface SecurityEvent {
  id: string;
  time: string;
  staff: string;
  event: string;
  device: string;
  location: string;
  result: "Blocked" | "Allowed" | "Flagged";
  severity: Severity;
}

export const securityEvents: SecurityEvent[] = [
  {
    id: "SEC-9012",
    time: "19 Aug, 09:12 AM",
    staff: "SCT-2421 · Dr. Lakshmi Narayanan",
    event: "Mock location app detected",
    device: "OnePlus 12R",
    location: "Outside boundary (1.4 km)",
    result: "Blocked",
    severity: "High",
  },
  {
    id: "SEC-9011",
    time: "19 Aug, 08:58 AM",
    staff: "SCT-2419 · Dr. Meenakshi Iyer",
    event: "Face verification failed (2 attempts)",
    device: "Samsung Galaxy S23",
    location: "Main Block, Gate 1",
    result: "Flagged",
    severity: "Medium",
  },
  {
    id: "SEC-9010",
    time: "19 Aug, 08:49 AM",
    staff: "SCT-2423 · Mr. Senthil Kumaravel",
    event: "Unregistered device attempt",
    device: "Unknown (Web)",
    location: "Salem, TN",
    result: "Blocked",
    severity: "High",
  },
  {
    id: "SEC-9009",
    time: "18 Aug, 05:41 PM",
    staff: "SCT-2425 · Mr. Vignesh Palanisamy",
    event: "Attendance outside window",
    device: "Vivo V29",
    location: "Polytechnic Block",
    result: "Blocked",
    severity: "Low",
  },
  {
    id: "SEC-9008",
    time: "18 Aug, 09:03 AM",
    staff: "SCT-2418 · Prof. Karthik Subramanian",
    event: "Low GPS accuracy warning",
    device: "iPhone 14",
    location: "Main Block basement",
    result: "Allowed",
    severity: "Low",
  },
];

export const auditLogs = [
  {
    id: "AUD-4411",
    timestamp: "19 Aug 2026, 09:03:11",
    user: "SCT-2417 · Dr. Priya Ramanathan",
    action: "Attendance marked",
    ip: "10.24.8.114",
    device: "Redmi Note 13 Pro",
    location: "Main Block, Gate 2",
    result: "Success" as const,
  },
  {
    id: "AUD-4410",
    timestamp: "19 Aug 2026, 09:01:47",
    user: "ADM-1002 · S. Gopinath",
    action: "Campus boundary updated",
    ip: "10.24.1.4",
    device: "Chrome · Windows 11",
    location: "Admin Office",
    result: "Success" as const,
  },
  {
    id: "AUD-4409",
    timestamp: "19 Aug 2026, 08:58:02",
    user: "SCT-2419 · Dr. Meenakshi Iyer",
    action: "Face verification attempt",
    ip: "10.24.8.71",
    device: "Samsung Galaxy S23",
    location: "Main Block, Gate 1",
    result: "Failed" as const,
  },
  {
    id: "AUD-4408",
    timestamp: "19 Aug 2026, 08:50:33",
    user: "ADM-1002 · S. Gopinath",
    action: "Staff device re-registered",
    ip: "10.24.1.4",
    device: "Chrome · Windows 11",
    location: "Admin Office",
    result: "Success" as const,
  },
  {
    id: "AUD-4407",
    timestamp: "19 Aug 2026, 08:49:19",
    user: "SCT-2423 · Mr. Senthil Kumaravel",
    action: "Login from unregistered device",
    ip: "49.207.x.x",
    device: "Unknown (Web)",
    location: "Salem, TN",
    result: "Blocked" as const,
  },
  {
    id: "AUD-4406",
    timestamp: "18 Aug 2026, 06:12:55",
    user: "ADM-1001 · R. Kalaiselvi",
    action: "Monthly report exported",
    ip: "10.24.1.9",
    device: "Safari · macOS",
    location: "Admin Office",
    result: "Success" as const,
  },
];

export const devices = staffDirectory.map((s, i) => ({
  id: `DEV-${8800 + i}-AX`,
  staff: s.name,
  staffId: s.id,
  model: s.device,
  os: s.device.toLowerCase().includes("iphone") ? "iOS 18.2" : "Android 14",
  registered: `0${(i % 9) + 1} Jul 2026`,
  status: s.deviceStatus,
}));

/** Irregular campus boundary polygon in a 0-100 viewbox coordinate space. */
export const campusPolygon =
  "18,12 46,6 62,14 78,10 92,26 88,48 94,66 74,82 52,88 30,84 14,70 8,44";

export const campusZones = [
  { name: "Sona College of Technology", x: 34, y: 30, w: 26, h: 16 },
  { name: "Sona Incubation Foundation", x: 66, y: 28, w: 18, h: 12 },
  { name: "Sona College of Arts & Science", x: 26, y: 56, w: 24, h: 14 },
  { name: "Thiagarajar Polytechnic College", x: 58, y: 56, w: 26, h: 16 },
];

export const staffMarkers = [
  { id: "SCT-2417", name: "Dr. Priya Ramanathan", x: 44, y: 38, state: "inside" as const },
  { id: "SCT-2418", name: "Prof. Karthik Subramanian", x: 72, y: 33, state: "inside" as const },
  { id: "SCT-2420", name: "Mr. Arun Vijaykumar", x: 36, y: 62, state: "inside" as const },
  { id: "SCT-2421", name: "Dr. Lakshmi Narayanan", x: 68, y: 62, state: "warning" as const },
  { id: "SCT-2422", name: "Ms. Divya Balakrishnan", x: 52, y: 46, state: "inside" as const },
  { id: "SCT-2424", name: "Dr. Anitha Rajendran", x: 78, y: 48, state: "inside" as const },
  { id: "SCT-2419", name: "Dr. Meenakshi Iyer", x: 8, y: 92, state: "outside" as const },
  { id: "SCT-2423", name: "Mr. Senthil Kumaravel", x: 95, y: 88, state: "outside" as const },
];
