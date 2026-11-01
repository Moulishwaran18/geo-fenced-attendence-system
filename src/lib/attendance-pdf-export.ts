/**
 * CampusAttend - Authoritative Monthly Staff Attendance PDF Export Engine
 *
 * Implements:
 * - A4 printable PDF generation with jsPDF & jsPDF-AutoTable
 * - Official Header: CampusAttend branding, Sona College of Technology, Staff metadata, Selected Month/Year, IST Timestamp
 * - Daily Attendance Table: S.No, Date, Day, Attendance Status, Check-in Time
 *   * PRESENT: Green formatting with actual check-in time
 *   * ABSENT: Red formatting with '—'
 *   * Weekend: Muted formatting with '—', excluded from applicable working days
 *   * Future Dates: Strictly excluded from current month's table and calculations
 * - Monthly Summary: Applicable Working Days, Present Days, Absent Days, Attendance Percentage
 * - Automatic Download: Desktop browser trigger and native Android APK bridge download
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface AttendanceRecordLike {
  id?: string;
  staff_code?: string;
  staff_name?: string;
  department?: string;
  date?: string; // e.g. "01-Nov-2026" or "2026-11-01" or "01 Nov 2026"
  rawDate?: string; // e.g. "2026-11-01"
  day?: string; // e.g. "Sunday"
  time?: string; // e.g. "09:05 AM"
  status?: string; // "Present" | "Late" | "Absent"
  created_at?: string;
}

export interface MonthlyPdfOptions {
  staffCode: string;
  staffName: string;
  department?: string;
  designation?: string;
  year: number;
  month: number; // 1 = January, 12 = December
  records: AttendanceRecordLike[];
  institutionName?: string;
  currentDate?: Date;
}

export interface DailyRowData {
  sNo: number;
  dateStr: string;
  dayName: string;
  status: "PRESENT" | "ABSENT" | "Weekend";
  checkInTime: string;
  isWorkingDay: boolean;
}

export interface MonthlyAttendanceSummary {
  applicableWorkingDays: number;
  presentDays: number;
  absentDays: number;
  attendancePercentage: number;
  formattedPercentage: string;
}

export interface MonthlyPdfResult {
  success: boolean;
  filename: string;
  summary: MonthlyAttendanceSummary;
  doc: jsPDF;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Format a Date object to India Standard Time (IST, UTC+5:30) string.
 */
export function formatIndiaDateTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date) + " IST";
  } catch {
    return date.toLocaleString("en-IN") + " IST";
  }
}

/**
 * Normalizes any date string or timestamp into YYYY-MM-DD
 */
export function normalizeDateToYmd(dateStr?: string, timestamp?: string): string {
  const target = (dateStr || timestamp || "").trim();
  if (!target) return "";

  // Already YYYY-MM-DD
  const ymdMatch = target.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }

  // DD-MMM-YYYY or DD MMM YYYY (e.g. "01-Nov-2026" or "1 Nov 2026")
  const dmyMatch = target.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const day = dmyMatch[1].padStart(2, "0");
    const mIdx = SHORT_MONTH_NAMES.findIndex(
      (m) => m.toLowerCase() === dmyMatch[2]!.toLowerCase(),
    );
    if (mIdx !== -1) {
      const month = String(mIdx + 1).padStart(2, "0");
      return `${dmyMatch[3]}-${month}-${day}`;
    }
  }

  try {
    const d = new Date(target);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  } catch {}

  return "";
}

/**
 * Computes the daily rows and statistical summary for the selected staff member, month, and year.
 */
