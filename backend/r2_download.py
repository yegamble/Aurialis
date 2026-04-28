"""Stream-download an R2 object to a local tempfile, validating early.

The Worker mints a presigned GET URL and forwards it as ``fetchUrl`` in the
JSON body of /analyze/deep and /separate. This module fetches the object
exactly once at job start, runs validation, and returns a local Path. The
caller hands the path to the existing job runners (which already accept
local paths).

Validation order matters for cost + DoS resistance:
    1. Pre-flight Content-Length check — reject before reading any bytes
       if the server claims the file is over MAX_UPLOAD_BYTES.
    2. Magic-byte sniff on the first 64 KB read from the stream.
    3. soundfile header probe on the first 1 MB written to the tempfile.
    4. Stream the rest, capping cumulative bytes at MAX_UPLOAD_BYTES.

Aborting at step 2 or 3 closes the httpx stream context manager and unlinks
the tempfile, so a 5 GB malicious download never gets fully consumed.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx
import soundfile as sf
from fastapi import HTTPException

from validation import (
    MAX_UPLOAD_BYTES,
    _MIN_MAGIC_BYTES,
    _SOUNDFILE_FORMATS,
    detect_audio_format,
)

_MAGIC_PROBE_BYTES = 64 * 1024
_HEADER_PROBE_BYTES = 1 * 1024 * 1024

_DOWNLOAD_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=10.0)


def _ext_for_format(fmt: str) -> str:
    return {"wav": ".wav", "flac": ".flac", "ogg": ".ogg", "mp3": ".mp3", "m4a": ".m4a"}.get(fmt, ".wav")


def _unlink_quiet(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def download_to_tempfile(
    fetch_url: str,
    *,
    max_bytes: int = MAX_UPLOAD_BYTES,
    temp_dir: str = "/tmp/smart-split",
) -> Path:
    """Stream the object at ``fetch_url`` to a local file, validating early.

    Raises ``HTTPException(400)`` for invalid audio, ``HTTPException(413)``
    for oversize, ``HTTPException(502)`` for fetch failures.
    """
    os.makedirs(temp_dir, exist_ok=True)

    client = httpx.Client(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True)
    try:
        with client.stream("GET", fetch_url) as response:
            if response.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"Couldn't fetch upload (status {response.status_code})",
                )

            content_length_header = response.headers.get("content-length")
            if content_length_header:
                try:
                    declared = int(content_length_header)
                except ValueError:
                    declared = -1
                if declared > max_bytes:
                    mb = max_bytes // (1024 * 1024)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds {mb} MB limit",
                    )

            magic_buf = bytearray()
            for chunk in response.iter_bytes(chunk_size=64 * 1024):
                magic_buf.extend(chunk)
                if len(magic_buf) >= _MAGIC_PROBE_BYTES:
                    break
            if len(magic_buf) < _MIN_MAGIC_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="File too small to be valid audio",
                )

            fmt = detect_audio_format(bytes(magic_buf[:_MIN_MAGIC_BYTES]))
            if fmt is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Unsupported audio format — magic bytes do not match "
                        "WAV/FLAC/OGG/MP3/M4A"
                    ),
                )

            suffix = _ext_for_format(fmt)
            tmp_fd, tmp_path_str = tempfile.mkstemp(dir=temp_dir, suffix=suffix)
            tmp_path = Path(tmp_path_str)

            try:
                with os.fdopen(tmp_fd, "wb") as out:
                    out.write(magic_buf)
                    cumulative = len(magic_buf)
                    header_probe_done = cumulative >= _HEADER_PROBE_BYTES

                    if header_probe_done and fmt in _SOUNDFILE_FORMATS:
                        _probe_header(tmp_path, fmt)

                    for chunk in response.iter_bytes(chunk_size=512 * 1024):
                        cumulative += len(chunk)
                        if cumulative > max_bytes:
                            mb = max_bytes // (1024 * 1024)
                            raise HTTPException(
                                status_code=413,
                                detail=f"File exceeds {mb} MB limit",
                            )
                        out.write(chunk)

                        if not header_probe_done and cumulative >= _HEADER_PROBE_BYTES:
                            out.flush()
                            if fmt in _SOUNDFILE_FORMATS:
                                _probe_header(tmp_path, fmt)
                            header_probe_done = True

                if not header_probe_done and fmt in _SOUNDFILE_FORMATS:
                    _probe_header(tmp_path, fmt)
            except BaseException:
                _unlink_quiet(tmp_path)
                raise
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Couldn't fetch upload: {exc.__class__.__name__}",
        ) from exc
    finally:
        client.close()

    return tmp_path


def _probe_header(path: Path, fmt: str) -> None:
    if fmt not in _SOUNDFILE_FORMATS:
        return
    try:
        sf.info(str(path))
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read audio header: {exc.__class__.__name__}",
        ) from exc
