"""
recognition_engine.py
---------------------
Orchestrates the full face recognition pipeline using DeepFace:

  Camera Frame
       ↓
  Face Detection  (DeepFace — configurable backend: mtcnn, retinaface, etc.)
       ↓
  Anti-Spoof Check (DeepFace FasNet — MiniFASNet ensemble with original weights)
       ↓  (reject if spoof)
  Embedding Extraction (DeepFace — Facenet512 by default, 512-D)
       ↓
  Similarity Search (FaissIndex / numpy)
       ↓
  Return UserId + Confidence

NOTE: Switching to DeepFace changes the embedding space.
      Existing face registrations from the old pipeline will need to be
      re-registered for accurate matching.
"""

from __future__ import annotations

import sys
import time
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from deepface import DeepFace
from utils.similarity import FaissIndex, average_embeddings, l2_normalize


# ---------------------------------------------------------------------------
# Result data classes
# ---------------------------------------------------------------------------

@dataclass
class RecognitionResult:
    """Full result for one detected face in a frame."""
    user_id: Optional[str]
    name: Optional[str]
    confidence: float
    spoof_detected: bool
    spoof_label: str
    real_confidence: float
    bbox: Tuple[int, int, int, int]
    processing_ms: float = 0.0

    @property
    def is_recognized(self) -> bool:
        return self.user_id is not None and not self.spoof_detected


@dataclass
class RegistrationResult:
    """Outcome of a registration attempt."""
    success: bool
    user_id: str
    message: str
    num_embeddings_used: int = 0


# ---------------------------------------------------------------------------
# Embedding dimension lookup
# ---------------------------------------------------------------------------

_MODEL_DIMS = {
    "VGG-Face": 4096, "Facenet": 128, "Facenet512": 512,
    "OpenFace": 128, "DeepFace": 4096, "DeepID": 160,
    "Dlib": 128, "ArcFace": 512, "SFace": 128,
    "GhostFaceNet": 512,
}


# ---------------------------------------------------------------------------
# Recognition Engine
# ---------------------------------------------------------------------------

