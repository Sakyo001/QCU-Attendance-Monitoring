"""
train_antispoof.py
------------------
Training script for the MiniFASNet anti-spoofing model.

Dataset structure expected:
    datasets/spoof/
        real/
            *.jpg / *.png
        print_attack/
            *.jpg
        replay_attack/
            *.jpg

Class mapping:
    0 → real
    1 → print_attack
    2 → replay_attack

Both MiniFASNetV2 and MiniFASNetV1SE can be trained with this script.

Usage
-----
    python training/train_antispoof.py \
        --data_dir datasets/spoof \
        --output_dir models/antispoof \
        --model v2 \
        --epochs 60 \
        --batch_size 64 \
        --device cuda

Tips for GTX 1650
-----------------
  - batch_size 64 fits comfortably in 4 GB VRAM with 80×80 inputs.
  - Mixed precision (AMP) is enabled by default.
  - The train set is intentionally balanced: the dataloader samples uniformly
    across the three classes to avoid imbalance.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.cuda.amp import GradScaler, autocast
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from tqdm import tqdm
import csv
from loguru import logger

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from recognition.anti_spoof import MiniFASNetV2, MiniFASNetV1SE
from utils.preprocessing import (
    build_antispoof_train_transforms,
    build_antispoof_val_transforms,
    bgr_to_rgb,
    ANTISPOOF_INPUT_SIZE,
)


# ---------------------------------------------------------------------------
# Label mapping
# ---------------------------------------------------------------------------

SPOOF_CLASS_MAP: Dict[str, int] = {
    "real":          0,
    "print_attack":  1,
    "replay_attack": 2,
}
IDX_TO_CLASS = {v: k for k, v in SPOOF_CLASS_MAP.items()}


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class AntiSpoofDataset(Dataset):
    """
    Loads spoof/real images from the expected folder layout.

        data_root/
            real/           → label 0
            print_attack/   → label 1
            replay_attack/  → label 2
    """

    def __init__(self, data_root: str, transform=None):
        self.data_root = Path(data_root)
        self.transform = transform

        self._samples: List[Tuple[Path, int]] = []
        valid_extensions = {".jpg", ".jpeg", ".png", ".bmp"}

        for class_name, class_id in SPOOF_CLASS_MAP.items():
            folder = self.data_root / class_name
            if not folder.exists():
                logger.warning(
                    f"Folder '{folder}' not found. "
                    f"Class '{class_name}' will have 0 samples."
                )
                continue
            for f in folder.iterdir():
                if f.suffix.lower() in valid_extensions:
                    self._samples.append((f, class_id))

        counts = Counter(label for _, label in self._samples)
        logger.info(
            f"AntiSpoofDataset: {len(self._samples)} images | "
            + " | ".join(f"{IDX_TO_CLASS[k]}={v}" for k, v in sorted(counts.items()))
        )

    def __len__(self) -> int:
        return len(self._samples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        img_path, label = self._samples[idx]
        bgr = cv2.imread(str(img_path))
        if bgr is None:
            bgr = np.zeros((*ANTISPOOF_INPUT_SIZE[::-1], 3), dtype=np.uint8)

        rgb = bgr_to_rgb(bgr)
        if self.transform:
            tensor = self.transform(image=rgb)["image"]
        else:
            from albumentations import Compose, Normalize, Resize
            from albumentations.pytorch import ToTensorV2
            _basic = Compose([
                Resize(*ANTISPOOF_INPUT_SIZE),
                Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
                ToTensorV2(),
            ])
            tensor = _basic(image=rgb)["image"]

        return tensor, label

    def class_weights(self) -> List[float]:
        """Per-sample weights for WeightedRandomSampler (class balancing)."""
        counts = Counter(label for _, label in self._samples)
        total = len(self._samples)
        weight_per_class = {
            cls: total / (len(counts) * cnt) for cls, cnt in counts.items()
        }
        return [weight_per_class[label] for _, label in self._samples]


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def build_train_loader(dataset: AntiSpoofDataset, batch_size: int, num_workers: int) -> DataLoader:
    """DataLoader with class-balanced WeightedRandomSampler."""
    weights = dataset.class_weights()
    sampler = WeightedRandomSampler(
        weights, num_samples=len(weights), replacement=True
    )
    return DataLoader(
        dataset,
        batch_size=batch_size,
        sampler=sampler,
        num_workers=num_workers,
        pin_memory=True,
        drop_last=True,
    )


def split_dataset(
    dataset: AntiSpoofDataset, val_fraction: float = 0.15
) -> Tuple[AntiSpoofDataset, AntiSpoofDataset]:
    """
    Stratified split: return (train_dataset, val_dataset).
    Both share the same underlying list but with different transforms.
    """
    from collections import defaultdict
    import random

    by_class: Dict[int, List[int]] = defaultdict(list)
    for i, (_, label) in enumerate(dataset._samples):
        by_class[label].append(i)

    train_indices, val_indices = [], []
    for label, indices in by_class.items():
        random.shuffle(indices)
        n_val = max(1, int(len(indices) * val_fraction))
        val_indices.extend(indices[:n_val])
        train_indices.extend(indices[n_val:])

    # Build lightweight wrappers
    class _Subset(Dataset):
        def __init__(self, parent: AntiSpoofDataset, indices: List[int], transform):
            self._parent = parent
            self._indices = indices
            self._transform = transform

        def __len__(self):
            return len(self._indices)

        def __getitem__(self, idx):
            real_idx = self._indices[idx]
            img_path, label = self._parent._samples[real_idx]
            bgr = cv2.imread(str(img_path))
            if bgr is None:
                bgr = np.zeros((*ANTISPOOF_INPUT_SIZE[::-1], 3), dtype=np.uint8)
            rgb = bgr_to_rgb(bgr)
            tensor = self._transform(image=rgb)["image"]
            return tensor, label

        def class_weights(self):
            counts = Counter(
                self._parent._samples[i][1] for i in self._indices
            )
            total = len(self._indices)
            wpc = {cls: total / (len(counts) * cnt) for cls, cnt in counts.items()}
            return [wpc[self._parent._samples[i][1]] for i in self._indices]

    train_tf = build_antispoof_train_transforms()
    val_tf   = build_antispoof_val_transforms()

    return _Subset(dataset, train_indices, train_tf), \
           _Subset(dataset, val_indices,   val_tf)


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: optim.Optimizer,
    criterion: nn.CrossEntropyLoss,
    scaler: GradScaler,
    device: str,
    epoch: int,
) -> Dict[str, float]:
    model.train()
    total_loss, correct, total = 0.0, 0, 0

    for imgs, labels in tqdm(loader, desc=f"Train epoch {epoch}", leave=False):
        imgs   = imgs.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)
        with autocast(enabled=(device == "cuda")):
            logits = model(imgs)
            loss   = criterion(logits, labels)

        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()

        total_loss += loss.item() * imgs.size(0)
        correct    += (logits.argmax(1) == labels).sum().item()
        total      += imgs.size(0)

    return {"loss": total_loss / total, "acc": correct / total * 100}


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.CrossEntropyLoss,
    device: str,
) -> Dict[str, float]:
    model.eval()
    total_loss, correct, total = 0.0, 0, 0

    for imgs, labels in tqdm(loader, desc="Val", leave=False):
        imgs   = imgs.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        logits = model(imgs)
        loss   = criterion(logits, labels)
        total_loss += loss.item() * imgs.size(0)
        correct    += (logits.argmax(1) == labels).sum().item()
        total      += imgs.size(0)

    return {"loss": total_loss / total, "acc": correct / total * 100}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train MiniFASNet anti-spoofing model"
    )
    parser.add_argument("--data_dir",    default="datasets/spoof",    help="Dataset root")
    parser.add_argument("--output_dir",  default="models/antispoof",  help="Save location")
    parser.add_argument("--model",       default="v2", choices=["v2", "v1se"],
                        help="MiniFASNetV2 or MiniFASNetV1SE")
    parser.add_argument("--epochs",      default=60,   type=int)
    parser.add_argument("--batch_size",  default=64,   type=int)
    parser.add_argument("--lr",          default=1e-3, type=float)
    parser.add_argument("--weight_decay",default=1e-4, type=float)
    parser.add_argument("--val_split",   default=0.15, type=float)
    parser.add_argument("--num_workers", default=4,    type=int)
    parser.add_argument("--device",      default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--resume",      default=None, help="Checkpoint path to resume")
    parser.add_argument("--log_dir",     default="runs/antispoof", help="CSV log directory")
    return parser.parse_args()


def main():
    args = parse_args()
    logger.info(f"Anti-spoof training args: {vars(args)}")

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
    full_dataset = AntiSpoofDataset(args.data_dir)
    train_ds, val_ds = split_dataset(full_dataset, args.val_split)

    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        sampler=WeightedRandomSampler(
            train_ds.class_weights(), len(train_ds), replacement=True
        ),
        num_workers=args.num_workers,
        pin_memory=True,
        drop_last=True,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=True,
    )

    # ── Model ─────────────────────────────────────────────────────────────
    if args.model == "v1se":
        model = MiniFASNetV1SE(num_classes=3).to(args.device)
    else:
        model = MiniFASNetV2(num_classes=3).to(args.device)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-6)
    scaler    = GradScaler(enabled=(args.device == "cuda"))

    start_epoch = 0
    best_val_acc = 0.0

    output_name = f"antispoof_model_{args.model}.pth"

    if args.resume:
        ckpt = torch.load(args.resume, map_location=args.device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        scaler.load_state_dict(ckpt["scaler"])
        start_epoch  = ckpt["epoch"] + 1
        best_val_acc = ckpt.get("best_val_acc", 0.0)
        logger.info(f"Resumed from {args.resume} at epoch {start_epoch}.")

    # ── Training loop ─────────────────────────────────────────────────────
    for epoch in range(start_epoch, args.epochs):
        t0 = time.time()

        train_m = train_one_epoch(model, train_loader, optimizer, criterion, scaler, args.device, epoch)
        val_m   = evaluate(model, val_loader, criterion, args.device)
        scheduler.step()

        lr_now  = optimizer.param_groups[0]["lr"]
        elapsed = time.time() - t0
        logger.info(
            f"Epoch {epoch:03d}/{args.epochs-1} | "
            f"Train loss={train_m['loss']:.4f} acc={train_m['acc']:.2f}% | "
            f"Val loss={val_m['loss']:.4f} acc={val_m['acc']:.2f}% | "
            f"LR={lr_now:.2e} | {elapsed:.1f}s"
        )

        _csv_writer.writerow({
            "epoch": epoch,
            "train_loss": f"{train_m['loss']:.6f}",
            "train_acc":  f"{train_m['acc']:.4f}",
            "val_loss":   f"{val_m['loss']:.6f}",
            "val_acc":    f"{val_m['acc']:.4f}",
            "lr":         f"{lr_now:.2e}",
        })

        ckpt = {
            "epoch": epoch,
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "scaler": scaler.state_dict(),
            "best_val_acc": best_val_acc,
        }
        torch.save(ckpt, out_dir / "last_checkpoint.pth")

        if val_m["acc"] > best_val_acc:
            best_val_acc = val_m["acc"]
            ckpt["best_val_acc"] = best_val_acc
            torch.save(ckpt, out_dir / output_name)
            logger.info(f"  → New best val acc: {best_val_acc:.2f}%  (saved to {output_name})")

    _csv_file.close()
    logger.info(f"Training complete. Best val accuracy: {best_val_acc:.2f}%")
    logger.info(f"Model saved to: {out_dir / output_name}")
    logger.info(f"Metrics log:    {csv_path}")


if __name__ == "__main__":
    main()
