import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";

const urls = [
  "https://dl.google.com/android/repository/platform-34_r02.zip",
  "https://dl.google.com/android/repository/platform-34_r01.zip",
  "https://dl.google.com/android/repository/platform-34.zip",
];

const tempZip = "d:/project/geo-fenced-attendence-system/android/platform-34.zip";
const targetPlatformDir = "C:/Users/Moulishwaran S/AppData/Local/Android/Sdk/platforms/android-34";

function tryDownload(index) {
  if (index >= urls.length) {
    console.error("All URLs failed.");
    process.exit(1);
  }
  const url = urls[index];
  console.log(`Trying ${url}...`);

  const file = fs.createWriteStream(tempZip);
  https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return https.get(response.headers.location, (res) => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on("finish", () => {
            file.close(extract);
          });
        } else {
          tryDownload(index + 1);
        }
      });
    }
    if (response.statusCode === 200) {
      response.pipe(file);
      file.on("finish", () => {
        file.close(extract);
      });
    } else {
      tryDownload(index + 1);
    }
  }).on("error", (err) => {
    tryDownload(index + 1);
  });
}

function extract() {
  console.log("Downloaded platform-34 zip successfully! Extracting...");
  try {
    execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath 'd:/project/geo-fenced-attendence-system/android/temp_platform' -Force"`, { stdio: "inherit" });
    fs.mkdirSync(targetPlatformDir, { recursive: true });
    execSync(`powershell -Command "Copy-Item -Path 'd:/project/geo-fenced-attendence-system/android/temp_platform/android-34/*' -Destination '${targetPlatformDir}' -Recurse -Force"`, { stdio: "inherit" });
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    execSync(`powershell -Command "Remove-Item -Path 'd:/project/geo-fenced-attendence-system/android/temp_platform' -Recurse -Force"`, { stdio: "inherit" });

    const stats = fs.statSync(path.join(targetPlatformDir, "android.jar"));
    console.log("SUCCESS! android.jar installed. Size:", stats.size, "bytes");
  } catch (e) {
    console.error("Extraction error:", e);
    process.exit(1);
  }
}

tryDownload(0);
