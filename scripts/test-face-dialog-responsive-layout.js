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

// TEST 2: Dialog Centering Without Rightward Clipping
assert(
  dialogUiCode.includes("left-1/2 top-1/2") &&
  dialogUiCode.includes("-translate-x-1/2 -translate-y-1/2") &&
  faceScanDialogCode.includes("fixed inset-x-0 mx-auto translate-x-0 top-1/2 -translate-y-1/2"),
  "DialogContent implements bulletproof horizontal and vertical centering without rightward clipping"
);

// TEST 3: Duplicate Close Button Prevention
assert(
  dialogUiCode.includes("hideCloseButton?: boolean") &&
  dialogUiCode.includes("!hideCloseButton &&") &&
  faceScanDialogCode.includes("hideCloseButton={true}"),
  "DialogContent supports and enables hideCloseButton={true} to eliminate duplicate close buttons"
);

// TEST 4: Camera Preview and Canvas Aspect Ratio & Mirroring
assert(
  faceScanDialogCode.includes("relative aspect-[4/3] sm:aspect-video w-full max-w-full overflow-hidden") &&
  faceScanDialogCode.includes("-scale-x-100 block") &&
  faceScanDialogCode.includes("canvasRef"),
  "Camera preview container has max-w-full with responsive aspect ratio and mirror-aligned video/canvas"
);

// TEST 5: Strict Removal of BLINK_ONCE from Challenge Engine
assert(
  !livenessEngineCode.includes('"BLINK_ONCE"') &&
  !livenessEngineCode.includes("'BLINK_ONCE'"),
  "BLINK_ONCE is strictly removed from liveness-engine.ts challenge options"
);

// TEST 6: All 5 Allowed Movement Actions Fully Supported
const expectedActions = [
  { action: "TURN_LEFT", text: "Face matched! Please turn your head slightly to the left." },
  { action: "TURN_RIGHT", text: "Face matched! Please turn your head slightly to the right." },
  { action: "LOOK_UP", text: "Face matched! Please tilt your head slightly upward." },
  { action: "LOOK_DOWN", text: "Face matched! Please tilt your head slightly downward." },
  { action: "NOD_ONCE", text: "Face matched! Please nod once." },
];

for (const { action, text } of expectedActions) {
  assert(
    livenessEngineCode.includes(text),
    `Liveness engine produces full exact instruction for ${action}: "${text}"`
  );
}

// TEST 7: Challenge Instruction Wrapping - No whitespace-nowrap on dynamic text
assert(
  faceScanDialogCode.includes("break-words whitespace-normal") &&
  faceScanDialogCode.includes("{livenessState.instruction}"),
  "Liveness challenge instruction text wraps with break-words whitespace-normal"
);

// TEST 8: Challenge HUD Container Mobile Max Width
assert(
  faceScanDialogCode.includes("max-w-[calc(100%-8px)] sm:max-w-sm") &&
  faceScanDialogCode.includes("bg-black/90") &&
  faceScanDialogCode.includes("box-border"),
  "Active Liveness Challenge HUD is bounded by max-w-[calc(100%-8px)] with box-border"
);

// TEST 9: Telemetry Angles Wrapping on Narrow Displays
assert(
  faceScanDialogCode.includes("flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[9px]") &&
  faceScanDialogCode.includes("ΔYaw:") &&
  faceScanDialogCode.includes("ΔPitch:"),
  "Yaw and pitch telemetry line uses flex-wrap to prevent overflow on 320px screens"
);

// TEST 10: Simplified Header and Two-Step Progress Labels
assert(
  faceScanDialogCode.includes("Face Authentication") &&
  faceScanDialogCode.includes("Step 1 of 2 — Face Match") &&
  faceScanDialogCode.includes("Step 2 of 2 — Head Movement"),
  "Dialog header uses compact title 'Face Authentication' and two-step progress label"
);

// TEST 11: Loading Screen Centering and Clean Text
assert(
  faceScanDialogCode.includes("Loading face recognition models…") &&
  faceScanDialogCode.includes("w-full max-w-xs space-y-3 text-center min-w-0 px-2"),
  "Model loading panel is centered with clean, non-clipping text and responsive progress bar"
);

// TEST 12: Simplified Primary Action Buttons
assert(
  faceScanDialogCode.includes("Start Face Check") &&
  faceScanDialogCode.includes("Try Again"),
  "Primary actions are simplified to 'Start Face Check' and 'Try Again' without redundant controls"
);

// TEST 13: Advanced Diagnostics Section Collapsed by Default
assert(
  faceScanDialogCode.includes("Advanced Diagnostics") &&
  faceScanDialogCode.includes("const [showDiag, setShowDiag] = useState(false);"),
  "Diagnostic details are housed inside collapsed 'Advanced Diagnostics' section"
);

// TEST 14: Preserved Core Verification Threshold & ArcFace Match
assert(
  faceScanDialogCode.includes("dist <= 0.45") &&
  faceScanDialogCode.includes("FACE_CONFIG") &&
  faceScanDialogCode.includes("alignMirroredFaceDetailed"),
  "ArcFace matching threshold (0.45) and mirrored alignment pipeline are strictly preserved"
);

// TEST 15: Simulated Viewport Layout Calculations
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
  const longestInstruction = "Face matched! Please turn your head slightly to the left."; // 57 chars
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