export function computeMonthlyAttendanceRows(
  options: MonthlyPdfOptions,
): { rows: DailyRowData[]; summary: MonthlyAttendanceSummary; maxDay: number } {
  const { year, month, records, staffCode, currentDate = new Date() } = options;
  const canonicalStaffCode = staffCode.trim().toUpperCase();

  // Index actual database attendance records by YYYY-MM-DD
  const recordMap = new Map<string, AttendanceRecordLike>();
  for (const rec of records) {
    const recStaff = (rec.staff_code || "").trim().toUpperCase();
    if (recStaff && recStaff !== canonicalStaffCode) {
      continue; // Never include another staff member's records
    }
    const ymd = normalizeDateToYmd(rec.rawDate || rec.date, rec.created_at);
    if (ymd) {
      recordMap.set(ymd, rec);
    }
  }

  // Get current date components in India Standard Time
  const now = currentDate;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentDay = now.getDate();

  // Total days in the selected month
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  // Determine cutoff day:
  // - If selected month is current month: cutoff at today's day (exclude future dates)
  // - If selected month is past month: include entire month (1..totalDaysInMonth)
  // - If selected month is in future: 0 days
  let maxDay = totalDaysInMonth;
  if (year > currentYear || (year === currentYear && month > currentMonth)) {
    maxDay = 0; // Future month
  } else if (year === currentYear && month === currentMonth) {
    maxDay = Math.min(totalDaysInMonth, currentDay); // Current month up to today
  }

  const rows: DailyRowData[] = [];
  let applicableWorkingDays = 0;
  let presentDays = 0;
  let absentDays = 0;

  for (let day = 1; day <= maxDay; day++) {
    const d = new Date(year, month - 1, day);
    const dayOfWeek = d.getDay(); // 0 = Sunday
    const dayName = WEEKDAY_NAMES[dayOfWeek] || "Day";
    const isSunday = dayOfWeek === 0;

    const dayStr = String(day).padStart(2, "0");
    const monthStr = String(month).padStart(2, "0");
    const isoDate = `${year}-${monthStr}-${dayStr}`;
    const shortMonth = SHORT_MONTH_NAMES[month - 1] || "Mon";
    const displayDate = `${dayStr}-${shortMonth}-${year}`;

    const matchingRecord = recordMap.get(isoDate);

    if (matchingRecord) {
      // Staff has an actual recorded attendance
      const status: "PRESENT" = "PRESENT";
      const checkInTime = matchingRecord.time || "09:00 AM";

      presentDays++;
      applicableWorkingDays++; // Staff attended (even if weekend, counted as worked/applicable)

      rows.push({
        sNo: day,
        dateStr: displayDate,
        dayName,
        status,
        checkInTime,
        isWorkingDay: true,
      });
    } else {
      // No attendance record found
      if (isSunday) {
        // Weekend: Not counted as absent, not an applicable working day
        rows.push({
          sNo: day,
          dateStr: displayDate,
          dayName,
          status: "Weekend",
          checkInTime: "—",
          isWorkingDay: false,
        });
      } else {
        // Applicable working day without attendance record -> ABSENT
        applicableWorkingDays++;
        absentDays++;

        rows.push({
          sNo: day,
          dateStr: displayDate,
          dayName,
          status: "ABSENT",
          checkInTime: "—",
          isWorkingDay: true,
        });
      }
    }
  }

  const attendancePercentage =
    applicableWorkingDays > 0 ? (presentDays / applicableWorkingDays) * 100 : 0;

  const summary: MonthlyAttendanceSummary = {
    applicableWorkingDays,
    presentDays,
    absentDays,
    attendancePercentage: Number(attendancePercentage.toFixed(2)),
    formattedPercentage: `${attendancePercentage.toFixed(1)}%`,
  };

  return { rows, summary, maxDay };
}

/**
 * Generates the authoritative A4 Monthly Staff Attendance PDF document.
 */
