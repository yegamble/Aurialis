"""
Demucs separation wrapper — runs stem separation in a background thread.
Supports htdemucs (4 stems) and htdemucs_6s (6 stems).
"""

import os
import uuid
import threading
import tempfile
import torchaudio
import torch
from pathlib import Path

from jobs import Job, StemInfo, create_job, update_job

TEMP_DIR = Path("/tmp/smart-split")
VALID_MODELS = ("htdemucs", "htdemucs_6s")

# Stem names per model
MODEL_STEMS = {
    "htdemucs": ["drums", "bass", "other", "vocals"],
    "htdemucs_6s": ["drums", "bass", "other", "vocals", "guitar", "piano"],
}


def start_separation(input_path: str, model: str = "htdemucs") -> Job:
    """Start a separation job in a background thread. Returns the job immediately."""
    if model not in VALID_MODELS:
        raise ValueError(f"Invalid model: {model}. Must be one of {VALID_MODELS}")

    job_id = str(uuid.uuid4())
    output_dir = str(TEMP_DIR / job_id)
    os.makedirs(output_dir, exist_ok=True)

    job = Job(
        id=job_id,
        status="queued",
        progress=0,
        model=model,
        input_path=input_path,
        output_dir=output_dir,
    )
    create_job(job)

    thread = threading.Thread(
        target=_run_separation,
        args=(job_id, input_path, model, output_dir),
        daemon=True,
    )
    thread.start()

    return job


def _run_separation(
    job_id: str,
    input_path: str,
    model_name: str,
    output_dir: str,
) -> None:
    """Run Demucs separation (called in background thread)."""
    try:
        # 10% — loading file and model
        update_job(job_id, status="processing", progress=10)

        from demucs.pretrained import get_model
        from demucs.apply import apply_model

        model = get_model(model_name)
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device)

        # Load audio
        wav, sr = torchaudio.load(input_path)

        # Resample to model's sample rate if needed
        if sr != model.samplerate:
            wav = torchaudio.transforms.Resample(sr, model.samplerate)(wav)
            sr = model.samplerate

        # Add batch dimension: (channels, samples) → (1, channels, samples)
        wav = wav.unsqueeze(0).to(device)

        # 50% — running separation
        update_job(job_id, progress=50)

        with torch.no_grad():
            sources = apply_model(model, wav, device=device)

        # sources shape: (1, num_sources, channels, samples)
        sources = sources.squeeze(0).cpu()

        # 90% — writing stem files
        update_job(job_id, progress=90)

        stem_names = MODEL_STEMS.get(model_name, MODEL_STEMS["htdemucs"])
        stems = []

        for i, name in enumerate(stem_names):
            if i >= sources.shape[0]:
                break
            stem_path = os.path.join(output_dir, f"{name}.wav")
            torchaudio.save(stem_path, sources[i], sr)
            stems.append(StemInfo(name=name, path=stem_path, ready=True))

        # 100% — done
        update_job(job_id, status="done", progress=100, stems=stems)

    except Exception as e:
        update_job(job_id, status="error", error=str(e))
