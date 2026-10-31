/**
 * Automated Test Suite: CampusAttend Independent Parallel Verification Architecture
 * & ArcFace Biometric Threshold Verification (MAX_COSINE_DISTANCE = 0.45, MIN_MATCH_MARGIN = 0.08)
 *
 * Verifies all 10 combinations required by specification:
 * 1. Wi-Fi PASS, GPS PASS, Face PASS  -> ALLOWED
 * 2. Wi-Fi FAIL, GPS PASS, Face PASS  -> REJECTED
 * 3. Wi-Fi PASS, GPS FAIL, Face PASS  -> REJECTED
 * 4. Wi-Fi PASS, GPS PASS, Face FAIL  -> REJECTED
 * 5. Wi-Fi FAIL, GPS FAIL, Face PASS  -> REJECTED
 * 6. Wi-Fi FAIL, GPS PASS, Face FAIL  -> REJECTED
 * 7. Wi-Fi PASS, GPS FAIL, Face FAIL  -> REJECTED
 * 8. All three FAIL                   -> REJECTED
 * 9. One factor UNAVAILABLE while other two execute successfully -> REJECTED
 * 10. One factor times out while other two complete             -> REJECTED
 *
 * Specific Threshold Tests:
 * 11. Cosine distance exactly 0.45 is ACCEPTED (PASS)
 * 12. Cosine distance > 0.45 (0.4501) is REJECTED (FAIL)
 * 13. Match margin exactly 0.08 is ACCEPTED (PASS)
 * 14. Match margin < 0.08 (0.05) is REJECTED (FAIL)
 * 15. Identity mismatch is REJECTED (FAIL)
 */

import {
  evaluateWifiFactor,
  evaluateGpsFactor,
  evaluateFaceFactor,
  computeParallelDecision,
  runParallelVerification,
  MAX_COSINE_DISTANCE,
  MIN_MATCH_MARGIN,
  type FactorStatus,
  type ParallelVerificationReport,
} from "../src/lib/parallel-verification";
import { REGISTERED_CAMPUS_BSSID } from "../src/lib/wifi-config";
import type { WifiStatus } from "../src/lib/wifi-config";
import type { FaceScanResult } from "../src/components/common/FaceScanDialog";
import type { GeofenceEvaluation } from "../src/lib/geofence/geofence-service";

