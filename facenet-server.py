"""
FaceNet Real-Time Multi-Face Recognition Server

Architecture inspired by Multiperson-Face-Recognition (dlib + face_recognition).
- Fast face detection using HOG (face_recognition/dlib) or Haar cascade (OpenCV fallback)
- 512D FaceNet embeddings from keras-facenet (compatible with DB-stored descriptors)
- In-memory session cache for enrolled student face descriptors
- WebSocket endpoint for true real-time frame streaming (~5-10 fps)
- HTTP fallback for single-frame recognition

Speed improvement:
  OLD: Client -> HTTP extract-embedding (MTCNN ~500ms) -> HTTP match-faces -> HTTP mark
  NEW: Client -> WebSocket frame -> HOG detect (~30ms) + FaceNet embed (~50ms) + in-memory match (~1ms) -> result
"""

# Fix TensorFlow/Keras compatibility - use Keras 2.x API
import os
os.environ['TF_USE_LEGACY_KERAS'] = '1'

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import cv2
import numpy as np
import json
from typing import List, Optional
import base64
import time
import asyncio

# ============ Environment Config ============

PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")

# CORS origins: comma-separated list via env, fallback to localhost for dev
_cors_env = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()]

RECOG_THRESHOLD = float(os.environ.get("RECOGNITION_THRESHOLD", "0.70"))

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

from keras_facenet import FaceNet

app = FastAPI(title="FaceNet Real-Time Multi-Face Recognition API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Model Loading ============

print("=" * 60)
print("Loading FaceNet model...")
embedder = FaceNet()
print("FaceNet model loaded (512D embeddings)")

# Try to load face_recognition (dlib HOG) for fast detection
try:
    import face_recognition as fr
    FAST_DETECTOR = "dlib_hog"
    print("face_recognition (dlib HOG) loaded - fast detection enabled")
except ImportError:
    FAST_DETECTOR = "haar"
    print("face_recognition not available - using OpenCV Haar cascade")

# OpenCV Haar cascade (always available fallback)
_haar_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
)
print("=" * 60)


# ============ Session Cache ============

_session = {
    "active": False,
    "section_id": None,
    "students": [],
}


# ============ Request Models ============

class VerifyRequest(BaseModel):
    image: str
    stored_embedding: List[float]


# ============ Helpers ============

def base64_to_image(base64_str: str) -> np.ndarray:
    """Convert base64 string to OpenCV BGR image with error handling."""
    try:
        # Remove data URL prefix if present
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        
        # Decode base64
        img_bytes = base64.b64decode(base64_str)
        
        if len(img_bytes) == 0:
            print("Error: Empty base64 data received")
            raise HTTPException(status_code=400, detail="Empty image data")
        
        # Convert to numpy array
        nparr = np.frombuffer(img_bytes, np.uint8)
        
        if len(nparr) == 0:
            print("Error: Empty numpy buffer")
            raise HTTPException(status_code=400, detail="Failed to create image buffer")
        
        # Decode image
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            print(f"Error: cv2.imdecode failed. Buffer size: {len(img_bytes)} bytes")
            raise HTTPException(status_code=400, detail="Invalid image format - could not decode")
        
        return img
        
    except base64.binascii.Error as e:
        print(f"Error: Base64 decode failed: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid base64 encoding: {str(e)}")
    except Exception as e:
        print(f"Error in base64_to_image: {e}")
        raise HTTPException(status_code=400, detail=f"Image processing error: {str(e)}")


def cosine_similarity(a, b):
    a = np.array(a, dtype=np.float64)
    b = np.array(b, dtype=np.float64)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def detect_faces_fast(img_bgr: np.ndarray, scale: float = 0.5):
    """
    Fast multi-face detection using the best available backend.
    Returns list of face boxes with coordinates in ORIGINAL image space.

    - dlib HOG: ~30-50ms (most accurate, requires face_recognition)
    - OpenCV Haar: ~5-15ms (fast fallback, always available)
    """
    h, w = img_bgr.shape[:2]
    sw, sh = int(w * scale), int(h * scale)
    small = cv2.resize(img_bgr, (sw, sh))

    boxes = []

    if FAST_DETECTOR == "dlib_hog":
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        locations = fr.face_locations(rgb, model="hog")
        for (top, right, bottom, left) in locations:
            boxes.append({
                "left": int(left / scale),
                "top": int(top / scale),
                "right": int(right / scale),
                "bottom": int(bottom / scale),
                "width": int((right - left) / scale),
                "height": int((bottom - top) / scale),
            })
    else:
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        rects = _haar_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=7, minSize=(40, 40)
        )
        for (x, y, fw, fh) in rects:
            boxes.append({
                "left": int(x / scale),
                "top": int(y / scale),
                "right": int((x + fw) / scale),
                "bottom": int((y + fh) / scale),
                "width": int(fw / scale),
                "height": int(fh / scale),
            })

    return boxes


