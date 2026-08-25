import { TemporalBlinkDetector } from "../src/lib/face-recognition/blink-detection.ts";

function createDummyLandmarks(leftEAR, rightEAR) {
  // Construct 68 landmark points with geometric coordinates yielding exact EAR
  const pts = [];
  for (let i = 0; i < 68; i++) {
    pts.push({ x: 100 + i, y: 100 + i });
  }

  // Left Eye: 36..41 (Horizontal: 36 to 39, Vertical: 37 to 41 and 38 to 40)
  // Distance 36 to 39 = 20.0
  // Vertical = leftEAR * 2 * 20 / 2 = leftEAR * 20
  const hL = 20.0;
  const vL = leftEAR * hL;
  pts[36] = { x: 50, y: 50 };
  pts[39] = { x: 50 + hL, y: 50 };
  pts[37] = { x: 55, y: 50 - vL / 2 };
  pts[41] = { x: 55, y: 50 + vL / 2 };
  pts[38] = { x: 65, y: 50 - vL / 2 };
  pts[40] = { x: 65, y: 50 + vL / 2 };

  // Right Eye: 42..47
  const hR = 20.0;
  const vR = rightEAR * hR;
  pts[42] = { x: 100, y: 50 };
  pts[45] = { x: 100 + hR, y: 50 };
  pts[43] = { x: 105, y: 50 - vR / 2 };
  pts[47] = { x: 105, y: 50 + vR / 2 };
  pts[44] = { x: 115, y: 50 - vR / 2 };
  pts[46] = { x: 115, y: 50 + vR / 2 };

  return { positions: pts };
}

async function runTests() {
  console.log("===============================================================================");
  console.log("             TEMPORAL BLINK DETECTOR VALIDATION TEST SUITE");
  console.log("===============================================================================\n");

  const detector = new TemporalBlinkDetector(1);

  // Test 1: Baseline Calibration (5 open eye frames)
  console.log("--- TEST 1: Baseline Calibration (Open Eyes) ---");
  for (let f = 1; f <= 5; f++) {
    const lms = createDummyLandmarks(0.29, 0.29);
    const state = detector.processFrame(lms);
    console.log(`Frame ${f}: EAR=${state.currentEAR.toFixed(3)} | Base=${state.baselineEAR.toFixed(3)} | EyeState=${state.eyeState} | BlinkState=${state.blinkState}`);
  }

  // Test 2: Natural 4-Stage Blink (OPEN -> CLOSING -> CLOSED -> OPEN)
  console.log("\n--- TEST 2: Natural 4-Stage Blink ---");
  const sequence = [
    { name: "Closing", ear: 0.23 },
    { name: "Closed", ear: 0.17 },
    { name: "Reopening", ear: 0.28 },
  ];

  for (const step of sequence) {
    const lms = createDummyLandmarks(step.ear, step.ear);
    const state = detector.processFrame(lms);
    console.log(`[${step.name}] EAR=${state.currentEAR.toFixed(3)} | EyeState=${state.eyeState} | BlinkState=${state.blinkState} | Count=${state.blinkCount} | Complete=${state.isComplete}`);
  }

  if (!detector.getState().isComplete) {
    throw new Error("Test 2 Failed: Natural blink was not verified");
  }
  console.log("✓ TEST 2 PASSED: Natural blink verified successfully!\n");

  // Test 3: Low-FPS Fast Blink (OPEN -> CLOSED in 1 frame -> OPEN in 1 frame)
  console.log("--- TEST 3: Low-FPS Transient Blink (1-frame dip) ---");
  detector.reset(1);
  for (let f = 1; f <= 5; f++) {
    detector.processFrame(createDummyLandmarks(0.28, 0.28));
  }
  console.log("Dip frame (EAR=0.18):", detector.processFrame(createDummyLandmarks(0.18, 0.18)).blinkState);
  const lowFpsState = detector.processFrame(createDummyLandmarks(0.28, 0.28));
  console.log("Reopen frame (EAR=0.28):", lowFpsState.blinkState, `| Completed: ${lowFpsState.isComplete}`);
  if (!lowFpsState.isComplete) {
    throw new Error("Test 3 Failed: Low-FPS blink was not verified");
  }
  console.log("✓ TEST 3 PASSED: Low-FPS blink verified successfully!\n");

  // Test 4: Permanently Closed Eyes Rejection (>15 consecutive closed frames)
  console.log("--- TEST 4: Permanently Closed Eyes Rejection ---");
  detector.reset(1);
  for (let f = 1; f <= 5; f++) {
    detector.processFrame(createDummyLandmarks(0.28, 0.28));
  }
  for (let f = 1; f <= 20; f++) {
    const state = detector.processFrame(createDummyLandmarks(0.16, 0.16));
    if (f === 16) {
      console.log(`Frame 16 (Closed > 15 frames): EyeState=${state.eyeState} | BlinkCount=${state.blinkCount}`);
    }
  }
  const reopenAfterSleep = detector.processFrame(createDummyLandmarks(0.28, 0.28));
  console.log(`Reopening after permanent closure: EyeState=${reopenAfterSleep.eyeState} | BlinkCount=${reopenAfterSleep.blinkCount} | BlinkState=${reopenAfterSleep.blinkState}`);
  if (reopenAfterSleep.blinkCount > 0 || reopenAfterSleep.isComplete) {
    throw new Error("Test 4 Failed: Permanently closed eye was incorrectly counted as a blink");
  }
  console.log("✓ TEST 4 PASSED: Permanently closed eye rejected correctly!\n");

  console.log("===============================================================================");
  console.log("       ALL BLINK DETECTOR TESTS COMPLETED WITH 100% SUCCESS!");
  console.log("===============================================================================");
}

runTests().catch(console.error);
