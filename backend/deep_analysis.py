"""
Deep analysis — section detection, per-section LUFS + spectral centroid,
and (in T3) per-stem AI-artifact analysis. Composed via start_deep_analysis()
which runs in a background thread and writes `partial_result` fields on the
Job as each phase completes (sections → stems → script).

Heavy ML imports (madmom, librosa) are lazy so the module can be loaded in
test environments that mock the analysis functions directly.
"""

from __future__ import annotations

import time
import uuid
import threading
from typing import Any

import numpy as np
import soundfile as sf
from opentelemetry import trace

from jobs import Job, create_job, is_cancelled, update_job
from observability import (
    get_logger,
    get_tracer,
    log_phase,
    run_in_span_context,
)

# Length below which a section is considered "too short" for LUFS measurement.
_LUFS_MIN_SEC = 0.4
# Confidence threshold below which we fall back to a fixed grid.
_MADMOM_CONFIDENCE_FLOOR = 0.5


def start_deep_analysis(input_path: str, profile: str) -> Job:
    """Start a deep-analysis job in a background thread. Returns the job immediately."""
    job_id = str(uuid.uuid4())
    job = Job(
        id=job_id,
        status="queued",
        progress=0,
        model=profile,  # repurpose `model` for profile id (avoids schema migration)
        input_path=input_path,
        job_type="deep_analysis",
    )
    create_job(job)
    get_logger().info(
        "job created", extra={"job_id": job_id, "phase": "queued", "profile": profile}
    )

    # Capture the active request span so the worker thread can attach to its
    # context (true parent-child trace tree). See observability.run_in_span_context.
    captured_span = trace.get_current_span()

    thread = threading.Thread(
        target=lambda: run_in_span_context(
            captured_span,
            lambda: _run_deep_analysis(job_id, input_path, profile),
        ),
        daemon=True,
    )
    thread.start()
    return job


def _run_deep_analysis(job_id: str, input_path: str, profile: str) -> None:
    """Background worker — section detection (T2) + per-stem AI-artifact analysis (T3).

    Cancellation: checked at three phase boundaries (after audio load, after
    section detection, after stem analysis). When `is_cancelled(job_id)` returns
    True the worker exits via status='error', error='Cancelled by user'.
    """
    tracer = get_tracer()
    try:
        update_job(job_id, status="processing", progress=5)

        # Phase 1: load audio
        load_start = time.time()
        get_logger().info(
            "phase start", extra={"job_id": job_id, "phase": "load"}
        )
        with tracer.start_as_current_span("deep_analysis.load") as span:
            span.set_attribute("job_id", job_id)
            span.set_attribute("phase", "load")
            samples, sr = _load_mono_for_analysis(input_path)
            span.set_attribute("audio.sample_rate", sr)
            span.set_attribute("audio.duration_sec", samples.shape[0] / sr)
        update_job(job_id, progress=15)
        log_phase("load", job_id, load_start)

        # Phase boundary: cancel before section detection
        if is_cancelled(job_id):
            update_job(job_id, status="error", error="Cancelled by user")
            log_phase("cancel-observed", job_id, load_start, error="cancelled")
            return

        # Phase 2a: section detection
        sections_start = time.time()
        get_logger().info(
            "phase start", extra={"job_id": job_id, "phase": "sections"}
        )
        with tracer.start_as_current_span("deep_analysis.sections") as span:
            span.set_attribute("job_id", job_id)
            span.set_attribute("phase", "sections")
            span.set_attribute("profile", profile)
            sections, _confidence = detect_sections(samples, sr)
            span.set_attribute("sections.count", len(sections))

        # Phase 2b: per-section LUFS + spectral centroid enrichment.
        # Kept as its own span so Truth #5 (≥ 5 spans per run) holds and so
        # operators can see how much time enrichment costs vs detection.
        enrich_start = time.time()
        get_logger().info(
            "phase start", extra={"job_id": job_id, "phase": "enrich"}
        )
        with tracer.start_as_current_span("deep_analysis.enrich") as span:
            span.set_attribute("job_id", job_id)
            span.set_attribute("phase", "enrich")
            sections = enrich_with_loudness_and_centroid(samples, sr, sections)
        partial: dict = {"sections": [_section_to_dict(s) for s in sections]}
        update_job(job_id, progress=40, partial_result=partial)
        log_phase("sections", job_id, sections_start)
        log_phase("enrich", job_id, enrich_start)

        # Phase boundary: cancel before stem analysis (longest phase)
        if is_cancelled(job_id):
            update_job(job_id, status="error", error="Cancelled by user")
            log_phase("cancel-observed", job_id, sections_start, error="cancelled")
            return

        # Phase 3: per-stem AI-artifact analysis. Skipped silently if Demucs
        # is unavailable (e.g. CPU-only test container).
        stems_start = time.time()
        get_logger().info(
            "phase start", extra={"job_id": job_id, "phase": "stems"}
        )
        with tracer.start_as_current_span("deep_analysis.stems") as span:
            span.set_attribute("job_id", job_id)
            span.set_attribute("phase", "stems")
            try:
                stem_reports = run_stem_artifact_analysis(input_path)
                partial = {**partial, "stems": stem_reports}
                span.set_attribute("stems.count", len(stem_reports))
            except (ImportError, RuntimeError) as stem_err:
                partial = {**partial, "stems": [], "stems_error": str(stem_err)}
                span.set_attribute("stems.error", str(stem_err))
        update_job(job_id, progress=80, partial_result=partial)
        log_phase("stems", job_id, stems_start)

        # Phase boundary: cancel before script generation (T5)
        if is_cancelled(job_id):
            update_job(job_id, status="error", error="Cancelled by user")
            log_phase("cancel-observed", job_id, stems_start, error="cancelled")
            return

        # T5 will fill `script` here. For now mark done with the partial result.
        update_job(job_id, status="done", progress=100)
        log_phase("done", job_id, load_start)

    except Exception as e:  # noqa: BLE001 — surface error verbatim to client
        update_job(job_id, status="error", error=str(e))
        get_logger().error(
            "deep analysis failed",
            extra={"job_id": job_id, "phase": "fatal", "error": str(e)},
            exc_info=True,
        )


