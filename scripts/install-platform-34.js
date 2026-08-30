import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";

const url = "https://dl.google.com/android/repository/platform-34-ext7_r03.zip";
const tempZip = "d:/project/geo-fenced-attendence-system/android/platform-34.zip";
const targetPlatformDir = "C:/Users/Moulishwaran S/AppData/Local/Android/Sdk/platforms/android-34";

console.log("Downloading Android Platform 34 (platform-34-ext7_r03.zip)...");

const file = fs.createWriteStream(tempZip);
https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    https.get(res.headers.location, (redirectRes) => {
      redirectRes.pipe(file);
      file.on("finish", () => {
        file.close(extract);
      });
    });
    return;
  }
  res.pipe(file);
  file.on("finish", () => {
    file.close(extract);
  });
}).on("error", (err) => {
  console.error("Download failed:", err);
  process.exit(1);
});

function extract() {
  console.log("Downloaded successfully! Extracting platform-34...");
  try {
    execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath 'd:/project/geo-fenced-attendence-system/android/temp_platform' -Force"`, { stdio: "inherit" });
    fs.mkdirSync(targetPlatformDir, { recursive: true });

    // Look for android-34 or android-34-ext7 directory inside temp_platform
    const subdirs = fs.readdirSync("d:/project/geo-fenced-attendence-system/android/temp_platform");
    console.log("Extracted subdirectories:", subdirs);
    const subfolder = subdirs[0];

    execSync(`powershell -Command "Copy-Item -Path 'd:/project/geo-fenced-attendence-system/android/temp_platform/${subfolder}/*' -Destination '${targetPlatformDir}' -Recurse -Force"`, { stdio: "inherit" });
    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    execSync(`powershell -Command "Remove-Item -Path 'd:/project/geo-fenced-attendence-system/android/temp_platform' -Recurse -Force"`, { stdio: "inherit" });

    const stats = fs.statSync(path.join(targetPlatformDir, "android.jar"));
    console.log("SUCCESS! android.jar installed. Size:", stats.size, "bytes");
  } catch (e) {
    console.error("Extraction error:", e);
    process.exit(1);
  }
}
