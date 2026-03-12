"""
train_arcface.py
----------------
Full training script for the ArcFace face-recognition model.

Pipeline
--------
1. Load dataset from  datasets/faces/<person_id>/*.jpg
2. Detect and align every image using RetinaFace
3. Apply data augmentation
4. Train IResNet (50 or 100) backbone with ArcFace loss head
5. Validate on a held-out split every N epochs
6. Save best checkpoint to  models/arcface/arcface_model.pth

Supports:
  - Mixed-precision training (AMP) for GTX 1650
  - Cosine LR warm-up + annealing
  - Gradient clipping
  - TensorBoard logging

Usage
-----
    python training/train_arcface.py \
        --data_dir datasets/faces \
        --output_dir models/arcface \
        --backbone r50 \
        --epochs 50 \
        --batch_size 64 \
        --device cuda

Requirements
------------
    pip install torch torchvision insightface albumentations tqdm
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.cuda.amp import GradScaler, autocast
from torch.utils.data import DataLoader, Dataset, random_split
from tqdm import tqdm
import csv
from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from recognition.face_detector import FaceDetector
from recognition.face_embedding import IResNet, iresnet50, iresnet100, ArcFaceHead
from utils.preprocessing import (
    build_arcface_train_transforms,
    build_arcface_val_transforms,
    align_face,
    bgr_to_rgb,
    ARCFACE_INPUT_SIZE,
)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class FaceDataset(Dataset):
    """
    Loads pre-aligned 112×112 face images from a folder hierarchy:

        data_root/
            person_001/
                img_001.jpg
                img_002.jpg
            person_002/
                ...

    If ``preprocess=True`` (default), runs RetinaFace alignment on every
    image at dataset construction time and caches the crops in memory.
    Pass ``preprocess=False`` if images are already aligned.
    """

    def __init__(
        self,
        data_root: str,
        transform=None,
        preprocess: bool = True,
        detector: Optional[FaceDetector] = None,
        min_images_per_identity: int = 3,
    ):
        self.data_root = Path(data_root)
        self.transform = transform

        # Build label index
        self._samples: List[Tuple[Path, int]] = []  # (image_path, class_id)
        self._class_to_idx: Dict[str, int] = {}

        identity_dirs = sorted(
            [d for d in self.data_root.iterdir() if d.is_dir()]
        )

        valid_extensions = {".jpg", ".jpeg", ".png", ".bmp"}

        for class_id, identity_dir in enumerate(identity_dirs):
            images = [
                f for f in identity_dir.iterdir()
                if f.suffix.lower() in valid_extensions
            ]
            if len(images) < min_images_per_identity:
                logger.warning(
                    f"Identity '{identity_dir.name}' has only {len(images)} images "
                    f"(< {min_images_per_identity}), skipping."
                )
                continue
            self._class_to_idx[identity_dir.name] = class_id
            for img_path in images:
                self._samples.append((img_path, class_id))

        logger.info(
            f"FaceDataset: {len(self._class_to_idx)} identities, "
            f"{len(self._samples)} images from '{data_root}'"
        )

        # Optionally pre-process (align) all images at construction time
        self._crops: Optional[List[Optional[np.ndarray]]] = None
        if preprocess:
            self._crops = self._run_preprocessing(detector)

    # ------------------------------------------------------------------
    def _run_preprocessing(
        self, detector: Optional[FaceDetector]
    ) -> List[Optional[np.ndarray]]:
        """Detect, align, and cache every face crop."""
        if detector is None:
            logger.info(
                "No detector provided for preprocessing. "
                "Loading a default FaceDetector (cpu) — this may be slow."
            )
            detector = FaceDetector(model_name="buffalo_sc", device="cpu")

        crops: List[Optional[np.ndarray]] = []
        logger.info("Pre-processing dataset images (detect + align)…")
        for img_path, _ in tqdm(self._samples, unit="img"):
            bgr = cv2.imread(str(img_path))
            if bgr is None:
                crops.append(None)
                continue
            face = detector.detect_largest(bgr)
            if face is None or face.crop is None:
                # Fallback: just resize to 112×112 without alignment
                crops.append(cv2.resize(bgr, ARCFACE_INPUT_SIZE))
            else:
                crops.append(face.crop)
        logger.info("Preprocessing complete.")
        return crops

    # ------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        label = self._samples[idx][1]

        if self._crops is not None:
            crop = self._crops[idx]
            if crop is None:
                # Return a black image placeholder
                crop = np.zeros((*ARCFACE_INPUT_SIZE[::-1], 3), dtype=np.uint8)
        else:
            img_path = self._samples[idx][0]
            crop = cv2.imread(str(img_path))
            if crop is None:
                crop = np.zeros((*ARCFACE_INPUT_SIZE[::-1], 3), dtype=np.uint8)
            crop = cv2.resize(crop, ARCFACE_INPUT_SIZE)

        rgb = bgr_to_rgb(crop)

        if self.transform:
            tensor = self.transform(image=rgb)["image"]
        else:
            from albumentations import Compose, Normalize
            from albumentations.pytorch import ToTensorV2
            _basic = Compose([
                Normalize(mean=(0.5, 0.5, 0.5), std=(0.5, 0.5, 0.5)),
                ToTensorV2(),
            ])
            tensor = _basic(image=rgb)["image"]

        return tensor, label

    @property
    def num_classes(self) -> int:
        return len(self._class_to_idx)

    @property
    def class_to_idx(self) -> Dict[str, int]:
        return self._class_to_idx


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def build_model(
    backbone: str,
    num_classes: int,
    device: str,
    scale: float = 64.0,
    margin: float = 0.5,
) -> Tuple[nn.Module, nn.Module]:
    """Return (backbone, head) moved to *device*."""
    if backbone == "r100":
        net = iresnet100()
    else:
        net = iresnet50()
    head = ArcFaceHead(
        embedding_dim=512,
        num_classes=num_classes,
        scale=scale,
        margin=margin,
    )
    return net.to(device), head.to(device)


def get_lr_scheduler(
    optimizer: optim.Optimizer,
    num_epochs: int,
    warmup_epochs: int = 5,
) -> optim.lr_scheduler.LambdaLR:
    """
    Cosine annealing with linear warm-up.
    """
    import math

    def lr_lambda(epoch: int) -> float:
        if epoch < warmup_epochs:
            return float(epoch) / float(max(1, warmup_epochs))
        progress = float(epoch - warmup_epochs) / float(
            max(1, num_epochs - warmup_epochs)
        )
        return max(0.0, 0.5 * (1.0 + math.cos(math.pi * progress)))

    return optim.lr_scheduler.LambdaLR(optimizer, lr_lambda=lr_lambda)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------

def train_one_epoch(
    backbone: nn.Module,
    head: nn.Module,
    loader: DataLoader,
    optimizer: optim.Optimizer,
    criterion: nn.CrossEntropyLoss,
    scaler: GradScaler,
    device: str,
    epoch: int,
    grad_clip: float = 5.0,
) -> Dict[str, float]:
    backbone.train()
    head.train()

    total_loss = 0.0
    correct = 0
    total = 0

    pbar = tqdm(loader, desc=f"Train epoch {epoch}", leave=False)
    for images, labels in pbar:
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)

        with autocast(enabled=(device == "cuda")):
            embeddings = backbone(images)
            logits = head(embeddings, labels)
            loss = criterion(logits, labels)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        nn.utils.clip_grad_norm_(
            list(backbone.parameters()) + list(head.parameters()),
            grad_clip,
        )
        scaler.step(optimizer)
        scaler.update()

        total_loss += loss.item() * images.size(0)
        preds = logits.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += images.size(0)

        pbar.set_postfix(loss=f"{loss.item():.4f}")

    avg_loss = total_loss / total
    accuracy = correct / total * 100
    return {"loss": avg_loss, "acc": accuracy}


@torch.no_grad()
def evaluate(
    backbone: nn.Module,
    head: nn.Module,
    loader: DataLoader,
    criterion: nn.CrossEntropyLoss,
    device: str,
) -> Dict[str, float]:
    backbone.eval()
    head.eval()

    total_loss = 0.0
    correct = 0
    total = 0

    for images, labels in tqdm(loader, desc="Val", leave=False):
        images = images.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        embeddings = backbone(images)
        logits = head(embeddings, labels)
        loss = criterion(logits, labels)
        total_loss += loss.item() * images.size(0)
        preds = logits.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += images.size(0)

    return {"loss": total_loss / total, "acc": correct / total * 100}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train ArcFace face recognition model")
    parser.add_argument("--data_dir",    default="datasets/faces",  help="Dataset root")
    parser.add_argument("--output_dir",  default="models/arcface",  help="Where to save weights")
    parser.add_argument("--backbone",    default="r50", choices=["r50", "r100"])
    parser.add_argument("--epochs",      default=50,   type=int)
    parser.add_argument("--batch_size",  default=64,   type=int)
    parser.add_argument("--lr",          default=0.1,  type=float)
    parser.add_argument("--weight_decay",default=5e-4, type=float)
    parser.add_argument("--scale",       default=64.0, type=float, help="ArcFace scale s")
    parser.add_argument("--margin",      default=0.5,  type=float, help="ArcFace margin m")
    parser.add_argument("--warmup",      default=5,    type=int,   help="Warm-up epochs")
    parser.add_argument("--val_split",   default=0.1,  type=float, help="Validation fraction")
    parser.add_argument("--num_workers", default=4,    type=int)
    parser.add_argument("--device",      default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--preprocess",  default=True, action=argparse.BooleanOptionalAction,
                        help="Run RetinaFace alignment at dataset load time")
    parser.add_argument("--resume",      default=None, help="Path to checkpoint to resume from")
    parser.add_argument("--log_dir",     default="runs/arcface", help="CSV log directory")
    return parser.parse_args()


def main():
    args = parse_args()
    logger.info(f"Args: {vars(args)}")

    # Output directories
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    csv_path = log_dir / "metrics.csv"
    _csv_file = open(csv_path, "w", newline="", buffering=1)
    _csv_writer = csv.DictWriter(
        _csv_file,
        fieldnames=["epoch", "train_loss", "train_acc", "val_loss", "val_acc", "lr"]
    )
    _csv_writer.writeheader()

    # ── Dataset ──────────────────────────────────────────────────────────
    train_transform = build_arcface_train_transforms(112)
    val_transform   = build_arcface_val_transforms(112)

    full_dataset = FaceDataset(
        data_root=args.data_dir,
        transform=train_transform,
        preprocess=args.preprocess,
    )
    n_classes = full_dataset.num_classes
    logger.info(f"Total classes: {n_classes}")

    val_size  = max(1, int(len(full_dataset) * args.val_split))
    train_size = len(full_dataset) - val_size
    train_ds, val_ds = random_split(full_dataset, [train_size, val_size])

    # Override transform for val subset
    val_ds.dataset = FaceDataset(
        data_root=args.data_dir,
        transform=val_transform,
        preprocess=False,  # already cached in full_dataset if preprocess=True
    )

    train_loader = DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True,
        num_workers=args.num_workers, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False,
        num_workers=args.num_workers, pin_memory=True,
    )

    # ── Model ─────────────────────────────────────────────────────────────
    backbone, head = build_model(
        args.backbone, n_classes, args.device,
        scale=args.scale, margin=args.margin,
    )
    criterion = nn.CrossEntropyLoss()

    optimizer = optim.SGD(
        list(backbone.parameters()) + list(head.parameters()),
        lr=args.lr,
        momentum=0.9,
        weight_decay=args.weight_decay,
    )
    scheduler = get_lr_scheduler(optimizer, args.epochs, warmup_epochs=args.warmup)
    scaler = GradScaler(enabled=(args.device == "cuda"))

    start_epoch = 0
    best_val_acc = 0.0

    if args.resume:
        ckpt = torch.load(args.resume, map_location=args.device)
        backbone.load_state_dict(ckpt["backbone"])
        head.load_state_dict(ckpt["head"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        scaler.load_state_dict(ckpt["scaler"])
        start_epoch = ckpt["epoch"] + 1
        best_val_acc = ckpt.get("best_val_acc", 0.0)
        logger.info(f"Resumed from {args.resume} at epoch {start_epoch}.")

    # ── Training loop ─────────────────────────────────────────────────────
    for epoch in range(start_epoch, args.epochs):
        t0 = time.time()

        train_metrics = train_one_epoch(
            backbone, head, train_loader, optimizer, criterion,
            scaler, args.device, epoch,
        )
        val_metrics = evaluate(backbone, head, val_loader, criterion, args.device)
        scheduler.step()

        elapsed = time.time() - t0
        lr_now = optimizer.param_groups[0]["lr"]

        logger.info(
            f"Epoch {epoch:03d}/{args.epochs-1} | "
            f"Train loss={train_metrics['loss']:.4f} acc={train_metrics['acc']:.2f}% | "
            f"Val loss={val_metrics['loss']:.4f} acc={val_metrics['acc']:.2f}% | "
            f"LR={lr_now:.2e} | {elapsed:.1f}s"
        )

        _csv_writer.writerow({
            "epoch": epoch,
            "train_loss": f"{train_metrics['loss']:.6f}",
            "train_acc":  f"{train_metrics['acc']:.4f}",
            "val_loss":   f"{val_metrics['loss']:.6f}",
            "val_acc":    f"{val_metrics['acc']:.4f}",
            "lr":         f"{lr_now:.2e}",
        })

        # Save checkpoint every epoch
        ckpt = {
            "epoch": epoch,
            "backbone": backbone.state_dict(),
            "head": head.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "scaler": scaler.state_dict(),
            "best_val_acc": best_val_acc,
            "num_classes": n_classes,
            "class_to_idx": full_dataset.class_to_idx,
        }
        torch.save(ckpt, out_dir / "last_checkpoint.pth")

        if val_metrics["acc"] > best_val_acc:
            best_val_acc = val_metrics["acc"]
            ckpt["best_val_acc"] = best_val_acc
            torch.save(ckpt, out_dir / "arcface_model.pth")
            logger.info(f"  → New best val acc: {best_val_acc:.2f}%  (saved)")

    _csv_file.close()
    logger.info(f"Training complete. Best val accuracy: {best_val_acc:.2f}%")
    logger.info(f"Model saved to: {out_dir / 'arcface_model.pth'}")
    logger.info(f"Metrics log:    {csv_path}")


if __name__ == "__main__":
    main()
