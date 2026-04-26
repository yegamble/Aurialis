"""Tests for backend deep_analysis module (T2 — section detection)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

import deep_analysis
from deep_analysis import (
    detect_sections,
    enrich_with_loudness_and_centroid,
    _label_sections,
    _fallback_segment,
    _section_to_dict,
    _load_mono_for_analysis,
)


@pytest.mark.unit
def test_load_mono_for_analysis_downmixes_stereo(synthetic_30s_wav: Path, sample_rate: int) -> None:
    samples, sr = _load_mono_for_analysis(str(synthetic_30s_wav))
    assert sr == sample_rate
    assert samples.ndim == 1
    assert samples.dtype == np.float32
    # 30 seconds @ 48k
    assert samples.shape[0] == sr * 30


@pytest.mark.unit
def test_label_sections_caps_intro_and_outro() -> None:
    assert _label_sections(1) == ["unknown"]
    assert _label_sections(3) == ["intro", "verse", "outro"]
    labels5 = _label_sections(5)
    assert labels5[0] == "intro"
    assert labels5[-1] == "outro"
    # Middle alternates verse/chorus
    assert all(label in {"verse", "chorus"} for label in labels5[1:-1])


@pytest.mark.unit
def test_fallback_segment_returns_at_least_two_boundaries(sample_rate: int) -> None:
    # 30s of zeros
    samples = np.zeros(sample_rate * 30, dtype=np.float32)
    boundaries = _fallback_segment(samples, sample_rate)
    assert len(boundaries) >= 2
    assert boundaries[0] == 0.0
    assert boundaries[-1] == pytest.approx(30.0, rel=1e-3)


@pytest.mark.unit
def test_fallback_segment_handles_short_audio(sample_rate: int) -> None:
    samples = np.zeros(sample_rate * 2, dtype=np.float32)
    boundaries = _fallback_segment(samples, sample_rate)
    assert boundaries == [0.0, 2.0]


@pytest.mark.unit
def test_detect_sections_falls_back_when_madmom_missing(synthetic_30s_wav: Path, sample_rate: int) -> None:
    samples, sr = _load_mono_for_analysis(str(synthetic_30s_wav))

    # Simulate madmom unavailable by having _madmom_segment raise ImportError.
    with patch.object(deep_analysis, "_madmom_segment", side_effect=ImportError):
        sections, confidence = detect_sections(samples, sr)

    assert confidence == 0.0
    assert len(sections) >= 2
    assert sections[0]["startSec"] == 0.0
    assert sections[-1]["endSec"] == pytest.approx(30.0, rel=1e-3)
    # IDs are unique
    assert len({s["id"] for s in sections}) == len(sections)
    # Types are from the closed enum
    valid_types = {"intro", "verse", "chorus", "bridge", "drop", "breakdown", "outro", "unknown"}
    for s in sections:
        assert s["type"] in valid_types


@pytest.mark.unit
def test_detect_sections_uses_madmom_when_confidence_high(sample_rate: int) -> None:
    samples = np.zeros(sample_rate * 30, dtype=np.float32)
    high_conf = (
        [0.0, 8.0, 16.0, 24.0],  # boundaries
        0.9,                      # confidence
    )
    with patch.object(deep_analysis, "_madmom_segment", return_value=high_conf):
        sections, confidence = detect_sections(samples, sample_rate)
    assert confidence == 0.9
    assert len(sections) >= 3


@pytest.mark.unit
def test_detect_sections_falls_back_when_confidence_low(sample_rate: int) -> None:
    samples = np.zeros(sample_rate * 30, dtype=np.float32)
    low_conf = ([0.0, 15.0], 0.2)  # below the 0.5 floor
    with patch.object(deep_analysis, "_madmom_segment", return_value=low_conf):
        sections, _ = detect_sections(samples, sample_rate)
    # Fallback grid should produce more than 2 boundaries (so >1 section)
    assert len(sections) >= 2


@pytest.mark.unit
def test_enrich_loudness_and_centroid_fills_required_fields(synthetic_30s_wav: Path) -> None:
    samples, sr = _load_mono_for_analysis(str(synthetic_30s_wav))
    sections = [
        {"id": "sec-1", "type": "intro", "startSec": 0.0, "endSec": 10.0},
        {"id": "sec-2", "type": "verse", "startSec": 10.0, "endSec": 20.0},
        {"id": "sec-3", "type": "chorus", "startSec": 20.0, "endSec": 30.0},
    ]
    enriched = enrich_with_loudness_and_centroid(samples, sr, sections)
    for s in enriched:
        assert "loudnessLufs" in s
        assert "spectralCentroidHz" in s
        assert isinstance(s["loudnessLufs"], float)
        assert isinstance(s["spectralCentroidHz"], float)
    # Section A (low-energy 220 Hz) should have a lower centroid than section C (noise + 880 Hz).
    assert enriched[0]["spectralCentroidHz"] < enriched[2]["spectralCentroidHz"]


@pytest.mark.unit
def test_section_to_dict_projects_to_schema_shape() -> None:
    raw = {
        "id": "sec-1",
        "type": "verse",
        "startSec": 0,
        "endSec": 10,
        "loudnessLufs": -14.5,
        "spectralCentroidHz": 1500.0,
    }
    out = _section_to_dict(raw)
    assert set(out.keys()) == {"id", "type", "startSec", "endSec", "loudnessLufs", "spectralCentroidHz"}
    assert isinstance(out["startSec"], float)
    assert isinstance(out["endSec"], float)


@pytest.mark.integration
def test_run_deep_analysis_writes_partial_result_sections(
    synthetic_30s_wav: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """End-to-end: starting a deep-analysis job populates partial_result.sections."""
    import jobs

    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(
        deep_analysis,
        "_madmom_segment",
        lambda *_a, **_k: (_ for _ in ()).throw(ImportError()),
    )
    # Force the stem branch to fail (Demucs not in test env) so we still see
    # sections-only fallback under partial_result.stems_error.
    monkeypatch.setattr(
        deep_analysis,
        "run_stem_artifact_analysis",
        lambda *_a, **_k: (_ for _ in ()).throw(ImportError("demucs not installed in test env")),
    )

    import uuid as uuid_mod
    fixed_id = "test-job-" + uuid_mod.uuid4().hex[:8]
    jobs.create_job(
        jobs.Job(
            id=fixed_id,
            status="queued",
            progress=0,
            model="modern_pop_polish",
            input_path=str(synthetic_30s_wav),
            job_type="deep_analysis",
        )
    )
    deep_analysis._run_deep_analysis(fixed_id, str(synthetic_30s_wav), "modern_pop_polish")

    job = jobs.get_job(fixed_id)
    assert job is not None
    assert job.status == "done"
    assert "sections" in job.partial_result
    assert len(job.partial_result["sections"]) >= 2
    for s in job.partial_result["sections"]:
        assert {"id", "type", "startSec", "endSec", "loudnessLufs", "spectralCentroidHz"} <= s.keys()
    # Stem branch failed gracefully and recorded the error
    assert job.partial_result.get("stems") == []
    assert "stems_error" in job.partial_result


@pytest.mark.integration
def test_run_deep_analysis_includes_stem_reports_when_demucs_succeeds(
    synthetic_30s_wav: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When Demucs returns stems, partial_result.stems contains StemAnalysisReport[]."""
    import jobs

    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")
    monkeypatch.setattr(
        deep_analysis,
        "_madmom_segment",
        lambda *_a, **_k: (_ for _ in ()).throw(ImportError()),
    )

    fake_reports = [
        {
            "stemId": "guitar",
            "classification": "guitar",
            "confidence": 0.9,
            "narrownessScore": 0.92,
            "spectralCollapseScore": 0.7,
            "bandCorrelations": [0.6, 0.92, 0.94, 0.88, 0.75],
        }
    ]
    monkeypatch.setattr(
        deep_analysis, "run_stem_artifact_analysis", lambda *_a, **_k: fake_reports
    )

    fixed_id = "test-job-with-stems"
    jobs.create_job(
        jobs.Job(
            id=fixed_id,
            status="queued",
            progress=0,
            model="metal_wall",
            input_path=str(synthetic_30s_wav),
            job_type="deep_analysis",
        )
    )
    deep_analysis._run_deep_analysis(fixed_id, str(synthetic_30s_wav), "metal_wall")

    job = jobs.get_job(fixed_id)
    assert job is not None
    assert job.status == "done"
    assert job.partial_result["stems"] == fake_reports
    # Required schema fields present on every stem report
    for r in job.partial_result["stems"]:
        assert {
            "stemId",
            "classification",
            "confidence",
            "narrownessScore",
            "spectralCollapseScore",
            "bandCorrelations",
        } <= r.keys()
