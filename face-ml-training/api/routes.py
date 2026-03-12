"""
routes.py
---------
FastAPI route definitions for the Face Recognition Attendance API.

Endpoints
---------
  POST /register          — Upload images, generate embedding, store user
  POST /recognize         — Upload a camera frame, run full pipeline
  POST /attendance        — Manually record attendance (internal use)
  GET  /users             — List all registered users
  GET  /users/{user_id}   — Single user detail
  DELETE /users/{user_id} — Remove a user
  GET  /attendance        — Query attendance records (with optional filters)
  GET  /health            — Liveness probe
"""

from __future__ import annotations

import io
import uuid
from typing import List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RegisterResponse(BaseModel):
    success: bool
    user_id: str
    name: str
    message: str
    num_images_used: int


class RecognizeResponse(BaseModel):
    user_id: Optional[str]
    name: Optional[str]
    spoof_detected: bool
    spoof_label: str
    real_confidence: float
    confidence: float          # recognition cosine similarity
    is_recognized: bool
    bbox: Optional[List[int]]
    processing_ms: float


class AttendanceRecord(BaseModel):
    id: int
    user_id: str
    name: str
    timestamp: str
    status: str
    confidence: float


class UserSummary(BaseModel):
    id: str
    name: str
    created_at: str


class LogAttendanceRequest(BaseModel):
    user_id: str
    status: str = Field(default="present", pattern="^(present|late|absent)$")
    confidence: float = 0.0
    timestamp: Optional[str] = None


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------