export function generateMonthlyAttendancePdf(options: MonthlyPdfOptions): MonthlyPdfResult {
  const {
    staffCode,
    staffName,
    department = "Computer Science & Engineering",
    year,
    month,
    institutionName = "Sona College of Technology",
    currentDate = new Date(),
  } = options;

  const monthName = MONTH_NAMES[month - 1];
  const filename = `CampusAttend_${staffCode.replace(/[^a-zA-Z0-9_-]/g, "_")}_${monthName}_${year}_Attendance_Report.pdf`;

  const { rows, summary, maxDay } = computeMonthlyAttendanceRows(options);

  // Initialize jsPDF A4 portrait
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4", // 210 x 297 mm
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 14;
  const contentWidth = pageWidth - margin * 2; // 182mm

  // ---------------------------------------------------------------------------
  // 1. Top Decorative Brand Banner
  // ---------------------------------------------------------------------------
  // Primary Navy Banner (#1E3A8A)
  doc.setFillColor(30, 58, 138);
  doc.rect(0, 0, pageWidth, 28, "F");

  // Accent Bottom Stripe (#2563EB)
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 28, pageWidth, 2.5, "F");

  // Brand Name & Tagline
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("CampusAttend", margin, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(224, 231, 255);
  doc.text("Authoritative Biometric & Geofenced Presence System", margin, 20);

  // Institution Name (Right-aligned in banner)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(institutionName, pageWidth - margin, 14, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(224, 231, 255);
  doc.text("Autonomous Institution · Salem, Tamil Nadu", pageWidth - margin, 20, {
    align: "right",
  });

  // ---------------------------------------------------------------------------
  // 2. Document Title
  // ---------------------------------------------------------------------------
  let currentY = 38;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42); // Slate-900
  doc.text("MONTHLY ATTENDANCE REPORT", pageWidth / 2, currentY, { align: "center" });

  // Underline
  currentY += 2;
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.8);
  doc.line(pageWidth / 2 - 38, currentY, pageWidth / 2 + 38, currentY);

  currentY += 6;

  // ---------------------------------------------------------------------------
  // 3. Staff & Report Metadata Box
  // ---------------------------------------------------------------------------
  const boxX = margin;
  const boxY = currentY;
  const boxHeight = 26;

  // Box background & border
  doc.setFillColor(248, 250, 252); // Slate-50
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, boxY, contentWidth, boxHeight, 2, 2, "FD");

  // Column 1 (Left): Staff Information
  const col1X = boxX + 5;
  let textY = boxY + 6.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // Slate-600
  doc.text("Staff Name:", col1X, textY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(staffName, col1X + 22, textY);

  textY += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Staff ID:", col1X, textY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 58, 138); // Navy
  doc.text(staffCode, col1X + 22, textY);

  textY += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Department:", col1X, textY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(department, col1X + 22, textY);

  // Column 2 (Right): Report Period & Generation
  const col2X = boxX + contentWidth / 2 + 8;
  textY = boxY + 6.5;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Report Period:", col2X, textY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(`${monthName} ${year}`, col2X + 24, textY);

  textY += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Generated On:", col2X, textY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(15, 23, 42);
  doc.text(formatIndiaDateTime(currentDate), col2X + 24, textY);

  textY += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(71, 85, 105);
  doc.text("Verification:", col2X, textY);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(21, 128, 61); // Green
  doc.text("ArcFace Biometric + Campus Geofence", col2X + 24, textY);

  currentY = boxY + boxHeight + 6;

  // ---------------------------------------------------------------------------
  // 4. Daily Attendance Table
  // ---------------------------------------------------------------------------
  const tableData = rows.map((r) => [
    r.sNo.toString(),
    r.dateStr,
    r.dayName,
    r.status,
    r.checkInTime,
  ]);

  if (tableData.length === 0) {
    // Empty state message
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "No attendance records available for the selected month.",
      pageWidth / 2,
      currentY + 15,
      { align: "center" },
    );
    currentY += 25;
  } else {
    autoTable(doc, {
      startY: currentY,
      margin: { left: margin, right: margin, bottom: 20 },
      head: [["S.No", "Date", "Day", "Attendance Status", "Check-in Time"]],
      body: tableData,
      theme: "grid",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      headStyles: {
        fillColor: [30, 58, 138], // #1E3A8A Navy
        textColor: [255, 255, 255],
        fontSize: 9,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        cellPadding: 2.8,
      },
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 2.4,
        lineColor: [226, 232, 240], // #E2E8F0
        lineWidth: 0.2,
        valign: "middle",
      },
      columnStyles: {
        0: { cellWidth: 16, halign: "center" },
        1: { cellWidth: 36, halign: "center" },
        2: { cellWidth: 38, halign: "left" },
        3: { cellWidth: 46, halign: "center" },
        4: { cellWidth: 46, halign: "center" },
      },
      didParseCell: (data) => {
        // Attendance Status Column Formatting
        if (data.section === "body" && data.column.index === 3) {
          const val = String(data.cell.raw);
          if (val === "PRESENT") {
            data.cell.styles.textColor = [21, 128, 61]; // #15803D (Green)
            data.cell.styles.fillColor = [240, 253, 244]; // #F0FDF4 (Light Green)
            data.cell.styles.fontStyle = "bold";
          } else if (val === "ABSENT") {
            data.cell.styles.textColor = [185, 28, 28]; // #B91C1C (Red)
            data.cell.styles.fillColor = [254, 242, 242]; // #FEF2F2 (Light Red)
            data.cell.styles.fontStyle = "bold";
          } else if (val === "Weekend") {
            data.cell.styles.textColor = [107, 114, 128]; // #6B7280 (Grey)
            data.cell.styles.fillColor = [249, 250, 251]; // #F9FAFB
            data.cell.styles.fontStyle = "italic";
          }
        }
      },
      didDrawPage: (data) => {
        // Running Header on subsequent pages
        if (data.pageNumber > 1) {
          doc.setFillColor(30, 58, 138);
          doc.rect(0, 0, pageWidth, 12, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(255, 255, 255);
          doc.text(
            `CampusAttend · ${institutionName} · Monthly Attendance Report (${staffName} · ${monthName} ${year})`,
            margin,
            8,
          );
        }
      },
    });

    // Capture the Y position after the table finishes
    const lastAutoTable = (doc as any).lastAutoTable;
    if (lastAutoTable && lastAutoTable.finalY) {
      currentY = lastAutoTable.finalY + 8;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Monthly Summary Section
  // ---------------------------------------------------------------------------
  // If remaining space on the page is less than 55mm, add a new page for clean presentation
  if (currentY + 55 > pageHeight - 20) {
    doc.addPage();
    currentY = 22;
  }

  const summaryBoxY = currentY;
  const summaryBoxHeight = 30;

  // Background container
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, summaryBoxY, contentWidth, summaryBoxHeight, 2, 2, "FD");

  // Summary Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 138);
  doc.text("MONTHLY ATTENDANCE SUMMARY", margin + 5, summaryBoxY + 6.5);

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin + 5, summaryBoxY + 8.5, margin + contentWidth - 5, summaryBoxY + 8.5);

  // 4 Metrics Grid (Equally divided)
  const tileWidth = (contentWidth - 10) / 4;
  const tileY = summaryBoxY + 11;

  const metrics = [
    {
      label: "Working Days",
      value: summary.applicableWorkingDays.toString(),
      color: [15, 23, 42],
    },
    {
      label: "Present Days",
      value: summary.presentDays.toString(),
      color: [21, 128, 61], // Green
    },
    {
      label: "Absent Days",
      value: summary.absentDays.toString(),
      color: [185, 28, 28], // Red
    },
    {
      label: "Attendance %",
      value: summary.formattedPercentage,
      color: [30, 58, 138], // Navy
    },
  ];

  metrics.forEach((m, idx) => {
    const tileX = margin + 5 + idx * tileWidth;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(m.label, tileX + tileWidth / 2, tileY + 4, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const [cR = 15, cG = 23, cB = 42] = m.color;
    doc.setTextColor(cR, cG, cB);
    doc.text(m.value, tileX + tileWidth / 2, tileY + 12, { align: "center" });

    // Vertical separator between tiles
    if (idx < 3) {
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(tileX + tileWidth, tileY + 2, tileX + tileWidth, tileY + 14);
    }
  });

  currentY = summaryBoxY + summaryBoxHeight + 14;

  // ---------------------------------------------------------------------------
  // 6. Institutional Signature / Verification Block
  // ---------------------------------------------------------------------------
  if (currentY + 24 > pageHeight - 20) {
    doc.addPage();
    currentY = 22;
  }

  const sigY = currentY + 12;
  doc.setDrawColor(148, 163, 184); // Slate-400
  doc.setLineWidth(0.4);

  // Staff signature line
  doc.line(margin + 10, sigY, margin + 65, sigY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("Staff Member Signature", margin + 37.5, sigY + 4, { align: "center" });

  // Authorised signatory line
  doc.line(pageWidth - margin - 65, sigY, pageWidth - margin - 10, sigY);
  doc.text("Authorised Signatory / Principal", pageWidth - margin - 37.5, sigY + 4, {
    align: "center",
  });

  // Computer generated notice
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "This is an official computer-generated document verified by the CampusAttend Presence Management System. No physical seal required.",
    pageWidth / 2,
    sigY + 11,
    { align: "center" },
  );

  // ---------------------------------------------------------------------------
  // 7. Running Page Numbers on All Pages
  // ---------------------------------------------------------------------------
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Bottom horizontal line
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);

    // Left footer
    doc.text(
      `CampusAttend · ${institutionName} · Monthly Attendance Report`,
      margin,
      pageHeight - 7,
    );

    // Right footer (Page X of Y)
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    });
  }

  return {
    success: true,
    filename,
    summary,
    doc,
  };
}

