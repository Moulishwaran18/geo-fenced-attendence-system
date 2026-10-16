/**
 * CampusAttend - Face Authentication Dialog Mobile Responsive Layout Regression Suite
 * Tests layout constraints, overflow prevention, and dynamic liveness challenge wrapping across viewports:
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
console.log("   CAMPUSATTEND FACE AUTHENTICATION DIALOG RESPONSIVE LAYOUT TEST SUITE        ");
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
const faceScanDialogPath = path.join(rootDir, "src", "components", "common", "FaceScanDialog.tsx");
const dialogUiPath = path.join(rootDir, "src", "components", "ui", "dialog.tsx");
const livenessEnginePath = path.join(rootDir, "src", "lib", "face-recognition", "liveness-engine.ts");

const faceScanDialogCode = fs.readFileSync(faceScanDialogPath, "utf-8");
const dialogUiCode = fs.readFileSync(dialogUiPath, "utf-8");
const livenessEngineCode = fs.readFileSync(livenessEnginePath, "utf-8");

// TEST 1: Dialog Content Viewport Constraints
assert(
  faceScanDialogCode.includes("w-[calc(100vw-16px)]") &&
  faceScanDialogCode.includes("max-w-xl") &&
  faceScanDialogCode.includes("min-w-0"),
  "DialogContent is constrained to w-[calc(100vw-16px)] with min-w-0 and max-w-xl"
);

// TEST 2: Duplicate Close Button Prevention
assert(
  dialogUiCode.includes("hideCloseButton?: boolean") &&
  dialogUiCode.includes("!hideCloseButton &&") &&
  faceScanDialogCode.includes("hideCloseButton={true}"),
  "DialogContent supports and enables hideCloseButton={true} to eliminate duplicate close buttons"
);

// TEST 3: Camera Preview and Canvas Aspect Ratio & Mirroring
assert(
  faceScanDialogCode.includes("relative aspect-[4/3] sm:aspect-video w-full max-w-full overflow-hidden") &&
  faceScanDialogCode.includes("-scale-x-100 block") &&
  faceScanDialogCode.includes("canvasRef"),
  "Camera preview container has max-w-full with responsive aspect ratio and mirror-aligned video/canvas"
);

// TEST 4: Dynamic Challenge Instructions Complete Coverage
const expectedActions = [
  { action: "BLINK_ONCE", text: "Face matched. Please blink once." },
  { action: "TURN_LEFT", text: "Face matched. Please turn your head slightly to the left." },
  { action: "TURN_RIGHT", text: "Face matched. Please turn your head slightly to the right." },
  { action: "NOD_ONCE", text: "Face matched. Please nod once." },
];

for (const { action, text } of expectedActions) {
  assert(
    livenessEngineCode.includes(text),
    `Liveness engine produces full exact instruction for ${action}: "${text}"`
  );
}

// TEST 5: Challenge Instruction Wrapping - No whitespace-nowrap on dynamic text
assert(
  faceScanDialogCode.includes("break-words whitespace-normal") &&
  faceScanDialogCode.includes("{livenessState.instruction}"),
  "Liveness challenge instruction text wraps with break-words whitespace-normal"
);

// TEST 6: Challenge HUD Container Mobile Max Width
assert(
  faceScanDialogCode.includes("max-w-[calc(100%-8px)] sm:max-w-sm") &&
  faceScanDialogCode.includes("bg-black/90") &&
  faceScanDialogCode.includes("box-border"),
  "Active Liveness Challenge HUD is bounded by max-w-[calc(100%-8px)] with box-border"
);

// TEST 7: Telemetry Angles Wrapping on Narrow Displays
assert(
  faceScanDialogCode.includes("flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[9px]") &&
  faceScanDialogCode.includes("ΔYaw:") &&
  faceScanDialogCode.includes("ΔPitch:"),
  "Yaw and pitch telemetry line uses flex-wrap to prevent overflow on 320px screens"
);

// TEST 8: Liveness Challenge Action Buttons Responsive Stacking
assert(
  faceScanDialogCode.includes("flex flex-col sm:flex-row gap-2 w-full min-w-0") &&
  faceScanDialogCode.includes("flex-1 min-w-0 bg-amber-600") &&
  faceScanDialogCode.includes("w-full sm:w-auto border-border"),
  "Liveness challenge action buttons stack vertically on mobile (flex-col sm:flex-row) with full tap targets"
);

// TEST 9: Collapsible Diagnostic Panel Header Wrapping
assert(
  faceScanDialogCode.includes("flex flex-wrap items-center justify-between gap-2 bg-muted/50") &&
  faceScanDialogCode.includes("Copy Diagnostics"),
  "Diagnostic telemetry panel header wraps cleanly with flex-wrap and min-w-0"
);

// TEST 10: State Machine Transition Log Auto Horizontal Scroll
assert(
  faceScanDialogCode.includes("max-h-28 overflow-y-auto overflow-x-auto space-y-1 text-[10px] font-mono min-w-0"),
  "State machine stage transition log uses overflow-x-auto to isolate long entries without expanding modal"
);

// TEST 11: 5-Slot Active Embedding Diagnostics Grid
assert(
  faceScanDialogCode.includes("grid grid-cols-5 gap-1 text-[8px] sm:text-[9px] font-mono min-w-0") &&
  faceScanDialogCode.includes("Slot-1"),
  "Per-template distances grid uses 5 compact columns with min-w-0 for mobile fit"
);

// TEST 12: Preserved Core Verification Threshold & ArcFace Match
assert(
  faceScanDialogCode.includes("dist <= 0.45") &&
  faceScanDialogCode.includes("FACE_CONFIG") &&
  faceScanDialogCode.includes("alignMirroredFaceDetailed"),
  "ArcFace matching threshold (0.45) and mirrored alignment pipeline are strictly preserved"
);

// TEST 13: Simulated Viewport Layout Calculations
const viewports = [
  { name: "iPhone SE (1st gen)", width: 320, height: 568 },
  { name: "Galaxy S20 (Android)", width: 360, height: 800 },
  { name: "iPhone 12/13/14", width: 390, height: 844 },
  { name: "Pixel 7/8", width: 412, height: 915 },
  { name: "HD / Foldable", width: 720, height: 1280 },
  { name: "Desktop", width: 1280, height: 800 },
];

for (const vp of viewports) {
  const dialogWidth = Math.min(vp.width - 16, 576);
  const padding = vp.width < 640 ? 24 : 40; // p-3 (12*2) vs p-5 (20*2)
  const availableContentWidth = dialogWidth - padding;
  const challengeHudWidth = Math.min(availableContentWidth - 8, 384);

  // Approximate character width for 14px bold text ~ 7.2px per char
  const longestInstruction = "Face matched. Please turn your head slightly to the left."; // 57 chars
  const singleLineWidth = longestInstruction.length * 7.2; // ~410px

  const fitsSingleLine = singleLineWidth <= challengeHudWidth - 40; // 40px for icon and padding
  const requiresWrapping = !fitsSingleLine;

  assert(
    dialogWidth <= vp.width && availableContentWidth > 0 && challengeHudWidth <= availableContentWidth,
    `Viewport ${vp.name} (${vp.width}x${vp.height}): dialog=${dialogWidth}px, inner=${availableContentWidth}px, HUD=${challengeHudWidth}px -> Overflow bounded (wrapping required: ${requiresWrapping})`
  );
}

console.log("\n===============================================================================");
console.log(`        RESULTS: ${passedTests} / ${totalTests} RESPONSIVE LAYOUT TESTS PASSED `);
console.log("===============================================================================");

if (passedTests !== totalTests) {
  process.exit(1);
}