def create_router(engine_ref: dict, db_ref: dict) -> APIRouter:
    """
    Create the APIRouter with injected references to the shared
    recognition engine and DB manager.

    Args:
        engine_ref: {"engine": RecognitionEngine instance}
        db_ref:     {"db": DBManager instance}
    """
    router = APIRouter()

    def get_engine():
        return engine_ref["engine"]

    def get_db():
        return db_ref["db"]

    # ── Health ────────────────────────────────────────────────────────────

    @router.get("/health", tags=["System"])
    async def health():
        return {"status": "ok", "service": "face-recognition-api"}

    # ── Registration ──────────────────────────────────────────────────────

    @router.post("/register", response_model=RegisterResponse, tags=["Registration"])
    async def register_user(
        name: str = Form(..., description="Full name of the person to register"),
        user_id: Optional[str] = Form(
            default=None,
            description="Optional user ID. Auto-generated UUID if omitted.",
        ),
        images: List[UploadFile] = File(
            ..., description="10–20 face images (JPEG / PNG)"
        ),
        engine=Depends(get_engine),
        db=Depends(get_db),
    ):
        """
        Register a new user from multiple face images.

        Send a multipart/form-data request with:
          - name (string)
          - user_id (optional string)
          - images[] (list of image files)
        """
        if not images:
            raise HTTPException(status_code=422, detail="No images provided.")
        if len(images) > 40:
            raise HTTPException(status_code=422, detail="Too many images. Maximum 40.")

        resolved_id = user_id or str(uuid.uuid4())

        # Decode all uploaded images to BGR numpy arrays
        bgr_frames = await _decode_uploads(images)
        if not bgr_frames:
            raise HTTPException(
                status_code=422, detail="Could not decode any uploaded images."
            )

        # Compute averaged embedding
        embedding, num_valid = engine.get_registration_embedding(bgr_frames, min_images=5)

        if embedding is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Only {num_valid} valid face(s) detected from {len(bgr_frames)} images. "
                    "Upload at least 10 clear face images (minimum 5 valid faces required)."
                ),
            )

        # Persist to DB
        try:
            await db.upsert_user(resolved_id, name, embedding)
        except Exception as exc:
            logger.exception("DB write failed during registration")
            raise HTTPException(status_code=500, detail=f"Database error: {exc}")

        # Update live FAISS index
        engine.add_to_index(resolved_id, name, embedding)

        return RegisterResponse(
            success=True,
            user_id=resolved_id,
            name=name,
            message="User registered successfully.",
            num_images_used=num_valid,
        )

    # ── Recognition ───────────────────────────────────────────────────────

    @router.post("/recognize", response_model=RecognizeResponse, tags=["Recognition"])
    async def recognize_face(
        image: UploadFile = File(..., description="Single camera frame (JPEG / PNG)"),
        engine=Depends(get_engine),
    ):
        """
        Recognize the largest face in an uploaded camera frame.

        Returns spoof status, recognized user (if any), and confidence.
        """
        frame = await _decode_single_upload(image)
        if frame is None:
            raise HTTPException(status_code=422, detail="Could not decode image.")

        result = engine.recognize_single(frame)

        if result is None:
            return RecognizeResponse(
                user_id=None,
                name=None,
                spoof_detected=False,
                spoof_label="real",
                real_confidence=0.0,
                confidence=0.0,
                is_recognized=False,
                bbox=None,
                processing_ms=0.0,
            )

        return RecognizeResponse(
            user_id=result.user_id,
            name=result.name,
            spoof_detected=result.spoof_detected,
            spoof_label=result.spoof_label,
            real_confidence=result.real_confidence,
            confidence=result.confidence,
            is_recognized=result.is_recognized,
            bbox=list(result.bbox),
            processing_ms=result.processing_ms,
        )

    # ── Attendance ────────────────────────────────────────────────────────

    @router.post("/attendance", tags=["Attendance"])
    async def log_attendance(
        body: LogAttendanceRequest,
        db=Depends(get_db),
    ):
        """
        Manually log an attendance record (called by the frontend after
        a successful /recognize response).
        """
        user = await db.get_user(body.user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")

        record = await db.log_attendance(
            user_id=body.user_id,
            confidence=body.confidence,
            status=body.status,
            timestamp=body.timestamp,
        )
        return {"success": True, "record": record}

    @router.get("/attendance", response_model=List[AttendanceRecord], tags=["Attendance"])
    async def get_attendance(
        user_id: Optional[str] = Query(default=None),
        date_from: Optional[str] = Query(default=None, description="YYYY-MM-DD"),
        date_to:   Optional[str] = Query(default=None, description="YYYY-MM-DD"),
        limit:     int           = Query(default=200, ge=1, le=1000),
        db=Depends(get_db),
    ):
        """Query attendance records. All filters are optional."""
        records = await db.get_attendance(
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
        )
        return records

    # ── Users ─────────────────────────────────────────────────────────────

    @router.get("/users", response_model=List[UserSummary], tags=["Users"])
    async def list_users(db=Depends(get_db)):
        """Return all registered users (no embeddings)."""
        return await db.get_all_users()

    @router.get("/users/{user_id}", response_model=UserSummary, tags=["Users"])
    async def get_user(user_id: str, db=Depends(get_db)):
        """Return a single user by ID."""
        user = await db.get_user(user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")
        # Exclude embedding from response
        return {"id": user["id"], "name": user["name"], "created_at": user["created_at"]}

    @router.delete("/users/{user_id}", tags=["Users"])
    async def delete_user(user_id: str, engine=Depends(get_engine), db=Depends(get_db)):
        """Delete a user and all their attendance records."""
        deleted = await db.delete_user(user_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="User not found.")
        engine.remove_from_index(user_id)
        return {"success": True, "user_id": user_id}

    return router


# ---------------------------------------------------------------------------
# Upload decoding helpers
# ---------------------------------------------------------------------------

async def _decode_single_upload(upload: UploadFile) -> Optional[np.ndarray]:
    """Safely decode a single uploaded image file to a BGR numpy array."""
    try:
        content = await upload.read()
        buf = np.frombuffer(content, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        return img
    except Exception as exc:
        logger.warning(f"Failed to decode upload '{upload.filename}': {exc}")
        return None


async def _decode_uploads(uploads: List[UploadFile]) -> List[np.ndarray]:
    """Decode a list of uploaded files; silently skip invalid ones."""
    results = []
    for upload in uploads:
        img = await _decode_single_upload(upload)
        if img is not None:
            results.append(img)
    return results


# ---------------------------------------------------------------------------
# Legacy-Compatible Router
# ---------------------------------------------------------------------------

def create_legacy_router(engine_ref: dict, session_store: dict) -> APIRouter:
    """
    Drop-in endpoint set matching the original facenet-server.py API surface.
    Mounted at root level (no /api/v1 prefix) so existing frontend code works
    without any URL changes.

    All detection, anti-spoofing, and embedding extraction is now handled by
    RecognitionEngine which uses DeepFace internally.
    """
    import base64

    router = APIRouter(tags=["Legacy"])

    def get_engine():
        return engine_ref["engine"]

    def _decode_b64_image(b64: str) -> Optional[np.ndarray]:
        """Decode a base64 data-URI or raw base64 string to BGR numpy array."""
        if not b64:
            return None
        try:
            if b64.startswith("data:"):
                b64 = b64.split(",", 1)[1]
            raw = base64.b64decode(b64)
            buf = np.frombuffer(raw, dtype=np.uint8)
            return cv2.imdecode(buf, cv2.IMREAD_COLOR)
        except Exception as exc:
            logger.warning(f"Base64 decode failed: {exc}")
            return None

    def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
        a = a.astype(np.float32)
        b = b.astype(np.float32)
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na < 1e-8 or nb < 1e-8:
            return 0.0
        return float(np.dot(a / na, b / nb))

    # ── Health ────────────────────────────────────────────────────────────

    @router.get("/health")
    async def health():
        return {"status": "ok", "ready": True, "service": "face-recognition-api"}

    # ── Extract Single Embedding (+ anti-spoof) ───────────────────────────

    @router.post("/extract-embedding")
    async def extract_embedding(request: Request):
        """
        Input:  {"image": "<base64 JPEG/PNG>"}
        Output: {detected, embedding, dimension, confidence, box,
                 spoof_detected, spoof_label, real_confidence}
        """
        engine = get_engine()
        if engine is None:
            raise HTTPException(status_code=503, detail="Engine not initialised yet")

        body = await request.json()
        img = _decode_b64_image(body.get("image", ""))
        if img is None:
            raise HTTPException(status_code=422, detail="Could not decode image")

        return engine.extract_single(img)

    # ── Extract Multiple Face Embeddings ─────────────────────────────────

    @router.post("/extract-multiple-embeddings")
    async def extract_multiple_embeddings(request: Request):
        """
        Input:  {"image": "<base64>"}
        Output: {detected, faces: [{index, embedding, embedding_size, box}], num_faces}
        """
        engine = get_engine()
        if engine is None:
            raise HTTPException(status_code=503, detail="Engine not initialised yet")

        body = await request.json()
        img = _decode_b64_image(body.get("image", ""))
        if img is None:
            raise HTTPException(status_code=422, detail="Could not decode image")

        return engine.extract_multiple(img)

    # ── Verify Face vs Stored Embedding ──────────────────────────────────

    @router.post("/verify")
    async def verify(request: Request):
        """
        Input:  {"image": "<base64>", "stored_embedding": [float, ...]}
        Output: {verified, similarity, threshold, confidence,
                 face_detected, spoof_detected, spoof_label, real_confidence}
        """
        engine = get_engine()
        if engine is None:
            raise HTTPException(status_code=503, detail="Engine not initialised yet")

        body = await request.json()
        img = _decode_b64_image(body.get("image", ""))
        stored = body.get("stored_embedding")
        if img is None or not stored:
            raise HTTPException(status_code=422, detail="image and stored_embedding required")

        stored_emb = np.array(stored, dtype=np.float32)
        return engine.verify_face(img, stored_emb)

    # ── Compare Two Embeddings ────────────────────────────────────────────

    @router.post("/compare-embeddings")
    async def compare_embeddings(request: Request):
        """
        Input:  {"embedding1": [...], "embedding2": [...]}
        Output: {similarity, match, confidence}
        """
        body = await request.json()
        e1 = np.array(body.get("embedding1", []), dtype=np.float32)
        e2 = np.array(body.get("embedding2", []), dtype=np.float32)
        if e1.size == 0 or e2.size == 0:
            raise HTTPException(status_code=422, detail="embedding1 and embedding2 required")

        sim = _cosine_sim(e1, e2)
        return {"similarity": sim, "match": bool(sim >= 0.7), "confidence": float(max(0.0, sim))}

    # ── Session Management ────────────────────────────────────────────────

    @router.post("/load-session")
    async def load_session(request: Request):
        """
        Input:  {"sectionId": str,
                 "students": [{"id", "name", "student_number", "embedding": []}]}
        Output: {success, students_loaded}
        """
        body = await request.json()
        section_id = body.get("sectionId", "default")
        students = body.get("students", [])

        session_store[section_id] = {}
        for s in students:
            sid = s.get("id") or s.get("studentId")
            emb = s.get("embedding")
            if sid and emb:
                session_store[section_id][sid] = {
                    "name": s.get("name", ""),
                    "student_number": s.get("student_number"),
                    "embedding": np.array(emb, dtype=np.float32),
                }

        loaded = len(session_store[section_id])
        logger.info(f"Session loaded: sectionId={section_id!r}, students={loaded}")
        return {"success": True, "students_loaded": loaded}

    @router.post("/clear-session")
    async def clear_session():
        session_store.clear()
        logger.info("Session store cleared.")
        return {"success": True}

    # ── HTTP Recognize Frame ──────────────────────────────────────────────

    @router.post("/recognize-frame")
    async def recognize_frame_http(request: Request):
        """
        Input:  {"image": "<base64>"}
        Output: {detected, faces: [RecognizedFace], num_faces, processing_time_ms}
        """
        engine = get_engine()
        if engine is None:
            raise HTTPException(status_code=503, detail="Engine not initialised yet")

        body = await request.json()
        img = _decode_b64_image(body.get("image", ""))
        if img is None:
            raise HTTPException(status_code=422, detail="Could not decode image")

        return engine.recognize_frame_with_session(img, session_store)

    return router