def run_stem_artifact_analysis(input_path: str) -> list[dict]:
    """Run Demucs separation, then per-stem AI-artifact analysis. Returns reports."""
    from stem_artifacts import analyze_stem_artifacts

    stems = _separate_stems(input_path)
    reports: list[dict] = []
    for stem_name, stem_samples, stem_sr in stems:
        reports.append(analyze_stem_artifacts(stem_name, stem_samples, stem_sr))
    return reports


def _separate_stems(input_path: str) -> list[tuple[str, np.ndarray, int]]:
    """Run Demucs and return (name, stereo_samples, sr) per source. Lazy-imports torch."""
    try:
        import torch  # type: ignore[import-untyped]
        import torchaudio  # type: ignore[import-untyped]
        from demucs.pretrained import get_model  # type: ignore[import-untyped]
        from demucs.apply import apply_model  # type: ignore[import-untyped]
    except ImportError as e:
        raise ImportError(f"Demucs/torch not available: {e}") from e

    model = get_model("htdemucs")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    data, sr = sf.read(input_path, dtype="float32", always_2d=True)
    wav = torch.from_numpy(data.T).float()
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    if sr != model.samplerate:
        wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)
        sr = int(model.samplerate)
    wav = wav.unsqueeze(0).to(device)

    with torch.no_grad():
        sources = apply_model(model, wav, device=device)

    sources = sources.squeeze(0).cpu().numpy()  # (n_sources, channels, samples)
    stem_names = ["drums", "bass", "other", "vocals"]
    out: list[tuple[str, np.ndarray, int]] = []
    for i, name in enumerate(stem_names):
        if i >= sources.shape[0]:
            break
        # (channels, samples) → (samples, channels)
        stereo = sources[i].T.astype(np.float32, copy=False)
        out.append((name, stereo, sr))
    return out


