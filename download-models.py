import urllib.request
import os
import time

baseUrl = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/'
models = [
    'ssd_mobilenetv1_model-weights_manifest.json',
    'ssd_mobilenetv1_model-shard1',
    'ssd_mobilenetv1_model-shard2',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model-shard1',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model-shard1',
    'face_recognition_model-shard2'
]

dest = os.path.join(os.getcwd(), 'public', 'models')
os.makedirs(dest, exist_ok=True)

def download_with_retry(url, path, max_retries=5):
    for i in range(max_retries):
        try:
            print(f"Downloading {url}...")
            urllib.request.urlretrieve(url, path)
            print(f"Downloaded {path}")
            return
        except Exception as e:
            print(f"Attempt {i+1} failed: {e}")
            if i < max_retries - 1:
                time.sleep(2 ** i) # Exponential backoff
            else:
                raise e

for m in models:
    download_with_retry(baseUrl + m, os.path.join(dest, m))
print("All done!")