interface TestResult {
  scenarioNumber: number;
  name: string;
  passed: boolean;
  expectedDecision: "ALLOWED" | "REJECTED";
  actualDecision: "ALLOWED" | "REJECTED" | "PENDING";
  wifiStatus: FactorStatus;
  gpsStatus: FactorStatus;
  faceStatus: FactorStatus;
  notes: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

// Mock builders
const makeWifiPass = (): Partial<WifiStatus> => ({
  authorized: true,
  isSonaWifi: true,
  bssid: REGISTERED_CAMPUS_BSSID,
  ssid: "SONA-WIFI",
  state: "connected",
  network: "SONA",
});

const makeWifiFailMismatch = (): Partial<WifiStatus> => ({
  authorized: false,
  isSonaWifi: false,
  bssid: "AA:BB:CC:DD:EE:FF",
  ssid: "Other-WiFi",
  state: "connected",
  network: "Other",
  errorCode: "UNAUTHORIZED_BSSID",
});

const makeWifiFailMobileData = (): Partial<WifiStatus> => ({
  authorized: false,
  isSonaWifi: false,
  bssid: undefined,
  network: "Mobile Data",
  errorCode: "CELLULAR_DATA",
  state: "connected",
});

const makeWifiUnavailable = (): Partial<WifiStatus> => ({
  authorized: false,
  isSonaWifi: false,
  bssid: undefined,
  errorCode: "PERMISSION_DENIED",
  permissionDenied: true,
});

const makeGpsPass = () => ({
  isInside: true,
  status: "inside",
  accuracy: 8,
  coords: { lat: 11.6802, lng: 78.1218 },
});

const makeGpsFailOutside = () => ({
  isInside: false,
  status: "outside",
  accuracy: 10,
  coords: { lat: 11.6900, lng: 78.1300 },
});

const makeFacePass = (staffCode = "SCT-001", distance = 0.28, margin = 0.12): FaceScanResult => ({
  verified: true,
  staffCode,
  staffId: staffCode,
  staffName: "Dr. Faculty Member",
  distance,
  livenessCompleted: true,
  antiSpoofScore: 0.95,
  margin,
} as any);

const makeFaceFailMismatch = (): FaceScanResult => ({
  verified: true,
  staffCode: "SCT-999", // Different staff
  staffId: "SCT-999",
  staffName: "Unknown Person",
  distance: 0.32,
  livenessCompleted: true,
  antiSpoofScore: 0.92,
});

const makeFaceFailUnrecognized = (): FaceScanResult => ({
  verified: false,
  staffCode: undefined,
  distance: 0.55, // Exceeds 0.45
  livenessCompleted: true,
  antiSpoofScore: 0.88,
});

const makeFaceFailSpoof = (): FaceScanResult => ({
  verified: false,
  antiSpoofScore: 0.42, // Spoof attack
  livenessCompleted: false,
});

async function runTestSuite() {
  console.log("\n================================================================================");
  console.log("CampusAttend – Independent Parallel Verification & Biometric Threshold Test Suite");
  console.log(`Configured Thresholds: MAX_COSINE_DISTANCE = ${MAX_COSINE_DISTANCE}, MIN_MATCH_MARGIN = ${MIN_MATCH_MARGIN}`);
  console.log("================================================================================\n");

  const targetStaff = "SCT-001";

  // Test 1: Wi-Fi PASS, GPS PASS, Face PASS -> ALLOWED
  {
    const wifi = evaluateWifiFactor(makeWifiPass());
    const gps = evaluateGpsFactor(makeGpsPass());
    const face = evaluateFaceFactor(makeFacePass(targetStaff), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "PASS" &&
      gps.status === "PASS" &&
      face.status === "PASS" &&
      decision.decision === "ALLOWED";

    results.push({
      scenarioNumber: 1,
      name: "Wi-Fi PASS, GPS PASS, Face PASS",
      passed,
      expectedDecision: "ALLOWED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "All 3 factors passed -> Attendance ALLOWED",
    });
  }

  // Test 2: Wi-Fi FAIL, GPS PASS, Face PASS -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiFailMismatch());
    const gps = evaluateGpsFactor(makeGpsPass());
    const face = evaluateFaceFactor(makeFacePass(targetStaff), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "FAIL" &&
      gps.status === "PASS" &&
      face.status === "PASS" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 2,
      name: "Wi-Fi FAIL (BSSID Mismatch), GPS PASS, Face PASS",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "Wi-Fi failed, but GPS & Face executed independently -> REJECTED",
    });
  }

