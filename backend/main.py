"""
Smart Split Backend — FastAPI service for Demucs stem separation.
Provides REST endpoints for uploading audio, tracking separation progress,
and downloading individual stems.

Entry points for /analyze/deep and /separate dispatch by Content-Type:
- application/json — Worker has minted a presigned R2 GET URL; container
  streams the object via r2_download.download_to_tempfile, validates early,
  then starts the job. This is the path for direct-to-R2 uploads.
- multipart/form-data — Legacy path, kept until Task 9 of the
  direct-r2-upload plan removes it. Increments the
  ``multipart_legacy_calls`` log counter so the deploy gate can verify zero
  traffic before deletion.
"""

import logging
import os
import tempfile
from typing import Annotated

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl

from jobs import get_job, cleanup_expired, update_job
from separation import start_separation, VALID_MODELS
from deep_analysis import start_deep_analysis
from observability import setup_telemetry
from r2_download import download_to_tempfile
from validation import validate_audio_upload

VALID_PROFILES = (
    "modern_pop_polish",
    "hip_hop_low_end",
    "indie_warmth",
    "metal_wall",
    "pop_punk_air",
)

TEMP_DIR = "/tmp/smart-split"
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}

_logger = logging.getLogger("aurialis.main")


def _unlink_quiet(path: str) -> None:
    """Unlink a path, swallowing 'already gone' errors."""
    try:
        os.unlink(path)
    except OSError:
        pass


def _detect_gpu() -> bool:
    """Lazy-import torch — keeps the FastAPI app loadable in test environments
    where the heavy ML deps aren't installed."""
    try:
        import torch  # type: ignore[import-untyped]

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


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


# ---- Pydantic JSON bodies ----


class AnalyzeDeepBody(BaseModel):
    fetchUrl: HttpUrl
    profile: str = "modern_pop_polish"


class SeparateBody(BaseModel):
    fetchUrl: HttpUrl
    model: str = "htdemucs"


# ---- Route handlers (module-level so they're easy to test in isolation) ----


async def _health():
    """Health check — reports GPU availability and loaded models."""
    return {
        "status": "ok",
        "gpu": _detect_gpu(),
        "models": _detect_models(),
    }


