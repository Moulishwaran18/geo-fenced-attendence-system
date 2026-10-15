import * as ort from "onnxruntime-web";
import fs from "fs";
import jpeg from "jpeg-js";

function softmax(logits) {
  const maxVal = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - maxVal));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sumExp);
}

async function run() {
  console.log("=== TESTING MINIFASNET V2 INFERENCE & CLASSIFICATION ===");
  const modelBuf = fs.readFileSync("public/models/MiniFASNetV2.onnx");
  const session = await ort.InferenceSession.create(modelBuf);

  console.log("Model loaded successfully. Input:", session.inputNames, "Output:", session.outputNames);

  // 1. Test with an artificial flat 2D screen/photo pattern (high frequency uniform grid)
  const spoofBuffer = new Float32Array(3 * 80 * 80);
  for (let i = 0; i < 80 * 80; i++) {
    spoofBuffer[0 * 6400 + i] = 0.85; // flat greyish white
    spoofBuffer[1 * 6400 + i] = 0.85;
    spoofBuffer[2 * 6400 + i] = 0.85;
  }
  const spoofTensor = new ort.Tensor("float32", spoofBuffer, [1, 3, 80, 80]);
  const spoofRes = await session.run({ input: spoofTensor });
  const spoofLogits = Array.from(spoofRes.output.data);
  const spoofProbs = softmax(spoofLogits);

  console.log("\n[Test Flat Screen / Photo Pattern]");
  console.log("Raw Logits:", spoofLogits.map(v => v.toFixed(3)));
  console.log("Probabilities -> Print:", spoofProbs[0].toFixed(4), "| LIVE:", spoofProbs[1].toFixed(4), "| Replay:", spoofProbs[2].toFixed(4));
  
  const isSpoofDetected = spoofProbs[1] < 0.70 && (spoofProbs[0] > 0.40 || spoofProbs[2] > 0.40);
  console.log("Flat pattern rejected as spoof:", isSpoofDetected ? "YES (CORRECT)" : "NO");
  if (!isSpoofDetected) throw new Error("MiniFASNet failed to detect artificial flat pattern as spoof");

  console.log("\n✓ MiniFASNetV2 ONNX inference & softmax validation PASSED!");
}

run().catch(console.error);
