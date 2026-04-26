"""Shared pytest fixtures for backend tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import numpy as np
import soundfile as sf

# Make backend modules importable when pytest is invoked from any directory.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def sample_rate() -> int:
    return 48_000


@pytest.fixture
def synthetic_30s_wav(tmp_path: Path, sample_rate: int) -> Path:
    """Generate a deterministic 30-second stereo WAV with three distinct sections.
    Section A (0-10s): 220 Hz sine, low-energy.
    Section B (10-20s): 440 Hz + harmonics, mid-energy.
    Section C (20-30s): pink-ish noise + 880 Hz, high-energy.
    """
    sr = sample_rate
    t_a = np.linspace(0, 10, sr * 10, endpoint=False, dtype=np.float32)
    t_b = np.linspace(0, 10, sr * 10, endpoint=False, dtype=np.float32)
    t_c = np.linspace(0, 10, sr * 10, endpoint=False, dtype=np.float32)

    rng = np.random.default_rng(42)
    a = 0.05 * np.sin(2 * np.pi * 220 * t_a)
    b = 0.20 * (np.sin(2 * np.pi * 440 * t_b) + 0.5 * np.sin(2 * np.pi * 880 * t_b))
    c = 0.40 * (rng.standard_normal(sr * 10).astype(np.float32) * 0.3 + np.sin(2 * np.pi * 880 * t_c))

    mono = np.concatenate([a, b, c]).astype(np.float32)
    stereo = np.stack([mono, mono], axis=1)

    out = tmp_path / "synthetic-30s.wav"
    sf.write(out, stereo, sr)
    return out
