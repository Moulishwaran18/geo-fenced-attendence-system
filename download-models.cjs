const https = require('https');
const fs = require('fs');
const path = require('path');

const baseUrl = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
const models = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model-shard1',
  'ssd_mobilenetv1_model-shard2',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];

const dest = path.join(__dirname, 'public', 'models');

if (!fs.existsSync(dest)){
    fs.mkdirSync(dest, { recursive: true });
}

function downloadFile(file) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(path.join(dest, file));
    https.get(baseUrl + file, (res) => {
      // Handle redirects if any
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (redirectRes) => {
              redirectRes.pipe(fileStream);
              fileStream.on('finish', () => {
                  fileStream.close();
                  resolve();
              });
          }).on('error', reject);
          return;
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(path.join(dest, file));
      reject(err);
    });
  });
}

async function main() {
  for (const file of models) {
    console.log('Downloading ' + file);
    await downloadFile(file);
    console.log('Done ' + file);
  }
}
main();
