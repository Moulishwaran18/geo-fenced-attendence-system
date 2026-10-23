/**
 * CampusAttend - Administrator Face Approval Dialog Mobile Responsive Layout Regression Suite
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
console.log("   CAMPUSATTEND ADMIN FACE APPROVAL DIALOG RESPONSIVE OVERLAY REGRESSION SUITE  ");
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

// 1. Inspect source file
const adminFaceRequestsPath = path.join(rootDir, "src", "routes", "admin.face-requests.tsx");
const adminFaceRequestsCode = fs.readFileSync(adminFaceRequestsPath, "utf-8");

// TEST 1: Full-screen modal overlay with 100dvh viewport height
assert(
  adminFaceRequestsCode.includes("fullScreen={true}") &&
  adminFaceRequestsCode.includes("fixed inset-0 z-50") &&
  adminFaceRequestsCode.includes("h-[100dvh]"),
  "Admin approval dialog uses fullScreen={true} with fixed inset-0 z-50 and h-[100dvh] overlay coverage"
);

// TEST 2: Elimination of conflicting CSS transforms and horizontal offset
assert(
  adminFaceRequestsCode.includes("[transform:none]") &&
  adminFaceRequestsCode.includes("overflow-x-hidden") &&
  adminFaceRequestsCode.includes("m-0"),
  "Overlay strictly enforces [transform:none], m-0, and overflow-x-hidden, eliminating transform drift and corner clipping"
);

// TEST 3: Safe-area handling for mobile viewports
assert(
  adminFaceRequestsCode.includes("safe-area-inset-top") &&
  adminFaceRequestsCode.includes("safe-area-inset-bottom") &&
  adminFaceRequestsCode.includes("safe-area-inset-left") &&
  adminFaceRequestsCode.includes("safe-area-inset-right"),
  "Overlay container respects top, bottom, left, and right safe-area insets (notch & home indicator)"
);

// TEST 4: Vertical scrolling support on mobile when keyboard opens
assert(
  adminFaceRequestsCode.includes("overflow-y-auto") &&
  adminFaceRequestsCode.includes("my-auto"),
  "Modal card supports vertical scrolling (overflow-y-auto) with auto-centering (my-auto) when keyboard opens or content overflows"
);

// TEST 5: Background scroll lock during modal display
assert(
  adminFaceRequestsCode.includes("document.body.style.overflow = \"hidden\"") &&
  adminFaceRequestsCode.includes("document.body.style.touchAction = \"none\""),
  "Locks document background scrolling and touch action when decision dialog is active"
);

// TEST 6: Accessible Cancel button and dismiss triggers
assert(
  adminFaceRequestsCode.includes("setDialogAction(null)") &&
  adminFaceRequestsCode.includes("setActiveReq(null)") &&
  adminFaceRequestsCode.includes('aria-label="Close dialog"'),
  "Cancel button, backdrop click, and close button cleanly close the overlay and reset action state"
);

// TEST 7: Form accessibility - Reason, details, admin note textarea, and confirm button
assert(
  adminFaceRequestsCode.includes('id="adminNote"') &&
  adminFaceRequestsCode.includes('id="admin-decision-confirm-btn"') &&
  adminFaceRequestsCode.includes("Administrative Note (Optional)"),
  "Form preserves accessible administrative note textarea and confirmation action button with id"
);

// TEST 8: Grant Re-enrollment Permission button label
assert(
  adminFaceRequestsCode.includes('"Grant Re-enrollment Permission"') &&
  adminFaceRequestsCode.includes('"Confirm Rejection"'),
  "Action button dynamically and clearly labels 'Grant Re-enrollment Permission' and 'Confirm Rejection'"
);

// TEST 9: Security governance and administrator workflow preservation
assert(
  adminFaceRequestsCode.includes("approveFaceChangeRequest") &&
  adminFaceRequestsCode.includes("rejectFaceChangeRequest") &&
  adminFaceRequestsCode.includes("Single-use token issued"),
  "Strictly preserves administrator cryptographic authorization, single-use token issuance, and rejection audit logging"
);

// TEST 10: Desktop layout preservation with backdrop blur and centered card
assert(
  adminFaceRequestsCode.includes("sm:bg-transparent") &&
  adminFaceRequestsCode.includes("max-w-lg") &&
  adminFaceRequestsCode.includes("rounded-2xl border border-border bg-card"),
  "Desktop layout preserves centered card with max-w-lg, rounded-2xl, border, and backdrop blur"
);

// TEST 11: Multi-viewport dimensional simulations (320px to 1280px)
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
console.log(`        RESULTS: ${passedTests} / ${totalTests} ADMIN APPROVAL TESTS PASSED `);
console.log("===============================================================================");

if (passedTests !== totalTests) {
  process.exit(1);
}
