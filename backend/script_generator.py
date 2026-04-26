"""
Script generator (T5).

Given Section[] + optional StemAnalysisReport[] + a profile id, emit a
MasteringScript that conforms to the JSON Schema. Each move covers the full
duration; at section boundaries the envelope ramps over a 200ms crossfade.

Caps envelope point density at ~20 pts/sec (well under the 100/sec hard cap
in the type/schema validators), giving headroom for future curve enrichment.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PROFILES_DIR = Path(__file__).resolve().parent / "profiles"
CROSSFADE_SEC = 0.2

# v1 profile IDs — matches src/types/deep-mastering.ts.
PROFILE_IDS = (
    "modern_pop_polish",
    "hip_hop_low_end",
    "indie_warmth",
    "metal_wall",
    "pop_punk_air",
)

_SECTION_TYPES = {
    "intro",
    "verse",
    "chorus",
    "bridge",
    "drop",
    "breakdown",
    "outro",
    "unknown",
}


# -------------------------- Profile loading --------------------------


def load_profile(profile_id: str) -> dict[str, Any]:
    """Load a profile JSON. Raises FileNotFoundError if unknown."""
    if profile_id not in PROFILE_IDS:
        raise ValueError(f"Unknown profile_id: {profile_id}. Known: {PROFILE_IDS}")
    path = PROFILES_DIR / f"{profile_id}.json"
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_all_profiles() -> dict[str, dict[str, Any]]:
    return {pid: load_profile(pid) for pid in PROFILE_IDS}


# -------------------------- Helpers --------------------------


def _validate_section(s: dict[str, Any]) -> None:
    if s.get("type") not in _SECTION_TYPES:
        raise ValueError(f"Section {s.get('id')} has invalid type: {s.get('type')}")
    if not (s.get("endSec", 0) > s.get("startSec", -1)):
        raise ValueError(f"Section {s.get('id')} has non-positive span")


def _section_target(profile: dict[str, Any], section_type: str) -> dict[str, Any]:
    """Look up the per-section-type target dict, falling back to 'unknown'."""
    by_type = profile["bySectionType"]
    return by_type.get(section_type, by_type["unknown"])


def _envelope_for_param(
    sections: list[dict[str, Any]],
    duration: float,
    value_for_section: list[float],
) -> list[list[float]]:
    """
    Build a piecewise-linear envelope that holds value_for_section[i] across
    section i, with a CROSSFADE_SEC ramp centered on each boundary.
    """
    if len(sections) != len(value_for_section):
        raise ValueError("sections and value_for_section must align")
    half = CROSSFADE_SEC / 2.0
    points: list[list[float]] = [[0.0, float(value_for_section[0])]]

    for i in range(len(sections) - 1):
        boundary = float(sections[i]["endSec"])
        left_end = max(0.0, boundary - half)
        right_start = min(duration, boundary + half)
        v_prev = float(value_for_section[i])
        v_next = float(value_for_section[i + 1])

        # Ensure the prior point time < left_end
        last_t = points[-1][0]
        if left_end <= last_t:
            left_end = last_t + 1e-3
        if right_start <= left_end:
            right_start = left_end + 1e-3

        points.append([left_end, v_prev])
        points.append([right_start, v_next])

    last_v = float(value_for_section[-1])
    last_t = points[-1][0]
    end_t = max(duration, last_t + 1e-3)
    if end_t > last_t:
        points.append([end_t, last_v])
    return points


def _make_move(
    move_id: str,
    param: str,
    sections: list[dict[str, Any]],
    duration: float,
    values: list[float],
    reason: str,
) -> dict[str, Any]:
    envelope = _envelope_for_param(sections, duration, values)
    return {
        "id": move_id,
        "param": param,
        "startSec": 0.0,
        "endSec": duration,
        "envelope": envelope,
        "reason": reason,
        "original": float(values[0]),
        "edited": False,
        "muted": False,
    }


# -------------------------- Main entry --------------------------


def generate_script(
    *,
    track_id: str,
    sample_rate: int,
    duration: float,
    sections: list[dict[str, Any]],
    profile_id: str,
    stem_reports: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Emit a MasteringScript dict ready for JSON serialization. Validates the
    inputs minimally; full schema validation is the caller's responsibility
    (e.g. via `jsonschema` against `mastering_script.schema.json`).
    """
    if not sections:
        raise ValueError("at least one section required")
    for s in sections:
        _validate_section(s)
    profile = load_profile(profile_id)

    # Build per-section value arrays for each automated parameter.
    targets = [_section_target(profile, s["type"]) for s in sections]

    eq_low = [t["toneOffsetsDb"]["low"] for t in targets]
    eq_mid = [t["toneOffsetsDb"]["mid"] for t in targets]
    eq_high = [t["toneOffsetsDb"]["high"] for t in targets]
    comp_thresh = [-22.0 + t["compressionDelta"]["threshold"] for t in targets]
    comp_makeup = [0.0 + t["compressionDelta"]["makeup"] for t in targets]
    sat_drive = [float(t["saturationDrive"]) for t in targets]
    stereo_width = [float(t["stereoWidth"]) for t in targets]
    input_gain = [float(t["loudnessLufsDelta"]) for t in targets]

    moves: list[dict[str, Any]] = [
        _make_move(
            "mv-input-gain",
            "master.inputGain",
            sections,
            duration,
            input_gain,
            f"Per-section makeup gain shaped by '{profile['name']}'",
        ),
        _make_move(
            "mv-eq-low",
            "master.eq.band1.gain",
            sections,
            duration,
            eq_low,
            "Low-end tonal balance per section",
        ),
        _make_move(
            "mv-eq-mid",
            "master.eq.band3.gain",
            sections,
            duration,
            eq_mid,
            "Mid balance per section",
        ),
        _make_move(
            "mv-eq-high",
            "master.eq.band5.gain",
            sections,
            duration,
            eq_high,
            "High-frequency air per section",
        ),
        _make_move(
            "mv-comp-threshold",
            "master.compressor.threshold",
            sections,
            duration,
            comp_thresh,
            "Compressor threshold per section",
        ),
        _make_move(
            "mv-comp-makeup",
            "master.compressor.makeup",
            sections,
            duration,
            comp_makeup,
            "Compressor makeup gain per section",
        ),
        _make_move(
            "mv-saturation",
            "master.saturation.drive",
            sections,
            duration,
            sat_drive,
            "Saturation drive per section",
        ),
        _make_move(
            "mv-stereo-width",
            "master.stereoWidth.width",
            sections,
            duration,
            stereo_width,
            "Stereo width per section",
        ),
    ]

    # AI Repair: only emit when at least one stem fits the recipe gate.
    repair_moves = _build_ai_repair_moves(
        profile=profile,
        stem_reports=stem_reports or [],
        sections=sections,
        duration=duration,
    )
    moves.extend(repair_moves)

    script: dict[str, Any] = {
        "version": 1,
        "trackId": track_id,
        "sampleRate": int(sample_rate),
        "duration": float(duration),
        "profile": profile_id,
        "sections": sections,
        "moves": moves,
    }
    if stem_reports:
        script["stemAnalysis"] = stem_reports
    return script


