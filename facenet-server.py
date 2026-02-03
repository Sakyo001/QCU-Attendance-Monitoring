"""
FaceNet Face Recognition Server
Uses keras-facenet for high-accuracy face recognition
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import cv2
import numpy as np
import json
import os
from typing import List, Optional
from keras_facenet import FaceNet
import base64

app = FastAPI(title="FaceNet Face Recognition API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize FaceNet
print("🔄 Loading FaceNet model...")
print("   This may take a moment on first run...")

# Suppress TensorFlow warnings
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

# Initialize with GPU/CPU setting
embedder = FaceNet()
print("✅ FaceNet model loaded successfully!")

class RegisterRequest(BaseModel):
    image: str  # base64
    name: str
    user_id: str
    user_type: str  # 'student' or 'professor'

class RecognizeRequest(BaseModel):
    image: str  # base64
    user_type: str  # 'student' or 'professor'

class VerifyRequest(BaseModel):
    image: str  # base64
    stored_embedding: List[float]

def cosine_similarity(a, b):
    """Calculate cosine similarity between two embeddings"""
    a = np.array(a)
    b = np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

def base64_to_image(base64_str: str) -> np.ndarray:
    """Convert base64 string to OpenCV image"""
    # Remove data URL prefix if present
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    
    # Decode base64
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image format")
    
    return img

@app.get("/")
async def root():
    return {
        "message": "FaceNet Face Recognition API",
        "model": "keras-facenet",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": "keras-facenet"}

@app.post("/extract-embedding")
async def extract_embedding(data: dict):
    """
    Extract face embedding from base64 image
    Returns 512-dimensional FaceNet embedding
    """
    try:
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")
        
        # Convert base64 to image
        img = base64_to_image(image_b64)
        
        # Extract face embedding
        faces = embedder.extract(img, threshold=0.95)
        
        if not faces or len(faces) == 0:
            return {
                "detected": False,
                "error": "No face detected in image"
            }
        
        # Get first face
        face = faces[0]
        embedding = face["embedding"].tolist()
        
        # Get face box coordinates
        box = face["box"]
        confidence = face["confidence"]
        
        return {
            "detected": True,
            "embedding": embedding,
            "embedding_size": len(embedding),
            "confidence": float(confidence),
            "box": box.tolist() if hasattr(box, 'tolist') else box,
            "num_faces": len(faces)
        }
        
    except Exception as e:
        print(f"❌ Error extracting embedding: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify")
async def verify_face(request: VerifyRequest):
    """
    Verify if captured face matches stored embedding
    """
    try:
        # Convert base64 to image
        img = base64_to_image(request.image)
        
        # Extract embedding from captured image
        faces = embedder.extract(img, threshold=0.95)
        
        if not faces or len(faces) == 0:
            return {
                "verified": False,
                "error": "No face detected in captured image"
            }
        
        captured_embedding = faces[0]["embedding"]
        stored_embedding = np.array(request.stored_embedding)
        
        # Validate embedding dimensions
        if len(captured_embedding) != len(stored_embedding):
            raise HTTPException(
                status_code=400,
                detail=f"Embedding size mismatch: {len(captured_embedding)} vs {len(stored_embedding)}"
            )
        
        # Calculate similarity
        similarity = cosine_similarity(captured_embedding, stored_embedding)
        
        # FaceNet threshold (70% for good match)
        THRESHOLD = 0.70
        verified = similarity >= THRESHOLD
        
        return {
            "verified": verified,
            "similarity": similarity,
            "threshold": THRESHOLD,
            "confidence": similarity * 100,
            "face_confidence": float(faces[0]["confidence"])
        }
        
    except Exception as e:
        print(f"❌ Error verifying face: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/compare-embeddings")
async def compare_embeddings(data: dict):
    """
    Compare two embeddings directly
    """
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
        print(f"❌ Error comparing embeddings: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🚀 Starting FaceNet Face Recognition API Server")
    print("="*60)
    print("📍 URL: http://localhost:8000")
    print("📖 Docs: http://localhost:8000/docs")
    print("🔧 Model: keras-facenet (FaceNet)")
    print("🎯 Embedding Size: 512 dimensions")
    print("📊 Threshold: 70% cosine similarity")
    print("="*60 + "\n")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
