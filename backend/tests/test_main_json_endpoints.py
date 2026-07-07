"""ASGI-level coverage for the JSON (direct-to-R2) branches of the /separate
and /analyze/deep routes in main.py.

The Worker mints a presigned R2 GET URL and forwards it as ``fetchUrl`` in a
JSON body; the container streams the object via
``r2_download.download_to_tempfile``, validates early, then starts the job.
These tests exercise that dispatch + validation + propagation path.

R2 is faked with ``httpx.MockTransport`` (same pattern as test_r2_download —
respx is intentionally not a dependency). The background job runners
(``start_separation`` / ``start_deep_analysis``) are patched to a fast fake so
no Demucs / GPU work is triggered: we only assert the route wiring.
"""

from __future__ import annotations

import io

import httpx
import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import main as backend_main
import r2_download
from jobs import Job


pytestmark = pytest.mark.unit


# ---- fixtures / helpers ----------------------------------------------------


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


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    """A TestClient whose JSON routes write temp files into an isolated dir and
    never spawn real background jobs."""
    # Keep downloaded temp files out of the shared /tmp/smart-split dir.
    monkeypatch.setattr(backend_main, "TEMP_DIR", str(tmp_path))

    captured: dict[str, object] = {}

    def fake_start_separation(input_path: str, model: str = "htdemucs") -> Job:
        captured["separation"] = {"input_path": input_path, "model": model}
        return Job(id="sep-job-1", status="queued", progress=0, model=model)

    def fake_start_deep_analysis(input_path: str, profile: str) -> Job:
        captured["deep"] = {"input_path": input_path, "profile": profile}
        return Job(
            id="deep-job-1",
            status="queued",
            progress=0,
            model=profile,
            job_type="deep_analysis",
        )

    monkeypatch.setattr(backend_main, "start_separation", fake_start_separation)
    monkeypatch.setattr(backend_main, "start_deep_analysis", fake_start_deep_analysis)

    app = backend_main.create_app(telemetry=False)
    tc = TestClient(app, raise_server_exceptions=False)
    tc.captured = captured  # type: ignore[attr-defined]
    return tc


# ===========================================================================
# /separate — JSON (direct-R2) branch
# ===========================================================================


def test_separate_json_happy_path_creates_job(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))

    resp = client.post(
        "/separate",
        json={"fetchUrl": "https://r2.example/obj", "model": "htdemucs"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"job_id": "sep-job-1", "status": "queued"}
    # The route handed the locally-downloaded temp path to the job runner.
    assert client.captured["separation"]["model"] == "htdemucs"  # type: ignore[attr-defined]
    assert client.captured["separation"]["input_path"].endswith(".wav")  # type: ignore[attr-defined]


def test_separate_json_defaults_model_when_omitted(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))

    resp = client.post("/separate", json={"fetchUrl": "https://r2.example/obj"})

    assert resp.status_code == 200
    assert client.captured["separation"]["model"] == "htdemucs"  # type: ignore[attr-defined]


def test_separate_json_invalid_model_returns_400_before_fetch(
    client, monkeypatch
) -> None:
    # Any fetch attempt would blow up (no transport configured) — assert the
    # model is rejected *before* the R2 download is attempted.
    def exploding_download(*_a, **_k):  # pragma: no cover - must not be called
        raise AssertionError("download must not run for an invalid model")

    monkeypatch.setattr(backend_main, "download_to_tempfile", exploding_download)

    resp = client.post(
        "/separate",
        json={"fetchUrl": "https://r2.example/obj", "model": "not_a_model"},
    )

    assert resp.status_code == 400
    assert "Invalid model" in resp.json()["detail"]


def test_separate_json_r2_fetch_failure_propagates_502(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(b"", status=404))

    resp = client.post(
        "/separate",
        json={"fetchUrl": "https://r2.example/obj", "model": "htdemucs"},
    )

    assert resp.status_code == 502
    assert "separation" not in client.captured  # type: ignore[attr-defined]


