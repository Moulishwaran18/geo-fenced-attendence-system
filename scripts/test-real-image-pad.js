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
  const modelBuf = fs.readFileSync("public/models/MiniFASNetV2.onnx");
  const session = await ort.InferenceSession.create(modelBuf);

  const images = [
    { path: "public/staff-photos/staff-1.jpg", label: "Genuine Face 1", box: { x: 180, y: 120, width: 220, height: 260 } },
    { path: "public/staff-photos/staff-2.jpg", label: "Genuine Face 2", box: { x: 180, y: 120, width: 220, height: 260 } },
    { path: "public/staff-photos/staff-3.jpg", label: "Genuine Face 3", box: { x: 180, y: 120, width: 220, height: 260 } },
  ];

  console.log("=== TESTING GENUINE FACES WITH [0..255] PIXELS ===");
  for (const imgInfo of images) {
    if (!fs.existsSync(imgInfo.path)) continue;
    const imgBuf = fs.readFileSync(imgInfo.path);
    const decoded = jpeg.decode(imgBuf);

    const cropScale = 2.7;
    const centerX = imgInfo.box.x + imgInfo.box.width / 2;
    const centerY = imgInfo.box.y + imgInfo.box.height / 2;
    const scaledW = imgInfo.box.width * cropScale;
    const scaledH = imgInfo.box.height * cropScale;

    const left = Math.max(0, Math.floor(centerX - scaledW / 2));
    const top = Math.max(0, Math.floor(centerY - scaledH / 2));
    const cropW = Math.min(decoded.width - left, Math.floor(scaledW));
    const cropH = Math.min(decoded.height - top, Math.floor(scaledH));

    const arr = new Float32Array(3 * 80 * 80);
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        const srcX = left + Math.floor((x / 80) * cropW);
        const srcY = top + Math.floor((y / 80) * cropH);
        const pIdx = (srcY * decoded.width + srcX) * 4;
        const r = decoded.data[pIdx];
        const g = decoded.data[pIdx + 1];
        const b = decoded.data[pIdx + 2];
        const idx = y * 80 + x;

        // BGR [0..255]
        arr[0 * 6400 + idx] = b;
        arr[1 * 6400 + idx] = g;
        arr[2 * 6400 + idx] = r;
      }
    }

    const res = await session.run({ input: new ort.Tensor("float32", arr, [1, 3, 80, 80]) });
    const logits = Array.from(res.output.data);
    const probs = softmax(logits);

    console.log(`\n${imgInfo.label} (${imgInfo.path}):`);
    console.log("Logits:", logits.map((v) => v.toFixed(3)));
    console.log(`Print: ${(probs[0] * 100).toFixed(2)}% | LIVE: ${(probs[1] * 100).toFixed(2)}% | Replay: ${(probs[2] * 100).toFixed(2)}%`);
  }

  // Now test spoof attack patterns with [0..255]
  console.log("\n=== TESTING PRESENTATION ATTACK SAMPLES WITH [0..255] ===");

  // Spoof 1: Flat uniform color (paper / screen border) [210, 210, 210]
  const flatBuf = new Float32Array(3 * 80 * 80);
  flatBuf.fill(210);
  const flatRes = await session.run({ input: new ort.Tensor("float32", flatBuf, [1, 3, 80, 80]) });
  const flatProbs = softmax(Array.from(flatRes.output.data));
  console.log(`Flat Paper / Screen (fill 210):`);
  console.log(`Print: ${(flatProbs[0] * 100).toFixed(2)}% | LIVE: ${(flatProbs[1] * 100).toFixed(2)}% | Replay: ${(flatProbs[2] * 100).toFixed(2)}%`);

  // Spoof 2: High-frequency alternating LCD pixel grid in [0..255]
  const moireBuf = new Float32Array(3 * 80 * 80);
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      const v = (x + y) % 2 === 0 ? 250 : 30;
      moireBuf[0 * 6400 + y * 80 + x] = v;
      moireBuf[1 * 6400 + y * 80 + x] = v;
      moireBuf[2 * 6400 + y * 80 + x] = v;
    }
  }
  const moireRes = await session.run({ input: new ort.Tensor("float32", moireBuf, [1, 3, 80, 80]) });
  const moireProbs = softmax(Array.from(moireRes.output.data));
  console.log(`High-Frequency Moire / LCD Grid:`);
  console.log(`Print: ${(moireProbs[0] * 100).toFixed(2)}% | LIVE: ${(moireProbs[1] * 100).toFixed(2)}% | Replay: ${(moireProbs[2] * 100).toFixed(2)}%`);
}

run().catch(console.error);
