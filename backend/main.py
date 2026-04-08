"""
Smart Split Backend — FastAPI service for Demucs stem separation.
Provides REST endpoints for uploading audio, tracking separation progress,
and downloading individual stems.
"""

import os
import tempfile

import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from jobs import get_job, cleanup_expired
from separation import start_separation, VALID_MODELS

app = FastAPI(
    title="Smart Split API",
    description="Self-hosted Demucs stem separation service",
    version="1.0.0",
)

# CORS — allow the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = "/tmp/smart-split"
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def _detect_gpu() -> bool:
    return torch.cuda.is_available()


def _detect_models() -> list[str]:
    models = []
    try:
        from demucs.pretrained import get_model

        for name in ("htdemucs", "htdemucs_6s"):
            try:
                get_model(name)
                models.append(name)
            except Exception:
                pass
    except ImportError:
        pass
    return models


@app.get("/health")
async def health():
    """Health check — reports GPU availability and loaded models."""
    return {
        "status": "ok",
        "gpu": _detect_gpu(),
        "models": _detect_models(),
    }


@app.post("/separate")
async def separate(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
):
    """Upload an audio file and start Demucs separation."""
    if model not in VALID_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model: {model}. Must be one of {VALID_MODELS}",
        )

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Save uploaded file to temp directory
    os.makedirs(TEMP_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    suffix = ext if ext in ALLOWED_EXTENSIONS else ".wav"

    with tempfile.NamedTemporaryFile(
        dir=TEMP_DIR, suffix=suffix, delete=False
    ) as tmp:
        content = await file.read()
        tmp.write(content)
        input_path = tmp.name

    # Start background separation
    job = start_separation(input_path, model)

    return {"job_id": job.id, "status": job.status}


@app.get("/jobs/{job_id}/status")
async def job_status(job_id: str):
    """Poll separation job status."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "model": job.model,
        "stems": [
            {"name": s.name, "ready": s.ready}
            for s in job.stems
        ],
        "error": job.error,
    }


@app.get("/jobs/{job_id}/stems/{stem_name}")
async def download_stem(job_id: str, stem_name: str):
    """Download a separated stem WAV file."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != "done":
        raise HTTPException(status_code=400, detail="Job not complete")

    stem = next((s for s in job.stems if s.name == stem_name), None)
    if not stem:
        raise HTTPException(
            status_code=404,
            detail=f"Stem '{stem_name}' not found. Available: {[s.name for s in job.stems]}",
        )

    if not os.path.exists(stem.path):
        raise HTTPException(status_code=404, detail="Stem file not found on disk")

    return FileResponse(
        stem.path,
        media_type="audio/wav",
        filename=f"{stem_name}.wav",
    )


@app.on_event("startup")
async def startup_cleanup():
    """Clean up expired jobs on startup."""
    removed = cleanup_expired()
    if removed:
        print(f"Cleaned up {removed} expired job(s)")
