"""
face_embedding.py
-----------------
ArcFace embedding model wrapper.

Supports two backends:
  1. **insightface ONNX** (recommended for production) — loads a pretrained
     ArcFace-ResNet100 ONNX model from the insightface model zoo.  Fast,
     does not require PyTorch.
  2. **PyTorch** — loads a custom-trained or fine-tuned ArcFace model
     (ResNet50 / ResNet100 backbone).  Used after ``training/train_arcface.py``.

Both backends expose the same ``get_embedding(aligned_crop)`` interface
and return a 512-D L2-normalised float32 numpy array.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional, Union

import cv2
import numpy as np
import torch
import torch.nn as nn
from loguru import logger

from utils.preprocessing import to_arcface_tensor, bgr_to_rgb
from utils.similarity import l2_normalize

# ---------------------------------------------------------------------------
# Optional insightface import
# ---------------------------------------------------------------------------
try:
    from insightface.model_zoo import get_model as ins_get_model
    _INSIGHTFACE_AVAILABLE = True
except ImportError:
    _INSIGHTFACE_AVAILABLE = False

# ---------------------------------------------------------------------------
# ArcFace backbone (PyTorch) — IResNet
# ---------------------------------------------------------------------------

class IResNetBlock(nn.Module):
    """Pre-activation residual block used in IResNet (ArcFace backbone)."""

    expansion = 1

    def __init__(self, in_channels: int, out_channels: int, stride: int = 1):
        super().__init__()
        self.bn1 = nn.BatchNorm2d(in_channels)
        self.conv1 = nn.Conv2d(
            in_channels, out_channels, kernel_size=3,
            stride=1, padding=1, bias=False,
        )
        self.bn2 = nn.BatchNorm2d(out_channels)
        self.prelu = nn.PReLU(out_channels)
        self.conv2 = nn.Conv2d(
            out_channels, out_channels, kernel_size=3,
            stride=stride, padding=1, bias=False,
        )
        self.bn3 = nn.BatchNorm2d(out_channels)

        self.downsample: Optional[nn.Sequential] = None
        if stride != 1 or in_channels != out_channels:
            self.downsample = nn.Sequential(
                nn.Conv2d(
                    in_channels, out_channels,
                    kernel_size=1, stride=stride, bias=False,
                ),
                nn.BatchNorm2d(out_channels),
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = x
        out = self.bn1(x)
        out = self.conv1(out)
        out = self.bn2(out)
        out = self.prelu(out)
        out = self.conv2(out)
        out = self.bn3(out)
        if self.downsample is not None:
            identity = self.downsample(x)
        return out + identity


class IResNet(nn.Module):
    """
    IResNet backbone as used in InsightFace ArcFace models.

    Produces 512-D embeddings from 112×112 aligned face crops.

    Args:
        layers: list of block counts per stage, e.g.
                [3, 4, 14, 3] => IResNet50
                [3, 13, 30, 3] => IResNet100
    """

    def __init__(self, layers: List[int], dropout_p: float = 0.4):
        super().__init__()
        self.in_channels = 64

        self.conv1 = nn.Conv2d(3, 64, kernel_size=3, stride=1, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.prelu = nn.PReLU(64)

        self.layer1 = self._make_layer(64,  layers[0], stride=2)
        self.layer2 = self._make_layer(128, layers[1], stride=2)
        self.layer3 = self._make_layer(256, layers[2], stride=2)
        self.layer4 = self._make_layer(512, layers[3], stride=2)

        self.bn2 = nn.BatchNorm2d(512)
        self.dropout = nn.Dropout(p=dropout_p)
        # After 4 stride-2 layers on 112×112 input: feature map is 7×7
        self.fc = nn.Linear(512 * 7 * 7, 512)
        self.features = nn.BatchNorm1d(512)

        self._init_weights()

    def _make_layer(self, out_channels: int, num_blocks: int, stride: int) -> nn.Sequential:
        layers = [IResNetBlock(self.in_channels, out_channels, stride=stride)]
        self.in_channels = out_channels
        for _ in range(1, num_blocks):
            layers.append(IResNetBlock(out_channels, out_channels, stride=1))
        return nn.Sequential(*layers)

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                nn.init.constant_(m.bias, 0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.conv1(x)
        x = self.bn1(x)
        x = self.prelu(x)
        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)
        x = self.bn2(x)
        x = self.dropout(x)
        x = x.flatten(1)
        x = self.fc(x)
        x = self.features(x)
        return x


def iresnet50(dropout_p: float = 0.4) -> IResNet:
    return IResNet([3, 4, 14, 3], dropout_p=dropout_p)


def iresnet100(dropout_p: float = 0.4) -> IResNet:
    return IResNet([3, 13, 30, 3], dropout_p=dropout_p)


# ---------------------------------------------------------------------------
# ArcFace loss head (used during training)
# ---------------------------------------------------------------------------

class ArcFaceHead(nn.Module):
    """
    ArcFace margin-based classification head.

    Reference:
        Deng et al., "ArcFace: Additive Angular Margin Loss for Deep Face
        Recognition", CVPR 2019.
    """

    def __init__(
        self,
        embedding_dim: int = 512,
        num_classes: int = 1000,
        scale: float = 64.0,
        margin: float = 0.5,
    ):
        super().__init__()
        import math
        self.scale = scale
        self.margin = margin
        self.cos_m = math.cos(margin)
        self.sin_m = math.sin(margin)
        self.th = math.cos(math.pi - margin)
        self.mm = math.sin(math.pi - margin) * margin

        self.weight = nn.Parameter(torch.FloatTensor(num_classes, embedding_dim))
        nn.init.xavier_uniform_(self.weight)

    def forward(
        self,
        embeddings: torch.Tensor,   # (B, D) L2-normalised
        labels: torch.Tensor,       # (B,)  long
    ) -> torch.Tensor:
        import torch.nn.functional as F
        import math

        # Cosine similarity between each embedding and each class weight
        cosine = F.linear(
            F.normalize(embeddings),
            F.normalize(self.weight),
        )                                               # (B, C)

        sine = torch.sqrt(
            torch.clamp(1.0 - cosine ** 2, min=1e-8)
        )
        phi = cosine * self.cos_m - sine * self.sin_m   # cos(θ + m)
        phi = torch.where(cosine > self.th, phi, cosine - self.mm)

        one_hot = torch.zeros_like(cosine)
        one_hot.scatter_(1, labels.view(-1, 1).long(), 1)

        output = (one_hot * phi) + ((1.0 - one_hot) * cosine)
        output *= self.scale
        return output


# ---------------------------------------------------------------------------
# High-level embedding extractor
# ---------------------------------------------------------------------------

class ArcFaceEmbedder:
    """
    Extracts 512-D face embeddings from 112×112 aligned BGR crops.

    Three modes:
      - ``mode="facenet"``    — InceptionResNetV1 via facenet_pytorch (auto-downloads)
      - ``mode="insightface"`` — ONNX inference via insightface model zoo
      - ``mode="pytorch"``    — Custom-trained / fine-tuned PyTorch weights

    Args:
        model_path: Path to .pth (pytorch) or directory (insightface).
        mode:       "facenet", "insightface", or "pytorch"
        backbone:   "r50" or "r100" (pytorch mode only)
        device:     "cuda" or "cpu"
    """

    EMBEDDING_DIM = 512

    def __init__(
        self,
        model_path: Union[str, Path, None] = None,
        mode: str = "facenet",
        backbone: str = "r100",
        device: str = "cuda",
    ):
        self.mode = mode
        self.device = device
        self._model: Optional[nn.Module] = None
        self._onnx_model = None
        self._ins_app = None

        if mode == "facenet":
            self._load_facenet()
        elif mode == "insightface":
            self._load_insightface(model_path)
        elif mode == "pytorch":
            self._load_pytorch(model_path, backbone)
        else:
            raise ValueError(f"Unknown mode '{mode}'. Use 'facenet', 'insightface', or 'pytorch'.")

    # ------------------------------------------------------------------
    def _load_facenet(self):
        """Load InceptionResnetV1 pre-trained on VGGFace2 via facenet_pytorch."""
        try:
            from facenet_pytorch import InceptionResnetV1
        except ImportError:
            raise RuntimeError(
                "facenet_pytorch is required for mode='facenet'. "
                "Install with: pip install facenet-pytorch"
            )
        logger.info("Loading FaceNet (InceptionResnetV1/VGGFace2) embedder...")
        net = InceptionResnetV1(pretrained="vggface2")
        net.eval()
        self._model = net.to(self.device)
        logger.info("ArcFaceEmbedder loaded via facenet_pytorch (VGGFace2).")

    def _load_insightface(self, model_dir: Optional[Union[str, Path]]):
        if not _INSIGHTFACE_AVAILABLE:
            raise RuntimeError("insightface not installed.")
        # The recognition model inside the buffalo pack is w600k_r50.onnx
        # insightface auto-downloads it on first run
        import insightface
        from insightface.app import FaceAnalysis
        self._ins_app = FaceAnalysis(
            name="buffalo_l",
            allowed_modules=["recognition"],
        )
        ctx = 0 if self.device == "cuda" else -1
        self._ins_app.prepare(ctx_id=ctx, det_size=(112, 112))
        # Extract the recognition model directly
        self._onnx_model = self._ins_app.models.get("recognition")
        logger.info("ArcFaceEmbedder loaded via insightface (ONNX).")

    def _load_pytorch(
        self,
        model_path: Optional[Union[str, Path]],
        backbone: str,
    ):
        if backbone == "r100":
            net = iresnet100()
        else:
            net = iresnet50()

        if model_path and Path(model_path).exists():
            state = torch.load(model_path, map_location=self.device)
            # Support checkpoints saved with or without 'model_state_dict' key
            if "model_state_dict" in state:
                state = state["model_state_dict"]
            net.load_state_dict(state, strict=False)
            logger.info(f"ArcFaceEmbedder loaded PyTorch weights from {model_path}.")
        else:
            logger.warning(
                "No model_path provided or file not found. "
                "Using random-initialised weights (for training only)."
            )

        net.eval()
        self._model = net.to(self.device)

    # ------------------------------------------------------------------
    def get_embedding(self, aligned_crop_bgr: np.ndarray) -> np.ndarray:
        """
        Compute a 512-D L2-normalised embedding for a single aligned face.

        Args:
            aligned_crop_bgr: 112×112 BGR uint8 numpy array.

        Returns:
            shape (512,) float32 array.
        """
        if self.mode == "facenet":
            return self._embed_facenet(aligned_crop_bgr)
        if self.mode == "insightface":
            return self._embed_insightface(aligned_crop_bgr)
        return self._embed_pytorch(aligned_crop_bgr)

    def get_embeddings_batch(
        self, crops: List[np.ndarray]
    ) -> np.ndarray:
        """
        Embed a list of aligned crops in a single forward pass (PyTorch/facenet mode).
        Falls back to sequential for insightface mode.

        Returns:
            shape (N, 512) float32 array.
        """
        if self.mode == "facenet" and self._model is not None:
            tensors = torch.stack([self._facenet_preprocess(c) for c in crops]).to(self.device)
            with torch.no_grad():
                embs = self._model(tensors).cpu().numpy().astype(np.float32)
            return l2_normalize(embs)

        if self.mode == "pytorch" and self._model is not None:
            tensors = torch.cat(
                [to_arcface_tensor(c, self.device) for c in crops], dim=0
            )
            with torch.no_grad():
                embs = self._model(tensors).cpu().numpy().astype(np.float32)
            return l2_normalize(embs)

        # Sequential fallback
        return np.stack([self.get_embedding(c) for c in crops])

    # ------------------------------------------------------------------
    def _facenet_preprocess(self, crop_bgr: np.ndarray) -> "torch.Tensor":
        """Convert 112×112 BGR crop to 160×160 RGB tensor for FaceNet."""
        import torch
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (160, 160))
        tensor = torch.from_numpy(resized.transpose(2, 0, 1)).float()
        tensor = (tensor - 127.5) / 128.0  # normalize to [-1, 1]
        return tensor

    def _embed_facenet(self, crop_bgr: np.ndarray) -> np.ndarray:
        """Use InceptionResNetV1 (facenet_pytorch) for embedding."""
        tensor = self._facenet_preprocess(crop_bgr).unsqueeze(0).to(self.device)
        with torch.no_grad():
            emb = self._model(tensor)
        arr = emb.squeeze().cpu().numpy().astype(np.float32)
        return l2_normalize(arr)

    def _embed_insightface(self, crop: np.ndarray) -> np.ndarray:
        """Use the ONNX recognition model from insightface."""
        if self._onnx_model is None:
            raise RuntimeError("insightface recognition model not loaded.")
        # insightface recognition models expect a face object; we build a
        # minimal mock using numpy directly via the ONNX session
        import cv2
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (112, 112))
        blob = (resized.astype(np.float32) - 127.5) / 127.5
        blob = blob.transpose(2, 0, 1)[np.newaxis]
        embedding = self._onnx_model.get_feat(blob)
        return l2_normalize(embedding.flatten().astype(np.float32))

    def _embed_pytorch(self, crop: np.ndarray) -> np.ndarray:
        """Run a single crop through the PyTorch IResNet."""
        tensor = to_arcface_tensor(crop, self.device)
        with torch.no_grad():
            emb = self._model(tensor)
        arr = emb.squeeze().cpu().numpy().astype(np.float32)
        return l2_normalize(arr)
