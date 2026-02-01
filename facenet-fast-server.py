"""
Lightweight FaceNet Server using face_recognition library
Much faster than keras-facenet/TensorFlow
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import face_recognition
import numpy as np
import cv2
import base64
from typing import List

app = FastAPI(title="FaceNet Recognition API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("✅ Face recognition library loaded successfully!")

class VerifyRequest(BaseModel):
    image: str
    stored_embedding: List[float]

def base64_to_image(base64_str: str) -> np.ndarray:
    """Convert base64 string to numpy array"""
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image format")
    
    # Convert BGR to RGB (face_recognition uses RGB)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img_rgb

def cosine_similarity(a, b):
    """Calculate cosine similarity between two embeddings"""
    a = np.array(a)
    b = np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

@app.get("/")
async def root():
    return {
        "message": "FaceNet Recognition API",
        "model": "face_recognition (dlib)",
        "status": "running"
    }

@app.post("/health")
async def health_check():
    return {"status": "healthy", "model": "face_recognition"}

@app.post("/extract-embedding")
async def extract_embedding(data: dict):
    """
    Extract face embedding from base64 image
    Returns 128-dimensional face encoding
    """
    try:
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")
        
        img_rgb = base64_to_image(image_b64)
        
        # Detect face locations
        face_locations = face_recognition.face_locations(img_rgb, model="hog")
        
        if not face_locations or len(face_locations) == 0:
            return {
                "detected": False,
                "error": "No face detected in image"
            }
        
        # Extract face encodings (128D)
        face_encodings = face_recognition.face_encodings(img_rgb, face_locations)
        
        if not face_encodings:
            return {
                "detected": False,
                "error": "Could not generate face encoding"
            }
        
        # Get first face
        encoding = face_encodings[0]
        location = face_locations[0]
        
        # Calculate confidence based on face size
        top, right, bottom, left = location
        face_area = (bottom - top) * (right - left)
        img_area = img_rgb.shape[0] * img_rgb.shape[1]
        confidence = min(face_area / img_area * 10, 0.99)  # Normalize to 0-0.99
        
        return {
            "detected": True,
            "embedding": encoding.tolist(),
            "embedding_size": len(encoding),
            "confidence": float(confidence),
            "box": [left, top, right, bottom],
            "num_faces": len(face_locations)
        }
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify")
async def verify_face(request: VerifyRequest):
    """
    Verify if captured face matches stored embedding
    """
    try:
        img_rgb = base64_to_image(request.image)
        
        # Extract embedding from captured image
        face_locations = face_recognition.face_locations(img_rgb, model="hog")
        
        if not face_locations:
            return {
                "verified": False,
                "error": "No face detected in captured image",
                "similarity": 0,
                "threshold": 0.60,
                "confidence": 0
            }
        
        face_encodings = face_recognition.face_encodings(img_rgb, face_locations)
        
        if not face_encodings:
            return {
                "verified": False,
                "error": "Could not generate face encoding",
                "similarity": 0,
                "threshold": 0.60,
                "confidence": 0
            }
        
        captured_embedding = face_encodings[0]
        stored_embedding = np.array(request.stored_embedding)
        
        # Validate embedding dimensions
        if len(captured_embedding) != len(stored_embedding):
            raise HTTPException(
                status_code=400,
                detail=f"Embedding size mismatch: {len(captured_embedding)} vs {len(stored_embedding)}"
            )
        
        # Calculate similarity
        similarity = cosine_similarity(captured_embedding, stored_embedding)
        
        # face_recognition threshold (60% is good for this model)
        THRESHOLD = 0.60
        verified = similarity >= THRESHOLD
        
        return {
            "verified": verified,
            "similarity": similarity,
            "threshold": THRESHOLD,
            "confidence": similarity * 100
        }
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/compare-embeddings")
async def compare_embeddings(data: dict):
    """Compare two embeddings directly"""
    try:
        embedding1 = np.array(data.get("embedding1"))
        embedding2 = np.array(data.get("embedding2"))
        
        if len(embedding1) != len(embedding2):
            raise HTTPException(
                status_code=400,
                detail=f"Embedding size mismatch"
            )
        
        similarity = cosine_similarity(embedding1, embedding2)
        THRESHOLD = 0.60
        
        return {
            "similarity": similarity,
            "threshold": THRESHOLD,
            "match": similarity >= THRESHOLD,
            "confidence": similarity * 100
        }
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🚀 Starting FaceNet Recognition API Server")
    print("="*60)
    print("📍 URL: http://localhost:8000")
    print("📖 Docs: http://localhost:8000/docs")
    print("🔧 Model: face_recognition (dlib-based)")
    print("🎯 Embedding Size: 128 dimensions")
    print("📊 Threshold: 60% cosine similarity")
    print("⚡ Fast startup - no TensorFlow!")
    print("="*60 + "\n")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
