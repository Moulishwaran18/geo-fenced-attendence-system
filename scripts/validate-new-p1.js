import fs from "fs";
import path from "path";
import crypto from "crypto";
import jpeg from "jpeg-js";
import * as tf from "@tensorflow/tfjs-core";
import faceapi from "face-api.js";

const MODELS_DIR = path.resolve("public", "models");
const UPLOAD_DIR = "C:\\Users\\Moulishwaran S\\.gemini\\antigravity-ide\\brain\\765be839-67f9-476e-94ce-1497167ca395\\.user_uploaded";

const NEW_PHOTOS = [
  { label: "Photo 1", file: "media_1787591912308.jpg", expectedPose: "Straight / Front" },
  { label: "Photo 2", file: "media_1787591912278.jpg", expectedPose: "Slight Right" },
  { label: "Photo 3", file: "media_1787591912392.jpg", expectedPose: "Slight Left" },
  { label: "Photo 4", file: "media_1787591912456.jpg", expectedPose: "Slight Up" },
  { label: "Photo 5", file: "media_1787591912433.jpg", expectedPose: "Slight Down" },
];

function analyzeQuality(rawJpeg) {
  const { width, height, data } = rawJpeg;
  const pixelCount = width * height;
  let totalLuma = 0, totalLumaSq = 0;
  const gray = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = luma;
    totalLuma += luma;
    totalLumaSq += luma * luma;
  }

  const brightness = totalLuma / pixelCount;
  const variance = (totalLumaSq / pixelCount) - (brightness * brightness);
  const contrast = Math.sqrt(Math.max(0, variance));

  // Sharpness via discrete Laplacian variance
  let lapSum = 0, lapSumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      lapSum += lap;
      lapSumSq += lap * lap;
      count++;
    }
  }
  const lapMean = lapSum / count;
  const sharpness = Math.sqrt(Math.max(0, (lapSumSq / count) - (lapMean * lapMean)));

  return { width, height, brightness, contrast, sharpness };
}

function estimatePose(landmarks68) {
  const pts = landmarks68.positions || landmarks68;
  let leX = 0, leY = 0, reX = 0, reY = 0;
  [36, 37, 38, 39, 40, 41].forEach(i => { leX += pts[i].x; leY += pts[i].y; });
  [42, 43, 44, 45, 46, 47].forEach(i => { reX += pts[i].x; reY += pts[i].y; });
  leX /= 6; leY /= 6; reX /= 6; reY /= 6;

  const noseX = pts[30].x;
  const noseY = pts[30].y;
  const mouthX = (pts[48].x + pts[54].x) / 2;
  const mouthY = (pts[48].y + pts[54].y) / 2;

  const eyeDist = Math.hypot(reX - leX, reY - leY) || 1;
  const eyeMidX = (leX + reX) / 2;
  const eyeMidY = (leY + reY) / 2;

  const yawRatio = (noseX - eyeMidX) / (eyeDist / 2);
  const yawDeg = Math.round(yawRatio * 45);

  const faceHeight = Math.hypot(mouthX - eyeMidX, mouthY - eyeMidY) || 1;
  const expectedNoseY = eyeMidY + faceHeight * 0.55;
  const pitchRatio = (noseY - expectedNoseY) / faceHeight;
  const pitchDeg = Math.round(pitchRatio * -60);

  return { yawDeg, pitchDeg };
}

async function validate() {
  console.log("===============================================================================");
  console.log("             VALIDATING 5 NEW REFERENCE PHOTOS FOR PERSON_001");
  console.log("===============================================================================\n");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_DIR);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_DIR);

  const results = [];
  const hashes = new Set();

  for (let i = 0; i < NEW_PHOTOS.length; i++) {
    const item = NEW_PHOTOS[i];
    const srcPath = path.join(UPLOAD_DIR, item.file);
    const fileBuf = fs.readFileSync(srcPath);
    const md5 = crypto.createHash("md5").update(fileBuf).digest("hex");
    const rawJpeg = jpeg.decode(fileBuf, { useTArray: true });
    const quality = analyzeQuality(rawJpeg);

    const isDup = hashes.has(md5);
    hashes.add(md5);

    const numPixels = rawJpeg.width * rawJpeg.height;
    const rgbValues = new Uint8Array(numPixels * 3);
    for (let p = 0; p < numPixels; p++) {
      rgbValues[p * 3] = rawJpeg.data[p * 4];
      rgbValues[p * 3 + 1] = rawJpeg.data[p * 4 + 1];
      rgbValues[p * 3 + 2] = rawJpeg.data[p * 4 + 2];
    }

    let tensor3D = tf.tensor3d(rgbValues, [rawJpeg.height, rawJpeg.width, 3], "int32");
    const maxDim = Math.max(rawJpeg.height, rawJpeg.width);
    if (maxDim > 640) {
      const scale = 640 / maxDim;
      const targetH = Math.round(rawJpeg.height * scale);
      const targetW = Math.round(rawJpeg.width * scale);
      const resized = tf.image.resizeBilinear(tensor3D, [targetH, targetW]);
      tensor3D.dispose();
      tensor3D = tf.cast(resized, "int32");
      resized.dispose();
    }

    const detections = await faceapi
      .detectAllFaces(tensor3D, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
      .withFaceLandmarks();

    tensor3D.dispose();

    const faceCount = detections.length;
    let yawStr = "N/A", pitchStr = "N/A";
    let status = "REJECTED";
    let qualityStr = "Good";

    if (quality.sharpness < 5) qualityStr = "Blurry";
    else if (quality.brightness < 40) qualityStr = "Too Dark";
    else if (quality.brightness > 220) qualityStr = "Overexposed";
    else qualityStr = `Clear (Sharp: ${quality.sharpness.toFixed(1)}, Bright: ${quality.brightness.toFixed(1)})`;

    if (faceCount === 1) {
      const face = detections[0];
      const pose = estimatePose(face.landmarks);
      yawStr = `${pose.yawDeg > 0 ? "+" : ""}${pose.yawDeg}°`;
      pitchStr = `${pose.pitchDeg > 0 ? "+" : ""}${pose.pitchDeg}°`;

      const absYaw = Math.abs(pose.yawDeg);
      const absPitch = Math.abs(pose.pitchDeg);

      if (absYaw <= 30 && absPitch <= 20) {
        status = "RECOMMENDED";
      } else if (absYaw <= 45 && absPitch <= 30) {
        status = "OPTIONAL";
      } else {
        status = "OPTIONAL (Wide Angle)";
      }
    } else if (faceCount === 0) {
      status = "REJECTED (No face detected)";
    } else {
      status = `REJECTED (${faceCount} faces detected)`;
    }

    results.push({
      photo: item.label,
      targetPose: item.expectedPose,
      file: item.file,
      faceCount,
      yaw: yawStr,
      pitch: pitchStr,
      quality: qualityStr,
      duplicate: isDup ? "Yes" : "No",
      status,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

validate().catch(console.error);