def _build_ai_repair_moves(
    *,
    profile: dict[str, Any],
    stem_reports: list[dict[str, Any]],
    sections: list[dict[str, Any]],
    duration: float,
) -> list[dict[str, Any]]:
    """Emit AI-Repair moves for stems that pass the recipe's gate."""
    recipe = profile.get("aiRepairRecipe", {})
    threshold = float(recipe.get("minNarrownessScore", 0.85))
    default_amount = float(recipe.get("defaultAmount", 0.0))

    flagged = [
        r
        for r in stem_reports
        if r.get("classification") == "guitar"
        and float(r.get("confidence", 0.0)) > 0.7
        and float(r.get("narrownessScore", 0.0)) >= threshold
    ]
    if not flagged or default_amount <= 0.0:
        return []

    # Single AI-Repair move covering the full duration (per-section curves are
    # a v2 enrichment). Use default_amount across all sections except sections
    # of type 'breakdown' / 'outro' where we taper to half.
    values = [
        default_amount * (0.5 if s["type"] in {"breakdown", "outro"} else 1.0)
        for s in sections
    ]
    return [
        _make_move(
            "mv-ai-repair",
            "master.aiRepair.amount",
            sections,
            duration,
            values,
            f"AI-Repair targeting {len(flagged)} narrow stem(s); recipe minNarrownessScore={threshold}",
        )
    ]
