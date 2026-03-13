"""
server.py
---------
FastAPI application entry point for the Face Recognition Attendance API.

Start the server:
    python api/server.py

Or with uvicorn directly:
    uvicorn api.server:app --host 0.0.0.0 --port 8000 --reload

Environment variables (set in .env or shell):
    DB_PATH             Path to SQLite database  (default: database/embeddings.db)
    ARCFACE_MODE        "facenet", "insightface" or "pytorch"  (default: facenet)
    ARCFACE_MODEL_PATH  Path to custom .pth weights (pytorch mode only)
    ARCFACE_BACKBONE    "r50" or "r100"             (pytorch mode only, default: r100)
    ANTISPOOF_MODEL_DIR Directory with MiniFASNet .pth files (default: models/antispoof)
    DET_MODEL_NAME      insightface detection pack  (default: buffalo_sc)
    DEVICE              "cuda" or "cpu"             (default: cuda if available)
    SIM_THRESHOLD       Cosine similarity threshold (default: 0.6)
    REAL_THRESHOLD      Anti-spoof real confidence  (default: 0.82)
    ALLOWED_ORIGINS     Comma-separated CORS origins (default: *)

The server:
  1. Initialises DB (creates tables if needed)
  2. Loads RecognitionEngine (detector + embedder + anti-spoof)
  3. Loads all stored embeddings into the FAISS/numpy index
  4. Mounts the API routes
  5. Starts uvicorn
"""

from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from database.db_manager import DBManager
from recognition.recognition_engine import RecognitionEngine
from recognition.camera_manager import CameraManager
from api.routes import create_router, create_legacy_router

# ---------------------------------------------------------------------------
# Load .env (if present)
# ---------------------------------------------------------------------------

load_dotenv(dotenv_path=_ROOT / ".env")


# ---------------------------------------------------------------------------
# Shared application state (populated in lifespan)
# ---------------------------------------------------------------------------

