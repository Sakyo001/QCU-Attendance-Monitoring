"""
preprocessing.py
----------------
Shared image and face preprocessing utilities used by both the training
pipeline and the inference/recognition pipeline.

Responsibilities:
  - BGR ↔ RGB / tensor conversions
  - Face alignment using 5-point landmarks produced by RetinaFace
  - Normalization to the range expected by ArcFace ([−1, 1]) and
    the range expected by MiniFASNet anti-spoofing ([0, 1] / ImageNet)
  - Data-augmentation transforms used during training
  - Utility wrappers around albumentations for batch augmentation
"""

from __future__ import annotations

import cv2
import numpy as np
import torch
from albumentations import (
    Compose,
    HorizontalFlip,
    ColorJitter,
    GaussianBlur,
    RandomBrightnessContrast,
    RandomGamma,
    Normalize,
    Resize,
    CoarseDropout,
    MotionBlur,
    CLAHE,
)
from albumentations.pytorch import ToTensorV2
from typing import Tuple, Optional, List

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# ArcFace standard input size
ARCFACE_INPUT_SIZE: Tuple[int, int] = (112, 112)

# MiniFASNet standard input size
ANTISPOOF_INPUT_SIZE: Tuple[int, int] = (80, 80)  # or 128x128 depending on variant

# Reference 5-point landmarks for 112×112 ArcFace alignment
# (left eye, right eye, nose, left mouth, right mouth)
ARCFACE_REF_LANDMARKS_112 = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


# ---------------------------------------------------------------------------
# Core geometric alignment
# ---------------------------------------------------------------------------

def align_face(
    image: np.ndarray,
    landmarks_5pt: np.ndarray,
    output_size: Tuple[int, int] = ARCFACE_INPUT_SIZE,
) -> np.ndarray:
    """
    Align a face crop to a canonical pose using a 5-point similarity
    transform (SimilarityTransform from skimage or cv2.estimateAffinePartial2D).

    Args:
        image:          BGR image (H × W × 3, uint8).
        landmarks_5pt:  Shape (5, 2), landmark coordinates in pixel space
                        ordered as [left_eye, right_eye, nose,
                                    left_mouth, right_mouth].
        output_size:    (width, height) of the output crop.

    Returns:
        Aligned face crop as BGR uint8 array of shape (H, W, 3).
    """
    dst = ARCFACE_REF_LANDMARKS_112.copy()
    if output_size != (112, 112):
        scale_x = output_size[0] / 112.0
        scale_y = output_size[1] / 112.0
        dst[:, 0] *= scale_x
        dst[:, 1] *= scale_y

    src = landmarks_5pt.astype(np.float32)
    tform, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)
    if tform is None:
        # Fallback: centre-crop
        return centre_crop(image, output_size)

    aligned = cv2.warpAffine(
        image, tform, output_size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT
    )
    return aligned


def centre_crop(image: np.ndarray, output_size: Tuple[int, int]) -> np.ndarray:
    """Resize and centre-crop an image to *output_size* (w, h)."""
    h, w = image.shape[:2]
    target_w, target_h = output_size
    # Resize so the shortest side equals the target short side
    scale = max(target_w / w, target_h / h)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    x0 = (new_w - target_w) // 2
    y0 = (new_h - target_h) // 2
    return resized[y0 : y0 + target_h, x0 : x0 + target_w]


# ---------------------------------------------------------------------------
# Tensor conversions & normalization
# ---------------------------------------------------------------------------

def bgr_to_rgb(image: np.ndarray) -> np.ndarray:
    """Convert OpenCV BGR uint8 image to RGB uint8."""
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def to_arcface_tensor(image: np.ndarray, device: str = "cpu") -> torch.Tensor:
    """
    Convert a BGR uint8 aligned face crop (112×112) to an ArcFace-ready tensor.

    Normalization: pixel ∈ [0, 255] → (pixel / 127.5) − 1  → [−1, 1]

    Returns:
        torch.Tensor of shape (1, 3, 112, 112), dtype float32.
    """
    rgb = bgr_to_rgb(image)
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).float()  # (3, H, W)
    tensor = (tensor - 127.5) / 127.5
    return tensor.unsqueeze(0).to(device)


