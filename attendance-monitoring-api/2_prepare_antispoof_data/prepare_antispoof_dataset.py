"""
prepare_antispoof_dataset.py
----------------------------
Prepares the anti-spoofing training dataset from the crowdsourced
real-face dataset (real_30.csv + samples/).

What this script does
---------------------
1. Reads real_30.csv
2. For each of the 30 subjects:
   a. Copies / resizes the live_selfie.jpg  → datasets/spoof/real/
   b. Extracts N evenly-spaced frames from the liveness video
      → datasets/spoof/real/
3. Synthesises PRINT-ATTACK images from every real image
   → datasets/spoof/print_attack/
4. Synthesises REPLAY-ATTACK (screen) images from every real image
   → datasets/spoof/replay_attack/

Synthesis techniques
--------------------
Print attack simulation:
  - Slight desaturation (colour fading of print)
  - Moisé fringe pattern overlay (halftone / scanning artefact)
  - Paper-texture noise
  - Brightness/contrast adjustments to mimic ink absorption
  - Optional: perspective / curl warp to simulate holding a physical print

Replay attack simulation:
  - Screen gamma correction (gamma < 1 → brighter, screen-like)
  - RGB channel shift to simulate display colour temperature
  - Regular scanline / grid noise (pixel grid of LCD)
  - Lens flare / vignette from holding a phone / tablet
  - Optional: add a screen bezel mask around the face crop

After running this script the layout will be:

datasets/spoof/
    real/           ~300+ images
    print_attack/   ~300+ images
    replay_attack/  ~300+ images

This is sufficient to train MiniFASNet to detect basic spoofing.

Usage
-----
    cd face-ml-training
    python 2_prepare_antispoof_data/prepare_antispoof_dataset.py \
        --csv   ../dataset/real_30.csv \
        --samples_dir ../dataset/samples \
        --output_dir  datasets/spoof \
        --frames_per_video 10 \
        --aug_per_image 3

Arguments
---------
  --csv              Path to real_30.csv
  --samples_dir      Path to the samples/ folder next to the CSV
  --output_dir       Where to write the prepared dataset
  --frames_per_video How many frames to extract per liveness video (default 10)
  --aug_per_image    How many augmented variants per source image (default 3)
  --face_size        Crop size to write (default 256 — model will resize to 80)
  --detect           Run RetinaFace to find the face box before cropping
                     (recommended; requires insightface to be installed)
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import random
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from tqdm import tqdm

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

random.seed(42)
np.random.seed(42)

# ---------------------------------------------------------------------------
# Optional face detector for cropping
# ---------------------------------------------------------------------------

def _load_detector():
    try:
        from recognition.face_detector import FaceDetector
        det = FaceDetector(model_name="buffalo_sc", device="cpu")
        print("[INFO] Face detector loaded (RetinaFace/buffalo_sc).")
        return det
    except Exception as e:
        print(f"[WARN] Face detector unavailable ({e}). Will use full image.")
        return None


def _detect_and_crop(
    image: np.ndarray,
    detector,
    face_size: int,
    pad_ratio: float = 0.35,
) -> Optional[np.ndarray]:
    """
    Detect the largest face, add padding, return a square crop.
    Returns None if no face is found.
    """
    if detector is None:
        return None

    face = detector.detect_largest(image)
    if face is None:
        return None

    x1, y1, x2, y2 = face.bbox
    h_img, w_img = image.shape[:2]
    fw = x2 - x1
    fh = y2 - y1

    # Pad around the face
    pad_x = int(fw * pad_ratio)
    pad_y = int(fh * pad_ratio)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w_img, x2 + pad_x)
    y2 = min(h_img, y2 + pad_y)

    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    return cv2.resize(crop, (face_size, face_size))


# ---------------------------------------------------------------------------
# Synthetic spoof generators
# ---------------------------------------------------------------------------

def make_print_attack(
    image: np.ndarray,
    variant: int = 0,
) -> np.ndarray:
    """
    Simulate a printed-photo attack from a real face image.

    Variant 0–2 produce visually distinct versions to increase diversity.
    """
    img = image.copy().astype(np.float32)
    h, w = img.shape[:2]

    # 1. Slight desaturation — print ink fades colour
    gray = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    gray3 = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR).astype(np.float32)
    desat_factor = random.uniform(0.35, 0.65)
    img = img * (1 - desat_factor) + gray3 * desat_factor

    # 2. Brightness / contrast: printed paper is usually slightly darker
    brightness = random.uniform(-18, 12)
    contrast = random.uniform(0.82, 1.05)
    img = img * contrast + brightness
    img = np.clip(img, 0, 255)

    # 3. Moisé / halftone fringe pattern (periodic noise of printing)
    freq_x = random.uniform(0.04, 0.12)   # cycles / pixel
    freq_y = random.uniform(0.04, 0.12)
    phase  = random.uniform(0, 2 * math.pi)
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)
    moie = (np.sin(2 * math.pi * freq_x * xx + phase) *
            np.sin(2 * math.pi * freq_y * yy + phase))
    amplitude = random.uniform(4, 12)
    moie_map = (moie * amplitude)[..., np.newaxis]
    img = np.clip(img + moie_map, 0, 255)

    # 4. Paper texture noise (Gaussian grain)
    noise_std = random.uniform(4, 14)
    noise = np.random.normal(0, noise_std, img.shape).astype(np.float32)
    img = np.clip(img + noise, 0, 255)

    # 5. Slight blur (ink diffusion on paper)
    if random.random() < 0.7:
        ksize = random.choice([3, 5])
        img = cv2.GaussianBlur(img, (ksize, ksize), 0)

    # 6. Variant-specific: perspective warp (holding / scanning angle)
    if variant == 2:
        pts_src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        warp_amount = random.uniform(0.03, 0.07)
        pts_dst = np.float32([
            [w * warp_amount * random.uniform(0, 1),
             h * warp_amount * random.uniform(0, 1)],
            [w * (1 - warp_amount * random.uniform(0, 1)),
             h * warp_amount * random.uniform(0, 1)],
            [w * (1 - warp_amount * random.uniform(0, 1)),
             h * (1 - warp_amount * random.uniform(0, 1))],
            [w * warp_amount * random.uniform(0, 1),
             h * (1 - warp_amount * random.uniform(0, 1))],
        ])
        M = cv2.getPerspectiveTransform(pts_src, pts_dst)
        img = cv2.warpPerspective(img, M, (w, h))

    # 7. Compression artefact simulation
    encode_quality = random.randint(55, 85)
    _, buf = cv2.imencode(".jpg", img.astype(np.uint8),
                          [cv2.IMWRITE_JPEG_QUALITY, encode_quality])
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR).astype(np.float32)

    return img.astype(np.uint8)


def make_replay_attack(
    image: np.ndarray,
    variant: int = 0,
) -> np.ndarray:
    """
    Simulate a replay (screen display) attack from a real face image.

    Emulates holding a phone / tablet screen in front of the camera.
    """
    img = image.copy().astype(np.float32)
    h, w = img.shape[:2]

    # 1. Screen gamma correction (screen is brighter / higher contrast)
    gamma = random.uniform(0.72, 0.92)
    lut = np.array(
        [(i / 255.0) ** gamma * 255 for i in range(256)], dtype=np.uint8
    )
    img = cv2.LUT(img.astype(np.uint8), lut).astype(np.float32)

    # 2. RGB channel shift (blue-shifted for most LCD / OLED screens)
    b_shift = random.uniform(6, 18)
    g_shift = random.uniform(-4, 4)
    r_shift = random.uniform(-8, 2)
    img[:, :, 0] = np.clip(img[:, :, 0] + b_shift, 0, 255)
    img[:, :, 1] = np.clip(img[:, :, 1] + g_shift, 0, 255)
    img[:, :, 2] = np.clip(img[:, :, 2] + r_shift, 0, 255)

    # 3. Pixel grid overlay (LCD sub-pixel pattern)
    pixel_pitch = random.choice([2, 3, 4])
    grid_strength = random.uniform(0.04, 0.12)
    grid = np.ones((h, w), dtype=np.float32)
    grid[::pixel_pitch, :] *= (1 - grid_strength)
    grid[:, ::pixel_pitch] *= (1 - grid_strength)
    img = img * grid[..., np.newaxis]
    img = np.clip(img, 0, 255)

    # 4. Vignette (camera lens picks up screen glare near edges)
    cy, cx = h // 2, w // 2
    Y, X = np.ogrid[:h, :w]
    dist = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    max_dist = math.sqrt(cx ** 2 + cy ** 2)
    vig_strength = random.uniform(0.25, 0.50)
    vignette = 1 - vig_strength * (dist / max_dist) ** 2
    img = img * vignette[..., np.newaxis]
    img = np.clip(img, 0, 255)

    # 5. Slight noise (device vibration + sensor noise from camera)
    noise_std = random.uniform(2, 8)
    noise = np.random.normal(0, noise_std, img.shape).astype(np.float32)
    img = np.clip(img + noise, 0, 255)

    # 6. Variant 1: add a screen bezel (black border) to simulate holding a phone
    if variant == 1:
        border_w = int(w * random.uniform(0.06, 0.14))
        border_h = int(h * random.uniform(0.10, 0.18))
        canvas = np.zeros_like(img)
        # Place the screen content inside the bezel
        inner_w = w - 2 * border_w
        inner_h = h - 2 * border_h
        inner = cv2.resize(img.astype(np.uint8), (inner_w, inner_h))
        canvas[border_h:border_h + inner_h,
               border_w:border_w + inner_w] = inner
        img = canvas

    # 7. Variant 2: motion blur (replay video shaking)
    if variant == 2 and random.random() < 0.6:
        ksize = random.choice([3, 5])
        kernel = np.zeros((ksize, ksize))
        kernel[ksize // 2, :] = 1.0 / ksize
        angle = random.uniform(0, 180)
        M_rot = cv2.getRotationMatrix2D((ksize / 2, ksize / 2), angle, 1)
        kernel = cv2.warpAffine(kernel, M_rot, (ksize, ksize))
        kernel /= kernel.sum() + 1e-8
        img = cv2.filter2D(img.astype(np.uint8), -1, kernel).astype(np.float32)

    # 8. Compression artefact
    encode_quality = random.randint(60, 90)
    _, buf = cv2.imencode(".jpg", img.astype(np.uint8),
                          [cv2.IMWRITE_JPEG_QUALITY, encode_quality])
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR).astype(np.float32)

    return img.astype(np.uint8)


# ---------------------------------------------------------------------------
# Video frame extractor
# ---------------------------------------------------------------------------

def extract_video_frames(
    video_path: Path,
    n_frames: int = 10,
    face_size: int = 256,
    detector=None,
) -> List[np.ndarray]:
    """
    Extract *n_frames* evenly-spaced frames from a video file.
    Optionally runs face detection + cropping on each frame.

    Returns a list of BGR uint8 images.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"  [WARN] Cannot open video: {video_path.name}")
        return []

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        total = 9999  # cannot determine — just read sequentially

    indices = set(
        [int(i * total / n_frames) for i in range(n_frames)] if total >= n_frames
        else list(range(total))
    )

    frames: List[np.ndarray] = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx in indices:
            crop = _detect_and_crop(frame, detector, face_size)
            frames.append(crop if crop is not None else cv2.resize(frame, (face_size, face_size)))
        frame_idx += 1
        if len(frames) >= n_frames:
            break

    cap.release()
    return frames


