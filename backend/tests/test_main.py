"""Pytest coverage for `_download_stem` — path-traversal sanitization (TS-010)
and stem-download happy path (TS-013). These run as pure pytest because they
require a completed separation job, which CI can't produce without a GPU."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

import jobs as jobs_module
import main as backend_main
from jobs import Job, StemInfo


pytestmark = pytest.mark.unit


def _seeded_completed_job(tmp_path: Path) -> tuple[str, Path]:
    """Build a completed separation Job with a single 'vocals' stem on disk."""
    stem_path = tmp_path / "vocals.wav"
    stem_path.write_bytes(b"RIFF$\x00\x00\x00WAVEfmt fake-stem-payload")
    job_id = "11111111-2222-3333-4444-555555555555"
    job = Job(
        id=job_id,
        status="done",
        progress=100,
        model="htdemucs",
        stems=[StemInfo(name="vocals", path=str(stem_path), ready=True)],
    )
    jobs_module.create_job(job)
    return job_id, stem_path


# ============================================================================
# TS-013: Stem download happy path
# ============================================================================


@pytest.mark.asyncio
async def test_download_stem_happy_path(tmp_path: Path) -> None:
    job_id, stem_path = _seeded_completed_job(tmp_path)

    with patch("main.FileResponse") as mock_resp:
        mock_resp.return_value = "RESPONSE_SENTINEL"
        result = await backend_main._download_stem(job_id, "vocals")

    assert result == "RESPONSE_SENTINEL"
    mock_resp.assert_called_once()
    args, kwargs = mock_resp.call_args
    assert args[0] == str(stem_path)
    assert kwargs["media_type"] == "audio/wav"
    assert kwargs["filename"] == "vocals.wav"


@pytest.mark.asyncio
async def test_download_stem_unknown_stem_returns_404(tmp_path: Path) -> None:
    job_id, _ = _seeded_completed_job(tmp_path)

    with pytest.raises(HTTPException) as exc:
        await backend_main._download_stem(job_id, "bass")
    assert exc.value.status_code == 404
    assert "bass" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_download_stem_missing_file_on_disk_returns_404(tmp_path: Path) -> None:
    job_id, stem_path = _seeded_completed_job(tmp_path)
    stem_path.unlink()

    with pytest.raises(HTTPException) as exc:
        await backend_main._download_stem(job_id, "vocals")
    assert exc.value.status_code == 404
    assert "not found on disk" in exc.value.detail.lower()


# ============================================================================
# TS-010: Path-traversal sanitization
# ============================================================================


@pytest.mark.asyncio
async def test_download_stem_path_traversal_rejected_relative(tmp_path: Path) -> None:
    """`../../etc/passwd` is not a registered stem name → 404 (NOT a file open)."""
    job_id, _ = _seeded_completed_job(tmp_path)

    with patch("main.FileResponse") as mock_resp:
        with pytest.raises(HTTPException) as exc:
            await backend_main._download_stem(job_id, "../../etc/passwd")
        assert exc.value.status_code == 404
        mock_resp.assert_not_called()


@pytest.mark.asyncio
async def test_download_stem_path_traversal_rejected_compound(tmp_path: Path) -> None:
    """`vocals/../../etc/passwd` does not equal 'vocals' literally → 404."""
    job_id, _ = _seeded_completed_job(tmp_path)

    with patch("main.FileResponse") as mock_resp:
        with pytest.raises(HTTPException) as exc:
            await backend_main._download_stem(job_id, "vocals/../../etc/passwd")
        assert exc.value.status_code == 404
        mock_resp.assert_not_called()


def test_download_stem_url_encoded_traversal_rejected_via_asgi(tmp_path: Path) -> None:
    """End-to-end ASGI test — `..%2F..%2Fetc%2Fpasswd` hits the actual route
    parser. Asserts the URL-decoded path is rejected at the stem-name lookup
    (404 'Stem not found'), NOT served as a file."""
    from fastapi.testclient import TestClient

    job_id, _ = _seeded_completed_job(tmp_path)
    app = backend_main.create_app(telemetry=False)

    with TestClient(app) as client:
        encoded = client.get(f"/jobs/{job_id}/stems/..%2F..%2Fetc%2Fpasswd")
        assert encoded.status_code in (404, 405)
        if encoded.status_code == 404:
            assert (
                "stem" in encoded.json().get("detail", "").lower()
                or "not found" in encoded.json().get("detail", "").lower()
            )

        raw = client.get(f"/jobs/{job_id}/stems/../../etc/passwd")
        assert raw.status_code in (404, 405)


@pytest.mark.asyncio
async def test_download_stem_unknown_job_returns_404(tmp_path: Path) -> None:
    """Bogus job_id never reaches stem-name lookup."""
    with pytest.raises(HTTPException) as exc:
        await backend_main._download_stem(
            "00000000-0000-0000-0000-000000000000", "vocals"
        )
    assert exc.value.status_code == 404
    assert "Job not found" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_download_stem_incomplete_job_returns_400(tmp_path: Path) -> None:
    """Stem download on a still-processing job returns 400, not 404."""
    job_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    job = Job(id=job_id, status="processing", progress=50, model="htdemucs", stems=[])
    jobs_module.create_job(job)

    with pytest.raises(HTTPException) as exc:
        await backend_main._download_stem(job_id, "vocals")
    assert exc.value.status_code == 400
    assert "not complete" in exc.value.detail.lower()