def crop_and_embed(img_bgr: np.ndarray, boxes: list):
    """
    Crop detected face regions, resize to 160x160, extract 512D FaceNet embeddings.
    Uses embedder.embeddings() which skips MTCNN (the main bottleneck).
    Returns list of (box_index, embedding_list) tuples.
    """
    if not boxes:
        return []

    h, w = img_bgr.shape[:2]
    crops = []
    valid_indices = []

    for i, b in enumerate(boxes):
        pad_x = int(b["width"] * 0.15)
        pad_y = int(b["height"] * 0.15)
        x1 = max(0, b["left"] - pad_x)
        y1 = max(0, b["top"] - pad_y)
        x2 = min(w, b["right"] + pad_x)
        y2 = min(h, b["bottom"] + pad_y)

        region = img_bgr[y1:y2, x1:x2]
        if region.size == 0:
            continue

        face = cv2.resize(region, (160, 160))
        # Convert BGR to RGB for FaceNet
        face_rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
        crops.append(face_rgb)
        valid_indices.append(i)

    if not crops:
        return []

    arr = np.array(crops)
    embs = embedder.embeddings(arr)
    return [(valid_indices[j], embs[j].tolist()) for j in range(len(crops))]


def _match_against_session_impl(emb_pairs: list, boxes: list, threshold: float = 0.70):
    """
    Match detected face embeddings against session-cached student embeddings.
    Uses numpy cosine similarity for fast in-memory matching.
    Prevents same student being matched to multiple faces.
    """
    results = []
    matched_ids = set()

    for (face_idx, emb) in emb_pairs:
        emb_np = np.array(emb, dtype=np.float64)
        best_sim = -1.0
        best_student = None

        for st in _session["students"]:
            if st["id"] in matched_ids:
                continue
            sim = cosine_similarity(emb_np, st["embedding"])
            if sim > best_sim:
                best_sim = sim
                best_student = st

        box = boxes[face_idx]

        if best_student and best_sim >= threshold:
            matched_ids.add(best_student["id"])
            results.append({
                "index": face_idx,
                "matched": True,
                "studentId": best_student["id"],
                "name": best_student["name"],
                "studentNumber": best_student.get("student_number", ""),
                "confidence": round(best_sim, 4),
                "box": box,
            })
        else:
            results.append({
                "index": face_idx,
                "matched": False,
                "name": "Unknown",
                "confidence": round(best_sim, 4) if best_sim > 0 else None,
                "box": box,
            })

    return results


def match_against_session(emb_pairs: list, boxes: list, threshold: float = None):
    """Wrapper that uses RECOG_THRESHOLD env var as default."""
    if threshold is None:
        threshold = RECOG_THRESHOLD
    return _match_against_session_impl(emb_pairs, boxes, threshold)


def process_frame(img_bgr: np.ndarray):
    """
    Full recognition pipeline for a single frame:
    1. Fast face detection (HOG/Haar)
    2. Crop + FaceNet embedding (512D, no MTCNN)
    3. Match against session cache
    """
    start = time.time()

    if not _session["active"]:
        return {
            "detected": False,
            "faces": [],
            "num_faces": 0,
            "error": "No session loaded",
            "processing_time_ms": 0,
        }

    boxes = detect_faces_fast(img_bgr, scale=0.5)
    if not boxes:
        return {
            "detected": False,
            "faces": [],
            "num_faces": 0,
            "processing_time_ms": round((time.time() - start) * 1000, 1),
        }

    emb_pairs = crop_and_embed(img_bgr, boxes)
    if not emb_pairs:
        return {
            "detected": True,
            "faces": [{"index": i, "matched": False, "name": "Unknown", "box": b, "confidence": None} for i, b in enumerate(boxes)],
            "num_faces": len(boxes),
            "processing_time_ms": round((time.time() - start) * 1000, 1),
        }

    results = match_against_session(emb_pairs, boxes)

    processing_time = round((time.time() - start) * 1000, 1)
    matched_count = sum(1 for r in results if r["matched"])
    print(f"Frame: {len(boxes)} face(s), {matched_count} matched in {processing_time}ms [{FAST_DETECTOR}]")

    return {
        "detected": True,
        "faces": results,
        "num_faces": len(results),
        "processing_time_ms": processing_time,
    }