# ---------------------------------------------------------------------------
# Main preparation pipeline
# ---------------------------------------------------------------------------

def prepare(
    csv_path: Path,
    samples_dir: Path,
    output_dir: Path,
    frames_per_video: int = 10,
    aug_per_image: int = 3,
    face_size: int = 256,
    use_detector: bool = True,
):
    real_dir    = output_dir / "real"
    print_dir   = output_dir / "print_attack"
    replay_dir  = output_dir / "replay_attack"
    for d in [real_dir, print_dir, replay_dir]:
        d.mkdir(parents=True, exist_ok=True)

    detector = _load_detector() if use_detector else None

    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"\nProcessing {len(rows)} subjects…")

    real_count   = 0
    print_count  = 0
    replay_count = 0

    for row in tqdm(rows, desc="Subjects"):
        subject_id = Path(row["selfie_link"]).parent.name  # folder name

        # ── 1. Live selfie ─────────────────────────────────────────────
        selfie_path = samples_dir / row["selfie_link"]
        real_images: List[np.ndarray] = []

        if selfie_path.exists():
            img = cv2.imread(str(selfie_path))
            if img is not None:
                crop = _detect_and_crop(img, detector, face_size)
                real_images.append(crop if crop is not None
                                   else cv2.resize(img, (face_size, face_size)))

        # ── 2. Video frames ────────────────────────────────────────────
        video_path = samples_dir / row["video_link"]
        if video_path.exists():
            video_frames = extract_video_frames(
                video_path, frames_per_video, face_size, detector
            )
            real_images.extend(video_frames)
        else:
            # Try alternative extensions stored on disk
            for ext in [".mp4", ".MOV", ".mov", ".3gp", ".avi"]:
                alt = video_path.with_suffix(ext)
                if alt.exists():
                    video_frames = extract_video_frames(
                        alt, frames_per_video, face_size, detector
                    )
                    real_images.extend(video_frames)
                    break

        if not real_images:
            print(f"  [WARN] No images found for subject {subject_id}")
            continue

        # ── 3. Save real images ────────────────────────────────────────
        for i, img in enumerate(real_images):
            fname = real_dir / f"{subject_id}_{i:04d}.jpg"
            cv2.imwrite(str(fname), img)
            real_count += 1

        # ── 4. Generate synthetic spoof samples ────────────────────────
        # Use all source images + create aug_per_image variants each
        sources = real_images

        for img in sources:
            for v in range(aug_per_image):
                # Print attack
                p_img = make_print_attack(img, variant=v % 3)
                fname = print_dir / f"{subject_id}_p{print_count:06d}.jpg"
                cv2.imwrite(str(fname), p_img)
                print_count += 1

                # Replay attack
                r_img = make_replay_attack(img, variant=v % 3)
                fname = replay_dir / f"{subject_id}_r{replay_count:06d}.jpg"
                cv2.imwrite(str(fname), r_img)
                replay_count += 1

    print(f"\n{'='*50}")
    print(f"  real/          {real_count:>5} images")
    print(f"  print_attack/  {print_count:>5} images")
    print(f"  replay_attack/ {replay_count:>5} images")
    print(f"  Total:         {real_count + print_count + replay_count:>5} images")
    print(f"  Output:        {output_dir.resolve()}")
    print(f"{'='*50}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Prepare anti-spoof training dataset from real_30 crowdsourced data."
    )
    p.add_argument("--csv",            default="../dataset/real_30.csv")
    p.add_argument("--samples_dir",    default="../dataset/samples")
    p.add_argument("--output_dir",     default="datasets/spoof")
    p.add_argument("--frames_per_video", default=10, type=int,
                   help="Video frames to extract per subject (default 10)")
    p.add_argument("--aug_per_image",  default=3, type=int,
                   help="Synthetic spoof variants per source image (default 3)")
    p.add_argument("--face_size",      default=256, type=int,
                   help="Square crop size to save (default 256)")
    p.add_argument("--no_detector",    action="store_true",
                   help="Skip RetinaFace — just resize whole image")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    prepare(
        csv_path=Path(args.csv).resolve(),
        samples_dir=Path(args.samples_dir).resolve(),
        output_dir=Path(args.output_dir).resolve(),
        frames_per_video=args.frames_per_video,
        aug_per_image=args.aug_per_image,
        face_size=args.face_size,
        use_detector=not args.no_detector,
    )