def to_antispoof_tensor(image: np.ndarray, device: str = "cpu") -> torch.Tensor:
    """
    Convert a BGR uint8 crop to a MiniFASNet-ready tensor.

    Normalization: ImageNet mean/std on RGB values ∈ [0, 1].

    Returns:
        torch.Tensor of shape (1, 3, H, W), dtype float32.
    """
    rgb = bgr_to_rgb(image)
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
    mean = torch.tensor([0.485, 0.456, 0.406], dtype=torch.float32).view(3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], dtype=torch.float32).view(3, 1, 1)
    tensor = (tensor - mean) / std
    return tensor.unsqueeze(0).to(device)


# ---------------------------------------------------------------------------
# Augmentation pipelines (albumentations)
# ---------------------------------------------------------------------------

def build_arcface_train_transforms(input_size: int = 112) -> Compose:
    """
    Strong augmentation pipeline for ArcFace training.
    Input images are assumed to be already aligned 112×112 crops.
    """
    return Compose(
        [
            Resize(input_size, input_size),
            HorizontalFlip(p=0.5),
            RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.5),
            ColorJitter(
                brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1, p=0.4
            ),
            RandomGamma(gamma_limit=(80, 120), p=0.3),
            GaussianBlur(blur_limit=(3, 7), p=0.2),
            MotionBlur(blur_limit=5, p=0.15),
            CLAHE(clip_limit=2.0, p=0.2),
            CoarseDropout(
                num_holes_range=(1, 4), hole_height_range=(4, 16), hole_width_range=(4, 16), fill=0, p=0.15
            ),
            Normalize(mean=(0.5, 0.5, 0.5), std=(0.5, 0.5, 0.5)),
            ToTensorV2(),
        ]
    )


def build_arcface_val_transforms(input_size: int = 112) -> Compose:
    """Minimal validation transform — resize + normalize only."""
    return Compose(
        [
            Resize(input_size, input_size),
            Normalize(mean=(0.5, 0.5, 0.5), std=(0.5, 0.5, 0.5)),
            ToTensorV2(),
        ]
    )


def build_antispoof_train_transforms(input_size: int = 80) -> Compose:
    """Augmentation pipeline for anti-spoof training."""
    return Compose(
        [
            Resize(input_size, input_size),
            HorizontalFlip(p=0.5),
            RandomBrightnessContrast(p=0.4),
            ColorJitter(brightness=0.2, contrast=0.2, saturation=0.15, p=0.3),
            GaussianBlur(blur_limit=(3, 5), p=0.2),
            MotionBlur(blur_limit=5, p=0.15),
            CoarseDropout(num_holes_range=(1, 3), hole_height_range=(4, 10), hole_width_range=(4, 10), p=0.1),
            Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
            ToTensorV2(),
        ]
    )


def build_antispoof_val_transforms(input_size: int = 80) -> Compose:
    return Compose(
        [
            Resize(input_size, input_size),
            Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
            ToTensorV2(),
        ]
    )


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------

def apply_transform(image_rgb: np.ndarray, transform: Compose) -> torch.Tensor:
    """
    Apply an albumentations *transform* to a single RGB uint8 image.

    Returns:
        torch.Tensor of shape (3, H, W), float32.
    """
    result = transform(image=image_rgb)
    return result["image"]


def batch_align_faces(
    image: np.ndarray,
    detections: List[dict],
    output_size: Tuple[int, int] = ARCFACE_INPUT_SIZE,
) -> List[Optional[np.ndarray]]:
    """
    Align all detected faces in *image* and return a list of aligned crops.

    Args:
        image:       BGR frame.
        detections:  List of dicts from RetinaFace / insightface with keys
                     ``bbox`` [x1, y1, x2, y2] and ``kps`` [[x,y], ...×5].

    Returns:
        List of aligned BGR crops (112×112 by default), one per detection.
        Entry is None if alignment failed.
    """
    crops: List[Optional[np.ndarray]] = []
    for det in detections:
        kps = det.get("kps")
        if kps is not None:
            landmarks = np.array(kps, dtype=np.float32)
            crops.append(align_face(image, landmarks, output_size))
        else:
            x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
            crop = image[max(0, y1) : y2, max(0, x1) : x2]
            if crop.size > 0:
                crops.append(cv2.resize(crop, output_size))
            else:
                crops.append(None)
    return crops