async def _separate_multipart(
    file: UploadFile,
    model: str,
):
    """Legacy multipart upload handler. Removed in plan Task 9."""
    _logger.info("multipart_legacy_calls path=/separate")
    if model not in VALID_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model: {model}. Must be one of {VALID_MODELS}",
        )
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    data = await validate_audio_upload(file)

    os.makedirs(TEMP_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    suffix = ext if ext in ALLOWED_EXTENSIONS else ".wav"

    with tempfile.NamedTemporaryFile(dir=TEMP_DIR, suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        input_path = tmp.name

    try:
        job = start_separation(input_path, model)
    except Exception:
        _unlink_quiet(input_path)
        raise
    return {"job_id": job.id, "status": job.status}


async def _separate_json(body: SeparateBody):
    if body.model not in VALID_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model: {body.model}. Must be one of {VALID_MODELS}",
        )
    tmp_path = download_to_tempfile(str(body.fetchUrl), temp_dir=TEMP_DIR)
    try:
        job = start_separation(str(tmp_path), body.model)
    except Exception:
        _unlink_quiet(str(tmp_path))
        raise
    return {"job_id": job.id, "status": job.status}


async def _separate(
    request: Request,
    file: Annotated[UploadFile | None, File()] = None,
    model: Annotated[str, Form()] = "htdemucs",
):
    """Upload an audio file (multipart) or supply a fetchUrl (JSON) and start
    Demucs separation."""
    ct = (request.headers.get("content-type") or "").lower()
    if ct.startswith("application/json"):
        body = SeparateBody(**(await request.json()))
        return await _separate_json(body)
    if file is None:
        raise HTTPException(
            status_code=400, detail="Missing 'file' (multipart) or JSON body"
        )
    return await _separate_multipart(file, model)


async def _job_status(job_id: str):
    """Poll separation job status."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "model": job.model,
        "job_type": job.job_type,
        "partial_result": job.partial_result,
        "stems": [{"name": s.name, "ready": s.ready} for s in job.stems],
        "error": job.error,
    }


async def _analyze_deep_multipart(
    file: UploadFile,
    profile: str,
):
    """Legacy multipart upload handler. Removed in plan Task 9."""
    _logger.info("multipart_legacy_calls path=/analyze/deep")
    if profile not in VALID_PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid profile: {profile}. Must be one of {VALID_PROFILES}",
        )
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    data = await validate_audio_upload(file)

    os.makedirs(TEMP_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    suffix = ext if ext in ALLOWED_EXTENSIONS else ".wav"

    with tempfile.NamedTemporaryFile(dir=TEMP_DIR, suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        input_path = tmp.name

    try:
        job = start_deep_analysis(input_path, profile)
    except Exception:
        _unlink_quiet(input_path)
        raise
    return {"job_id": job.id, "status": job.status}


async def _analyze_deep_json(body: AnalyzeDeepBody):
    if body.profile not in VALID_PROFILES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid profile: {body.profile}. Must be one of {VALID_PROFILES}",
        )
    tmp_path = download_to_tempfile(str(body.fetchUrl), temp_dir=TEMP_DIR)
    try:
        job = start_deep_analysis(str(tmp_path), body.profile)
    except Exception:
        _unlink_quiet(str(tmp_path))
        raise
    return {"job_id": job.id, "status": job.status}


async def _analyze_deep(
    request: Request,
    file: Annotated[UploadFile | None, File()] = None,
    profile: Annotated[str, Form()] = "modern_pop_polish",
):
    """Upload an audio file (multipart) or supply a fetchUrl (JSON) and start
    a deep-analysis job."""
    ct = (request.headers.get("content-type") or "").lower()
    if ct.startswith("application/json"):
        body = AnalyzeDeepBody(**(await request.json()))
        return await _analyze_deep_json(body)
    if file is None:
        raise HTTPException(
            status_code=400, detail="Missing 'file' (multipart) or JSON body"
        )
    return await _analyze_deep_multipart(file, profile)


async def _job_result(job_id: str):
    """Return the deep-analysis result."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.job_type != "deep_analysis":
        raise HTTPException(status_code=400, detail="Job is not a deep_analysis job")
    if job.status != "done":
        raise HTTPException(status_code=400, detail="Job not complete")
    return job.partial_result


async def _download_stem(job_id: str, stem_name: str):
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


async def _cancel_job(job_id: str):
    """Cooperative cancel — flips Job.cancelled so the worker thread exits at
    the next phase boundary. Idempotent on already-terminal jobs."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("done", "error"):
        return {"job_id": job_id, "status": job.status, "cancelled": False}
    update_job(job_id, cancelled=True)
    return {"job_id": job_id, "status": job.status, "cancelled": True}


def _register_routes(app: FastAPI) -> None:
    app.add_api_route("/health", _health, methods=["GET"])
    app.add_api_route("/separate", _separate, methods=["POST"])
    app.add_api_route("/jobs/{job_id}/status", _job_status, methods=["GET"])
    app.add_api_route("/analyze/deep", _analyze_deep, methods=["POST"])
    app.add_api_route("/jobs/{job_id}/result", _job_result, methods=["GET"])
    app.add_api_route(
        "/jobs/{job_id}/stems/{stem_name}", _download_stem, methods=["GET"]
    )
    app.add_api_route("/jobs/{job_id}", _cancel_job, methods=["DELETE"])


def _register_lifecycle(app: FastAPI) -> None:
    @app.on_event("startup")
    async def _startup_cleanup():
        removed = cleanup_expired()
        if removed:
            print(f"Cleaned up {removed} expired job(s)")

    @app.on_event("shutdown")
    async def _shutdown_otel():
        """Flush + shut down the OTel tracer provider so spans aren't dropped
        on container restart. Cheap no-op if telemetry wasn't initialized."""
        try:
            from opentelemetry import trace

            provider = trace.get_tracer_provider()
            shutdown = getattr(provider, "shutdown", None)
            if callable(shutdown):
                shutdown()
        except Exception:
            pass


def create_app(*, telemetry: bool = True) -> FastAPI:
    """Build a fresh FastAPI app. Tests pass `telemetry=False` to keep the app
    isolated from the global OTel SDK state."""
    app = FastAPI(
        title="Smart Split API",
        description="Self-hosted Demucs stem separation service",
        version="1.0.0",
    )

    if telemetry:
        setup_telemetry(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "https://aurialis.yosefgamble.com",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["traceparent"],
    )

    _register_routes(app)
    _register_lifecycle(app)
    return app


# Module-level app for production / wrangler.
app = create_app()
