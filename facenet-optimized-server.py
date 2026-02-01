from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import numpy as np
from PIL import Image
import io
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy load heavy dependencies
facenet_model = None
mtcnn_detector = None

def load_models():
    """Load models on first use"""
    global facenet_model, mtcnn_detector
    
    if facenet_model is None:
        logger.info("Loading FaceNet model...")
        from keras_facenet import FaceNet
        facenet_model = FaceNet()
        logger.info("FaceNet model loaded")
    
    if mtcnn_detector is None:
        logger.info("Loading MTCNN detector...")
        from mtcnn import MTCNN
        mtcnn_detector = MTCNN()
        logger.info("MTCNN detector loaded")
    
    return facenet_model, mtcnn_detector

class ImageData(BaseModel):
    image: str  # base64 encoded image

class EmbeddingData(BaseModel):
    embedding1: list
    embedding2: list

@app.get("/health")
async def health_check():
    """Quick health check without loading models"""
    return {"status": "ok", "models_loaded": facenet_model is not None}

@app.post("/extract-embedding")
async def extract_embedding(data: ImageData):
    """Extract 512D embedding from image"""
    try:
        # Load models on first use
        model, detector = load_models()
        
        # Decode base64 image
        image_data = base64.b64decode(data.image.split(',')[1] if ',' in data.image else data.image)
        image = Image.open(io.BytesIO(image_data))
        image_array = np.array(image)
        
        # Detect face
        faces = detector.detect_faces(image_array)
        if not faces or len(faces) == 0:
            raise HTTPException(status_code=400, detail="No face detected")
        
        # Get the largest face
        face = max(faces, key=lambda f: f['box'][2] * f['box'][3])
        
        # Extract face region with padding
        x, y, w, h = face['box']
        padding = 20
        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(image_array.shape[1], x + w + padding)
        y2 = min(image_array.shape[0], y + h + padding)
        
        face_img = image_array[y1:y2, x1:x2]
        
        # Resize to 160x160 for FaceNet
        face_img = Image.fromarray(face_img).resize((160, 160))
        face_array = np.array(face_img)
        
        # Extract embedding
        embedding = model.embeddings([face_array])[0]
        
        return {
            "embedding": embedding.tolist(),
            "dimension": len(embedding),
            "confidence": face['confidence']
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting embedding: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/verify")
async def verify_faces(data: ImageData):
    """Verify face against stored embedding"""
    try:
        # Extract embedding from captured image
        result = await extract_embedding(data)
        return result
        
    except Exception as e:
        logger.error(f"Error verifying face: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/compare-embeddings")
async def compare_embeddings(data: EmbeddingData):
    """Compare two embeddings and return similarity"""
    try:
        emb1 = np.array(data.embedding1)
        emb2 = np.array(data.embedding2)
        
        # Cosine similarity
        dot_product = np.dot(emb1, emb2)
        norm1 = np.linalg.norm(emb1)
        norm2 = np.linalg.norm(emb2)
        similarity = dot_product / (norm1 * norm2)
        
        # Convert to percentage
        similarity_percent = float(similarity * 100)
        
        return {
            "similarity": similarity_percent,
            "match": similarity_percent >= 70.0
        }
        
    except Exception as e:
        logger.error(f"Error comparing embeddings: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FaceNet server on http://localhost:8000")
    logger.info("Models will be loaded on first request...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
