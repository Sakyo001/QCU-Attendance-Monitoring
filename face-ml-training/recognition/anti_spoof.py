"""
anti_spoof.py
-------------
MiniFASNet (Silent Face Anti-Spoofing) inference wrapper.

Source model:
    https://github.com/minivision-ai/Silent-Face-Anti-Spoofing

Two weights are used:
  - 2.7_80x80_MiniFASNetV2.pth   (input 80 × 80)
  - 4_0_0_80x80_MiniFASNetV1SE.pth  (input 80 × 80, SE attention)

Both networks output a 3-class softmax:
    class 0 → real face
    class 1 → print attack (paper/photo)
    class 2 → replay attack (phone/monitor screen)

The wrapper loads both models, runs inference, and combines their outputs
by averaging the softmax probabilities (ensemble).

If the pretrained weights are not found, the module emits a clear error.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import List, Optional, Tuple, Union

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from loguru import logger

from utils.preprocessing import to_antispoof_tensor, ANTISPOOF_INPUT_SIZE


# ---------------------------------------------------------------------------
# MiniFASNet building blocks
# ---------------------------------------------------------------------------

class Conv_block(nn.Module):
    def __init__(self, in_c: int, out_c: int, kernel=1, stride=1, padding=0):
        super().__init__()
        self.conv = nn.Conv2d(in_c, out_c, kernel, stride, padding, bias=False)
        self.bn = nn.BatchNorm2d(out_c)
        self.prelu = nn.PReLU(out_c)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.prelu(self.bn(self.conv(x)))


class Linear_block(nn.Module):
    def __init__(self, in_c: int, out_c: int, kernel=1, stride=1, padding=0, groups=1):
        super().__init__()
        self.conv = nn.Conv2d(in_c, out_c, kernel, stride, padding, groups=groups, bias=False)
        self.bn = nn.BatchNorm2d(out_c)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.bn(self.conv(x))


class Depth_Wise(nn.Module):
    def __init__(
        self,
        in_c: int,
        out_c: int,
        residual: bool = False,
        kernel: int = 3,
        stride: int = 2,
        padding: int = 1,
    ):
        super().__init__()
        self.residual = residual
        self.conv = Conv_block(in_c, in_c, kernel=1)
        self.conv_dw = Conv_block(in_c, in_c, kernel=kernel, stride=stride, padding=padding,)
        self.project = Linear_block(in_c, out_c, kernel=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.residual:
            short_cut = x
        x = self.conv(x)
        x = self.conv_dw(x)
        x = self.project(x)
        if self.residual:
            x = x + short_cut
        return x


class Residual(nn.Module):
    def __init__(self, c: int, num_block: int, groups: int, kernel: int = 3, stride: int = 1, padding: int = 1):
        super().__init__()
        self.model = nn.Sequential(
            *[Depth_Wise(c, c, residual=True, kernel=kernel, stride=stride, padding=padding)
              for _ in range(num_block)]
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)


class SEModule(nn.Module):
    def __init__(self, channels: int, reduction: int = 16):
        super().__init__()
        self.avg_pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Sequential(
            nn.Linear(channels, channels // reduction, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(channels // reduction, channels, bias=False),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.size()
        y = self.avg_pool(x).view(b, c)
        y = self.fc(y).view(b, c, 1, 1)
        return x * y.expand_as(x)


# ---------------------------------------------------------------------------
# MiniFASNetV2
# ---------------------------------------------------------------------------

class MiniFASNetV2(nn.Module):
    """
    MiniFASNetV2 — lightweight anti-spoofing network.
    Input: (B, 3, 80, 80)
    Output: (B, num_classes)  where num_classes == 3 by default
    """

    def __init__(self, embedding_size: int = 128, conv6_kernel: int = 5, num_classes: int = 3, img_channel: int = 3):
        super().__init__()
        self.conv1 = Conv_block(img_channel, 64, kernel=3, stride=2, padding=1)
        self.conv2_dw = Conv_block(64, 64, kernel=3, stride=1, padding=1)
        self.conv_23 = Depth_Wise(64, 64, kernel=3, stride=2, padding=1)
        self.conv_3 = Residual(64, num_block=4, groups=128, kernel=3, stride=1, padding=1)
        self.conv_34 = Depth_Wise(64, 128, kernel=3, stride=2, padding=1)
        self.conv_4 = Residual(128, num_block=6, groups=256, kernel=3, stride=1, padding=1)
        self.conv_45 = Depth_Wise(128, 128, kernel=3, stride=2, padding=1)
        self.conv_5 = Residual(128, num_block=2, groups=256, kernel=3, stride=1, padding=1)
        self.conv_6_sep = Conv_block(128, 512, kernel=1)
        # conv6_kernel depends on the feature map size after 4 stride-2 ops on 80×80
        # 80→40→20→10→5; so conv6_kernel=5 reduces to 1×1
        self.conv_6_dw = Linear_block(512, 512, groups=512, kernel=conv6_kernel, stride=1, padding=0)
        self.conv_6_flatten = nn.Flatten()
        self.linear = nn.Linear(512, embedding_size)
        self.bn = nn.BatchNorm1d(embedding_size)
        self.drop = nn.Dropout()
        self.prob = nn.Linear(embedding_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv1(x)
        out = self.conv2_dw(out)
        out = self.conv_23(out)
        out = self.conv_3(out)
        out = self.conv_34(out)
        out = self.conv_4(out)
        out = self.conv_45(out)
        out = self.conv_5(out)
        out = self.conv_6_sep(out)
        out = self.conv_6_dw(out)
        out = self.conv_6_flatten(out)
        out = self.linear(out)
        out = self.bn(out)
        out = self.drop(out)
        out = self.prob(out)
        return out


# ---------------------------------------------------------------------------
# MiniFASNetV1SE (with Squeeze-Excitation)
# ---------------------------------------------------------------------------

class MiniFASNetV1SE(nn.Module):
    """MiniFASNetV1SE with Squeeze-and-Excitation blocks."""

    def __init__(self, embedding_size: int = 128, conv6_kernel: int = 5, num_classes: int = 3, img_channel: int = 3):
        super().__init__()
        self.conv1 = Conv_block(img_channel, 64, kernel=3, stride=2, padding=1)
        self.conv2_dw = Conv_block(64, 64, kernel=3, stride=1, padding=1)
        self.conv_23 = Depth_Wise(64, 64, kernel=3, stride=2, padding=1)
        self.conv_3 = Residual(64, num_block=4, groups=128, kernel=3, stride=1, padding=1)
        self.se_3 = SEModule(64)
        self.conv_34 = Depth_Wise(64, 128, kernel=3, stride=2, padding=1)
        self.conv_4 = Residual(128, num_block=6, groups=256, kernel=3, stride=1, padding=1)
        self.se_4 = SEModule(128)
        self.conv_45 = Depth_Wise(128, 128, kernel=3, stride=2, padding=1)
        self.conv_5 = Residual(128, num_block=2, groups=256, kernel=3, stride=1, padding=1)
        self.se_5 = SEModule(128)
        self.conv_6_sep = Conv_block(128, 512, kernel=1)
        self.conv_6_dw = Linear_block(512, 512, groups=512, kernel=conv6_kernel, stride=1, padding=0)
        self.conv_6_flatten = nn.Flatten()
        self.linear = nn.Linear(512, embedding_size)
        self.bn = nn.BatchNorm1d(embedding_size)
        self.drop = nn.Dropout()
        self.prob = nn.Linear(embedding_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv1(x)
        out = self.conv2_dw(out)
        out = self.conv_23(out)
        out = self.conv_3(out)
        out = self.se_3(out)
        out = self.conv_34(out)
        out = self.conv_4(out)
        out = self.se_4(out)
        out = self.conv_45(out)
        out = self.conv_5(out)
        out = self.se_5(out)
        out = self.conv_6_sep(out)
        out = self.conv_6_dw(out)
        out = self.conv_6_flatten(out)
        out = self.linear(out)
        out = self.bn(out)
        out = self.drop(out)
        out = self.prob(out)
        return out


# ---------------------------------------------------------------------------
# Label mapping
# ---------------------------------------------------------------------------

SPOOF_LABELS = {
    0: "real",
    1: "print_attack",
    2: "replay_attack",
}


# ---------------------------------------------------------------------------
# Anti-spoofing inference engine
# ---------------------------------------------------------------------------

class AntiSpoofDetector:
    """
    Ensemble anti-spoofing detector using MiniFASNetV2 + MiniFASNetV1SE.

    Usage::

        detector = AntiSpoofDetector(
            model_dir="models/antispoof",
            device="cuda",
        )
        result = detector.predict(aligned_face_crop_bgr)
        if result.is_spoof:
            print("SPOOF detected:", result.label)
        else:
            print("Real face, confidence:", result.real_confidence)

    Download pretrained weights from:
        https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/master/resources/anti_spoof_models
    """

    _MODEL_FILES = {
        "v2":  "antispoof_model_v2.pth",
        "v1se": "antispoof_model_v1se.pth",
    }

    def __init__(
        self,
        model_dir: Union[str, Path] = "models/antispoof",
        device: str = "cuda",
        real_threshold: float = 0.7,
        num_classes: int = 3,
    ):
        """
        Args:
            model_dir:        Directory containing the pretrained .pth files.
            device:           "cuda" or "cpu"
            real_threshold:   P(real) must exceed this to be accepted as live.
            num_classes:      3 (real + print + replay) — match training config.
        """
        self.device = device
        self.real_threshold = real_threshold
        self.num_classes = num_classes
        self._models: List[nn.Module] = []

        model_dir = Path(model_dir)
        self._load_models(model_dir, num_classes)

    # ------------------------------------------------------------------
    def _load_models(self, model_dir: Path, num_classes: int):
        constructors = {
            "v2":   lambda: MiniFASNetV2(num_classes=num_classes),
            "v1se": lambda: MiniFASNetV1SE(num_classes=num_classes),
        }
        for key, filename in self._MODEL_FILES.items():
            path = model_dir / filename
            net = constructors[key]()
            if path.exists():
                state = torch.load(path, map_location=self.device)
                # Handle checkpoint dicts saved by train_antispoof.py
                if isinstance(state, dict) and "model" in state:
                    state = state["model"]
                elif isinstance(state, dict) and "state_dict" in state:
                    state = state["state_dict"]
                net.load_state_dict(state, strict=False)
                logger.info(f"AntiSpoof model '{key}' loaded from {path}.")
            else:
                logger.warning(
                    f"AntiSpoof model '{key}' not found at {path}. "
                    "Download from: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
                )
            net.eval()
            self._models.append(net.to(self.device))

    # ------------------------------------------------------------------
    class Result:
        """Holds the prediction for one face."""
        __slots__ = ("is_spoof", "label", "real_confidence", "class_probs")

        def __init__(
            self,
            is_spoof: bool,
            label: str,
            real_confidence: float,
            class_probs: np.ndarray,
        ):
            self.is_spoof = is_spoof
            self.label = label
            self.real_confidence = real_confidence
            self.class_probs = class_probs  # shape (3,)

        def __repr__(self):
            return (
                f"AntiSpoofResult(is_spoof={self.is_spoof}, label={self.label!r}, "
                f"real={self.real_confidence:.3f})"
            )

    # ------------------------------------------------------------------
    def predict(self, face_crop_bgr: np.ndarray) -> "AntiSpoofDetector.Result":
        """
        Run anti-spoofing classification on a single face crop.

        Args:
            face_crop_bgr: BGR uint8 array (any size — will be resized to 80×80).

        Returns:
            :class:`AntiSpoofDetector.Result`
        """
        if not self._models:
            logger.error("No anti-spoof models loaded — defaulting to 'real'.")
            dummy = np.array([1.0, 0.0, 0.0], dtype=np.float32)
            return self.Result(False, "real", 1.0, dummy)

        # Resize to anti-spoof input
        resized = cv2.resize(face_crop_bgr, ANTISPOOF_INPUT_SIZE)
        tensor = to_antispoof_tensor(resized, self.device)

        probs_list: List[np.ndarray] = []
        with torch.no_grad():
            for model in self._models:
                logits = model(tensor)              # (1, num_classes)
                prob = F.softmax(logits, dim=1).squeeze().cpu().numpy()
                probs_list.append(prob)

        # Ensemble: arithmetic mean of probability vectors
        avg_probs = np.mean(probs_list, axis=0).astype(np.float32)

        pred_class = int(np.argmax(avg_probs))
        label = SPOOF_LABELS.get(pred_class, "unknown")
        real_confidence = float(avg_probs[0])
        is_spoof = real_confidence < self.real_threshold

        return self.Result(
            is_spoof=is_spoof,
            label=label,
            real_confidence=real_confidence,
            class_probs=avg_probs,
        )