/**
 * Executes PDF download on both native Android APK (via AndroidWifiBridge / AndroidBiometricBridge)
 * and desktop/mobile web browsers.
 */
export async function downloadMonthlyAttendancePdf(
  options: MonthlyPdfOptions,
): Promise<{ success: boolean; filename: string; summary: MonthlyAttendanceSummary }> {
  const result = generateMonthlyAttendancePdf(options);
  const { doc, filename, summary } = result;

  try {
    // Check if running inside native Android APK
    const anyWindow = typeof window !== "undefined" ? (window as any) : null;
    const nativeBridge = anyWindow?.AndroidWifiBridge || anyWindow?.AndroidBiometricBridge;

    if (nativeBridge && typeof nativeBridge.downloadPdf === "function") {
      const dataUri = doc.output("datauristring");
      const base64Data = dataUri.split(",")[1] || dataUri;
      const nativeOk = nativeBridge.downloadPdf(base64Data, filename);
      if (nativeOk) {
        return { success: true, filename, summary };
      }
    }

    // Standard Browser Fallback
    doc.save(filename);
    return { success: true, filename, summary };
  } catch (err) {
    console.warn("[downloadMonthlyAttendancePdf] Native trigger fallback, trying doc.save:", err);
    try {
      doc.save(filename);
      return { success: true, filename, summary };
    } catch (saveErr: any) {
      throw new Error(`Failed to download PDF: ${saveErr?.message || "Unknown error"}`);
    }
  }
}
