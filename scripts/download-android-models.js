import fs from "fs";
import path from "path";
import https from "https";

const models = [
  {
    name: "face_detection_short_range.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
  },
  {
    name: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
  },
  {
    name: "MiniFASNetV2.onnx",
    url: "https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/main/minifasnet_v2.onnx?download=true"
  }
];

const destDir = path.resolve("android", "app", "src", "main", "assets");
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const fileStream = fs.createWriteStream(dest);
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      fileStream.on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on("error", reject);
  });
}

async function main() {
  for (const m of models) {
    const filePath = path.join(destDir, m.name);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      console.log(`✓ Already exists: ${m.name} (${fs.statSync(filePath).size} bytes)`);
      continue;
    }
    console.log(`Downloading ${m.name} from ${m.url}...`);
    try {
      await downloadFile(m.url, filePath);
      console.log(`✓ Downloaded ${m.name} (${fs.statSync(filePath).size} bytes)`);
    } catch (err) {
      console.error(`✗ Error downloading ${m.name}:`, err.message);
    }
  }
}

main().catch(console.error);
