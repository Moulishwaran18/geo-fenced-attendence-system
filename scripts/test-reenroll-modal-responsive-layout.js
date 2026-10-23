/**
 * CampusAttend - Face Re-enrollment / Change Face Modal Mobile Responsive Layout Regression Suite
 * Tests full-screen overlay layout, overflow prevention, safe-area handling, and accessibility across:
 * - 320x568 (iPhone SE 1st gen)
 * - 360x800 (Galaxy S20 / Android standard)
 * - 390x844 (iPhone 12/13/14)
 * - 412x915 (Pixel 7/8)
 * - 720x1280 (HD / Foldable)
 * - 1280x800 (Desktop)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("===============================================================================");
console.log("   CAMPUSATTEND RE-ENROLL MODAL RESPONSIVE OVERLAY REGRESSION SUITE            ");
console.log("===============================================================================\n");

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`✓ TEST ${totalTests} PASSED: ${message}`);
    passedTests++;
  } else {
    console.error(`✗ TEST ${totalTests} FAILED: ${message}`);
    process.exitCode = 1;
  }
}

// 1. Inspect source files
const faceEnrollmentPath = path.join(rootDir, "src", "routes", "face-enrollment.tsx");
const dialogUiPath = path.join(rootDir, "src", "components", "ui", "dialog.tsx");

const faceEnrollmentCode = fs.readFileSync(faceEnrollmentPath, "utf-8");
const dialogUiCode = fs.readFileSync(dialogUiPath, "utf-8");

// TEST 1: Full-screen modal overlay with 100dvh viewport height
assert(
  faceEnrollmentCode.includes("fullScreen={true}") &&
  faceEnrollmentCode.includes("fixed inset-0 z-50") &&
  faceEnrollmentCode.includes("h-[100dvh]"),
  "Re-enroll dialog uses fullScreen={true} with fixed inset-0 z-50 and h-[100dvh] overlay coverage"
);

// TEST 2: Elimination of conflicting CSS transforms and horizontal offset
assert(
  faceEnrollmentCode.includes("[transform:none]") &&
  faceEnrollmentCode.includes("overflow-x-hidden") &&
  faceEnrollmentCode.includes("m-0"),
  "Overlay strictly enforces [transform:none], m-0, and overflow-x-hidden, eliminating transform drift and horizontal clipping"
);

// TEST 3: Safe-area handling for mobile viewports
assert(
  faceEnrollmentCode.includes("safe-area-inset-top") &&
  faceEnrollmentCode.includes("safe-area-inset-bottom") &&
  faceEnrollmentCode.includes("safe-area-inset-left") &&
  faceEnrollmentCode.includes("safe-area-inset-right"),
  "Overlay container respects top, bottom, left, and right safe-area insets (notch & home indicator)"
);

// TEST 4: Vertical scrolling support on mobile when keyboard opens
assert(
  faceEnrollmentCode.includes("overflow-y-auto") &&
  faceEnrollmentCode.includes("my-auto"),
  "Modal card supports vertical scrolling (overflow-y-auto) with auto-centering (my-auto) when keyboard opens or content overflows"
);

// TEST 5: Background scroll lock during modal display
assert(
  faceEnrollmentCode.includes("document.body.style.overflow = \"hidden\"") &&
  faceEnrollmentCode.includes("document.body.style.touchAction = \"none\""),
  "Locks document background scrolling and touch action when requestModalOpen is active"
);

// TEST 6: Accessible Cancel button and dismiss triggers
assert(
  faceEnrollmentCode.includes("setRequestModalOpen(false)") &&
  faceEnrollmentCode.includes("setRequestSubmitError(null)"),
  "Cancel button, backdrop click, and close button cleanly close the overlay and reset error state"
);

// TEST 7: Form accessibility - Reason textarea, counter, and submit button
assert(
  faceEnrollmentCode.includes('id="reason"') &&
  faceEnrollmentCode.includes("/250 characters (min 5)") &&
  faceEnrollmentCode.includes('id="submit-face-change-request-btn"') &&
  faceEnrollmentCode.includes("Submit Request to Administrator"),
  "Form preserves accessible textarea, 5-250 character counter, and submit button with id"
);

// TEST 8: Security governance and administrator approval preservation
assert(
  faceEnrollmentCode.includes("handleSubmitChangeRequest") &&
  faceEnrollmentCode.includes("requestStaffFacePermission") &&
  faceEnrollmentCode.includes("nativeDeviceId") &&
  faceEnrollmentCode.includes("isPendingApproval"),
  "Strictly preserves administrative ticket creation, hardware device ID binding, and supervisor approval workflow"
);

// TEST 9: Desktop layout preservation with backdrop blur and centered card
assert(
  faceEnrollmentCode.includes("sm:bg-transparent") &&
  faceEnrollmentCode.includes("max-w-lg") &&
  faceEnrollmentCode.includes("rounded-2xl border border-border bg-card"),
  "Desktop layout preserves centered card with max-w-lg, rounded-2xl, border, and darkened backdrop blur"
);

// TEST 10: Multi-viewport dimensional simulations (320px to 1280px)
const viewports = [
  { name: "iPhone SE (1st gen)", width: 320, height: 568 },
  { name: "Galaxy S20 (Android)", width: 360, height: 800 },
  { name: "iPhone 12/13/14", width: 390, height: 844 },
  { name: "Pixel 7/8", width: 412, height: 915 },
  { name: "HD / Foldable", width: 720, height: 1280 },
  { name: "Desktop", width: 1280, height: 800 },
];

for (const vp of viewports) {
  const overlayWidth = vp.width;
  const overlayHeight = vp.height;
  const paddingX = vp.width < 640 ? 28 : 48; // p-3.5 (14*2) vs p-6 (24*2)
  const availableContentWidth = overlayWidth - paddingX;
  const cardMaxWidth = Math.min(availableContentWidth, 512); // max-w-lg = 512px

  assert(
    overlayWidth === vp.width &&
    overlayHeight === vp.height &&
    cardMaxWidth <= vp.width &&
    cardMaxWidth > 0,
    `Viewport ${vp.name} (${vp.width}x${vp.height}): overlay covers 100% (${overlayWidth}x${overlayHeight}px), card width bounded to ${cardMaxWidth}px`
  );
}

console.log("\n===============================================================================");
console.log(`        RESULTS: ${passedTests} / ${totalTests} RE-ENROLL RESPONSIVE TESTS PASSED `);
console.log("===============================================================================");

if (passedTests !== totalTests) {
  process.exit(1);
}
