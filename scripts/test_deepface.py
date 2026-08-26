"""
Test DeepFace Face Recognition & Verification Pipeline on CampusAttend Photos
"""

import os
import sys
import time
import numpy as np

try:
    from deepface import DeepFace
    print("[OK] DeepFace imported successfully.")
except ImportError as e:
    print("DeepFace not yet available:", e)
    sys.exit(1)

def cosine_distance(a, b):
    a = np.array(a, dtype=np.float32)
    b = np.array(b, dtype=np.float32)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    sim = dot / (norm_a * norm_b)
    return float(np.clip(1.0 - sim, 0.0, 2.0))

def main():
    print("==================================================")
    print("CampusAttend - DeepFace Verification Test")
    print("==================================================")

    photos_dir = os.path.join("public", "staff-photos", "person-001")
    if not os.path.exists(photos_dir):
        print(f"Directory not found: {photos_dir}")
        return

    photo_files = sorted([os.path.join(photos_dir, f) for f in os.listdir(photos_dir) if f.endswith(('.jpg', '.jpeg', '.png'))])
    print(f"Found {len(photo_files)} reference photos for PERSON_001:")

    embeddings = []

    for img_path in photo_files:
        start_t = time.time()
        try:
            # We use Facenet512 or ArcFace with OpenCV / RetinaFace
            res = DeepFace.represent(
                img_path=img_path,
                model_name="Facenet512",
                detector_backend="opencv",
                enforce_detection=True,
                align=True
            )
            elapsed_ms = (time.time() - start_t) * 1000
            emb = res[0]["embedding"]
            box = res[0]["facial_area"]
            embeddings.append({"path": img_path, "embedding": emb, "box": box})
            print(f"  [OK] {os.path.basename(img_path)}: Dim={len(emb)}, Box={box['w']}x{box['h']} @ ({box['x']},{box['y']}), Time={elapsed_ms:.1f}ms")
        except Exception as e:
            print(f"  [FAIL] {os.path.basename(img_path)}: Error - {e}")

    if len(embeddings) >= 2:
        print("\nPairwise Cosine Distances among PERSON_001 DeepFace Embeddings:")
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                d = cosine_distance(embeddings[i]["embedding"], embeddings[j]["embedding"])
                name_i = os.path.basename(embeddings[i]["path"])
                name_j = os.path.basename(embeddings[j]["path"])
                status_str = "MATCH [OK]" if d <= 0.40 else "MISMATCH [FAIL]"
                print(f"  {name_i} vs {name_j}: Distance = {d:.4f} ({status_str})")

    print("\n==================================================")
    print("DeepFace Verification Test Completed.")
    print("==================================================")

if __name__ == "__main__":
    main()
