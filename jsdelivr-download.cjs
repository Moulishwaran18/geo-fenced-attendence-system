const https = require('https');
const fs = require('fs');
const path = require('path');

const baseUrl = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/';
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
    const filePath = path.join(dest, file);
    const fileStream = fs.createWriteStream(filePath);
    
    https.get(baseUrl + file, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (redirectRes) => {
              redirectRes.pipe(fileStream);
              fileStream.on('finish', () => { fileStream.close(); resolve(); });
          }).on('error', reject);
          return;
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(filePath);
      reject(err);
    });
  });
}

async function main() {
  console.log('Downloading all models via jsdelivr...');
  await Promise.all(models.map(async (file) => {
    await downloadFile(file);
    console.log('Downloaded ' + file);
  }));
  console.log('All models downloaded successfully!');
}
main();
