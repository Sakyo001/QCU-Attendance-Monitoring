const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_URL_BASE = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');

const models = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
];

// Create models directory if it doesn't exist
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function downloadModels() {
  console.log('Downloading face-api.js models...');
  
  for (const model of models) {
    const url = MODEL_URL_BASE + model;
    const dest = path.join(MODELS_DIR, model);
    
    try {
      console.log(`Downloading ${model}...`);
      await downloadFile(url, dest);
      console.log(`✓ Downloaded ${model}`);
    } catch (error) {
      console.error(`✗ Failed to download ${model}:`, error.message);
    }
  }
  
  console.log('\n✓ All models downloaded successfully!');
}

downloadModels().catch(console.error);