# ============ Session Management Endpoints ============

@app.post("/load-session")
async def load_session(data: dict):
    """
    Load enrolled student face descriptors into memory for fast matching.
    Call this once when a class session starts.

    Body: { sectionId, students: [{ id, name, student_number, embedding: number[] }] }
    """
    global _session

    students_raw = data.get("students", [])
    section_id = data.get("sectionId")

    processed = []
    for s in students_raw:
        emb = s.get("embedding")
        if not emb:
            continue
        if isinstance(emb, dict):
            emb = list(emb.values())
        processed.append({
            "id": s["id"],
            "name": s.get("name", "Unknown"),
            "student_number": s.get("student_number", ""),
            "embedding": np.array(emb, dtype=np.float64),
        })

    _session = {
        "active": True,
        "section_id": section_id,
        "students": processed,
    }

    print(f"Session loaded: {len(processed)} students for section {section_id}")
    return {
        "success": True,
        "students_loaded": len(processed),
        "section_id": section_id,
    }


@app.post("/clear-session")
async def clear_session():
    global _session
    _session = {"active": False, "section_id": None, "students": []}
    print("Session cleared")
    return {"success": True}


# ============ Real-Time Recognition Endpoints ============

@app.post("/recognize-frame")
async def recognize_frame(data: dict):
    """
    Single-call real-time recognition: detect + embed + match in one HTTP request.

    Body: { image: base64 }
    Returns: { detected, faces: [{ index, matched, studentId?, name, confidence, box }], processing_time_ms }
    """
    image_b64 = data.get("image")
    if not image_b64:
        raise HTTPException(status_code=400, detail="No image provided")

    img = base64_to_image(image_b64)
    return process_frame(img)


@app.websocket("/ws/recognize")
async def ws_recognize(websocket: WebSocket):
    """
    WebSocket endpoint for true real-time face recognition.

    Client sends: { "image": "<base64 JPEG>" }
    Server responds: { "detected": bool, "faces": [...], "processing_time_ms": float }

    Natural backpressure: client waits for response before sending next frame.
    """
    await websocket.accept()
    print("WebSocket client connected for real-time recognition")

    try:
        while True:
            try:
                raw = await websocket.receive_text()
                data = json.loads(raw)

                image_b64 = data.get("image")
                if not image_b64:
                    await websocket.send_json({
                        "detected": False, "faces": [], "num_faces": 0
                    })
                    continue

                img = base64_to_image(image_b64)
                result = process_frame(img)
                await websocket.send_json(result)
                
            except HTTPException as e:
                # base64_to_image validation error - send error response
                print(f"Frame validation error: {e.detail}")
                await websocket.send_json({
                    "detected": False, "faces": [], "num_faces": 0, "error": str(e.detail)
                })
            except Exception as e:
                # Other processing errors - log and send error response
                print(f"Frame processing error: {e}")
                await websocket.send_json({
                    "detected": False, "faces": [], "num_faces": 0, "error": str(e)
                })

    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    except Exception as e:
        print(f"WebSocket connection error: {e}")


# ============ Legacy Endpoints (backward compatibility) ============

@app.get("/")
async def root():
    return {
        "message": "FaceNet Real-Time Multi-Face Recognition API",
        "model": "keras-facenet",
        "detector": FAST_DETECTOR,
        "session_active": _session["active"],
        "session_students": len(_session["students"]),
        "status": "running",
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": "keras-facenet",
        "detector": FAST_DETECTOR,
        "session_active": _session["active"],
        "session_students": len(_session["students"]),
        "threshold": RECOG_THRESHOLD,
    }


