"""
Job store — tracks separation job state.
Uses a JSON file on disk so state survives container restarts.
"""

import json
import os
import re
import time
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

JOBS_FILE = Path("/tmp/smart-split/jobs.json")
JOB_TTL_SECONDS = 30 * 60  # 30 minutes

_lock = threading.Lock()

# Allowed characters in a stem name. Limits Content-Disposition exposure if a
# future Demucs model emits exotic stem names. Today's models use only the
# names below — see separation.MODEL_STEMS.
_STEM_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


@dataclass
class StemInfo:
    name: str
    path: str
    ready: bool = False

    def __post_init__(self) -> None:
        if not _STEM_NAME_RE.match(self.name):
            raise ValueError(
                f"Invalid stem name {self.name!r}: must match {_STEM_NAME_RE.pattern}"
            )


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | processing | done | error
    progress: int = 0
    model: str = "htdemucs"
    stems: list[StemInfo] = field(default_factory=list)
    error: Optional[str] = None
    input_path: Optional[str] = None
    output_dir: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    # Job type discriminator: "separation" (default) or "deep_analysis".
    job_type: str = "separation"
    # Progressive results for deep_analysis jobs. Populated phase-by-phase:
    # {"sections": [...]} after section detection (~10 s),
    # {"sections": [...], "stems": [...]} after stem analysis,
    # {"sections": [...], "stems": [...], "script": {...}} after script generation.
    partial_result: dict = field(default_factory=dict)
    # Cooperative cancel flag — DELETE /jobs/{id} flips it; the worker thread
    # checks at phase boundaries and exits via status="error" when set.
    cancelled: bool = False


def _load_jobs() -> dict[str, Job]:
    """Load jobs from disk. Tolerates jobs serialized before job_type/partial_result existed."""
    if not JOBS_FILE.exists():
        return {}
    try:
        data = json.loads(JOBS_FILE.read_text())
        jobs = {}
        for jid, jdata in data.items():
            stems = [StemInfo(**s) for s in jdata.pop("stems", [])]
            # Defaults for fields added after initial deploy
            jdata.setdefault("job_type", "separation")
            jdata.setdefault("partial_result", {})
            jdata.setdefault("cancelled", False)
            jobs[jid] = Job(**jdata, stems=stems)
        return jobs
    except (json.JSONDecodeError, TypeError):
        return {}


def _save_jobs(jobs: dict[str, Job]) -> None:
    """Persist jobs to disk."""
    JOBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    for jid, job in jobs.items():
        d = asdict(job)
        data[jid] = d
    JOBS_FILE.write_text(json.dumps(data, indent=2))


def create_job(job: Job) -> None:
    """Create a new job."""
    with _lock:
        jobs = _load_jobs()
        jobs[job.id] = job
        _save_jobs(jobs)


def get_job(job_id: str) -> Optional[Job]:
    """Get a job by ID."""
    with _lock:
        jobs = _load_jobs()
        return jobs.get(job_id)


def update_job(job_id: str, **kwargs) -> Optional[Job]:
    """Update job fields."""
    with _lock:
        jobs = _load_jobs()
        job = jobs.get(job_id)
        if not job:
            return None
        for key, value in kwargs.items():
            setattr(job, key, value)
        _save_jobs(jobs)
        return job


def is_cancelled(job_id: str) -> bool:
    """Cheap read of the cancel flag. Returns False for unknown jobs (no exception)."""
    job = get_job(job_id)
    return bool(job and job.cancelled)


def cleanup_expired() -> int:
    """Remove jobs older than TTL. Returns count of removed jobs."""
    now = time.time()
    removed = 0
    with _lock:
        jobs = _load_jobs()
        expired = [
            jid for jid, j in jobs.items() if now - j.created_at > JOB_TTL_SECONDS
        ]
        for jid in expired:
            job = jobs.pop(jid)
            # Clean up files
            if job.input_path and os.path.exists(job.input_path):
                os.remove(job.input_path)
            if job.output_dir and os.path.isdir(job.output_dir):
                import shutil

                shutil.rmtree(job.output_dir, ignore_errors=True)
            removed += 1
        if removed:
            _save_jobs(jobs)
    return removed
