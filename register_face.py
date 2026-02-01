import cv2
import json
import os
import numpy as np
from keras_facenet import FaceNet

DB_FILE = "embeddings.json"
embedder = FaceNet()

def load_db():
    if not os.path.exists(DB_FILE):
        return []
    with open(DB_FILE, "r") as f:
        return json.load(f)

def save_db(data):
    with open(DB_FILE, "w") as f:
        json.dump(data, f)

def register_face(image_path, name, student_id):
    img = cv2.imread(image_path)
    if img is None:
        print("❌ Image not found")
        return

    faces = embedder.extract(img, threshold=0.95)
    if not faces:
        print("❌ No face detected")
        return

    embedding = faces[0]["embedding"].tolist()

    db = load_db()
    db.append({
        "name": name,
        "student_id": student_id,
        "embedding": embedding
    })

    save_db(db)
    print(f"✅ Registered: {name} ({student_id})")

if __name__ == "__main__":
    register_face("photos/register.jpg", "Juan Dela Cruz", "2024-001")