class RecognitionEngine:
    """
    Top-level face recognition engine powered by DeepFace.

    Args:
        model_name:        DeepFace recognition model (default Facenet512).
        detector_backend:  DeepFace detector (default mtcnn).
        sim_threshold:     Cosine similarity threshold for identity match.
        anti_spoofing:     Enable FasNet anti-spoofing gate.
        db_manager:        Injected DBManager for persistent storage.
    """

    def __init__(
        self,
        model_name: str = "Facenet512",
        detector_backend: str = "mtcnn",
        sim_threshold: float = 0.4,
        anti_spoofing: bool = True,
        db_manager=None,
        # Legacy params — kept for backward-compatible server.py init, ignored
        arcface_model_path=None, arcface_mode=None, arcface_backbone=None,
        antispoof_model_dir=None, det_model_name=None, device=None,
        real_threshold=None,
    ):
        self.model_name = model_name
        self.detector_backend = detector_backend
        self.sim_threshold = sim_threshold
        self.anti_spoofing_enabled = anti_spoofing
        self._db = db_manager

        # Session (kiosk) matching guardrails.
        # Unknown faces should remain Unknown instead of being forced to the
        # closest identity.
        self.session_sim_threshold = float(os.getenv("SESSION_SIM_THRESHOLD", str(sim_threshold)))
        self.session_sim_threshold = max(0.75, min(0.95, self.session_sim_threshold))
        self.min_match_margin = float(os.getenv("MIN_MATCH_MARGIN", "0.06"))
        self.min_match_margin = max(0.0, min(0.2, self.min_match_margin))
        self.session_faiss_fallback = os.getenv("SESSION_FAISS_FALLBACK", "false").lower() == "true"

        logger.info("Initialising RecognitionEngine (DeepFace)")
        logger.info(f"  model_name:       {model_name}")
        logger.info(f"  detector_backend: {detector_backend}")
        logger.info(f"  sim_threshold:    {sim_threshold}")
        logger.info(f"  anti_spoofing:    {anti_spoofing}")

        # Pre-load models so first request isn't slow
        logger.info("Pre-loading DeepFace recognition model...")
        DeepFace.build_model(model_name)

        if anti_spoofing:
            # FasNet anti-spoofing in DeepFace requires torch. On slim containers
            # (e.g. Railway), installing torch can be heavy and is optional.
            # If torch isn't available, disable anti-spoofing instead of crashing
            # the whole API on startup.
            try:
                import torch  # noqa: F401
                logger.info("Pre-loading DeepFace anti-spoofing model (FasNet)...")
                DeepFace.build_model("Fasnet", task="spoofing")
            except Exception as exc:
                self.anti_spoofing_enabled = False
                logger.warning(
                    "Anti-spoofing disabled (torch/FasNet unavailable). "
                    f"Set ANTI_SPOOFING=false to silence this warning. Reason: {exc}"
                )

        self._embedding_dim = _MODEL_DIMS.get(model_name, 512)
        logger.info(f"  embedding_dim:    {self._embedding_dim}")

        # In-memory vector index
        self._index: FaissIndex = FaissIndex(embedding_dim=self._embedding_dim)
        self._name_cache: dict[str, str] = {}

        logger.info("RecognitionEngine (DeepFace) ready.")

    # ------------------------------------------------------------------
    # DB integration helpers
    # ------------------------------------------------------------------

    def set_db_manager(self, db_manager) -> None:
        self._db = db_manager

    async def load_embeddings_from_db(self) -> int:
        if self._db is None:
            logger.warning("No DB manager set. Index will be empty.")
            return 0

        users = await self._db.get_all_users_with_embeddings()
        loaded = 0
        for user in users:
            uid = str(user["id"])
            name = user.get("name", uid)
            emb = np.array(user["embedding_vector"], dtype=np.float32)
            if len(emb) != self._embedding_dim:
                logger.warning(
                    f"Skipping user {uid}: embedding dim {len(emb)} != "
                    f"{self._embedding_dim}. Re-register with the new model."
                )
                continue
            self._index.add(uid, emb)
            self._name_cache[uid] = name
            loaded += 1

        logger.info(f"Loaded {loaded} user embeddings into FAISS index.")
        return loaded

    def add_to_index(self, user_id: str, name: str, embedding: np.ndarray) -> None:
        self._index.add(user_id, embedding)
        self._name_cache[user_id] = name

    def remove_from_index(self, user_id: str) -> None:
        self._index.remove(user_id)
        self._name_cache.pop(user_id, None)

    # ------------------------------------------------------------------
    # DeepFace wrappers
    # ------------------------------------------------------------------

    def _detect_faces(self, img_bgr: np.ndarray) -> List[dict]:
        """
        Detect faces with optional anti-spoofing via DeepFace.

        Returns list of dicts from DeepFace.extract_faces(), each containing:
          face, facial_area, confidence, is_real, antispoof_score
        """
        try:
            results = DeepFace.extract_faces(
                img_path=img_bgr,
                detector_backend=self.detector_backend,
                enforce_detection=False,
                align=True,
                anti_spoofing=self.anti_spoofing_enabled,
                color_face="bgr",
                normalize_face=False,
            )
            # Filter out the "no-face" placeholder DeepFace adds when
            # enforce_detection=False and nothing was found.
            h, w = img_bgr.shape[:2]
            filtered = []
            for r in results:
                fa = r.get("facial_area", {})
                if r.get("confidence", 0) == 0 and fa.get("w", 0) >= w - 2 and fa.get("h", 0) >= h - 2:
                    continue
                filtered.append(r)
            return filtered
        except Exception as e:
            logger.warning(f"DeepFace face detection error: {e}")
            return []

    def _get_embedding(self, face_crop_bgr: np.ndarray) -> Optional[np.ndarray]:
        """Extract a 512-D embedding from a BGR uint8 face crop."""
        try:
            results = DeepFace.represent(
                img_path=face_crop_bgr,
                model_name=self.model_name,
                detector_backend="skip",
                enforce_detection=False,
                anti_spoofing=False,
            )
            if results:
                emb = np.array(results[0]["embedding"], dtype=np.float32)
                return l2_normalize(emb)
            return None
        except Exception as e:
            logger.warning(f"DeepFace embedding extraction error: {e}")
            return None

    @staticmethod
    def _spoof_fields(face_dict: dict) -> Tuple[bool, str, float]:
        """
        Extract anti-spoofing fields from a DeepFace extract_faces result dict.

        Returns (spoof_detected, spoof_label, real_confidence).
        """
        is_real = face_dict.get("is_real", True)
        score = face_dict.get("antispoof_score", 1.0)

        if is_real:
            return False, "real", float(score)
        else:
            return True, "spoof", float(1.0 - score)

    @staticmethod
    def _bbox_from_facial_area(fa: dict) -> Tuple[int, int, int, int]:
        """Convert DeepFace facial_area dict {x,y,w,h} to (x1, y1, x2, y2)."""
        x = fa.get("x", 0)
        y = fa.get("y", 0)
        w = fa.get("w", 0)
        h = fa.get("h", 0)
        return (x, y, x + w, y + h)

    # ------------------------------------------------------------------
    # High-level single-face operations (used by legacy routes)
    # ------------------------------------------------------------------

    def extract_single(self, img_bgr: np.ndarray) -> dict:
        """
        Detect the largest face, run anti-spoof, extract embedding.
        Returns a dict matching the /extract-embedding API response.
        """
        faces = self._detect_faces(img_bgr)
        if not faces:
            return {
                "detected": False, "embedding": None, "dimension": 0,
                "confidence": 0.0, "spoof_detected": False,
                "spoof_label": "real", "real_confidence": 1.0,
            }

        # Pick largest face by area
        face = max(
            faces,
            key=lambda f: f.get("facial_area", {}).get("w", 0) * f.get("facial_area", {}).get("h", 0),
        )

        fa = face.get("facial_area", {})
        x1, y1, x2, y2 = self._bbox_from_facial_area(fa)
        box_data = {
            "x": fa.get("x", 0), "y": fa.get("y", 0),
            "width": fa.get("w", 0), "height": fa.get("h", 0),
            "left": x1, "top": y1, "right": x2, "bottom": y2,
        }
        det_conf = face.get("confidence", 0.0)
        spoof_detected, spoof_label, real_confidence = self._spoof_fields(face)

        if spoof_detected:
            return {
                "detected": True, "embedding": None, "dimension": 0,
                "confidence": det_conf, "box": box_data,
                "spoof_detected": True, "spoof_label": spoof_label,
                "real_confidence": real_confidence,
            }

        face_crop = face.get("face")
        if face_crop is None or face_crop.size == 0:
            return {
                "detected": True, "embedding": None, "dimension": 0,
                "confidence": det_conf, "box": box_data,
                "spoof_detected": False, "spoof_label": "real",
                "real_confidence": real_confidence,
            }

        emb = self._get_embedding(face_crop)
        if emb is None:
            return {
                "detected": True, "embedding": None, "dimension": 0,
                "confidence": det_conf, "box": box_data,
                "spoof_detected": False, "spoof_label": "real",
                "real_confidence": real_confidence,
            }

        return {
            "detected": True,
            "embedding": emb.tolist(),
            "dimension": len(emb),
            "confidence": det_conf,
            "box": box_data,
            "spoof_detected": False,
            "spoof_label": "real",
            "real_confidence": real_confidence,
        }

    def extract_multiple(self, img_bgr: np.ndarray) -> dict:
        """
        Detect all faces and extract embeddings (no anti-spoof gate).
        Returns a dict matching the /extract-multiple-embeddings API response.
        """
        faces = self._detect_faces(img_bgr)
        face_results = []
        for i, face in enumerate(faces):
            face_crop = face.get("face")
            if face_crop is None or face_crop.size == 0:
                continue
            emb = self._get_embedding(face_crop)
            if emb is None:
                continue
            fa = face.get("facial_area", {})
            x1, y1, x2, y2 = self._bbox_from_facial_area(fa)
            face_results.append({
                "index": i,
                "embedding": emb.tolist(),
                "embedding_size": len(emb),
                "box": {
                    "left": x1, "top": y1, "right": x2, "bottom": y2,
                    "width": fa.get("w", 0), "height": fa.get("h", 0),
                },
            })

        return {
            "detected": len(face_results) > 0,
            "faces": face_results,
            "num_faces": len(face_results),
        }

    def verify_face(
        self, img_bgr: np.ndarray, stored_embedding: np.ndarray,
    ) -> dict:
        """
        Detect the largest face, run anti-spoof, compare against a stored
        embedding.  Returns a dict matching the /verify API response.
        """
        faces = self._detect_faces(img_bgr)
        if not faces:
            return {
                "verified": False, "similarity": 0.0,
                "threshold": self.sim_threshold, "confidence": 0.0,
                "face_detected": False, "spoof_detected": False,
            }

        face = max(
            faces,
            key=lambda f: f.get("facial_area", {}).get("w", 0) * f.get("facial_area", {}).get("h", 0),
        )

        spoof_detected, spoof_label, real_confidence = self._spoof_fields(face)

        face_crop = face.get("face")
        if face_crop is None or face_crop.size == 0:
            return {
                "verified": False, "similarity": 0.0,
                "threshold": self.sim_threshold, "confidence": 0.0,
                "face_detected": False, "spoof_detected": spoof_detected,
                "spoof_label": spoof_label, "real_confidence": real_confidence,
            }

        emb = self._get_embedding(face_crop)
        if emb is None:
            return {
                "verified": False, "similarity": 0.0,
                "threshold": self.sim_threshold, "confidence": 0.0,
                "face_detected": True, "spoof_detected": spoof_detected,
                "spoof_label": spoof_label, "real_confidence": real_confidence,
            }

        stored = stored_embedding.astype(np.float32)
        na, nb = np.linalg.norm(emb), np.linalg.norm(stored)
        sim = float(np.dot(emb / (na + 1e-8), stored / (nb + 1e-8)))

        return {
            "verified": sim >= self.sim_threshold and not spoof_detected,
            "similarity": sim,
            "threshold": self.sim_threshold,
            "confidence": sim,
            "face_detected": True,
            "spoof_detected": spoof_detected,
            "spoof_label": spoof_label,
            "real_confidence": real_confidence,
        }

    # ------------------------------------------------------------------
    # Full-frame recognition with session matching
    # Used by /recognize-frame and WebSocket /ws/recognize
    # ------------------------------------------------------------------

    def recognize_frame_with_session(
        self,
        img_bgr: np.ndarray,
        session_store: dict,
    ) -> dict:
        """
        Detect all faces, run anti-spoof + embedding per face, match
        against session_store (and FAISS fallback).

        Returns a dict matching the frontend RecognitionResult interface.
        """
        if img_bgr is None or img_bgr.size == 0:
            return {"detected": False, "faces": [], "num_faces": 0, "processing_time_ms": 0.0}

        t0 = time.perf_counter()
        faces = self._detect_faces(img_bgr)

        # Filter weak detections to avoid false positives (e.g., background patterns
        # incorrectly detected as faces). These guardrails are especially important
        # for kiosk attendance where a false match is worse than a miss.
        min_det_conf = float(getattr(self, "min_det_conf", 0.75))
        min_face_size = int(getattr(self, "min_face_size", 60))
        filtered_faces = []
        for f in faces:
            fa = f.get("facial_area", {})
            w = int(fa.get("w", 0) or 0)
            h = int(fa.get("h", 0) or 0)
            det_conf = float(f.get("confidence", 0.0) or 0.0)
            if det_conf < min_det_conf:
                continue
            if w < min_face_size or h < min_face_size:
                continue
            filtered_faces.append(f)
        faces = filtered_faces
        result_faces = []

        for idx, face in enumerate(faces):
            fa = face.get("facial_area", {})
            x1, y1, x2, y2 = self._bbox_from_facial_area(fa)
            det_conf = face.get("confidence", 0.0)
            spoof_detected, spoof_label, real_confidence = self._spoof_fields(face)

            matched = False
            student_id = None
            student_name = "Unknown"
            student_number = None
            match_confidence = 0.0

            if not spoof_detected:
                face_crop = face.get("face")
                emb = self._get_embedding(face_crop) if (face_crop is not None and face_crop.size > 0) else None

                if emb is not None:
                    # 1) Session store match (best vs runner-up margin)
                    a = emb.astype(np.float32)
                    best_sim = -1.0
                    second_sim = -1.0
                    best_sid = None
                    best_data = None

                    for _sec, students in session_store.items():
                        for sid, sdata in students.items():
                            b = sdata["embedding"].astype(np.float32)
                            na, nb = np.linalg.norm(a), np.linalg.norm(b)
                            sim = float(np.dot(a / (na + 1e-8), b / (nb + 1e-8)))
                            if sim > best_sim:
                                second_sim = best_sim
                                best_sim = sim
                                best_sid = sid
                                best_data = sdata
                            elif sim > second_sim:
                                second_sim = sim

                    if (
                        best_sid is not None
                        and best_sim >= self.session_sim_threshold
                        and (best_sim - second_sim) >= self.min_match_margin
                    ):
                        matched = True
                        student_id = best_sid
                        student_name = (best_data or {}).get("name", "Unknown")
                        student_number = (best_data or {}).get("student_number")
                        match_confidence = float(best_sim)

                    # 2) Optional global fallback (OFF by default for kiosk)
                    if (
                        not matched
                        and self.session_faiss_fallback
                        and len(session_store) == 0
                        and len(self._index) > 0
                    ):
                        try:
                            results = self._index.search(emb, threshold=self.session_sim_threshold, top_k=2)
                            uid1, sim1 = results[0]
                            sim2 = results[1][1] if len(results) > 1 else -1.0
                            if uid1 is not None and (float(sim1) - float(sim2)) >= self.min_match_margin:
                                matched = True
                                student_id = uid1
                                student_name = self._name_cache.get(uid1, "Unknown")
                                match_confidence = float(sim1)
                        except Exception:
                            pass

            result_faces.append({
                "index": idx,
                "matched": matched,
                "studentId": student_id,
                "name": student_name,
                "studentNumber": student_number,
                "confidence": match_confidence,
                "box": {
                    "left": x1, "top": y1, "right": x2, "bottom": y2,
                    "width": x2 - x1, "height": y2 - y1,
                },
                "spoofDetected": spoof_detected,
                "spoofLabel": spoof_label,
                "realConfidence": real_confidence,
            })

        proc_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "detected": len(result_faces) > 0,
            "faces": result_faces,
            "num_faces": len(result_faces),
            "processing_time_ms": proc_ms,
        }

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def get_registration_embedding(
        self,
        image_list: List[np.ndarray],
        min_images: int = 5,
    ) -> Tuple[Optional[np.ndarray], int]:
        """
        Compute the averaged embedding from a list of BGR images.
        Returns (averaged_embedding, num_valid) or (None, num_valid).
        """
        valid: List[np.ndarray] = []
        for img in image_list:
            faces = self._detect_faces(img)
            if not faces:
                continue
            face = max(
                faces,
                key=lambda f: f.get("facial_area", {}).get("w", 0) * f.get("facial_area", {}).get("h", 0),
            )
            if face.get("confidence", 0) < 0.5:
                continue
            face_crop = face.get("face")
            if face_crop is None or face_crop.size == 0:
                continue
            emb = self._get_embedding(face_crop)
            if emb is not None:
                valid.append(emb)

        if len(valid) < min_images:
            return None, len(valid)
        return average_embeddings(valid), len(valid)

    # ------------------------------------------------------------------
    # Recognition (single frame — used by /api/v1/recognize)
    # ------------------------------------------------------------------

    def recognize_single(
        self,
        frame_bgr: np.ndarray,
    ) -> Optional[RecognitionResult]:
        """Recognize the largest face in a frame against the FAISS index."""
        faces = self._detect_faces(frame_bgr)
        if not faces:
            return None

        face = max(
            faces,
            key=lambda f: f.get("facial_area", {}).get("w", 0) * f.get("facial_area", {}).get("h", 0),
        )
        return self._process_face(face)

    def recognize_frame(
        self,
        frame_bgr: np.ndarray,
        max_faces: int = 5,
    ) -> List[RecognitionResult]:
        """Run the full pipeline on a single BGR frame."""
        t0 = time.perf_counter()
        faces = self._detect_faces(frame_bgr)
        if not faces:
            return []

        faces = sorted(
            faces,
            key=lambda f: f.get("facial_area", {}).get("w", 0) * f.get("facial_area", {}).get("h", 0),
            reverse=True,
        )[:max_faces]

        results = [self._process_face(f) for f in faces]
        total_ms = (time.perf_counter() - t0) * 1000
        logger.debug(f"recognize_frame: {len(faces)} face(s), {total_ms:.1f} ms total")
        return results

    def _process_face(self, face: dict) -> RecognitionResult:
        """Process a single detected face through anti-spoof → embed → search."""
        fa = face.get("facial_area", {})
        bbox = self._bbox_from_facial_area(fa)
        spoof_detected, spoof_label, real_confidence = self._spoof_fields(face)

        if spoof_detected:
            return RecognitionResult(
                user_id=None, name=None, confidence=0.0,
                spoof_detected=True, spoof_label=spoof_label,
                real_confidence=real_confidence, bbox=bbox,
            )

        face_crop = face.get("face")
        if face_crop is None or face_crop.size == 0:
            return RecognitionResult(
                user_id=None, name=None, confidence=0.0,
                spoof_detected=False, spoof_label="real",
                real_confidence=real_confidence, bbox=bbox,
            )

        emb = self._get_embedding(face_crop)
        if emb is None or len(self._index) == 0:
            return RecognitionResult(
                user_id=None, name=None, confidence=0.0,
                spoof_detected=False, spoof_label="real",
                real_confidence=real_confidence, bbox=bbox,
            )

        matches = self._index.search(emb, threshold=self.sim_threshold, top_k=1)
        best_label, best_sim = matches[0]
        name = self._name_cache.get(best_label) if best_label else None

        return RecognitionResult(
            user_id=best_label, name=name, confidence=best_sim,
            spoof_detected=False, spoof_label="real",
            real_confidence=real_confidence, bbox=bbox,
        )
