"""Unit tests for the audio-upload validator and its handler integration."""

from __future__ import annotations

import io
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException


pytestmark = pytest.mark.unit


# ---- Helper: build a fake UploadFile that returns bytes from .read(n) ----


def _fake_upload_file(content: bytes, filename: str = "x.wav") -> MagicMock:
    """Build a minimal UploadFile-like mock. `read(n)` returns up to n bytes
    from `content` (mirrors Starlette's SpooledTemporaryFile behavior)."""
    pos = {"i": 0}

    async def _read(n: int = -1) -> bytes:
        i = pos["i"]
        if n is None or n < 0:
            chunk = content[i:]
            pos["i"] = len(content)
        else:
            chunk = content[i : i + n]
            pos["i"] = i + len(chunk)
        return chunk

    upload = MagicMock()
    upload.filename = filename
    upload.read = AsyncMock(side_effect=_read)
    return upload


# ---- Helper: build a real synthetic WAV in memory ----


def _synth_wav(
    sample_rate: int = 48_000, seconds: float = 1.0, mono: bool = False
) -> bytes:
    """Generate a tiny synthetic WAV in memory."""
    n = int(sample_rate * seconds)
    t = np.linspace(0, seconds, n, endpoint=False, dtype=np.float32)
    sig = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    if not mono:
        sig = np.stack([sig, sig], axis=1)
    buf = io.BytesIO()
    sf.write(buf, sig, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _synth_flac(sample_rate: int = 48_000, seconds: float = 0.5) -> bytes:
    n = int(sample_rate * seconds)
    sig = (
        0.1
        * np.sin(
            2
            * np.pi
            * 440
            * np.linspace(0, seconds, n, endpoint=False, dtype=np.float32)
        )
    ).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, sig, sample_rate, format="FLAC")
    return buf.getvalue()


def _synth_ogg(sample_rate: int = 48_000, seconds: float = 0.5) -> bytes:
    n = int(sample_rate * seconds)
    sig = (
        0.1
        * np.sin(
            2
            * np.pi
            * 440
            * np.linspace(0, seconds, n, endpoint=False, dtype=np.float32)
        )
    ).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, sig, sample_rate, format="OGG", subtype="VORBIS")
    return buf.getvalue()


# ---- Magic-byte stubs for MP3 / M4A (real encoding requires ffmpeg) ----


def _stub_mp3_id3() -> bytes:
    """ID3v2 tagged MP3 — first 10 bytes are ID3 header, then MP3 frames."""
    return b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + b"\x00" * 200


def _stub_mp3_framesync() -> bytes:
    """MP3 frame sync (no ID3 tag) — starts with 0xFF 0xFB."""
    return b"\xff\xfb\x90\x00" + b"\x00" * 200


def _stub_m4a() -> bytes:
    """M4A: bytes 4-7 = 'ftyp', then brand."""
    return b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00" + b"\x00" * 200


# ============================================================================
# validate_audio_upload — happy paths
# ============================================================================


@pytest.mark.asyncio
async def test_wav_validates_successfully() -> None:
    from validation import validate_audio_upload

    wav_bytes = _synth_wav()
    upload = _fake_upload_file(wav_bytes)
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out == wav_bytes


@pytest.mark.asyncio
async def test_flac_validates_successfully() -> None:
    from validation import validate_audio_upload

    flac_bytes = _synth_flac()
    upload = _fake_upload_file(flac_bytes, filename="x.flac")
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out == flac_bytes


@pytest.mark.asyncio
async def test_ogg_validates_successfully() -> None:
    from validation import validate_audio_upload

    ogg_bytes = _synth_ogg()
    upload = _fake_upload_file(ogg_bytes, filename="x.ogg")
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out == ogg_bytes


@pytest.mark.asyncio
async def test_mp3_id3_validates_successfully() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(_stub_mp3_id3(), filename="x.mp3")
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out.startswith(b"ID3")


@pytest.mark.asyncio
async def test_mp3_framesync_validates_successfully() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(_stub_mp3_framesync(), filename="x.mp3")
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out.startswith(b"\xff\xfb")


@pytest.mark.asyncio
async def test_m4a_validates_successfully() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(_stub_m4a(), filename="x.m4a")
    out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out[4:8] == b"ftyp"


# ============================================================================
# validate_audio_upload — rejection paths
# ============================================================================


