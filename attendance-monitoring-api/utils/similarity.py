"""
similarity.py
-------------
Embedding comparison and similarity utilities for the ArcFace recognition
pipeline.

Includes:
  - L2 normalisation
  - Cosine similarity (single pair and batch)
  - Nearest-neighbour search helpers (both numpy brute-force and FAISS)
  - Threshold-based recognition decision
"""

from __future__ import annotations

import numpy as np
from typing import List, Optional, Tuple

# Try to import FAISS; fall back gracefully to numpy brute-force
try:
    import faiss  # type: ignore
    _FAISS_AVAILABLE = True
except ImportError:
    _FAISS_AVAILABLE = False


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def l2_normalize(embedding: np.ndarray) -> np.ndarray:
    """
    L2-normalise a 1-D or 2-D embedding array.

    Args:
        embedding: shape (D,) or (N, D)

    Returns:
        Unit-norm array of the same shape.
    """
    if embedding.ndim == 1:
        norm = np.linalg.norm(embedding)
        return embedding / (norm + 1e-10)
    norms = np.linalg.norm(embedding, axis=1, keepdims=True)
    return embedding / (norms + 1e-10)


# ---------------------------------------------------------------------------
# Single-pair similarities
# ---------------------------------------------------------------------------

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """
    Cosine similarity between two L2-normalised embeddings.

    Args:
        a, b: 1-D float arrays of the same dimension.

    Returns:
        Similarity in [−1, 1]; higher is more similar.
    """
    a_norm = l2_normalize(a.flatten())
    b_norm = l2_normalize(b.flatten())
    return float(np.dot(a_norm, b_norm))


def euclidean_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Euclidean distance between two embeddings."""
    return float(np.linalg.norm(a.flatten() - b.flatten()))


# ---------------------------------------------------------------------------
# Batch similarity search (numpy)
# ---------------------------------------------------------------------------

def batch_cosine_similarity(
    query: np.ndarray,
    gallery: np.ndarray,
) -> np.ndarray:
    """
    Compute cosine similarity between one query embedding and a gallery of
    embeddings.

    Args:
        query:   shape (D,)
        gallery: shape (N, D)

    Returns:
        similarities: shape (N,), dtype float32
    """
    q_norm = l2_normalize(query.flatten()).reshape(1, -1).astype(np.float32)
    g_norm = l2_normalize(gallery.astype(np.float32))
    return (g_norm @ q_norm.T).flatten()


def find_best_match(
    query: np.ndarray,
    gallery_embeddings: np.ndarray,
    gallery_labels: List[str],
    threshold: float = 0.6,
) -> Tuple[Optional[str], float]:
    """
    Find the closest identity in *gallery_embeddings* for *query*.

    Args:
        query:               shape (D,)  — the probe embedding
        gallery_embeddings:  shape (N, D) — stored embeddings
        gallery_labels:      list of N identity labels (e.g. user_id strings)
        threshold:           minimum cosine similarity to accept a match

    Returns:
        (label, confidence) if similarity > threshold, else (None, confidence)
    """
    if gallery_embeddings.shape[0] == 0:
        return None, 0.0

    sims = batch_cosine_similarity(query, gallery_embeddings)
    best_idx = int(np.argmax(sims))
    best_sim = float(sims[best_idx])

    if best_sim >= threshold:
        return gallery_labels[best_idx], best_sim
    return None, best_sim


# ---------------------------------------------------------------------------
# FAISS-accelerated search (optional)
# ---------------------------------------------------------------------------

class FaissIndex:
    """
    Thin wrapper around a flat L2 FAISS index for fast nearest-neighbour
    search over face embeddings.

    Falls back to numpy brute-force if FAISS is unavailable.
    """

    def __init__(self, embedding_dim: int = 512):
        self.dim = embedding_dim
        self._labels: List[str] = []
        self._embeddings: List[np.ndarray] = []

        if _FAISS_AVAILABLE:
            # Inner-product index on L2-normalised vectors == cosine similarity
            self._index = faiss.IndexFlatIP(embedding_dim)
        else:
            self._index = None

    def add(self, label: str, embedding: np.ndarray) -> None:
        """Add a normalised embedding and its label to the index."""
        vec = l2_normalize(embedding.flatten()).astype(np.float32)
        self._labels.append(label)
        self._embeddings.append(vec)
        if self._index is not None:
            self._index.add(vec.reshape(1, -1))

    def search(
        self,
        query: np.ndarray,
        threshold: float = 0.6,
        top_k: int = 1,
    ) -> List[Tuple[Optional[str], float]]:
        """
        Search for the *top_k* nearest identities.

        Returns:
            List of (label, similarity) tuples, sorted descending by similarity.
            Labels are None if similarity < threshold.
        """
        if not self._labels:
            return [(None, 0.0)]

        q_vec = l2_normalize(query.flatten()).astype(np.float32).reshape(1, -1)

        if self._index is not None:
            k = min(top_k, len(self._labels))
            distances, indices = self._index.search(q_vec, k)
            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx == -1:
                    continue
                sim = float(dist)
                label = self._labels[idx] if sim >= threshold else None
                results.append((label, sim))
            return results if results else [(None, 0.0)]

        # Numpy fallback
        gallery = np.stack(self._embeddings).astype(np.float32)
        sims = batch_cosine_similarity(query, gallery)
        top_indices = np.argsort(sims)[::-1][:top_k]
        results = []
        for idx in top_indices:
            sim = float(sims[idx])
            label = self._labels[idx] if sim >= threshold else None
            results.append((label, sim))
        return results

    def rebuild(self) -> None:
        """Rebuild FAISS index from stored embeddings (e.g., after deletions)."""
        if self._index is None:
            return
        self._index.reset()
        if self._embeddings:
            matrix = np.stack(self._embeddings).astype(np.float32)
            self._index.add(matrix)

    def remove(self, label: str) -> int:
        """Remove all entries for *label*. Returns count removed."""
        indices_to_remove = [i for i, lb in enumerate(self._labels) if lb == label]
        if not indices_to_remove:
            return 0
        for idx in sorted(indices_to_remove, reverse=True):
            del self._labels[idx]
            del self._embeddings[idx]
        self.rebuild()
        return len(indices_to_remove)

    def __len__(self) -> int:
        return len(self._labels)

    def __repr__(self) -> str:
        backend = "FAISS" if self._index is not None else "numpy"
        return f"FaissIndex(dim={self.dim}, n={len(self)}, backend={backend})"


# ---------------------------------------------------------------------------
# Embedding averaging (for registration)
# ---------------------------------------------------------------------------

def average_embeddings(embeddings: List[np.ndarray]) -> np.ndarray:
    """
    Compute the mean of a list of embeddings and L2-normalise the result.

    Used when a user registers multiple face images: their final stored
    embedding is the normalised mean of all per-image embeddings.

    Args:
        embeddings: list of (D,) float32 arrays

    Returns:
        (D,) L2-normalised float32 array
    """
    if not embeddings:
        raise ValueError("Cannot average an empty list of embeddings.")
    stacked = np.stack([e.flatten().astype(np.float32) for e in embeddings])
    mean_vec = stacked.mean(axis=0)
    return l2_normalize(mean_vec)
