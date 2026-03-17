"""
collect_faces.py
----------------
Interactive face-collection tool for building the recognition or anti-spoof dataset.

Usage
-----
Collect face images for ONE person (recognition dataset):

    python 1_collect_data/collect_faces.py \
        --mode recognition \
        --identity "John_Doe" \
        --output_dir datasets/faces \
        --num_images 20

Collect anti-spoof samples (real face in front of camera):

    python 1_collect_data/collect_faces.py \
        --mode antispoof \
        --class_name real \
        --output_dir datasets/spoof \
        --num_images 200

Anti-spoof class names:
    real | print_attack | replay_attack

Controls
--------
  SPACE  — capture the current frame
  A      — toggle auto-capture (captures every N frames automatically)
  Q / ESC — quit

Requirements
------------
  pip install opencv-python insightface onnxruntime
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


# ---------------------------------------------------------------------------
# RetinaFace-based live preview helper
# ---------------------------------------------------------------------------

def _try_load_detector():
    """Attempt to load a lightweight face detector for live preview quality checks."""
    try:
        from recognition.face_detector import FaceDetector
        return FaceDetector(model_name="buffalo_sc", device="cpu")
    except Exception as exc:
        logger.warning(f"Face detector not available for live preview: {exc}")
        return None


# ---------------------------------------------------------------------------
# Main collector
# ---------------------------------------------------------------------------

def collect_faces(
    output_dir: Path,
    num_images: int = 20,
    camera_idx: int = 0,
    auto_interval_frames: int = 10,
    detector=None,
) -> int:
    """
    Open webcam and collect *num_images* face crops into *output_dir*.

    Returns the number of images actually saved.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(camera_idx)
    if not cap.isOpened():
        logger.error(f"Cannot open camera index {camera_idx}.")
        return 0

    # Use a higher resolution if available
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)

    saved = 0
    frame_count = 0
    auto_mode = False

    label_text  = f"Saving to: {output_dir}"
    status_text = f"Saved: 0/{num_images}"

    logger.info(f"Camera opened. Saving up to {num_images} images to '{output_dir}'")
    logger.info("Controls: SPACE=capture | A=auto-capture | Q/ESC=quit")

    while saved < num_images:
        ret, frame = cap.read()
        if not ret:
            logger.warning("Frame grab failed — retrying…")
            time.sleep(0.05)
            continue

        frame_count += 1
        display = frame.copy()

        # Run detector on every 5th frame for live feedback
        face_found = False
        if detector is not None and frame_count % 5 == 0:
            try:
                face = detector.detect_largest(frame)
                if face is not None:
                    face_found = True
                    x1, y1, x2, y2 = face.bbox
                    cv2.rectangle(display, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(
                        display, f"{face.score:.2f}",
                        (x1, max(0, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1,
                    )
            except Exception:
                pass

        # Status overlay
        color = (0, 200, 0) if face_found else (0, 100, 200)
        cv2.putText(display, label_text,  (10, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        cv2.putText(display, status_text, (10, 55),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
        mode_str = "AUTO" if auto_mode else "MANUAL"
        cv2.putText(display, f"Mode: {mode_str}", (10, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 50), 1)

        cv2.imshow("Face Collector — press SPACE to capture, A to toggle auto, Q to quit", display)

        # Auto-capture
        should_capture = auto_mode and (frame_count % auto_interval_frames == 0)

        key = cv2.waitKey(1) & 0xFF
        if key == ord(" "):
            should_capture = True
        elif key == ord("a") or key == ord("A"):
            auto_mode = not auto_mode
            logger.info(f"Auto-capture {'ON' if auto_mode else 'OFF'}")
        elif key in (ord("q"), ord("Q"), 27):  # Q or ESC
            logger.info("User quit early.")
            break

        if should_capture:
            filename = output_dir / f"{saved:05d}.jpg"
            cv2.imwrite(str(filename), frame)
            saved += 1
            status_text = f"Saved: {saved}/{num_images}"
            logger.info(f"  Saved [{saved}/{num_images}] → {filename.name}")

    cap.release()
    cv2.destroyAllWindows()
    logger.info(f"Collection done. {saved} images saved to '{output_dir}'.")
    return saved


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect face images for the attendance recognition dataset."
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    # ── Recognition mode ──────────────────────────────────────────────────
    rec = sub.add_parser(
        "recognition",
        help="Collect face images for ONE person (adds to datasets/faces/<identity>/)",
    )
    rec.add_argument(
        "--identity",
        required=True,
        help='Person identifier, e.g. "John_Doe" or an employee ID.',
    )
    rec.add_argument("--output_dir", default="datasets/faces")
    rec.add_argument("--num_images", default=20, type=int)
    rec.add_argument("--camera",     default=0,  type=int)
    rec.add_argument("--auto_interval", default=10, type=int,
                     help="Capture every N frames in auto mode.")
    rec.add_argument("--no_detector", action="store_true",
                     help="Disable live face detection overlay (faster on CPU).")

    # ── Anti-spoof mode ───────────────────────────────────────────────────
    spf = sub.add_parser(
        "antispoof",
        help="Collect samples for anti-spoof training (real / print_attack / replay_attack).",
    )
    spf.add_argument(
        "--class_name",
        required=True,
        choices=["real", "print_attack", "replay_attack"],
    )
    spf.add_argument("--output_dir", default="datasets/spoof")
    spf.add_argument("--num_images", default=200, type=int)
    spf.add_argument("--camera",     default=0,   type=int)
    spf.add_argument("--auto_interval", default=5, type=int)
    spf.add_argument("--no_detector", action="store_true")

    return parser.parse_args()


def main():
    args = parse_args()

    detector = None
    if not args.no_detector:
        detector = _try_load_detector()

    if args.mode == "recognition":
        out = Path(args.output_dir) / args.identity
        logger.info(f"Recognition collection → identity='{args.identity}' → {out}")
    else:  # antispoof
        out = Path(args.output_dir) / args.class_name
        logger.info(f"Anti-spoof collection  → class='{args.class_name}' → {out}")

    saved = collect_faces(
        output_dir=out,
        num_images=args.num_images,
        camera_idx=args.camera,
        auto_interval_frames=args.auto_interval,
        detector=detector,
    )

    print(f"\n✓ Done. {saved} images saved to: {out}")


if __name__ == "__main__":
    main()