@pytest.mark.asyncio
async def test_pdf_rejected() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(b"%PDF-1.4\n%%EOF\n" + b"\x00" * 100, filename="x.pdf")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_exe_rejected() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(b"MZ" + b"\x00" * 200, filename="malware.exe")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_garbage_rejected() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(b"\xde\xad\xbe\xef" * 100, filename="x.wav")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_empty_file_rejected() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(b"", filename="x.wav")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_too_small_file_rejected() -> None:
    from validation import validate_audio_upload

    upload = _fake_upload_file(b"abc", filename="x.wav")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_spoofed_wav_extension_with_pdf_bytes_rejected() -> None:
    """User uploads `evil.wav` but the file is actually a PDF — magic bytes
    should reject regardless of extension."""
    from validation import validate_audio_upload

    upload = _fake_upload_file(
        b"%PDF-1.4\n%%EOF\n" + b"\x00" * 100, filename="evil.wav"
    )
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_corrupted_wav_header_rejected() -> None:
    """RIFF/WAVE magic bytes pass but soundfile.info() raises on truncated body."""
    from validation import validate_audio_upload

    # 12 bytes is the minimum to satisfy the WAV magic check, but soundfile
    # will choke on the lack of fmt/data chunks.
    fake_wav = b"RIFF\x24\x00\x00\x00WAVE" + b"\x00" * 12
    upload = _fake_upload_file(fake_wav, filename="x.wav")
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert exc.value.status_code == 400


# ============================================================================
# Size-cap behavior
# ============================================================================


