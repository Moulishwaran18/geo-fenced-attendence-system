import fs from "fs";
import path from "path";
import https from "https";

const MODEL_URL = "https://huggingface.co/deepghs/insightface/resolve/main/buffalo_s/w600k_mbf.onnx";
const DEST_DIR = path.resolve("public", "models");
const DEST_FILE = path.join(DEST_DIR, "w600k_mbf.onnx");

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Fetching from: ${url}...`);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirecting to: ${res.headers.location}`);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download: HTTP status ${res.statusCode}`));
      }

      const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;
      const fileStream = fs.createWriteStream(dest);

      res.on("data", (chunk) => {
        downloaded += chunk.length;
        if (totalBytes > 0) {
          const pct = ((downloaded / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\rDownloading w600k_mbf.onnx: ${pct}% (${(downloaded / (1024 * 1024)).toFixed(2)} MB / ${(totalBytes / (1024 * 1024)).toFixed(2)} MB)`);
        } else {
          process.stdout.write(`\rDownloading: ${(downloaded / (1024 * 1024)).toFixed(2)} MB`);
        }
      });

      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        console.log("\n✓ Download completed successfully!");
        resolve();
      });

      fileStream.on("error", (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("==================================================");
  console.log("InsightFace MobileFaceNet ArcFace Model Downloader");
  console.log("==================================================");
  
  if (fs.existsSync(DEST_FILE) && fs.statSync(DEST_FILE).size > 10 * 1024 * 1024) {
    console.log(`Model already exists at: ${DEST_FILE} (${(fs.statSync(DEST_FILE).size / (1024 * 1024)).toFixed(2)} MB)`);
    return;
  }

  await download(MODEL_URL, DEST_FILE);
  const sizeMb = (fs.statSync(DEST_FILE).size / (1024 * 1024)).toFixed(2);
  console.log(`Saved model: ${DEST_FILE} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error("Download failed:", err);
  process.exit(1);
});