@app.post("/extract-embedding")
async def extract_embedding(data: dict):
    try:
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")

        img = base64_to_image(image_b64)
        faces = embedder.extract(img, threshold=0.95)

        if not faces or len(faces) == 0:
            return {"detected": False, "error": "No face detected in image"}

        face = faces[0]
        embedding = face["embedding"].tolist()
        box = face["box"]
        confidence = face["confidence"]

        return {
            "detected": True,
            "embedding": embedding,
            "embedding_size": len(embedding),
            "confidence": float(confidence),
            "box": box.tolist() if hasattr(box, 'tolist') else box,
            "num_faces": len(faces),
        }
    except Exception as e:
        print(f"Error extracting embedding: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-multiple-embeddings")
async def extract_multiple_embeddings(data: dict):
    try:
        start_time = time.time()
        image_b64 = data.get("image")
        if not image_b64:
            raise HTTPException(status_code=400, detail="No image provided")

        img = base64_to_image(image_b64)
        faces = embedder.extract(img, threshold=0.95)

        if not faces or len(faces) == 0:
            return {
                "detected": False,
                "faces": [],
                "num_faces": 0,
                "processing_time_ms": round((time.time() - start_time) * 1000, 1),
            }

        result_faces = []
        for i, face in enumerate(faces):
            embedding = face["embedding"].tolist()
            box = face["box"]
            if hasattr(box, 'tolist'):
                box = box.tolist()
            x1, y1, w, h = box[0], box[1], box[2], box[3]
            result_faces.append({
                "index": i,
                "embedding": embedding,
                "embedding_size": len(embedding),
                "box": {
                    "left": int(x1), "top": int(y1),
                    "right": int(x1 + w), "bottom": int(y1 + h),
                    "width": int(w), "height": int(h),
                },
            })

        return {
            "detected": True,
            "faces": result_faces,
            "num_faces": len(result_faces),
            "processing_time_ms": round((time.time() - start_time) * 1000, 1),
        }
    except Exception as e:
        print(f"Error extracting multiple embeddings: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/verify")
async def verify_face(request: VerifyRequest):
    try:
        img = base64_to_image(request.image)
        faces = embedder.extract(img, threshold=0.95)
        if not faces or len(faces) == 0:
            return {"verified": False, "error": "No face detected"}
        captured_embedding = faces[0]["embedding"]
        stored_embedding = np.array(request.stored_embedding)
        if len(captured_embedding) != len(stored_embedding):
            raise HTTPException(400, f"Embedding size mismatch: {len(captured_embedding)} vs {len(stored_embedding)}")
        similarity = cosine_similarity(captured_embedding, stored_embedding)
        THRESHOLD = RECOG_THRESHOLD
        return {
            "verified": similarity >= THRESHOLD,
            "similarity": similarity,
            "threshold": THRESHOLD,
            "confidence": similarity * 100,
            "face_confidence": float(faces[0]["confidence"]),
        }
    except Exception as e:
        print(f"Error verifying face: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare-embeddings")
async def compare_embeddings(data: dict):
    try:
        embedding1 = np.array(data.get("embedding1"))
        embedding2 = np.array(data.get("embedding2"))
        if len(embedding1) != len(embedding2):
            raise HTTPException(400, f"Embedding size mismatch: {len(embedding1)} vs {len(embedding2)}")
        similarity = cosine_similarity(embedding1, embedding2)
        THRESHOLD = RECOG_THRESHOLD
        return {
            "similarity": similarity,
            "threshold": THRESHOLD,
            "match": similarity >= THRESHOLD,
            "confidence": similarity * 100,
        }
    except Exception as e:
        print(f"Error comparing embeddings: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Main ============

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("Starting FaceNet Real-Time Multi-Face Recognition Server")
    print("=" * 60)
    if FAST_DETECTOR == "dlib_hog":
        det_info = "dlib HOG ~30ms"
    else:
        det_info = "OpenCV Haar ~10ms"
    print(f"URL: http://{HOST}:{PORT}")
    print(f"Docs: http://{HOST}:{PORT}/docs")
    print(f"Detector: {FAST_DETECTOR} ({det_info})")
    print(f"Embedder: keras-facenet (512D)")
    print(f"WebSocket: ws://{HOST}:{PORT}/ws/recognize")
    print(f"Threshold: {RECOG_THRESHOLD * 100:.0f}% cosine similarity")
    print(f"CORS Origins: {ALLOWED_ORIGINS}")
    print("=" * 60 + "\n")

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        # WebSocket ping/pong keepalive for Railway's 60s idle timeout
        ws_ping_interval=20,
        ws_ping_timeout=30,
    )