@pytest.mark.asyncio
async def test_oversized_returns_413() -> None:
    from validation import validate_audio_upload

    # 200 bytes content with max_bytes=100 → reject
    upload = _fake_upload_file(b"\x00" * 200)
    with pytest.raises(HTTPException) as exc:
        await validate_audio_upload(upload, max_bytes=100)
    assert exc.value.status_code == 413
    assert "limit" in exc.value.detail.lower() or "exceeds" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_oversized_rejected_without_persisting_tempfile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the validator rejects an oversized upload, no NamedTemporaryFile is
    opened — verified by patching tempfile in the handler module.

    Uses MAX_UPLOAD_BYTES_OVERRIDE so the test allocates KB, not GB. Validator
    resolves the cap at call-time (lazy), so no module reload is needed."""
    monkeypatch.setenv("MAX_UPLOAD_BYTES_OVERRIDE", "10240")  # 10 KB

    import main as backend_main

    upload = _fake_upload_file(b"\x00" * (10 * 1024 + 1024))

    with patch("main.tempfile.NamedTemporaryFile") as mock_tmp:
        with pytest.raises(HTTPException) as exc:
            await backend_main._separate_multipart(file=upload, model="htdemucs")
        assert exc.value.status_code == 413
        mock_tmp.assert_not_called()


# ============================================================================
# MP3 / M4A magic-only policy
# ============================================================================


@pytest.mark.asyncio
async def test_mp3_validates_via_magic_only_no_soundfile_call() -> None:
    """Policy: MP3 inputs MUST NOT trigger sf.info() — magic bytes are the
    only audio-content gate (libsndfile MP3 support varies by version)."""
    from validation import validate_audio_upload

    upload = _fake_upload_file(_stub_mp3_id3(), filename="x.mp3")
    with patch("validation.sf.info") as mock_info:
        out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out.startswith(b"ID3")
    mock_info.assert_not_called()


@pytest.mark.asyncio
async def test_m4a_validates_via_magic_only_no_soundfile_call() -> None:
    """Policy: M4A inputs MUST NOT trigger sf.info() — magic bytes only."""
    from validation import validate_audio_upload

    upload = _fake_upload_file(_stub_m4a(), filename="x.m4a")
    with patch("validation.sf.info") as mock_info:
        out = await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert out[4:8] == b"ftyp"
    mock_info.assert_not_called()


@pytest.mark.asyncio
async def test_wav_does_call_soundfile_info() -> None:
    """Counterpart: WAV/FLAC/OGG MUST go through sf.info() for header validation."""
    from validation import validate_audio_upload

    wav_bytes = _synth_wav()
    upload = _fake_upload_file(wav_bytes)
    with patch("validation.sf.info", wraps=sf.info) as mock_info:
        await validate_audio_upload(upload, max_bytes=10 * 1024 * 1024)
    assert mock_info.call_count == 1


# ============================================================================
# Handler integration — temp file cleanup on post-validation failure
# ============================================================================


@pytest.mark.asyncio
async def test_separate_handler_unlinks_tempfile_on_start_separation_failure(
    tmp_path: Path,
) -> None:
    """If start_separation raises after validation, the temp file is unlinked."""
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    wav_bytes = _synth_wav(seconds=0.5)
    upload = _fake_upload_file(wav_bytes, filename="x.wav")

    backend_main.TEMP_DIR = str(tmp_path)

    captured: dict[str, str] = {}

    def _failing_start_separation(input_path: str, model: str) -> None:
        captured["input_path"] = input_path
        # File MUST exist at this point — handler wrote it before calling us.
        assert os.path.exists(input_path), "tempfile not yet written"
        raise RuntimeError("simulated demucs import failure")

    with patch("main.start_separation", _failing_start_separation):
        with pytest.raises(RuntimeError):
            await backend_main._separate_multipart(file=upload, model="htdemucs")

    assert "input_path" in captured
    assert not os.path.exists(captured["input_path"]), (
        f"temp file leaked: {captured['input_path']}"
    )


@pytest.mark.asyncio
async def test_analyze_deep_handler_unlinks_tempfile_on_failure(tmp_path: Path) -> None:
    """Same cleanup contract for /analyze/deep."""
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    wav_bytes = _synth_wav(seconds=0.5)
    upload = _fake_upload_file(wav_bytes, filename="x.wav")

    backend_main.TEMP_DIR = str(tmp_path)

    captured: dict[str, str] = {}

    def _failing_start(input_path: str, profile: str) -> None:
        captured["input_path"] = input_path
        assert os.path.exists(input_path)
        raise RuntimeError("simulated madmom failure")

    with patch("main.start_deep_analysis", _failing_start):
        with pytest.raises(RuntimeError):
            await backend_main._analyze_deep_multipart(
                file=upload, profile="modern_pop_polish"
            )

    assert "input_path" in captured
    assert not os.path.exists(captured["input_path"])


# ============================================================================
# Handler integration — non-audio rejection happens before temp file write
# ============================================================================


@pytest.mark.asyncio
async def test_separate_rejects_pdf_before_writing_tempfile() -> None:
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    pdf_bytes = b"%PDF-1.4\n%%EOF\n" + b"\x00" * 100
    upload = _fake_upload_file(pdf_bytes, filename="evil.wav")

    with patch("main.tempfile.NamedTemporaryFile") as mock_tmp:
        with pytest.raises(HTTPException) as exc:
            await backend_main._separate_multipart(file=upload, model="htdemucs")
        assert exc.value.status_code == 400
        mock_tmp.assert_not_called()


@pytest.mark.asyncio
async def test_analyze_deep_rejects_pdf_before_writing_tempfile() -> None:
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    pdf_bytes = b"%PDF-1.4\n%%EOF\n" + b"\x00" * 100
    upload = _fake_upload_file(pdf_bytes, filename="evil.wav")

    with patch("main.tempfile.NamedTemporaryFile") as mock_tmp:
        with pytest.raises(HTTPException) as exc:
            await backend_main._analyze_deep_multipart(
                file=upload, profile="modern_pop_polish"
            )
        assert exc.value.status_code == 400
        mock_tmp.assert_not_called()


# ============================================================================
# Handler integration — invalid model/profile still rejected before validation
# ============================================================================


@pytest.mark.asyncio
async def test_separate_rejects_invalid_model_before_reading_file() -> None:
    """Model allowlist guard runs first — does not even read the upload."""
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    upload = _fake_upload_file(_synth_wav(seconds=0.2))
    with pytest.raises(HTTPException) as exc:
        await backend_main._separate_multipart(file=upload, model="BOGUS")
    assert exc.value.status_code == 400
    upload.read.assert_not_called()


@pytest.mark.asyncio
async def test_analyze_deep_rejects_invalid_profile_before_reading_file() -> None:
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    upload = _fake_upload_file(_synth_wav(seconds=0.2))
    with pytest.raises(HTTPException) as exc:
        await backend_main._analyze_deep_multipart(file=upload, profile="BOGUS")
    assert exc.value.status_code == 400
    upload.read.assert_not_called()


@pytest.mark.asyncio
async def test_separate_rejects_missing_filename() -> None:
    import importlib
    import main as backend_main

    importlib.reload(backend_main)

    upload = _fake_upload_file(_synth_wav(seconds=0.2), filename="")
    with pytest.raises(HTTPException) as exc:
        await backend_main._separate_multipart(file=upload, model="htdemucs")
    assert exc.value.status_code == 400
