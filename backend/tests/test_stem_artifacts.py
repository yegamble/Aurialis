"""Tests for backend stem_artifacts module (T3 — AI-music narrowness detection)."""

from __future__ import annotations

import numpy as np
import pytest

from stem_artifacts import (
    AI_REPAIR_BANDS,
    band_correlations,
    narrowness_score,
    spectral_collapse_score,
    analyze_stem_artifacts,
)


# ---------- helpers ----------


def _stereo_correlated(samples: np.ndarray, correlation: float) -> np.ndarray:
    """Build a 2-channel signal where R = correlation*L + sqrt(1-corr^2)*N."""
    n = samples.shape[0]
    rng = np.random.default_rng(123)
    noise = rng.standard_normal(n).astype(np.float32) * float(np.std(samples))
    other = correlation * samples + (1.0 - correlation**2) ** 0.5 * noise
    return np.stack([samples.astype(np.float32), other.astype(np.float32)], axis=1)


def _bandlimited_signal(sr: int, duration: float, low: float, high: float) -> np.ndarray:
    """Generate a noise burst band-limited to [low, high]."""
    n = int(sr * duration)
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(n).astype(np.float32)
    # FFT-domain bandpass
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    mask = (freqs >= low) & (freqs <= high)
    spec[~mask] = 0.0
    return np.fft.irfft(spec, n=n).astype(np.float32)


# ---------- band_correlations ----------


@pytest.mark.unit
def test_band_correlations_identical_channels_returns_one_per_band(sample_rate: int) -> None:
    sig = _bandlimited_signal(sample_rate, 1.0, 200, 4000)
    stereo = np.stack([sig, sig], axis=1)
    corrs = band_correlations(stereo, sample_rate)
    assert len(corrs) == len(AI_REPAIR_BANDS)
    for c in corrs:
        # Identical channels → correlation ≈ 1
        assert c == pytest.approx(1.0, abs=0.05)


@pytest.mark.unit
def test_band_correlations_independent_channels_low(sample_rate: int) -> None:
    rng = np.random.default_rng(99)
    n = sample_rate * 1
    left = rng.standard_normal(n).astype(np.float32)
    right = rng.standard_normal(n).astype(np.float32)
    stereo = np.stack([left, right], axis=1)
    corrs = band_correlations(stereo, sample_rate)
    for c in corrs:
        assert abs(c) < 0.3


@pytest.mark.unit
def test_band_correlations_handles_silent_band(sample_rate: int) -> None:
    """A band with no energy returns 0 correlation, not NaN."""
    sig = _bandlimited_signal(sample_rate, 1.0, 200, 800)
    stereo = np.stack([sig, sig], axis=1)
    corrs = band_correlations(stereo, sample_rate)
    # Any band should be a finite float
    for c in corrs:
        assert np.isfinite(c)


# ---------- narrowness_score ----------


@pytest.mark.unit
def test_narrowness_score_high_for_collapsed_stereo(sample_rate: int) -> None:
    """Mono signal = perfectly narrow → score ≈ 1."""
    sig = _bandlimited_signal(sample_rate, 1.0, 200, 4000)
    stereo = np.stack([sig, sig], axis=1)
    score = narrowness_score(stereo, sample_rate)
    assert score > 0.85


@pytest.mark.unit
def test_narrowness_score_low_for_decorrelated_stereo(sample_rate: int) -> None:
    """Independent left/right channels → score < 0.5."""
    rng = np.random.default_rng(42)
    n = sample_rate * 1
    left = _bandlimited_signal(sample_rate, 1.0, 200, 4000)
    right = rng.standard_normal(n).astype(np.float32) * float(np.std(left))
    stereo = np.stack([left, right], axis=1)
    score = narrowness_score(stereo, sample_rate)
    assert score < 0.5


# ---------- spectral_collapse_score ----------


@pytest.mark.unit
def test_collapse_score_high_for_constant_centroid(sample_rate: int) -> None:
    """Pure sine has near-zero centroid variance → high collapse score."""
    n = sample_rate * 2
    t = np.linspace(0, 2, n, endpoint=False, dtype=np.float32)
    sig = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    score = spectral_collapse_score(sig, sample_rate)
    assert score > 0.7


@pytest.mark.unit
def test_collapse_score_low_for_dynamic_signal(sample_rate: int) -> None:
    """A sweeping sine has wide centroid variance → low collapse score."""
    n = sample_rate * 2
    t = np.linspace(0, 2, n, endpoint=False, dtype=np.float32)
    # Linear chirp from 200 Hz to 4000 Hz
    inst_freq = 200 + (4000 - 200) * (t / 2)
    phase = 2 * np.pi * np.cumsum(inst_freq) / sample_rate
    sig = np.sin(phase).astype(np.float32)
    score = spectral_collapse_score(sig, sample_rate)
    assert score < 0.5


# ---------- analyze_stem_artifacts (full pipeline per stem) ----------


@pytest.mark.unit
def test_analyze_stem_artifacts_narrow_guitar_flagged(sample_rate: int) -> None:
    """Synthetic 'narrow guitar' (mono, 200-4kHz energy) gets high narrowness + report fields populated."""
    sig = _bandlimited_signal(sample_rate, 2.0, 200, 4000)
    stereo = np.stack([sig, sig], axis=1)
    report = analyze_stem_artifacts("guitar", stereo, sample_rate)
    assert report["stemId"] == "guitar"
    assert report["classification"] == "guitar"
    assert report["confidence"] == pytest.approx(0.9)
    assert report["narrownessScore"] > 0.85
    assert len(report["bandCorrelations"]) == len(AI_REPAIR_BANDS)
    # Schema bound: every band correlation in [-1, 1]
    for c in report["bandCorrelations"]:
        assert -1.0 <= c <= 1.0


@pytest.mark.unit
def test_analyze_stem_artifacts_wide_guitar_not_flagged(sample_rate: int) -> None:
    """A wide-guitar reference (decorrelated stereo) gets a low narrowness score."""
    rng = np.random.default_rng(2026)
    n = sample_rate * 2
    left = _bandlimited_signal(sample_rate, 2.0, 200, 4000)
    right = rng.standard_normal(n).astype(np.float32) * float(np.std(left))
    stereo = np.stack([left, right], axis=1)
    report = analyze_stem_artifacts("guitar", stereo, sample_rate)
    assert report["narrownessScore"] < 0.5


@pytest.mark.unit
def test_analyze_stem_artifacts_handles_mono_input(sample_rate: int) -> None:
    """A 1-D (mono) input shape is treated as L==R (max narrowness)."""
    sig = _bandlimited_signal(sample_rate, 2.0, 200, 4000)
    report = analyze_stem_artifacts("vocals", sig, sample_rate)
    assert report["narrownessScore"] > 0.85
    assert report["stemId"] == "vocals"
    assert report["classification"] == "vocals"


@pytest.mark.unit
def test_analyze_stem_artifacts_score_clamped_to_unit_interval(sample_rate: int) -> None:
    """Floating-point edge cases must not produce scores outside [0, 1]."""
    sig = _bandlimited_signal(sample_rate, 0.1, 200, 4000)  # short signal
    stereo = np.stack([sig, sig], axis=1)
    report = analyze_stem_artifacts("other", stereo, sample_rate)
    assert 0.0 <= report["narrownessScore"] <= 1.0
    assert 0.0 <= report["spectralCollapseScore"] <= 1.0
    assert 0.0 <= report["confidence"] <= 1.0
