"""
Multi-Face Recognition Server
Uses dlib + face_recognition for detecting and encoding multiple faces simultaneously.
Keeps backward compatibility with the existing single-face /extract-embedding endpoint.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import cv2
import numpy as np
import base64
import face_recognition
from typing import List, Optional
import time

app = FastAPI(title="Multi-Face Recognition API (dlib)")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("✅ dlib + face_recognition loaded successfully!")
print("   Supports multiple face detection per frame")


# ============ Helpers ============

def base64_to_image(base64_str: str) -> np.ndarray:
    """Convert base64 string to RGB numpy array (face_recognition expects RGB)."""
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(status_code=400, detail="Invalid image format")
    # Convert BGR → RGB for face_recognition
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    return img_rgb


def cosine_similarity(a, b):
    """Cosine similarity between two vectors."""
    a = np.array(a, dtype=np.float64)
    b = np.array(b, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


# ============ Routes ============

@app.get("/")
async def root():
    return {
        "message": "Multi-Face Recognition API (dlib)",
        "model": "dlib / face_recognition",
        "features": ["single-face", "multi-face"],
        "status": "running"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": "dlib", "multi_face": True}


@app.post("/extract-embedding")
async def extract_embedding(data: dict):
    """
    Backward-compatible: extract embedding for the FIRST detected face.
    Returns a 128-dimensional dlib embedding.
    """
    try:
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")

        img_rgb = base64_to_image(image_b64)

        # Detect face locations (use 'hog' for speed, 'cnn' for accuracy)
        face_locations = face_recognition.face_locations(img_rgb, model="hog")

        if not face_locations:
            return {"detected": False, "error": "No face detected in image"}

        # Get encoding for first face
        face_encodings = face_recognition.face_encodings(img_rgb, [face_locations[0]])

        if not face_encodings:
            return {"detected": False, "error": "Could not compute face encoding"}

        encoding = face_encodings[0].tolist()
        top, right, bottom, left = face_locations[0]

        return {
            "detected": True,
            "embedding": encoding,
            "embedding_size": len(encoding),
            "confidence": 1.0,  # dlib doesn't provide confidence per-face
            "box": [left, top, right - left, bottom - top],
            "num_faces": len(face_locations)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error extracting embedding: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-multiple-embeddings")
async def extract_multiple_embeddings(data: dict):
    """
    Extract embeddings for ALL detected faces in a single image.
    Returns an array of {embedding, box} for each face found.
    """
    try:
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")

        t0 = time.time()
        img_rgb = base64_to_image(image_b64)

        # Detect all faces
        face_locations = face_recognition.face_locations(img_rgb, model="hog")

        if not face_locations:
            return {
                "detected": False,
                "faces": [],
                "num_faces": 0,
                "processing_time_ms": round((time.time() - t0) * 1000)
            }

        # Compute encodings for ALL detected faces at once (batch)
        face_encodings = face_recognition.face_encodings(img_rgb, face_locations)

        faces = []
        for i, (encoding, location) in enumerate(zip(face_encodings, face_locations)):
            top, right, bottom, left = location
            faces.append({
                "index": i,
                "embedding": encoding.tolist(),
                "embedding_size": len(encoding),
                "box": {
                    "left": int(left),
                    "top": int(top),
                    "right": int(right),
                    "bottom": int(bottom),
                    "width": int(right - left),
                    "height": int(bottom - top)
                }
            })

        elapsed = round((time.time() - t0) * 1000)
        print(f"🔍 Detected {len(faces)} face(s) in {elapsed}ms")

        return {
            "detected": True,
            "faces": faces,
            "num_faces": len(faces),
            "processing_time_ms": elapsed
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error extracting multiple embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class VerifyRequest(BaseModel):
    image: str
    stored_embedding: List[float]


@app.post("/verify")
async def verify_face(request: VerifyRequest):
    """Verify if captured face matches a stored embedding."""
    try:
        img_rgb = base64_to_image(request.image)
        face_locations = face_recognition.face_locations(img_rgb, model="hog")

        if not face_locations:
            return {"verified": False, "error": "No face detected in captured image"}

        face_encodings = face_recognition.face_encodings(img_rgb, [face_locations[0]])
        if not face_encodings:
            return {"verified": False, "error": "Could not compute face encoding"}

        captured = face_encodings[0]
        stored = np.array(request.stored_embedding)

        # face_recognition uses Euclidean distance; threshold 0.6 is standard
        distance = float(np.linalg.norm(captured - stored))
        similarity = cosine_similarity(captured, stored)

        THRESHOLD = 0.70
        verified = similarity >= THRESHOLD

        return {
            "verified": verified,
            "similarity": similarity,
            "distance": distance,
            "threshold": THRESHOLD,
            "confidence": similarity * 100,
            "face_confidence": 1.0
        }

    except Exception as e:
        print(f"❌ Error verifying face: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare-embeddings")
async def compare_embeddings(data: dict):
    """Compare two embeddings directly."""
    try:
        embedding1 = np.array(data.get("embedding1"))
        embedding2 = np.array(data.get("embedding2"))

        if len(embedding1) != len(embedding2):
            raise HTTPException(
                status_code=400,
                detail=f"Embedding size mismatch: {len(embedding1)} vs {len(embedding2)}"
            )

        similarity = cosine_similarity(embedding1, embedding2)
        THRESHOLD = 0.70

        return {
            "similarity": similarity,
            "threshold": THRESHOLD,
            "match": similarity >= THRESHOLD,
            "confidence": similarity * 100
        }

    except Exception as e:
        print(f"❌ Error comparing embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Main ============

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("🚀 Multi-Face Recognition API Server (dlib)")
    print("=" * 60)
    print("📍 URL: http://localhost:8000")
    print("📖 Docs: http://localhost:8000/docs")
    print("🔧 Model: dlib / face_recognition")
    print("🎯 Embedding Size: 128 dimensions")
    print("👥 Multi-Face: YES — detects all faces per frame")
    print("📊 Threshold: 70% cosine similarity")
    print("=" * 60 + "\n")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
