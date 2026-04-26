"""
Per-stem AI-music artifact analysis (T3).

Detects two issues common in Suno/Udio-generated tracks:
  - Narrow stereo: guitars (and other instruments) collapsed to ~mono in
    the 200-4000 Hz band where real metal/rock recordings layer wide.
  - Spectral collapse: unnaturally stable spectral centroid over time
    (less natural variation than real performances).

Output dict shape matches `StemAnalysisReport` in
`src/types/deep-mastering.ts` and `backend/schemas/mastering_script.schema.json`.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Bands used for AI-Repair correlation analysis (Hz). Designed around the
# 200-4000 Hz region where AI guitars typically collapse.
AI_REPAIR_BANDS: tuple[tuple[float, float], ...] = (
    (60.0, 200.0),     # bass
    (200.0, 800.0),    # low-mid
    (800.0, 2000.0),   # mid
    (2000.0, 4000.0),  # high-mid (most diagnostic for guitar narrowness)
    (4000.0, 12000.0), # highs
)

# Stem classification → confidence baseline. T3 trusts Demucs's classification
# at 0.9 (Demucs separates by source — high prior confidence).
_DEMUCS_CONFIDENCE = 0.9


def _ensure_stereo(samples: np.ndarray) -> np.ndarray:
    """Promote mono (N,) → stereo (N, 2) by duplicating the channel."""
    if samples.ndim == 1:
        return np.stack([samples, samples], axis=1).astype(np.float32, copy=False)
    if samples.ndim == 2 and samples.shape[1] == 1:
        return np.concatenate([samples, samples], axis=1).astype(np.float32, copy=False)
    return samples.astype(np.float32, copy=False)


def _bandpass_fft(channel: np.ndarray, sr: int, low: float, high: float) -> np.ndarray:
    """FFT-domain bandpass — returns the band-limited time-domain signal."""
    n = channel.shape[0]
    spec = np.fft.rfft(channel)
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    mask = (freqs >= low) & (freqs <= high)
    spec_filt = np.zeros_like(spec)
    spec_filt[mask] = spec[mask]
    return np.fft.irfft(spec_filt, n=n).astype(np.float32, copy=False)


def _safe_corr(a: np.ndarray, b: np.ndarray) -> float:
    """Pearson correlation of two equal-length signals. Returns 0.0 when undefined."""
    if a.size == 0 or b.size == 0:
        return 0.0
    sa = float(np.std(a))
    sb = float(np.std(b))
    if sa < 1e-9 or sb < 1e-9:
        return 0.0
    val = float(np.mean((a - np.mean(a)) * (b - np.mean(b))) / (sa * sb))
    # Clamp tiny FP overshoot
    return max(-1.0, min(1.0, val))


def band_correlations(stereo: np.ndarray, sr: int) -> list[float]:
    """L/R Pearson correlation per band in AI_REPAIR_BANDS."""
    s = _ensure_stereo(stereo)
    left = s[:, 0]
    right = s[:, 1]
    out: list[float] = []
    for low, high in AI_REPAIR_BANDS:
        lb = _bandpass_fft(left, sr, low, high)
        rb = _bandpass_fft(right, sr, low, high)
        out.append(_safe_corr(lb, rb))
    return out


def narrowness_score(stereo: np.ndarray, sr: int) -> float:
    """
    Single 0–1 score where 1 = mono-collapsed in diagnostic bands, 0 = wide.
    Weighted average emphasising 800-4000 Hz (guitar artifact zone).
    """
    corrs = band_correlations(stereo, sr)
    # Weights: emphasise low-mid + mid + high-mid (indices 1, 2, 3)
    weights = np.array([0.05, 0.25, 0.35, 0.30, 0.05], dtype=np.float64)
    if len(corrs) != weights.size:
        weights = np.ones(len(corrs)) / len(corrs)
    weighted = float(np.sum(np.clip(np.asarray(corrs), 0.0, 1.0) * weights))
    return max(0.0, min(1.0, weighted))


def spectral_collapse_score(channel: np.ndarray, sr: int) -> float:
    """
    Score in [0, 1] where 1 = unnaturally constant centroid (AI artifact),
    0 = natural variation. Computed as 1 - normalized_std of centroid frames.
    """
    if channel.ndim > 1:
        channel = channel.mean(axis=1).astype(np.float32, copy=False)
    n = channel.shape[0]
    frame_size = 2048
    hop = 1024
    if n < frame_size:
        return 0.0
    n_frames = max(1, (n - frame_size) // hop + 1)
    centroids = np.empty(n_frames, dtype=np.float64)
    freqs = np.fft.rfftfreq(frame_size, 1.0 / sr)
    # Hann window suppresses FFT leakage so a stable signal yields a stable centroid.
    window = np.hanning(frame_size).astype(np.float32)
    for i in range(n_frames):
        start = i * hop
        frame = channel[start : start + frame_size] * window
        spec = np.abs(np.fft.rfft(frame))
        total = float(np.sum(spec))
        centroids[i] = float(np.sum(freqs * spec) / total) if total > 1e-12 else 0.0

    if n_frames < 2:
        return 0.0
    mean_c = float(np.mean(centroids))
    if mean_c < 1e-6:
        return 0.0
    # Normalised stddev of centroid trajectory.
    cv = float(np.std(centroids) / mean_c)
    # Map: cv ≈ 0 → score 1; cv ≥ 0.4 → score 0. Linear in between.
    score = 1.0 - min(1.0, cv / 0.4)
    return max(0.0, min(1.0, score))


def analyze_stem_artifacts(
    stem_id: str,
    samples: np.ndarray,
    sr: int,
) -> dict[str, Any]:
    """Full per-stem analysis. Returns a `StemAnalysisReport` dict."""
    stereo = _ensure_stereo(samples)
    left = stereo[:, 0]
    corrs = band_correlations(stereo, sr)
    narrow = narrowness_score(stereo, sr)
    collapse = spectral_collapse_score(left, sr)
    return {
        "stemId": stem_id,
        "classification": stem_id,  # backend uses Demucs source name as classification
        "confidence": _DEMUCS_CONFIDENCE,
        "narrownessScore": float(narrow),
        "spectralCollapseScore": float(collapse),
        "bandCorrelations": [float(c) for c in corrs],
    }
