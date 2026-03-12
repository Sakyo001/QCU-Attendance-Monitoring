"""
face_detector.py
----------------
MTCNN-based face detection wrapper using the facenet_pytorch library.

facenet_pytorch MTCNN provides:
  - Multi-scale face detection
  - 5-point landmark localisation (left_eye, right_eye, nose, left_mouth, right_mouth)
  - Pure Python/PyTorch — no C++ compilation required

This module exposes a clean FaceDetector class that:
  1. Loads MTCNN detection model (PyTorch, auto-downloaded)
  2. Runs detection on BGR frames
  3. Returns structured detection results with bounding boxes and landmarks
"""

from __future__ import annotations

import cv2
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from loguru import logger

try:
    from facenet_pytorch import MTCNN
    _MTCNN_AVAILABLE = True
except ImportError:
    _MTCNN_AVAILABLE = False
    logger.warning(
        "facenet_pytorch not found. Install it with: pip install facenet-pytorch"
    )


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class DetectedFace:
    """Holds all outputs for a single detected face."""
    bbox: Tuple[int, int, int, int]          # (x1, y1, x2, y2)
    score: float                              # detection confidence [0, 1]
    landmarks_5pt: Optional[np.ndarray]       # shape (5, 2) or None
    crop: Optional[np.ndarray] = field(default=None, repr=False)  # aligned BGR crop


# ---------------------------------------------------------------------------
# FaceDetector
# ---------------------------------------------------------------------------

class FaceDetector:
    """
    Thin wrapper around facenet_pytorch MTCNN for face detection and alignment.

    Usage::

        detector = FaceDetector(device="cpu")
        faces = detector.detect(frame)
        for face in faces:
            print(face.bbox, face.score)
            aligned_crop = face.crop  # 112×112 BGR aligned crop
    """

    def __init__(
        self,
        model_name: str = "buffalo_sc",  # kept for API compatibility, unused
        device: str = "cuda",
        det_size: Tuple[int, int] = (640, 640),
        det_threshold: float = 0.5,
    ):
        if not _MTCNN_AVAILABLE:
            raise RuntimeError(
                "facenet_pytorch is required for FaceDetector. "
                "Install with: pip install facenet-pytorch"
            )

        self.device = "cpu" if device != "cuda" else "cuda"
        self.det_threshold = det_threshold

        logger.info(f"Loading MTCNN face detector on device='{self.device}'")
        self._mtcnn = MTCNN(
            keep_all=True,
            device=self.device,
            min_face_size=20,
            thresholds=[0.6, 0.7, 0.7],  # P-Net, R-Net, O-Net thresholds
            post_process=False,
        )
        logger.info("FaceDetector (MTCNN) ready.")

    # ------------------------------------------------------------------
    def detect(
        self,
        image: np.ndarray,
        max_faces: Optional[int] = None,
    ) -> List[DetectedFace]:
        """
        Run MTCNN detection on a BGR image.

        Args:
            image:     BGR uint8 numpy array (H × W × 3).
            max_faces: If set, return at most *max_faces* detections sorted
                       by confidence descending.

        Returns:
            List of :class:`DetectedFace` objects.
        """
        if image is None or image.size == 0:
            return []

        # MTCNN expects RGB
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        boxes, probs, landmarks = self._mtcnn.detect(rgb, landmarks=True)

        if boxes is None:
            return []

        results: List[DetectedFace] = []
        for i, (box, prob) in enumerate(zip(boxes, probs)):
            score = float(prob) if prob is not None else 0.0
            if score < self.det_threshold:
                continue

            x1, y1, x2, y2 = (int(v) for v in box)
            bbox = (x1, y1, x2, y2)

            kps: Optional[np.ndarray] = None
            if landmarks is not None and landmarks[i] is not None:
                kps = np.array(landmarks[i], dtype=np.float32)  # (5, 2)

            # Produce a 112×112 aligned crop
            crop: Optional[np.ndarray] = None
            if kps is not None:
                from utils.preprocessing import align_face, ARCFACE_INPUT_SIZE
                crop = align_face(image, kps, ARCFACE_INPUT_SIZE)
            else:
                # Fallback: direct crop + resize
                h, w = image.shape[:2]
                x1c = max(0, x1); y1c = max(0, y1)
                x2c = min(w, x2); y2c = min(h, y2)
                if x2c > x1c and y2c > y1c:
                    crop = cv2.resize(image[y1c:y2c, x1c:x2c], (112, 112))

            results.append(
                DetectedFace(
                    bbox=bbox,
                    score=score,
                    landmarks_5pt=kps,
                    crop=crop,
                )
            )

        # Sort by confidence descending
        results.sort(key=lambda f: f.score, reverse=True)
        if max_faces is not None:
            results = results[:max_faces]

        return results

    # ------------------------------------------------------------------
    def detect_largest(self, image: np.ndarray) -> Optional[DetectedFace]:
        """
        Convenience method: return the single largest (by bbox area) face.

        Useful for single-person kiosk scenarios.
        """
        faces = self.detect(image)
        if not faces:
            return None
        return max(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        )

    # ------------------------------------------------------------------
    @staticmethod
    def draw_detections(
        image: np.ndarray,
        faces: List[DetectedFace],
        draw_landmarks: bool = True,
    ) -> np.ndarray:
        """
        Draw bounding boxes (and optionally landmarks) on a copy of *image*.
        Useful for debugging.
        """
        vis = image.copy()
        for face in faces:
            x1, y1, x2, y2 = face.bbox
            cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 255, 0), 2)
            label = f"{face.score:.2f}"
            cv2.putText(
                vis, label, (x1, y1 - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1,
            )
            if draw_landmarks and face.landmarks_5pt is not None:
                for pt in face.landmarks_5pt:
                    cv2.circle(vis, (int(pt[0]), int(pt[1])), 2, (0, 0, 255), -1)
        return vis

