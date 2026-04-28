"""Audio-upload validation — magic-byte sniff + size cap + soundfile.info()
header confirmation for WAV/FLAC/OGG. MP3/M4A go through magic bytes only by
policy (libsndfile MP3 support varies across versions and platforms; we want
deterministic rejection across deploys).

Two entry points:
- ``validate_audio_upload(UploadFile)`` for legacy multipart paths.
- ``validate_audio_bytes(bytes)`` for the JSON / R2-streamed paths.

Both designed to run BEFORE any temp-file write in the request handler so
that oversized or non-audio uploads never persist anything to /tmp.
"""

from __future__ import annotations

import io
import os

import soundfile as sf
from fastapi import HTTPException, UploadFile

# 1 GB cap — initial soft limit per the direct-r2-upload plan. Raise via
# the MAX_UPLOAD_BYTES_OVERRIDE env var as cost-envelope review allows.
_DEFAULT_MAX_UPLOAD_BYTES = 1 * 1024 * 1024 * 1024


def _resolve_max_bytes() -> int:
    override = os.environ.get("MAX_UPLOAD_BYTES_OVERRIDE")
    if override:
        try:
            value = int(override)
            if value > 0:
                return value
        except ValueError:
            pass
    return _DEFAULT_MAX_UPLOAD_BYTES


MAX_UPLOAD_BYTES = _resolve_max_bytes()

# Minimum bytes needed to evaluate any of our magic-byte signatures.
MIN_MAGIC_BYTES = 12

# Formats we route through libsndfile's header parser for a second-line check.
# MP3 + M4A are deliberately excluded — see module docstring.
SOUNDFILE_FORMATS = frozenset({"wav", "flac", "ogg"})

# Backwards-compat aliases (private spellings used in tests).
_MIN_MAGIC_BYTES = MIN_MAGIC_BYTES
_SOUNDFILE_FORMATS = SOUNDFILE_FORMATS


def _is_wav(prefix: bytes) -> bool:
    """RIFF....WAVE — bytes 0-3 = 'RIFF', bytes 8-11 = 'WAVE'."""
    return len(prefix) >= 12 and prefix[:4] == b"RIFF" and prefix[8:12] == b"WAVE"


def _is_flac(prefix: bytes) -> bool:
    return prefix[:4] == b"fLaC"


def _is_ogg(prefix: bytes) -> bool:
    return prefix[:4] == b"OggS"


def _is_mp3(prefix: bytes) -> bool:
    """ID3v2 tagged file OR a raw MPEG audio frame (sync = 11 bits)."""
    if prefix[:3] == b"ID3":
        return True
    # MPEG frame sync: byte 0 = 0xFF, top 3 bits of byte 1 set.
    return len(prefix) >= 2 and prefix[0] == 0xFF and (prefix[1] & 0xE0) == 0xE0


def _is_m4a(prefix: bytes) -> bool:
    """ISO base media: bytes 4-7 = 'ftyp' (any brand)."""
    return len(prefix) >= 8 and prefix[4:8] == b"ftyp"


def detect_audio_format(prefix: bytes) -> str | None:
    """Return the detected audio format ("wav", "flac", "ogg", "mp3", "m4a")
    or ``None`` if the prefix doesn't match any supported magic bytes."""
    if _is_wav(prefix):
        return "wav"
    if _is_flac(prefix):
        return "flac"
    if _is_ogg(prefix):
        return "ogg"
    if _is_mp3(prefix):
        return "mp3"
    if _is_m4a(prefix):
        return "m4a"
    return None


def validate_audio_bytes(data: bytes, max_bytes: int | None = None) -> bytes:
    """Validate ``data`` as an audio upload.

    ``max_bytes`` is resolved at call-time (not at import) when omitted, so
    tests and CI can change ``MAX_UPLOAD_BYTES_OVERRIDE`` without reloading
    the module. Pass an explicit value to bypass the env-var lookup.

    Raises ``HTTPException(413)`` on oversize, ``HTTPException(400)`` on any
    other rejection reason. Returns ``data`` unchanged when valid.
    """
    if max_bytes is None:
        max_bytes = _resolve_max_bytes()
    if len(data) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File exceeds {mb} MB limit")

    if len(data) < _MIN_MAGIC_BYTES:
        raise HTTPException(status_code=400, detail="File too small to be valid audio")

    fmt = detect_audio_format(data[:_MIN_MAGIC_BYTES])
    if fmt is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported audio format — magic bytes do not match "
                "WAV/FLAC/OGG/MP3/M4A"
            ),
        )

    if fmt in _SOUNDFILE_FORMATS:
        try:
            sf.info(io.BytesIO(data))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Could not read audio header: {exc.__class__.__name__}",
            ) from exc

    return data


async def validate_audio_upload(
    file: UploadFile, max_bytes: int | None = None
) -> bytes:
    """Read a multipart upload (bounded by max_bytes+1) and validate.

    ``max_bytes`` is resolved at call-time when omitted (see
    ``validate_audio_bytes``). Returns the validated bytes for the caller
    to persist.
    """
    if max_bytes is None:
        max_bytes = _resolve_max_bytes()
    data = await file.read(max_bytes + 1)
    return validate_audio_bytes(data, max_bytes)
