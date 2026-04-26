"""Tests for the script generator (T5)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from script_generator import (
    PROFILE_IDS,
    PROFILES_DIR,
    generate_script,
    load_all_profiles,
    load_profile,
)

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "mastering_script.schema.json"


def _load_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text())


def _basic_sections() -> list[dict[str, Any]]:
    return [
        {"id": "s1", "type": "intro", "startSec": 0.0, "endSec": 8.0,
         "loudnessLufs": -16.0, "spectralCentroidHz": 1200.0},
        {"id": "s2", "type": "verse", "startSec": 8.0, "endSec": 18.0,
         "loudnessLufs": -14.5, "spectralCentroidHz": 1450.0},
        {"id": "s3", "type": "chorus", "startSec": 18.0, "endSec": 30.0,
         "loudnessLufs": -12.0, "spectralCentroidHz": 1800.0},
    ]


def _wide_guitar_report() -> dict[str, Any]:
    return {
        "stemId": "guitar",
        "classification": "guitar",
        "confidence": 0.9,
        "narrownessScore": 0.30,        # well below any profile's threshold
        "spectralCollapseScore": 0.20,
        "bandCorrelations": [0.2, 0.25, 0.30, 0.28, 0.22],
    }


def _narrow_guitar_report() -> dict[str, Any]:
    return {
        "stemId": "guitar",
        "classification": "guitar",
        "confidence": 0.9,
        "narrownessScore": 0.95,        # above all profile thresholds
        "spectralCollapseScore": 0.80,
        "bandCorrelations": [0.6, 0.92, 0.94, 0.88, 0.75],
    }


# ---------- Profile loading ----------


@pytest.mark.unit
def test_all_5_profiles_load() -> None:
    profiles = load_all_profiles()
    assert set(profiles.keys()) == set(PROFILE_IDS)
    for pid, p in profiles.items():
        assert p["id"] == pid
        assert "name" in p and "description" in p
        assert set(p["bySectionType"].keys()) == {
            "intro", "verse", "chorus", "bridge", "drop", "breakdown", "outro", "unknown"
        }
        for st, target in p["bySectionType"].items():
            assert "loudnessLufsDelta" in target
            assert {"low", "mid", "high"} <= target["toneOffsetsDb"].keys()
            assert {"threshold", "makeup"} <= target["compressionDelta"].keys()
            assert "stereoWidth" in target and "saturationDrive" in target


@pytest.mark.unit
def test_load_profile_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Unknown profile_id"):
        load_profile("not-a-real-profile")


@pytest.mark.unit
def test_profiles_directory_path_exists() -> None:
    assert PROFILES_DIR.is_dir()
    for pid in PROFILE_IDS:
        assert (PROFILES_DIR / f"{pid}.json").is_file()


# ---------- generate_script: structural ----------


@pytest.mark.unit
def test_generate_script_validates_against_schema() -> None:
    jsonschema = pytest.importorskip("jsonschema")
    schema = _load_schema()
    for pid in PROFILE_IDS:
        script = generate_script(
            track_id="test-track",
            sample_rate=48_000,
            duration=30.0,
            sections=_basic_sections(),
            profile_id=pid,
        )
        jsonschema.validate(instance=script, schema=schema)


@pytest.mark.unit
def test_generate_script_emits_all_8_master_moves_when_no_stems() -> None:
    script = generate_script(
        track_id="t",
        sample_rate=48_000,
        duration=30.0,
        sections=_basic_sections(),
        profile_id="modern_pop_polish",
    )
    params = sorted(m["param"] for m in script["moves"])
    assert params == sorted([
        "master.inputGain",
        "master.eq.band1.gain",
        "master.eq.band3.gain",
        "master.eq.band5.gain",
        "master.compressor.threshold",
        "master.compressor.makeup",
        "master.saturation.drive",
        "master.stereoWidth.width",
    ])


@pytest.mark.unit
def test_generate_script_envelopes_monotonically_increasing() -> None:
    script = generate_script(
        track_id="t",
        sample_rate=48_000,
        duration=30.0,
        sections=_basic_sections(),
        profile_id="metal_wall",
    )
    for move in script["moves"]:
        env = move["envelope"]
        assert len(env) >= 2
        for i in range(1, len(env)):
            assert env[i][0] > env[i - 1][0], f"non-increasing envelope on {move['id']}"


@pytest.mark.unit
def test_generate_script_envelopes_within_density_cap() -> None:
    script = generate_script(
        track_id="t",
        sample_rate=48_000,
        duration=30.0,
        sections=_basic_sections(),
        profile_id="metal_wall",
    )
    for move in script["moves"]:
        env = move["envelope"]
        span = env[-1][0] - env[0][0]
        if span > 0:
            density = len(env) / span
            assert density <= 100.0, f"{move['id']}: density {density:.2f}/sec > 100"


@pytest.mark.unit
def test_generate_script_invalid_section_type_rejected() -> None:
    sections = _basic_sections()
    sections[0]["type"] = "not-a-real-type"
    with pytest.raises(ValueError, match="invalid type"):
        generate_script(
            track_id="t",
            sample_rate=48_000,
            duration=30.0,
            sections=sections,
            profile_id="modern_pop_polish",
        )


@pytest.mark.unit
def test_generate_script_empty_sections_rejected() -> None:
    with pytest.raises(ValueError, match="at least one section"):
        generate_script(
            track_id="t",
            sample_rate=48_000,
            duration=30.0,
            sections=[],
            profile_id="modern_pop_polish",
        )


# ---------- AI Repair gate (false-positive guard) ----------


@pytest.mark.unit
def test_wide_guitar_yields_zero_ai_repair_moves_for_all_profiles() -> None:
    """Truth-level guarantee: a wide-guitar reference never triggers AI Repair."""
    sections = _basic_sections()
    wide_report = _wide_guitar_report()
    for pid in PROFILE_IDS:
        script = generate_script(
            track_id="wide",
            sample_rate=48_000,
            duration=30.0,
            sections=sections,
            profile_id=pid,
            stem_reports=[wide_report],
        )
        ai_moves = [m for m in script["moves"] if m["param"] == "master.aiRepair.amount"]
        assert ai_moves == [], f"profile {pid} produced AI-Repair on wide guitar"


@pytest.mark.unit
def test_narrow_guitar_yields_at_least_one_ai_repair_move_for_all_profiles() -> None:
    sections = _basic_sections()
    narrow = _narrow_guitar_report()
    for pid in PROFILE_IDS:
        script = generate_script(
            track_id="narrow",
            sample_rate=48_000,
            duration=30.0,
            sections=sections,
            profile_id=pid,
            stem_reports=[narrow],
        )
        ai_moves = [m for m in script["moves"] if m["param"] == "master.aiRepair.amount"]
        assert len(ai_moves) >= 1, f"profile {pid} did not emit AI-Repair on narrow guitar"


@pytest.mark.unit
def test_ai_repair_only_for_guitar_classification() -> None:
    """A narrow VOCAL report should NOT trigger AI-Repair (gate is guitar-only)."""
    sections = _basic_sections()
    narrow_vocal = {**_narrow_guitar_report(), "stemId": "vocals", "classification": "vocals"}
    script = generate_script(
        track_id="t",
        sample_rate=48_000,
        duration=30.0,
        sections=sections,
        profile_id="metal_wall",
        stem_reports=[narrow_vocal],
    )
    ai_moves = [m for m in script["moves"] if m["param"] == "master.aiRepair.amount"]
    assert ai_moves == []


# ---------- Profile-difference guarantee (Truth 4) ----------


@pytest.mark.unit
def test_two_profiles_produce_meaningfully_different_scripts() -> None:
    """At least 3-of-4 move types differ in count or magnitude between any two profiles."""
    sections = _basic_sections()

    def _signature(script: dict[str, Any]) -> dict[str, tuple[int, float]]:
        out: dict[str, tuple[int, float]] = {}
        for m in script["moves"]:
            mag = sum(abs(v) for _, v in m["envelope"])
            out[m["param"]] = (len(m["envelope"]), mag)
        return out

    pop = generate_script(
        track_id="t", sample_rate=48_000, duration=30.0,
        sections=sections, profile_id="modern_pop_polish",
    )
    metal = generate_script(
        track_id="t", sample_rate=48_000, duration=30.0,
        sections=sections, profile_id="metal_wall",
    )
    sig_pop = _signature(pop)
    sig_metal = _signature(metal)
    diffs = sum(
        1
        for k in sig_pop.keys() & sig_metal.keys()
        if sig_pop[k] != sig_metal[k]
    )
    assert diffs >= 3, f"only {diffs} parameter types differ between profiles (need ≥3)"
