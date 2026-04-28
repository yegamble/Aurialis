"""Generate audio + non-audio fixtures for the Postman E2E suite.

Idempotent: re-runs are no-ops when sha256 sidecars match. Use --clean to wipe
fixtures and regenerate. Designed to run in <10 s on a developer laptop or CI
runner.

Layout:
  fixtures/
    _seeds/                  -- committed seed binaries (tone.mp3, tone.m4a)
    .gitignore              -- excludes generated fixtures
    generate-fixtures.py    -- this script
    <generated fixtures>     -- ignored by git
    <fixture>.sha256         -- ignored by git
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
SEEDS = HERE / "_seeds"

OVERSIZED_BYTES = (
    250 * 1024 * 1024
)  # 250 MB — exceeds the 200 MB cap when env override applied


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_sidecar(path: Path) -> None:
    sidecar = path.with_suffix(path.suffix + ".sha256")
    sidecar.write_text(_sha256(path) + "\n")


def _matches_sidecar(path: Path) -> bool:
    sidecar = path.with_suffix(path.suffix + ".sha256")
    if not path.exists() or not sidecar.exists():
        return False
    expected = sidecar.read_text().strip()
    return expected == _sha256(path)


def _ensure(path: Path, builder: Callable[[Path], None]) -> bool:
    """Build `path` via `builder` if missing or sidecar mismatches.
    Returns True if it (re)generated the fixture."""
    if _matches_sidecar(path):
        return False
    if path.exists():
        path.unlink()
    builder(path)
    _write_sidecar(path)
    return True


def _build_sine_wav(
    path: Path,
    *,
    seconds: float,
    sample_rate: int,
    freq_hz: float = 220.0,
    mono: bool = False,
    amplitude: float = 0.1,
) -> None:
    n = int(seconds * sample_rate)
    t = np.linspace(0, seconds, n, endpoint=False, dtype=np.float32)
    sig = (amplitude * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)
    if not mono:
        sig = np.stack([sig, sig], axis=1)
    sf.write(path, sig, sample_rate, format="WAV", subtype="PCM_16")


def _build_normal_3s(path: Path) -> None:
    _build_sine_wav(path, seconds=3.0, sample_rate=48_000, mono=False)


def _build_tiny(path: Path) -> None:
    _build_sine_wav(path, seconds=0.5, sample_rate=48_000, mono=True)


def _build_mono_8khz(path: Path) -> None:
    _build_sine_wav(path, seconds=3.0, sample_rate=8_000, mono=True)


def _build_mono_96khz(path: Path) -> None:
    _build_sine_wav(path, seconds=3.0, sample_rate=96_000, mono=True)


def _build_corrupted(path: Path) -> None:
    """RIFF/WAVE magic only, no real fmt/data chunks — passes magic-byte
    sniff, fails ``soundfile.info()`` with 'No data chunk marker'.

    A naive truncation of a real WAV (e.g. first 50 bytes) preserves a
    complete fmt chunk plus the start of the data chunk — ``sf.info()``
    happily reports metadata and validation accepts it. The handcrafted
    header below has the magic bytes only; libsndfile rejects it deterministically.
    """
    path.write_bytes(b"RIFF\x24\x00\x00\x00WAVE" + b"\x00" * 12)


def _build_long_10min(path: Path) -> None:
    # Mono 22.05 kHz keeps it ~26 MB while still being a real, decodable WAV.
    _build_sine_wav(path, seconds=600.0, sample_rate=22_050, mono=True)


def _build_oversized(path: Path) -> None:
    """250 MB of zeros. Uses os.posix_fallocate on Linux when available."""
    with path.open("wb") as f:
        try:
            if hasattr(os, "posix_fallocate"):
                os.posix_fallocate(f.fileno(), 0, OVERSIZED_BYTES)
                return
        except (OSError, AttributeError):
            pass
        chunk = b"\x00" * (1024 * 1024)
        for _ in range(OVERSIZED_BYTES // len(chunk)):
            f.write(chunk)


def _build_pdf(path: Path) -> None:
    """Minimal valid-looking PDF stub."""
    path.write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n%%EOF\n" + b"\x00" * 100)


def _build_exe(path: Path) -> None:
    """MZ + 16 zeros — DOS executable magic, otherwise empty."""
    path.write_bytes(b"MZ" + b"\x00" * 64)


def _build_evil_spoofed(path: Path) -> None:
    """PDF body with .wav extension — magic-byte sniff catches the spoof."""
    _build_pdf(path)


def _copy_seed(name: str) -> Callable[[Path], None]:
    def _builder(path: Path) -> None:
        seed = SEEDS / name
        if not seed.exists():
            raise FileNotFoundError(
                f"Seed fixture missing: {seed}. Commit a tiny pre-encoded "
                f"sample to {SEEDS}/ — encoding {name} requires ffmpeg/lame "
                "which we don't want in the backend image."
            )
        shutil.copy(seed, path)

    return _builder


FIXTURES: list[tuple[str, Callable[[Path], None]]] = [
    ("normal_3s.wav", _build_normal_3s),
    ("tiny.wav", _build_tiny),
    ("mono_8khz.wav", _build_mono_8khz),
    ("mono_96khz.wav", _build_mono_96khz),
    ("corrupted.wav", _build_corrupted),
    ("long_10min.wav", _build_long_10min),
    ("oversized.bin", _build_oversized),
    ("not-audio.pdf", _build_pdf),
    ("fake.exe", _build_exe),
    ("evil-spoofed.wav", _build_evil_spoofed),
    ("normal_3s.mp3", _copy_seed("tone.mp3")),
    ("normal_3s.m4a", _copy_seed("tone.m4a")),
]


def _clean() -> None:
    """Delete every generated fixture and sidecar, leaving _seeds/ alone."""
    for entry in HERE.iterdir():
        if entry.name in {"_seeds", "generate-fixtures.py", ".gitignore", "README.md"}:
            continue
        if entry.is_file():
            entry.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete all generated fixtures + sidecars before regenerating.",
    )
    args = parser.parse_args()

    if args.clean:
        _clean()

    HERE.mkdir(parents=True, exist_ok=True)

    regenerated = 0
    for name, builder in FIXTURES:
        path = HERE / name
        try:
            if _ensure(path, builder):
                regenerated += 1
                print(f"generated {name}")
        except FileNotFoundError as e:
            print(f"SKIP {name}: {e}", file=sys.stderr)

    skipped = len(FIXTURES) - regenerated
    print(f"done: {regenerated} regenerated, {skipped} cached")
    return 0


if __name__ == "__main__":
    sys.exit(main())
