"""
camera_manager.py
-----------------
Manages a single shared OpenCV VideoCapture for the Python server.

The camera is opened once and shared among all active WebSocket clients.
Each frame is captured at the native resolution, processed through the
recognition engine (detection + anti-spoofing + embedding + identification),
and then streamed as JPEG to connected clients along with recognition data.

This ensures anti-spoofing runs on raw camera frames (never browser-compressed),
making replay / phone-display attacks much harder to bypass.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

import cv2
import numpy as np
from loguru import logger


class CameraManager:
    """
    Thread-safe singleton camera capture manager.

    Captures frames from a local webcam in a background thread and
    exposes them via ``get_frame()``.
    """

    def __init__(
        self,
        camera_index: int = 0,
        width: int = 640,
        height: int = 480,
        target_fps: int = 15,
    ):
        self._camera_index = camera_index
        self._width = width
        self._height = height
        self._target_fps = target_fps
        self._frame_interval = 1.0 / target_fps

        self._cap: Optional[cv2.VideoCapture] = None
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._frame_id: int = 0
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._client_count = 0
        self._client_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def _open_camera(self) -> bool:
        """Open the camera device. Returns True on success."""
        if self._cap is not None and self._cap.isOpened():
            return True

        logger.info(f"Opening camera index={self._camera_index} ({self._width}x{self._height})")
        cap = cv2.VideoCapture(self._camera_index, cv2.CAP_DSHOW)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        if not cap.isOpened():
            logger.error(f"Failed to open camera {self._camera_index}")
            return False

        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info(f"Camera opened: {actual_w}x{actual_h}")
        self._cap = cap
        return True

    def _capture_loop(self) -> None:
        """Background thread: read frames from camera continuously."""
        logger.info("Camera capture thread started")
        while self._running:
            t0 = time.monotonic()
            if self._cap is None or not self._cap.isOpened():
                time.sleep(0.5)
                continue

            ret, frame = self._cap.read()
            if ret and frame is not None:
                with self._lock:
                    self._frame = frame
                    self._frame_id += 1

            # Throttle to target FPS
            elapsed = time.monotonic() - t0
            sleep_time = self._frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info("Camera capture thread stopped")

    def _start_capture(self) -> bool:
        """Start the background capture thread if not already running."""
        if self._running:
            return True
        if not self._open_camera():
            return False
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        return True

    def _stop_capture(self) -> None:
        """Stop the background thread and release the camera."""
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        logger.info("Camera released")

    # ------------------------------------------------------------------
    # Client reference counting
    # ------------------------------------------------------------------

    def acquire(self) -> bool:
        """
        A client (WebSocket) is connecting. Start the camera if this is
        the first client. Returns True if the camera is available.
        """
        with self._client_lock:
            self._client_count += 1
            logger.info(f"Camera client count: {self._client_count}")
            if self._client_count == 1:
                return self._start_capture()
            return self._running

    def release(self) -> None:
        """
        A client is disconnecting. Stop the camera when the last client
        leaves.
        """
        with self._client_lock:
            self._client_count = max(0, self._client_count - 1)
            logger.info(f"Camera client count: {self._client_count}")
            if self._client_count == 0:
                self._stop_capture()

    # ------------------------------------------------------------------
    # Frame access
    # ------------------------------------------------------------------

    def get_frame(self) -> tuple[Optional[np.ndarray], int]:
        """
        Get the latest captured frame.
        Returns (frame_bgr, frame_id) or (None, 0) if no frame available.
        The frame is a copy — safe to modify.
        """
        with self._lock:
            if self._frame is None:
                return None, 0
            return self._frame.copy(), self._frame_id

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def resolution(self) -> tuple[int, int]:
        """Return (width, height) of the camera."""
        return self._width, self._height
