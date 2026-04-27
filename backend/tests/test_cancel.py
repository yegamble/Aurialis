"""Tests for cancel plumbing — Job.cancelled field, DELETE /jobs/{job_id}, and
cooperative cancellation in _run_deep_analysis."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import jobs
import deep_analysis
from jobs import Job, create_job, get_job, update_job, is_cancelled


@pytest.fixture(autouse=True)
def isolate_jobs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redirect JOBS_FILE to a temp path so tests don't share state."""
    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")


@pytest.mark.unit
def test_cancelled_field_defaults_false() -> None:
    j = Job(id="j1")
    assert j.cancelled is False


@pytest.mark.unit
def test_cancelled_round_trips_through_save_load() -> None:
    create_job(Job(id="j2", cancelled=False))
    update_job("j2", cancelled=True)
    loaded = get_job("j2")
    assert loaded is not None
    assert loaded.cancelled is True


@pytest.mark.unit
def test_legacy_jobs_without_cancelled_field_load_safely(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Old jobs.json files written before this change must still parse."""
    legacy_file = tmp_path / "jobs.json"
    legacy_file.write_text(
        '{"j-old": {"id": "j-old", "status": "queued", "progress": 0, '
        '"model": "htdemucs", "stems": [], "error": null, "input_path": null, '
        '"output_dir": null, "created_at": 0, "job_type": "separation", '
        '"partial_result": {}}}'
    )
    monkeypatch.setattr(jobs, "JOBS_FILE", legacy_file)
    loaded = get_job("j-old")
    assert loaded is not None
    assert loaded.cancelled is False


@pytest.mark.unit
def test_is_cancelled_returns_false_for_nonexistent_job() -> None:
    assert is_cancelled("does-not-exist") is False


@pytest.mark.unit
def test_is_cancelled_returns_true_after_update() -> None:
    create_job(Job(id="j3", cancelled=False))
    assert is_cancelled("j3") is False
    update_job("j3", cancelled=True)
    assert is_cancelled("j3") is True


# ----- DELETE endpoint tests -----


@pytest.fixture
def client() -> TestClient:
    from main import app
    return TestClient(app)


@pytest.mark.integration
def test_delete_endpoint_404_for_nonexistent_job(client: TestClient) -> None:
    r = client.delete("/jobs/nonexistent-id")
    assert r.status_code == 404
    assert r.json()["detail"] == "Job not found"


@pytest.mark.integration
def test_delete_endpoint_marks_processing_job_cancelled(client: TestClient) -> None:
    create_job(Job(id="active-job", status="processing", cancelled=False))
    r = client.delete("/jobs/active-job")
    assert r.status_code == 200
    body = r.json()
    assert body["cancelled"] is True
    assert get_job("active-job").cancelled is True  # type: ignore[union-attr]


@pytest.mark.integration
def test_delete_endpoint_idempotent_on_done_job(client: TestClient) -> None:
    create_job(Job(id="done-job", status="done", cancelled=False))
    r = client.delete("/jobs/done-job")
    assert r.status_code == 200
    body = r.json()
    assert body["cancelled"] is False  # already terminal — no-op
    # Should NOT flip cancelled retroactively
    assert get_job("done-job").cancelled is False  # type: ignore[union-attr]


@pytest.mark.integration
def test_delete_endpoint_idempotent_on_error_job(client: TestClient) -> None:
    create_job(Job(id="error-job", status="error", cancelled=False, error="boom"))
    r = client.delete("/jobs/error-job")
    assert r.status_code == 200
    assert r.json()["cancelled"] is False


# ----- Worker cancel observation tests -----


@pytest.mark.unit
def test_worker_observes_cancel_before_section_detection(
    synthetic_30s_wav: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """If cancelled=True before _run_deep_analysis runs, it exits via error."""
    import numpy as np

    create_job(Job(id="cancel-pre", cancelled=True, input_path=str(synthetic_30s_wav)))

    fake_samples = np.zeros(48_000 * 2, dtype=np.float32)
    # Mock load to return a valid tuple; spy on detect_sections so we can
    # assert it's never reached.
    with patch.object(deep_analysis, "_load_mono_for_analysis", return_value=(fake_samples, 48_000)), \
         patch.object(deep_analysis, "detect_sections") as mock_detect:
        deep_analysis._run_deep_analysis("cancel-pre", str(synthetic_30s_wav), "modern_pop_polish")
        mock_detect.assert_not_called()

    job = get_job("cancel-pre")
    assert job is not None
    assert job.status == "error"
    assert job.error == "Cancelled by user"


@pytest.mark.unit
def test_worker_observes_cancel_between_sections_and_stems(
    synthetic_30s_wav: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Cancel that fires after section detection completes is honored before stems start."""
    create_job(Job(id="cancel-mid", cancelled=False, input_path=str(synthetic_30s_wav)))

    section_called = {"count": 0}
    stems_called = {"count": 0}

    def fake_detect(samples, sr):
        section_called["count"] += 1
        # Simulate the user pressing Cancel right after sections finishes
        update_job("cancel-mid", cancelled=True)
        return ([{"id": "s1", "type": "intro", "startSec": 0.0, "endSec": 5.0}], 0.9)

    def fake_enrich(samples, sr, sections):
        return sections

    def fake_stems(input_path):
        stems_called["count"] += 1
        return []

    with patch.object(deep_analysis, "detect_sections", side_effect=fake_detect), \
         patch.object(deep_analysis, "enrich_with_loudness_and_centroid", side_effect=fake_enrich), \
         patch.object(deep_analysis, "run_stem_artifact_analysis", side_effect=fake_stems):
        deep_analysis._run_deep_analysis("cancel-mid", str(synthetic_30s_wav), "modern_pop_polish")

    job = get_job("cancel-mid")
    assert job is not None
    assert section_called["count"] == 1
    assert stems_called["count"] == 0  # stems phase skipped
    assert job.status == "error"
    assert job.error == "Cancelled by user"


# ----- CORS expose_headers test -----


@pytest.mark.integration
def test_cors_exposes_traceparent_header(client: TestClient) -> None:
    """The response to a cross-origin request must expose 'traceparent' so JS can read it."""
    r = client.get(
        "/health",
        headers={"Origin": "https://aurialis.yosefgamble.com"},
    )
    assert r.status_code == 200
    expose = r.headers.get("access-control-expose-headers", "")
    # Header may be a comma-separated list; we want traceparent to appear
    assert "traceparent" in expose.lower()
