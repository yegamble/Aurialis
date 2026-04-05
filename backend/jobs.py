"""
Job store — tracks separation job state.
Uses a JSON file on disk so state survives container restarts.
"""

import json
import os
import time
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

JOBS_FILE = Path("/tmp/smart-split/jobs.json")
JOB_TTL_SECONDS = 30 * 60  # 30 minutes

_lock = threading.Lock()


@dataclass
class StemInfo:
    name: str
    path: str
    ready: bool = False


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


def _load_jobs() -> dict[str, Job]:
    """Load jobs from disk."""
    if not JOBS_FILE.exists():
        return {}
    try:
        data = json.loads(JOBS_FILE.read_text())
        jobs = {}
        for jid, jdata in data.items():
            stems = [StemInfo(**s) for s in jdata.pop("stems", [])]
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


def cleanup_expired() -> int:
    """Remove jobs older than TTL. Returns count of removed jobs."""
    now = time.time()
    removed = 0
    with _lock:
        jobs = _load_jobs()
        expired = [
            jid for jid, j in jobs.items()
            if now - j.created_at > JOB_TTL_SECONDS
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
