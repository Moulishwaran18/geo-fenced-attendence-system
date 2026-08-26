import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PG_DIR = "C:\\PostgreSQL17\\pgsql";
const ZIP_URL = "https://github.com/andreiramani/pgvector_pgsql_windows/releases/download/0.8.6_17/vector.v0.8.6-pg17.zip";
const TEMP_ZIP = "C:\\PostgreSQL17\\pgvector.zip";
const EXTRACT_DIR = "C:\\PostgreSQL17\\pgvector_extracted";

function download(url, dest, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error("Too many redirects"));

    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, dest, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve(dest));
      });
    });
    req.on("error", reject);
  });
}

async function installPgVector() {
  console.log("=== Installing pgvector 0.8.6 for PostgreSQL 17 ===");
  console.log(`Downloading: ${ZIP_URL}`);
  await download(ZIP_URL, TEMP_ZIP);
  console.log(`Downloaded to ${TEMP_ZIP} (${fs.statSync(TEMP_ZIP).size} bytes)`);

  if (!fs.existsSync(EXTRACT_DIR)) {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  }

  // Extract using tar
  execSync(`tar -xf "${TEMP_ZIP}" -C "${EXTRACT_DIR}"`);
  console.log("Extracted zip contents.");

  // List extracted files
  function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);
    files.forEach((file) => {
      const fullPath = path.join(dirPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        getAllFiles(fullPath, arrayOfFiles);
      } else {
        arrayOfFiles.push(fullPath);
      }
    });
    return arrayOfFiles;
  }

  const allFiles = getAllFiles(EXTRACT_DIR);
  console.log("Found extracted files:", allFiles.map((f) => path.basename(f)));

  // Copy files to target directories
  allFiles.forEach((file) => {
    const name = path.basename(file);
    if (name.endsWith(".dll")) {
      const dest = path.join(PG_DIR, "lib", name);
      fs.copyFileSync(file, dest);
      console.log(`Copied ${name} -> ${dest}`);
    } else if (name.endsWith(".control") || name.endsWith(".sql")) {
      const dest = path.join(PG_DIR, "share", "extension", name);
      fs.copyFileSync(file, dest);
      console.log(`Copied ${name} -> ${dest}`);
    }
  });

  console.log("[OK] pgvector files installed successfully!");
}

installPgVector().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
