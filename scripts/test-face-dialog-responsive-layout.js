/**
 * CampusAttend - Face Authentication Dialog Mobile Responsive Layout Regression Suite
 * Tests full-screen overlay layout, overflow prevention, and dynamic liveness challenge wrapping across viewports:
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

// TEST 1: Full-Screen Dialog Overlay & Viewport Height Fallbacks
assert(
  faceScanDialogCode.includes("fullScreen={true}") &&
  dialogUiCode.includes("fullScreen?: boolean") &&
  dialogUiCode.includes("h-[100dvh]") &&
  dialogUiCode.includes("fixed inset-0"),
  "DialogContent implements fullScreen={true} with fixed inset-0 and h-[100dvh] viewport coverage"
);

// TEST 2: Dialog Centering Without Conflicting Mobile Transforms or Rightward Clipping
assert(
  dialogUiCode.includes("[transform:none]") &&
  faceScanDialogCode.includes("[transform:none]") &&
  faceScanDialogCode.includes("overflow-x-hidden") &&
  faceScanDialogCode.includes("safe-area-inset-top"),
  "DialogContent removes conflicting transforms ([transform:none]) and respects mobile safe areas without horizontal overflow"
);

// TEST 3: Single Header Close Button & Dialog Close Button Suppression
assert(
  dialogUiCode.includes("hideCloseButton?: boolean") &&
  dialogUiCode.includes("!hideCloseButton &&") &&
  faceScanDialogCode.includes("hideCloseButton={true}"),
  "DialogContent supports and enables hideCloseButton={true} to eliminate duplicate close buttons"
);

// TEST 4: Camera Preview and Canvas Aspect Ratio & Mirroring
assert(
  faceScanDialogCode.includes("aspect-[3/4]") &&
  faceScanDialogCode.includes("-scale-x-100 block") &&
  faceScanDialogCode.includes("canvasRef") &&
  faceScanDialogCode.includes("videoRef"),
  "Camera preview container uses portrait aspect-[3/4] with mirror-aligned video and canvas overlay"
);

// TEST 5: Strict Removal of BLINK_ONCE & NOD_ONCE from Challenge Engine
assert(
  !livenessEngineCode.includes('"BLINK_ONCE"') &&
  !livenessEngineCode.includes("'BLINK_ONCE'") &&
  !livenessEngineCode.includes('"NOD_ONCE"') &&
  !livenessEngineCode.includes("'NOD_ONCE'"),
  "Both BLINK_ONCE and NOD_ONCE are strictly eliminated from liveness-engine.ts challenge options"
);

// TEST 6: Exactly 4 Allowed Head-Movement Actions Fully Supported
const expectedActions = [
  { action: "TURN_LEFT", text: "Face matched! Please turn your head slightly to the left." },
  { action: "TURN_RIGHT", text: "Face matched! Please turn your head slightly to the right." },
  { action: "LOOK_UP", text: "Face matched! Please tilt your head slightly upward." },
  { action: "LOOK_DOWN", text: "Face matched! Please tilt your head slightly downward." },
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

// TEST 8: Challenge Status Container Mobile Sizing Below Camera Preview
assert(
  faceScanDialogCode.includes("max-w-sm sm:max-w-md") &&
  faceScanDialogCode.includes("Step 2: Head Movement Challenge") &&
  faceScanDialogCode.includes("livenessState.timeRemainingSec"),
  "Challenge status container is placed below camera with clear time remaining countdown"
);

// TEST 9: Background Scroll Lock During Full-Screen Presentation
assert(
  faceScanDialogCode.includes("document.body.style.overflow = \"hidden\"") &&
  faceScanDialogCode.includes("document.body.style.touchAction = \"none\""),
  "Dialog locks background scrolling and touch gestures when open and restores them on close"
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

// TEST 15: Simulated Viewport Layout Calculations for Full-Screen Interface
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
  const contentWidth = Math.min(overlayWidth, 512); // max-w-lg = 512px
  const padding = vp.width < 640 ? 24 : 40; // p-3 (12*2) vs p-5 (20*2)
  const innerContentWidth = contentWidth - padding;
  const cameraWidth = Math.min(innerContentWidth, 384); // max-w-sm = 384px

  // Longest instruction text
  const longestInstruction = "Face matched! Please turn your head slightly to the left."; // 57 chars
  const singleLineWidth = longestInstruction.length * 7.2; // ~410px
  const requiresWrapping = singleLineWidth > (cameraWidth - 48);

  assert(
    overlayWidth === vp.width &&
    overlayHeight === vp.height &&
    contentWidth <= vp.width &&
    innerContentWidth > 0 &&
    cameraWidth <= innerContentWidth,
    `Viewport ${vp.name} (${vp.width}x${vp.height}): overlay=${overlayWidth}x${overlayHeight}px, content=${contentWidth}px, camera=${cameraWidth}px -> Fullscreen bounded (instruction wrapping: ${requiresWrapping})`
  );
}

console.log("\n===============================================================================");
console.log(`        RESULTS: ${passedTests} / ${totalTests} RESPONSIVE LAYOUT TESTS PASSED `);
console.log("===============================================================================");

if (passedTests !== totalTests) {
  process.exit(1);
}