  // Test 3: Wi-Fi PASS, GPS FAIL, Face PASS -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiPass());
    const gps = evaluateGpsFactor(makeGpsFailOutside());
    const face = evaluateFaceFactor(makeFacePass(targetStaff), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "PASS" &&
      gps.status === "FAIL" &&
      face.status === "PASS" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 3,
      name: "Wi-Fi PASS, GPS FAIL (Outside Campus), Face PASS",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "GPS outside campus, but Wi-Fi & Face executed independently -> REJECTED",
    });
  }

  // Test 4: Wi-Fi PASS, GPS PASS, Face FAIL -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiPass());
    const gps = evaluateGpsFactor(makeGpsPass());
    const face = evaluateFaceFactor(makeFaceFailUnrecognized(), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "PASS" &&
      gps.status === "PASS" &&
      face.status === "FAIL" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 4,
      name: "Wi-Fi PASS, GPS PASS, Face FAIL (Unrecognized)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "Face unrecognized, but Wi-Fi & GPS executed independently -> REJECTED",
    });
  }

  // Test 5: Wi-Fi FAIL, GPS FAIL, Face PASS -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiFailMismatch());
    const gps = evaluateGpsFactor(makeGpsFailOutside());
    const face = evaluateFaceFactor(makeFacePass(targetStaff), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "FAIL" &&
      gps.status === "FAIL" &&
      face.status === "PASS" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 5,
      name: "Wi-Fi FAIL, GPS FAIL, Face PASS",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "Both Wi-Fi & GPS failed, Face executed independently -> REJECTED",
    });
  }

  // Test 6: Wi-Fi FAIL, GPS PASS, Face FAIL -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiFailMismatch());
    const gps = evaluateGpsFactor(makeGpsPass());
    const face = evaluateFaceFactor(makeFaceFailMismatch(), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "FAIL" &&
      gps.status === "PASS" &&
      face.status === "FAIL" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 6,
      name: "Wi-Fi FAIL, GPS PASS, Face FAIL (Identity Mismatch)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "Wi-Fi & Face failed, GPS executed independently -> REJECTED",
    });
  }

  // Test 7: Wi-Fi PASS, GPS FAIL, Face FAIL -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiPass());
    const gps = evaluateGpsFactor(makeGpsFailOutside());
    const face = evaluateFaceFactor(makeFaceFailSpoof(), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "PASS" &&
      gps.status === "FAIL" &&
      face.status === "FAIL" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 7,
      name: "Wi-Fi PASS, GPS FAIL, Face FAIL (Spoof Detected)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "GPS & Face failed, Wi-Fi executed independently -> REJECTED",
    });
  }

  // Test 8: All three FAIL -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiFailMobileData());
    const gps = evaluateGpsFactor(makeGpsFailOutside());
    const face = evaluateFaceFactor(makeFaceFailUnrecognized(), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "FAIL" &&
      gps.status === "FAIL" &&
      face.status === "FAIL" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 8,
      name: "All Three Factors FAIL",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "All 3 factors failed independently -> REJECTED",
    });
  }

  // Test 9: One factor UNAVAILABLE while other two execute -> REJECTED
  {
    const wifi = evaluateWifiFactor(makeWifiUnavailable());
    const gps = evaluateGpsFactor(makeGpsPass());
    const face = evaluateFaceFactor(makeFacePass(targetStaff), targetStaff);
    const decision = computeParallelDecision(wifi, gps, face);

    const passed =
      wifi.status === "UNAVAILABLE" &&
      gps.status === "PASS" &&
      face.status === "PASS" &&
      decision.decision === "REJECTED";

    results.push({
      scenarioNumber: 9,
      name: "Wi-Fi UNAVAILABLE (Permission Denied), GPS PASS, Face PASS",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: decision.decision,
      wifiStatus: wifi.status,
      gpsStatus: gps.status,
      faceStatus: face.status,
      notes: "Wi-Fi unavailable due to permissions, GPS & Face executed -> REJECTED",
    });
  }

  // Test 10: One factor TIMEOUT while other two complete -> REJECTED
  {
    const report = await runParallelVerification({
      checkWifi: async () => makeWifiPass() as WifiStatus,
      checkGps: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { isInside: true, lat: 11.6802, lng: 78.1218, accuracy: 5 } as GeofenceEvaluation;
      },
      getFaceResult: async () => makeFacePass(targetStaff),
      expectedStaffCode: targetStaff,
      timeoutMs: 100,
    });

    const passed =
      report.wifi.status === "PASS" &&
      report.gps.status === "TIMEOUT" &&
      report.face.status === "PASS" &&
      report.overallDecision === "REJECTED";

    results.push({
      scenarioNumber: 10,
      name: "GPS TIMEOUT, Wi-Fi PASS, Face PASS",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: report.overallDecision,
      wifiStatus: report.wifi.status,
      gpsStatus: report.gps.status,
      faceStatus: report.face.status,
      notes: "GPS timed out, Wi-Fi & Face completed successfully -> REJECTED",
    });
  }

  // =========================================================================
  // Specific Biometric Threshold Tests (Section 2)
  // =========================================================================

  // Test 11: Cosine distance exactly 0.45 is ACCEPTED (PASS)
  {
    const faceAtThreshold = makeFacePass(targetStaff, 0.45, 0.08);
    const face = evaluateFaceFactor(faceAtThreshold, targetStaff);
    const passed = face.status === "PASS";

    results.push({
      scenarioNumber: 11,
      name: "ArcFace Cosine Distance = 0.45 (Boundary PASS)",
      passed,
      expectedDecision: "ALLOWED",
      actualDecision: "ALLOWED",
      wifiStatus: "PASS",
      gpsStatus: "PASS",
      faceStatus: face.status,
      notes: `Distance = 0.45 is within threshold (${MAX_COSINE_DISTANCE}) -> PASS`,
    });
  }

  // Test 12: Cosine distance > 0.45 (e.g. 0.4501) is REJECTED (FAIL)
  {
    const faceOverThreshold = makeFacePass(targetStaff, 0.4501, 0.08);
    const face = evaluateFaceFactor(faceOverThreshold, targetStaff);
    const passed = face.status === "FAIL" && face.label.includes("Distance Exceeded");

    results.push({
      scenarioNumber: 12,
      name: "ArcFace Cosine Distance = 0.4501 (Threshold FAIL)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: "REJECTED",
      wifiStatus: "PASS",
      gpsStatus: "PASS",
      faceStatus: face.status,
      notes: `Distance = 0.4501 exceeds threshold (${MAX_COSINE_DISTANCE}) -> FAIL`,
    });
  }

  // Test 13: Match margin exactly 0.08 is ACCEPTED (PASS)
  {
    const faceAtMargin = makeFacePass(targetStaff, 0.35, 0.08);
    const face = evaluateFaceFactor(faceAtMargin, targetStaff);
    const passed = face.status === "PASS";

    results.push({
      scenarioNumber: 13,
      name: "ArcFace Match Margin = 0.08 (Boundary PASS)",
      passed,
      expectedDecision: "ALLOWED",
      actualDecision: "ALLOWED",
      wifiStatus: "PASS",
      gpsStatus: "PASS",
      faceStatus: face.status,
      notes: `Margin = 0.08 satisfies minimum required margin (${MIN_MATCH_MARGIN}) -> PASS`,
    });
  }

  // Test 14: Match margin < 0.08 (e.g. 0.05) is REJECTED (FAIL)
  {
    const faceBelowMargin = makeFacePass(targetStaff, 0.35, 0.05);
    const face = evaluateFaceFactor(faceBelowMargin, targetStaff);
    const passed = face.status === "FAIL" && face.label.includes("Ambiguous Match Margin");

    results.push({
      scenarioNumber: 14,
      name: "ArcFace Match Margin = 0.05 (Ambiguity FAIL)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: "REJECTED",
      wifiStatus: "PASS",
      gpsStatus: "PASS",
      faceStatus: face.status,
      notes: `Margin = 0.05 below minimum required margin (${MIN_MATCH_MARGIN}) -> FAIL`,
    });
  }

  // Test 15: Face identity mismatch is REJECTED (FAIL)
  {
    const faceMismatch = makeFaceFailMismatch();
    const face = evaluateFaceFactor(faceMismatch, targetStaff);
    const passed = face.status === "FAIL" && face.label.includes("Identity Mismatch");

    results.push({
      scenarioNumber: 15,
      name: "Face Identity Mismatch (Impostor FAIL)",
      passed,
      expectedDecision: "REJECTED",
      actualDecision: "REJECTED",
      wifiStatus: "PASS",
      gpsStatus: "PASS",
      faceStatus: face.status,
      notes: "Recognized staff SCT-999 does not match authenticated SCT-001 -> FAIL",
    });
  }

  // Extra Test 16: Non-blocking Error Exception in Parallel Promise.allSettled
  {
    const report = await runParallelVerification({
      checkWifi: async () => {
        throw new Error("Simulated network interface crashed");
      },
      checkGps: async () => {
        return { isInside: true, lat: 11.6802, lng: 78.1218, accuracy: 8 } as GeofenceEvaluation;
      },
      getFaceResult: async () => makeFacePass(targetStaff),
      expectedStaffCode: targetStaff,
      timeoutMs: 500,
    });

    const passed =
      report.wifi.status === "FAIL" &&
      report.gps.status === "PASS" &&
      report.face.status === "PASS" &&
      report.overallDecision === "REJECTED";

    assert(passed, "Wi-Fi exception must not crash or prevent GPS and Face execution!");
  }

  // Print Summary Table
  console.log(
    "| # | Scenario Name | Wi-Fi | GPS | Face | Decision | Result | Notes |"
  );
  console.log(
    "|---|---------------|-------|-----|------|----------|--------|-------|"
  );

  let allPassed = true;
  for (const r of results) {
    if (!r.passed) allPassed = false;
    const icon = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(
      `| ${String(r.scenarioNumber).padStart(2)} | ${r.name.padEnd(46)} | ${r.wifiStatus.padEnd(8)} | ${r.gpsStatus.padEnd(8)} | ${r.faceStatus.padEnd(8)} | ${r.actualDecision.padEnd(8)} | ${icon} | ${r.notes} |`
    );
  }

  console.log("\n================================================================================");
  if (allPassed) {
    console.log(`🎉 ALL ${results.length} TEST SCENARIOS PASSED SUCCESSFULLY!`);
    console.log(`Independent parallel verification + ArcFace thresholds (0.45 / 0.08) verified.`);
  } else {
    console.error("❌ SOME TEST SCENARIOS FAILED.");
    process.exit(1);
  }
  console.log("================================================================================\n");
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