def test_separate_json_r2_network_error_propagates_502(client, monkeypatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    _patch_transport(monkeypatch, handler)

    resp = client.post(
        "/separate",
        json={"fetchUrl": "https://r2.example/obj", "model": "htdemucs"},
    )

    assert resp.status_code == 502


def test_separate_json_non_audio_payload_returns_400(client, monkeypatch) -> None:
    garbage = b"NOPE!!!!" + b"\x00" * 70_000  # > magic probe, no audio signature
    _patch_transport(monkeypatch, _serve(garbage))

    resp = client.post(
        "/separate",
        json={"fetchUrl": "https://r2.example/obj", "model": "htdemucs"},
    )

    assert resp.status_code == 400
    assert "separation" not in client.captured  # type: ignore[attr-defined]


# ===========================================================================
# /analyze/deep — JSON (direct-R2) branch
# ===========================================================================


def test_analyze_deep_json_happy_path_creates_job(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))

    resp = client.post(
        "/analyze/deep",
        json={"fetchUrl": "https://r2.example/obj", "profile": "hip_hop_low_end"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"job_id": "deep-job-1", "status": "queued"}
    assert client.captured["deep"]["profile"] == "hip_hop_low_end"  # type: ignore[attr-defined]
    assert client.captured["deep"]["input_path"].endswith(".wav")  # type: ignore[attr-defined]


def test_analyze_deep_json_defaults_profile_when_omitted(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))

    resp = client.post("/analyze/deep", json={"fetchUrl": "https://r2.example/obj"})

    assert resp.status_code == 200
    assert client.captured["deep"]["profile"] == "modern_pop_polish"  # type: ignore[attr-defined]


def test_analyze_deep_json_invalid_profile_returns_400_before_fetch(
    client, monkeypatch
) -> None:
    def exploding_download(*_a, **_k):  # pragma: no cover - must not be called
        raise AssertionError("download must not run for an invalid profile")

    monkeypatch.setattr(backend_main, "download_to_tempfile", exploding_download)

    resp = client.post(
        "/analyze/deep",
        json={"fetchUrl": "https://r2.example/obj", "profile": "not_a_profile"},
    )

    assert resp.status_code == 400
    assert "Invalid profile" in resp.json()["detail"]


def test_analyze_deep_json_r2_fetch_failure_propagates_502(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(b"", status=500))

    resp = client.post(
        "/analyze/deep",
        json={"fetchUrl": "https://r2.example/obj", "profile": "modern_pop_polish"},
    )

    assert resp.status_code == 502
    assert "deep" not in client.captured  # type: ignore[attr-defined]


def test_analyze_deep_json_non_audio_payload_returns_400(client, monkeypatch) -> None:
    garbage = b"NOPE!!!!" + b"\x00" * 70_000
    _patch_transport(monkeypatch, _serve(garbage))

    resp = client.post(
        "/analyze/deep",
        json={"fetchUrl": "https://r2.example/obj", "profile": "modern_pop_polish"},
    )

    assert resp.status_code == 400
    assert "deep" not in client.captured  # type: ignore[attr-defined]


# ===========================================================================
# Content-Type dispatch: a JSON body with no file must not fall through to the
# multipart branch's "Missing 'file'" 400.
# ===========================================================================


def test_separate_json_content_type_routes_to_json_branch(client, monkeypatch) -> None:
    _patch_transport(monkeypatch, _serve(_wav_bytes()))
    # Explicit application/json content-type, hand-built body.
    resp = client.post(
        "/separate",
        content=b'{"fetchUrl": "https://r2.example/obj", "model": "htdemucs"}',
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 200


# ===========================================================================
# KNOWN PRODUCTION BUG (reported in deferred): a JSON body with a
# missing/invalid `fetchUrl` raises a raw pydantic ValidationError inside the
# handler (``SeparateBody(**await request.json())``) which is *not* translated
# to a 4xx — the client sees a 500. FastAPI only auto-converts validation
# errors to 422 when the body is a declared parameter. The JSON branch parses
# the body manually, so it escapes that machinery.
#
# These xfail tests pin the CORRECT contract (a 4xx for bad client input).
# Flip them to normal asserts once main.py validates the JSON body properly
# (e.g. declare a typed body param, or catch ValidationError -> 422).
# ===========================================================================


@pytest.mark.xfail(
    reason="main.py JSON branch surfaces pydantic ValidationError as 500, not 4xx",
    strict=True,
)
def test_separate_json_missing_fetch_url_should_be_4xx(client) -> None:
    resp = client.post("/separate", json={"model": "htdemucs"})
    assert 400 <= resp.status_code < 500


@pytest.mark.xfail(
    reason="main.py JSON branch surfaces pydantic ValidationError as 500, not 4xx",
    strict=True,
)
def test_separate_json_invalid_fetch_url_should_be_4xx(client) -> None:
    resp = client.post("/separate", json={"fetchUrl": "not-a-url", "model": "htdemucs"})
    assert 400 <= resp.status_code < 500


@pytest.mark.xfail(
    reason="main.py JSON branch surfaces pydantic ValidationError as 500, not 4xx",
    strict=True,
)
def test_analyze_deep_json_missing_fetch_url_should_be_4xx(client) -> None:
    resp = client.post("/analyze/deep", json={"profile": "modern_pop_polish"})
    assert 400 <= resp.status_code < 500