def _load_mono_for_analysis(path: str) -> tuple[np.ndarray, int]:
    """Load audio as mono float32 for analysis (downmix preserves loudness math via mean)."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    return mono.astype(np.float32, copy=False), int(sr)


# -------------------------- Section detection --------------------------


def detect_sections(samples: np.ndarray, sr: int) -> tuple[list[dict[str, Any]], float]:
    """
    Detect musical sections.
    Returns (sections, confidence). Each section dict has: id, type, startSec, endSec.
    Caller fills loudnessLufs + spectralCentroidHz via enrich_with_loudness_and_centroid().

    Strategy: try madmom downbeat tracking + librosa segmentation; on madmom
    confidence < 0.5 (or import failure), fall back to fixed 8-bar grids
    derived from beat tracking, or last-resort fixed time grid.
    """
    confidence = 0.0
    boundaries: list[float] | None = None

    try:
        boundaries, confidence = _madmom_segment(samples, sr)
    except (ImportError, RuntimeError, ValueError):
        boundaries = None

    if boundaries is None or confidence < _MADMOM_CONFIDENCE_FLOOR:
        boundaries = _fallback_segment(samples, sr)
        confidence = max(confidence, 0.0)  # keep the floor honest

    duration = float(samples.shape[0]) / float(sr)
    if not boundaries or boundaries[0] > 0:
        boundaries = [0.0, *(boundaries or [])]
    if boundaries[-1] < duration:
        boundaries.append(duration)

    sections: list[dict[str, Any]] = []
    section_types = _label_sections(len(boundaries) - 1)
    for i in range(len(boundaries) - 1):
        sections.append(
            {
                "id": f"sec-{i + 1}",
                "type": section_types[i],
                "startSec": float(boundaries[i]),
                "endSec": float(boundaries[i + 1]),
            }
        )
    return sections, confidence


def _madmom_segment(samples: np.ndarray, sr: int) -> tuple[list[float], float]:
    """Run madmom downbeat tracking + simple boundary derivation. Raises on failure."""
    from madmom.features.downbeats import (  # type: ignore[import-untyped]
        DBNDownBeatTrackingProcessor,
        RNNDownBeatProcessor,
    )

    rnn = RNNDownBeatProcessor()
    activations = rnn(samples)
    dbn = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)
    beats_with_pos = dbn(activations)
    if beats_with_pos.size == 0:
        raise RuntimeError("madmom returned no beats")

    # Downbeats are rows where position == 1
    downbeat_times = [float(t) for t, pos in beats_with_pos if int(pos) == 1]
    if len(downbeat_times) < 2:
        raise RuntimeError("madmom: too few downbeats")

    # Boundaries every 8 bars (≈ verse / chorus length grid).
    # Confidence from mean RNN activation gives a rough quality signal.
    boundaries = downbeat_times[::8]
    confidence = float(np.mean(activations) * 4)  # scale 0..1-ish
    confidence = max(0.0, min(1.0, confidence))
    return boundaries, confidence


def _fallback_segment(samples: np.ndarray, sr: int) -> list[float]:
    """Fixed-grid fallback: divide the track into ~8 equal segments (min 4 sec each)."""
    duration = float(samples.shape[0]) / float(sr)
    if duration <= 4.0:
        return [0.0, duration]
    n_segments = max(2, min(8, int(duration // 8) + 1))
    step = duration / n_segments
    return [i * step for i in range(n_segments + 1)]


def _label_sections(n: int) -> list[str]:
    """Heuristic section labeling for v1 — verse/chorus alternation with intro/outro caps."""
    if n <= 1:
        return ["unknown"] * max(n, 1)
    labels: list[str] = []
    for i in range(n):
        if i == 0:
            labels.append("intro")
        elif i == n - 1:
            labels.append("outro")
        elif i % 2 == 1:
            labels.append("verse")
        else:
            labels.append("chorus")
    return labels


# -------------------------- Enrichment --------------------------


def enrich_with_loudness_and_centroid(
    samples: np.ndarray, sr: int, sections: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fill loudnessLufs + spectralCentroidHz on each section. Mutates and returns."""
    for s in sections:
        start = int(s["startSec"] * sr)
        end = int(s["endSec"] * sr)
        seg = samples[start:end]
        s["loudnessLufs"] = _section_lufs(seg, sr)
        s["spectralCentroidHz"] = _section_centroid(seg, sr)
    return sections


def _section_lufs(seg: np.ndarray, sr: int) -> float:
    """Integrated LUFS over a section. Returns -70 for sections too short to measure."""
    if seg.shape[0] < int(sr * _LUFS_MIN_SEC):
        return -70.0
    try:
        import pyloudnorm as pyln  # type: ignore[import-untyped]

        meter = pyln.Meter(sr)
        return float(meter.integrated_loudness(seg))
    except (ImportError, ValueError):
        # Fallback: rough RMS → dBFS → LUFS-ish (no K-weighting). Acceptable for
        # environments without pyloudnorm; T2 tests substitute or skip.
        rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2)))
        if rms <= 0:
            return -70.0
        return 20.0 * float(np.log10(rms)) - 0.691  # K-weight offset placeholder


def _section_centroid(seg: np.ndarray, sr: int) -> float:
    """Spectral centroid in Hz, averaged over the section."""
    if seg.shape[0] < 1024:
        return 0.0
    try:
        import librosa  # type: ignore[import-untyped]

        cent = librosa.feature.spectral_centroid(y=seg, sr=sr)
        return float(np.mean(cent))
    except ImportError:
        # FFT-based fallback
        return _centroid_fft(seg, sr)


def _centroid_fft(seg: np.ndarray, sr: int) -> float:
    """Plain numpy FFT centroid — used when librosa is unavailable."""
    frame_size = 2048
    if seg.shape[0] < frame_size:
        return 0.0
    n_frames = seg.shape[0] // frame_size
    total_w = 0.0
    total_m = 0.0
    for i in range(n_frames):
        frame = seg[i * frame_size : (i + 1) * frame_size]
        spec = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(frame_size, 1.0 / sr)
        total_w += float(np.sum(freqs * spec))
        total_m += float(np.sum(spec))
    return total_w / total_m if total_m > 0 else 0.0


# -------------------------- Serialization --------------------------


def _section_to_dict(s: dict[str, Any]) -> dict[str, Any]:
    """Project a section dict to its public schema shape (defensive copy)."""
    return {
        "id": str(s["id"]),
        "type": str(s["type"]),
        "startSec": float(s["startSec"]),
        "endSec": float(s["endSec"]),
        "loudnessLufs": float(s.get("loudnessLufs", -70.0)),
        "spectralCentroidHz": float(s.get("spectralCentroidHz", 0.0)),
    }
