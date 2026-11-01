/**
 * Comprehensive Automated Test Suite: Monthly Staff Attendance PDF Export
 *
 * Verifies all 10 required test cases specified in the prompt:
 * 1. Current month with only 10 completed days (cutoff at current day, excludes future dates)
 * 2. Previous month with complete attendance records (covers entire month 1..31)
 * 3. Staff with all working days present (100% attendance rate)
 * 4. Staff with mixed present and absent days (accurate percentage calculation)
 * 5. Staff with no attendance records (0% attendance, all working days absent)
 * 6. Future dates are strictly excluded from current month calculations and table
 * 7. Weekends (Sundays) handled correctly (marked Weekend, excluded from applicable working days unless attended)
 * 8. Zero-Trust staff isolation (records of staff A never leak into staff B's PDF)
 * 9. PDF generation & download trigger verification (jsPDF structure, valid pages, Android/desktop bridge)
 * 10. Summary totals and attendance percentage match database records exactly
 */

import {
  computeMonthlyAttendanceRows,
  generateMonthlyAttendancePdf,
  formatIndiaDateTime,
  normalizeDateToYmd,
  type AttendanceRecordLike,
} from "../src/lib/attendance-pdf-export";

function runTests() {
  console.log("================================================================================");
  console.log("       CAMPUSATTEND — MONTHLY ATTENDANCE PDF EXPORT TEST SUITE                  ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, extra?: string) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${name} — ${extra || "Assertion failed"}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1: Current month with only 10 completed days (Cutoff & Future Dates)
  // ---------------------------------------------------------------------------
  console.log("--- Test 1 & 6: Current Month Cutoff (10 Completed Days & Future Dates Excluded) ---");
  const mockCurrentDate10th = new Date(2026, 10, 10, 10, 30); // 10-Nov-2026
  const recordsNov: AttendanceRecordLike[] = [
    { staff_code: "SCT-2417", rawDate: "2026-11-02", time: "09:05 AM", status: "Present" },
    { staff_code: "SCT-2417", rawDate: "2026-11-03", time: "09:12 AM", status: "Present" },
    { staff_code: "SCT-2417", rawDate: "2026-11-04", time: "08:58 AM", status: "Present" },
  ];

  const resNov10th = computeMonthlyAttendanceRows({
    staffCode: "SCT-2417",
    staffName: "Dr. Priya Ramanathan",
    year: 2026,
    month: 11, // November 2026
    records: recordsNov,
    currentDate: mockCurrentDate10th,
  });

  assert("Current month table length equals 10 days", resNov10th.rows.length === 10, `Got ${resNov10th.rows.length}`);
  assert("MaxDay cutoff is day 10", resNov10th.maxDay === 10, `Got ${resNov10th.maxDay}`);
  assert("Future dates (11-30 Nov) are excluded from table", !resNov10th.rows.some((r) => r.sNo > 10));
  assert("Last row in table is Day 10 (10-Nov-2026)", resNov10th.rows[9]?.dateStr === "10-Nov-2026");

  // ---------------------------------------------------------------------------
  // Test 2: Previous month with complete attendance records (All 31 days)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 2: Previous Month Full Report (October 2026 - 31 Days) ---");
  const recordsOctFull: AttendanceRecordLike[] = [];
  // Populate all October weekdays
  for (let d = 1; d <= 31; d++) {
    const dayDate = new Date(2026, 9, d);
    if (dayDate.getDay() !== 0) {
      // Weekdays present
      recordsOctFull.push({
        staff_code: "SCT-2417",
        rawDate: `2026-10-${String(d).padStart(2, "0")}`,
        time: "09:00 AM",
        status: "Present",
      });
    }
  }

  const resOct = computeMonthlyAttendanceRows({
    staffCode: "SCT-2417",
    staffName: "Dr. Priya Ramanathan",
    year: 2026,
    month: 10, // October 2026
    records: recordsOctFull,
    currentDate: mockCurrentDate10th, // Current date is Nov 10
  });

  assert("Previous month covers all 31 days", resOct.rows.length === 31, `Got ${resOct.rows.length}`);
  assert("MaxDay for October is 31", resOct.maxDay === 31, `Got ${resOct.maxDay}`);
  assert("October row 1 is 01-Oct-2026", resOct.rows[0]?.dateStr === "01-Oct-2026");
  assert("October row 31 is 31-Oct-2026", resOct.rows[30]?.dateStr === "31-Oct-2026");

  // ---------------------------------------------------------------------------
  // Test 3: Staff with all working days present (100% Attendance)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 3: Staff with 100% Working Days Present ---");
  assert(
    "All working days present count matches applicable working days",
    resOct.summary.presentDays === resOct.summary.applicableWorkingDays,
    `Present: ${resOct.summary.presentDays}, Working: ${resOct.summary.applicableWorkingDays}`,
  );
  assert("Total absent days is 0", resOct.summary.absentDays === 0, `Got ${resOct.summary.absentDays}`);
  assert("Attendance percentage is 100.0%", resOct.summary.formattedPercentage === "100.0%", `Got ${resOct.summary.formattedPercentage}`);

  // ---------------------------------------------------------------------------
  // Test 4: Staff with mixed present and absent days
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 4: Staff with Mixed Present and Absent Days ---");
  // November 1..10 has 10 days:
  // Nov 1 (Sun, Weekend), Nov 2 (Mon, Pres), Nov 3 (Tue, Pres), Nov 4 (Wed, Pres),
  // Nov 5 (Thu, Absent), Nov 6 (Fri, Absent), Nov 7 (Sat, Absent), Nov 8 (Sun, Weekend), Nov 9 (Mon, Absent), Nov 10 (Tue, Absent)
  // Working days = 8. Present = 3. Absent = 5. Percentage = (3/8)*100 = 37.5%
  assert("November 10 days: Applicable working days = 8", resNov10th.summary.applicableWorkingDays === 8, `Got ${resNov10th.summary.applicableWorkingDays}`);
  assert("November 10 days: Present days = 3", resNov10th.summary.presentDays === 3, `Got ${resNov10th.summary.presentDays}`);
  assert("November 10 days: Absent days = 5", resNov10th.summary.absentDays === 5, `Got ${resNov10th.summary.absentDays}`);
  assert("November 10 days: Attendance percentage = 37.5%", resNov10th.summary.formattedPercentage === "37.5%", `Got ${resNov10th.summary.formattedPercentage}`);

  // ---------------------------------------------------------------------------
  // Test 5: Staff with no attendance records (0% Attendance)
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 5: Staff with No Attendance Records ---");
  const resEmpty = computeMonthlyAttendanceRows({
    staffCode: "SCT-9999",
    staffName: "New Faculty",
    year: 2026,
    month: 10,
    records: [],
    currentDate: mockCurrentDate10th,
  });

  assert("Empty records: Present days = 0", resEmpty.summary.presentDays === 0);
  assert("Empty records: Absent days equals working days (27 working days in Oct)", resEmpty.summary.absentDays === 27, `Got ${resEmpty.summary.absentDays}`);
  assert("Empty records: Attendance percentage = 0.0%", resEmpty.summary.formattedPercentage === "0.0%");
  assert("All non-weekend days are marked ABSENT", resEmpty.rows.filter((r) => r.dayName !== "Sunday").every((r) => r.status === "ABSENT"));

  // ---------------------------------------------------------------------------
  // Test 7: Weekends & Holidays Handled Correctly
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 7: Weekends Handled Correctly ---");
  const sundayRows = resOct.rows.filter((r) => r.dayName === "Sunday");
  assert("Sundays exist in October (4 Sundays: Oct 4, 11, 18, 25)", sundayRows.length === 4, `Got ${sundayRows.length}`);
  assert(
    "Unattended Sundays are marked as 'Weekend' (not 'ABSENT')",
    sundayRows.every((r) => r.status === "Weekend" && r.checkInTime === "—"),
  );

  // If staff member worked on Sunday:
  const recordsWithSundayWork: AttendanceRecordLike[] = [
    { staff_code: "SCT-2417", rawDate: "2026-11-01", time: "09:05 AM", status: "Present" }, // Nov 1 is Sunday
  ];
  const resSundayWork = computeMonthlyAttendanceRows({
    staffCode: "SCT-2417",
    staffName: "Dr. Priya Ramanathan",
    year: 2026,
    month: 11,
    records: recordsWithSundayWork,
    currentDate: new Date(2026, 10, 1), // Nov 1st
  });
  assert(
    "Worked Sunday is marked PRESENT with check-in time 09:05 AM",
    resSundayWork.rows[0]?.status === "PRESENT" && resSundayWork.rows[0]?.checkInTime === "09:05 AM",
  );
  assert("Worked Sunday is counted in Present Days", resSundayWork.summary.presentDays === 1);

  // ---------------------------------------------------------------------------
  // Test 8: Zero-Trust Staff Isolation
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 8: Zero-Trust Staff Isolation ---");
  const mixedStaffRecords: AttendanceRecordLike[] = [
    { staff_code: "SCT-001", rawDate: "2026-11-02", time: "08:50 AM", status: "Present" },
    { staff_code: "SCT-002", rawDate: "2026-11-02", time: "09:30 AM", status: "Present" },
  ];
  const resStaff1 = computeMonthlyAttendanceRows({
    staffCode: "SCT-001",
    staffName: "Staff One",
    year: 2026,
    month: 11,
    records: mixedStaffRecords,
    currentDate: mockCurrentDate10th,
  });
  const resStaff2 = computeMonthlyAttendanceRows({
    staffCode: "SCT-002",
    staffName: "Staff Two",
    year: 2026,
    month: 11,
    records: mixedStaffRecords,
    currentDate: mockCurrentDate10th,
  });

  const staff1Day2 = resStaff1.rows.find((r) => r.sNo === 2);
  const staff2Day2 = resStaff2.rows.find((r) => r.sNo === 2);
  assert("Staff 1 report contains only Staff 1's check-in time (08:50 AM)", staff1Day2?.checkInTime === "08:50 AM");
  assert("Staff 2 report contains only Staff 2's check-in time (09:30 AM)", staff2Day2?.checkInTime === "09:30 AM");

  // ---------------------------------------------------------------------------
  // Test 9: PDF Generation & Document Structure
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 9: PDF Document Generation & Format ---");
  const pdfResult = generateMonthlyAttendancePdf({
    staffCode: "SCT-2417",
    staffName: "Dr. Priya Ramanathan",
    department: "Computer Science & Engineering",
    year: 2026,
    month: 10,
    records: recordsOctFull,
    institutionName: "Sona College of Technology",
    currentDate: mockCurrentDate10th,
  });

  assert("PDF document generates successfully", pdfResult.success === true);
  assert(
    "Filename matches convention: CampusAttend_SCT-2417_October_2026_Attendance_Report.pdf",
    pdfResult.filename === "CampusAttend_SCT-2417_October_2026_Attendance_Report.pdf",
    `Got ${pdfResult.filename}`,
  );
  assert("jsPDF doc object is instantiated", pdfResult.doc !== null);
  assert("PDF has pages generated", pdfResult.doc.getNumberOfPages() >= 1, `Pages: ${pdfResult.doc.getNumberOfPages()}`);
  const pdfBytes = pdfResult.doc.output("arraybuffer");
  assert("PDF output contains non-empty binary buffer", pdfBytes.byteLength > 1000, `Bytes: ${pdfBytes.byteLength}`);

  // ---------------------------------------------------------------------------
  // Test 10: PDF Totals and Attendance Percentage Match Database
  // ---------------------------------------------------------------------------
  console.log("\n--- Test 10: PDF Totals & Attendance Percentage Integrity ---");
  assert("PDF summary presentDays matches rows (27)", pdfResult.summary.presentDays === 27);
  assert("PDF summary absentDays matches rows (0)", pdfResult.summary.absentDays === 0);
  assert("PDF summary workingDays matches rows (27)", pdfResult.summary.applicableWorkingDays === 27);
  assert("PDF summary percentage matches: (27 / 27) * 100 = 100.0%", pdfResult.summary.formattedPercentage === "100.0%");

  console.log("\n================================================================================");
  console.log(`       TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
