import cv2
import json
import numpy as np
from keras_facenet import FaceNet

DB_FILE = "embeddings.json"
embedder = FaceNet()

def cosine_similarity(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def load_db():
    with open(DB_FILE, "r") as f:
        return json.load(f)

def recognize_face(image_path, threshold=0.75):
    img = cv2.imread(image_path)
    if img is None:
        print("❌ Image not found")
        return

    faces = embedder.extract(img, threshold=0.95)
    if not faces:
        print("❌ No face detected")
        return

    new_embedding = faces[0]["embedding"]

    users = load_db()

    best_match = None
    best_score = 0

    for user in users:
        score = cosine_similarity(new_embedding, user["embedding"])
        if score > best_score:
            best_score = score
            best_match = user

    if best_match and best_score > threshold:
        print(f"✅ Match Found: {best_match['name']} ({best_match['student_id']})")
        print("Similarity:", round(best_score, 3))
    else:
        print("❌ No match found")
        print("Best similarity:", round(best_score, 3))

if __name__ == "__main__":
    recognize_face("photos/test.jpg")