_engine_ref:    dict = {"engine": None}
_db_ref:        dict = {"db":     None}
_session_store: dict = {}          # sectionId → {studentId → {name, student_number, embedding}}
_camera:        CameraManager = CameraManager()


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown hooks)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    AsyncContextManager used by FastAPI as startup/shutdown handler.
    Replaces deprecated ``@app.on_event("startup")``.
    """
    # ── Startup ──────────────────────────────────────────────────────────
    logger.info("=== Face Recognition API starting up (DeepFace) ===")

    db_path      = os.getenv("DB_PATH",             "database/embeddings.db")
    model_name   = os.getenv("MODEL_NAME",          "Facenet512")
    det_backend  = os.getenv("DETECTOR_BACKEND",    "mtcnn")
    # Similarity threshold: too low causes false positives (students marked present incorrectly).
    # Default to a safer value and clamp to a reasonable range.
    sim_thr_raw  = float(os.getenv("SIM_THRESHOLD", "0.65"))
    sim_thr      = max(0.6, min(0.9, sim_thr_raw))
    anti_spoof   = os.getenv("ANTI_SPOOFING",       "true").lower() == "true"

    logger.info(f"  DB_PATH:             {db_path}")
    logger.info(f"  MODEL_NAME:          {model_name}")
    logger.info(f"  DETECTOR_BACKEND:    {det_backend}")
    logger.info(f"  SIM_THRESHOLD:       {sim_thr} (raw={sim_thr_raw})")
    logger.info(f"  ANTI_SPOOFING:       {anti_spoof}")

    # Initialise DB
    db = await DBManager.create(db_path)
    _db_ref["db"] = db

    # Initialise recognition engine (DeepFace)
    engine = RecognitionEngine(
        model_name=model_name,
        detector_backend=det_backend,
        sim_threshold=sim_thr,
        anti_spoofing=anti_spoof,
        db_manager=db,
    )
    _engine_ref["engine"] = engine

    # Load all embeddings from DB into the in-memory FAISS index
    n = await engine.load_embeddings_from_db()
    logger.info(f"FAISS index populated with {n} user(s).")
    logger.info("=== API ready ===")

    yield  # ← server is running here

    # ── Shutdown ──────────────────────────────────────────────────────────
    logger.info("Shutting down...")
    await db.close()
    logger.info("Database closed. Goodbye.")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Imports used by routes / WebSocket handlers (moved to module scope)
# ---------------------------------------------------------------------------
import asyncio
import base64
import json as _json
import time as _time
import numpy as np
import cv2
from fastapi import WebSocket, WebSocketDisconnect


def create_app() -> FastAPI:

    app = FastAPI(
        title="Face Recognition Attendance API",
        description=(
            "ArcFace + RetinaFace + MiniFASNet anti-spoofing backend "
            "for the attendance monitoring system."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS — restrict in production
    allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "*")
    allowed_origins = (
        ["*"]
        if allowed_origins_str == "*"
        else [o.strip() for o in allowed_origins_str.split(",")]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=".*" if allowed_origins == ["*"] else None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount /api/v1 routes (new structured API)
    router = create_router(_engine_ref, _db_ref)
    app.include_router(router, prefix="/api/v1")

    # Mount legacy routes at root level (drop-in replacement for facenet-server.py)
    legacy_router = create_legacy_router(_engine_ref, _session_store)
    app.include_router(legacy_router)

    # Root redirect to docs
    @app.get("/", include_in_schema=False)
    async def root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/docs")

    return app


app = create_app()


# ---------------------------------------------------------------------------
# Helper used by /ws/recognize
# ---------------------------------------------------------------------------

def _decode_b64_ws(b64: str):
    """Decode base64 image string to BGR numpy array (WebSocket path)."""
    try:
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        buf = np.frombuffer(raw, dtype=np.uint8)
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# WebSocket: real-time recognition stream
# ---------------------------------------------------------------------------

@app.websocket("/ws/recognize")
async def ws_recognize(websocket: WebSocket):
    """
    Real-time face recognition stream.

    Client sends JSON frames:
      {"image": "<base64 JPEG>"}

    Server replies with a RecognitionResult JSON object per frame.
    """
    await websocket.accept()
    logger.info("WebSocket /ws/recognize: client connected")
    try:
        while True:
            data = await websocket.receive_text()
            engine = _engine_ref["engine"]
            if engine is None:
                await websocket.send_text(
                    _json.dumps({"detected": False, "faces": [], "num_faces": 0})
                )
                continue

            body = _json.loads(data)
            img = _decode_b64_ws(body.get("image", ""))
            result = engine.recognize_frame_with_session(img, _session_store)
            await websocket.send_text(_json.dumps(result))

    except WebSocketDisconnect:
        logger.info("WebSocket /ws/recognize: client disconnected")
    except Exception as exc:
        logger.warning(f"WebSocket /ws/recognize error: {exc}")


# ---------------------------------------------------------------------------
# WebSocket: server-side camera stream
# ---------------------------------------------------------------------------

# Thread pool for offloading CPU-bound recognition work
import concurrent.futures as _cf
_recognition_pool = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="recognition")


@app.websocket("/ws/camera-stream")
async def ws_camera_stream(websocket: WebSocket):
    """
    Server-side camera stream with real-time recognition.

    Client sends a JSON config once to start:
      {"mode": "recognize" | "extract" | "view",
       "jpeg_quality": 60,
       "process_every": 3}

    Server continuously sends back:
      {"frame": "<base64 JPEG>",
       "width": int, "height": int,
       "results": <RecognitionResult or ExtractResult or null>,
       "frame_id": int,
       "fps": float}

    Frames are always streamed at camera FPS.  Recognition/extraction
    runs every ``process_every`` frames (default 3) in a background thread
    so the event loop is never blocked.  Frames in between carry the
    previous ``results`` (or null).
    """
    logger.info("WebSocket /ws/camera-stream: client connected")
    await websocket.accept()

    if not _camera.acquire():
        await websocket.send_text(_json.dumps({
            "error": "Camera not available. Check that no other application is using it."
        }))
        await websocket.close()
        return

    loop = asyncio.get_event_loop()

    try:
        # Wait for client config message
        config_raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        config = _json.loads(config_raw)
        mode: str = config.get("mode", "recognize")
        jpeg_quality: int = max(30, min(95, int(config.get("jpeg_quality", 60))))
        process_every: int = max(1, int(config.get("process_every", 3)))
        logger.info(f"Camera stream mode={mode}, quality={jpeg_quality}, process_every={process_every}")

        engine = _engine_ref["engine"]
        last_frame_id = -1
        fps_counter = 0
        fps_timer = _time.time()
        current_fps = 0.0
        frame_counter = 0          # counts every new frame
        last_results = None         # cached results from last processing

        while True:
            # Check for client messages (non-blocking)
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=0.002)
                cmd = _json.loads(msg)
                if "mode" in cmd:
                    mode = cmd["mode"]
                    logger.info(f"Camera stream mode switched to: {mode}")
                if "jpeg_quality" in cmd:
                    jpeg_quality = max(30, min(95, int(cmd["jpeg_quality"])))
                if "process_every" in cmd:
                    process_every = max(1, int(cmd["process_every"]))
                if cmd.get("action") == "stop":
                    break
            except asyncio.TimeoutError:
                pass

            # Get latest frame from camera
            frame, frame_id = _camera.get_frame()
            if frame is None or frame_id == last_frame_id:
                await asyncio.sleep(0.005)
                continue
            last_frame_id = frame_id
            frame_counter += 1

            # Process frame in thread pool (only every N frames)
            should_process = (
                engine is not None
                and mode != "view"
                and frame_counter % process_every == 0
            )
            if should_process:
                if mode == "recognize":
                    last_results = await loop.run_in_executor(
                        _recognition_pool,
                        engine.recognize_frame_with_session, frame, _session_store,
                    )
                elif mode == "extract":
                    last_results = await loop.run_in_executor(
                        _recognition_pool,
                        engine.extract_single, frame,
                    )

            # Encode frame as JPEG
            _, jpeg_buf = cv2.imencode(
                ".jpg", frame,
                [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality],
            )
            frame_b64 = base64.b64encode(jpeg_buf).decode("ascii")

            # FPS tracking
            fps_counter += 1
            now = _time.time()
            if now - fps_timer >= 1.0:
                current_fps = fps_counter / (now - fps_timer)
                fps_counter = 0
                fps_timer = now

            h, w = frame.shape[:2]
            payload = {
                "frame": frame_b64,
                "width": w,
                "height": h,
                "results": last_results if should_process else None,
                "frame_id": frame_id,
                "fps": round(current_fps, 1),
            }
            await websocket.send_text(_json.dumps(payload))

            # Yield to event loop
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.info("WebSocket /ws/camera-stream: client disconnected")
    except asyncio.TimeoutError:
        logger.warning("WebSocket /ws/camera-stream: config timeout")
    except Exception as exc:
        logger.warning(f"WebSocket /ws/camera-stream error: {exc}")
    finally:
        _camera.release()
        logger.info("WebSocket /ws/camera-stream: camera released")


# ---------------------------------------------------------------------------
# Dev runner
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "false").lower() == "true"

    uvicorn.run(
        "api.server:app" if reload else app,
        host=host,
        port=port,
        reload=reload,
        log_level="info",
        workers=1,          # Single worker required for shared in-memory index
        ws="wsproto",       # Use wsproto instead of websockets (compat fix)
    )
