import fs from "fs";
import path from "path";
import https from "https";

const jarUrl = "https://raw.githubusercontent.com/gradle/gradle/master/gradle/wrapper/gradle-wrapper.jar";
const destDir = "d:/project/geo-fenced-attendence-system/android/gradle/wrapper";
const destPath = path.join(destDir, "gradle-wrapper.jar");

fs.mkdirSync(destDir, { recursive: true });

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return download(response.headers.location, dest, cb);
    }
    response.pipe(file);
    file.on("finish", () => {
      file.close(cb);
    });
  }).on("error", (err) => {
    fs.unlink(dest, () => {});
    cb(err);
  });
}

download(jarUrl, destPath, (err) => {
  if (err) {
    console.error("Download error:", err);
    process.exit(1);
  }
  const stats = fs.statSync(destPath);
  console.log("Downloaded gradle-wrapper.jar successfully! Size:", stats.size, "bytes");
});
