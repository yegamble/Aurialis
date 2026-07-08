"""Tests for r2_download.download_to_tempfile — the R2 fetch + early-validation
path. Demucs/network are mocked via httpx.MockTransport (no real R2)."""

from __future__ import annotations

import io
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException

import r2_download


def _wav_bytes(seconds: float = 1.0, sr: int = 44100) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.zeros((int(sr * seconds), 1), dtype="float32"), sr, format="WAV")
    return buf.getvalue()


def _patch_transport(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    """Route r2_download's internal httpx.Client through a MockTransport."""
    real_client = httpx.Client
    transport = httpx.MockTransport(handler)

    def fake_client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(r2_download.httpx, "Client", fake_client)


def _serve(body: bytes, status: int = 200):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=body)

    return handler


def test_happy_path_returns_a_valid_local_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))
    out = r2_download.download_to_tempfile(
        "https://r2.example/obj", temp_dir=str(tmp_path)
    )
    assert out.exists()
    assert out.suffix == ".wav"
    # The downloaded file is a readable WAV.
    info = sf.info(str(out))
    assert info.samplerate == 44100
    r2_download._unlink_quiet(out)


def test_rejects_non_audio_magic_bytes_with_400(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    garbage = b"NOPE!!!!" + b"\x00" * 70_000  # > magic probe, no audio signature
    _patch_transport(monkeypatch, _serve(garbage))
    with pytest.raises(HTTPException) as exc:
        r2_download.download_to_tempfile(
            "https://r2.example/obj", temp_dir=str(tmp_path)
        )
    assert exc.value.status_code == 400


def test_rejects_too_small_payload_with_400(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _patch_transport(monkeypatch, _serve(b"\x00\x00"))
    with pytest.raises(HTTPException) as exc:
        r2_download.download_to_tempfile(
            "https://r2.example/obj", temp_dir=str(tmp_path)
        )
    assert exc.value.status_code == 400


def test_rejects_oversize_via_content_length_with_413(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # httpx sets Content-Length from the body; a 176 KB WAV exceeds max_bytes=1000
    # so the pre-flight check rejects before any bytes are streamed.
    _patch_transport(monkeypatch, _serve(_wav_bytes()))
    with pytest.raises(HTTPException) as exc:
        r2_download.download_to_tempfile(
            "https://r2.example/obj", max_bytes=1000, temp_dir=str(tmp_path)
        )
    assert exc.value.status_code == 413


def test_non_200_response_becomes_502(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _patch_transport(monkeypatch, _serve(b"", status=404))
    with pytest.raises(HTTPException) as exc:
        r2_download.download_to_tempfile(
            "https://r2.example/obj", temp_dir=str(tmp_path)
        )
    assert exc.value.status_code == 502


def test_network_error_becomes_502(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    _patch_transport(monkeypatch, handler)
    with pytest.raises(HTTPException) as exc:
        r2_download.download_to_tempfile(
            "https://r2.example/obj", temp_dir=str(tmp_path)
        )
    assert exc.value.status_code == 502


def test_no_tempfile_left_behind_on_rejection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A rejected download must not orphan a tempfile in temp_dir."""
    garbage = b"NOPE!!!!" + b"\x00" * 70_000
    _patch_transport(monkeypatch, _serve(garbage))
    with pytest.raises(HTTPException):
        r2_download.download_to_tempfile(
            "https://r2.example/obj", temp_dir=str(tmp_path)
        )
    assert list(tmp_path.iterdir()) == []


class _OneShotStream(httpx.SyncByteStream):
    """Faithful to real httpx: the body can be iterated exactly once.

    MockTransport's in-memory responses tolerate a second iter_bytes() call,
    which hid the StreamConsumed crash (magic-byte probe consumed the first
    iterator, the copy loop opened a second) that broke every real R2
    download. This stream reproduces production semantics.
    """

    def __init__(self, body: bytes, chunk: int = 64 * 1024) -> None:
        self._chunks = [body[i : i + chunk] for i in range(0, len(body), chunk)]
        self._consumed = False

    def __iter__(self):
        if self._consumed:
            raise httpx.StreamConsumed()
        self._consumed = True
        yield from self._chunks


def test_download_streams_body_exactly_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Regression: r2_download must consume ONE body iterator end to end.

    Verified live 2026-07-08: with real httpx the old double-iter_bytes()
    raised httpx.StreamConsumed on every JSON-path download (bare 500 in
    prod). A one-shot stream makes the mock as strict as production.
    """
    body = _wav_bytes()

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=_OneShotStream(body))

    _patch_transport(monkeypatch, handler)

    out = r2_download.download_to_tempfile(
        "https://example.test/upload.wav", temp_dir=str(tmp_path)
    )
    try:
        assert out.read_bytes() == body
    finally:
        out.unlink(missing_ok=True)
