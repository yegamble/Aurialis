"""Tests for backend/observability.py — tracer setup, JSON logging, traceparent
injection hook, and parent-child context propagation across the daemon thread."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

import jobs


@pytest.fixture(autouse=True)
def isolate_jobs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(jobs, "JOBS_FILE", tmp_path / "jobs.json")


@pytest.fixture
def memory_exporter() -> InMemorySpanExporter:
    """Replace the global tracer provider with an in-memory one for assertions.

    OTel forbids overriding a previously-set global provider, so this fixture
    is best-effort: if a provider was already set in this test session, the
    existing one stays. Tests that need a guaranteed in-memory provider should
    build their own and pass it to setup_telemetry directly (see the
    setup_telemetry tests below)."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    try:
        trace.set_tracer_provider(provider)
    except Exception:
        pass
    return exporter


def _fresh_provider() -> tuple[TracerProvider, InMemorySpanExporter]:
    """Build an isolated TracerProvider + InMemorySpanExporter — does NOT touch
    the global. Pass to setup_telemetry(..., tracer_provider=...)."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider, exporter


# ----- JSON formatter -----


@pytest.mark.unit
def test_json_formatter_emits_required_fields() -> None:
    from observability import JsonFormatter

    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="aurialis.deep_analysis",
        level=logging.INFO,
        pathname=__file__,
        lineno=10,
        msg="phase start",
        args=(),
        exc_info=None,
    )
    record.job_id = "j1"
    record.phase = "sections"
    record.duration_ms = 42

    out = formatter.format(record)
    parsed = json.loads(out)
    assert parsed["msg"] == "phase start"
    assert parsed["level"] == "INFO"
    assert parsed["job_id"] == "j1"
    assert parsed["phase"] == "sections"
    assert parsed["duration_ms"] == 42
    assert "timestamp" in parsed


@pytest.mark.unit
def test_json_formatter_includes_active_trace_id_when_in_span(
    memory_exporter: InMemorySpanExporter,
) -> None:
    from observability import JsonFormatter

    tracer = trace.get_tracer("test")
    formatter = JsonFormatter()
    with tracer.start_as_current_span("test-span"):
        record = logging.LogRecord(
            name="aurialis.deep_analysis",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg="hi",
            args=(),
            exc_info=None,
        )
        out = formatter.format(record)
        parsed = json.loads(out)
        assert parsed["trace_id"] != ""
        assert len(parsed["trace_id"]) == 32


# ----- Telemetry setup -----


@pytest.mark.unit
def test_setup_telemetry_returns_tracer() -> None:
    from observability import setup_telemetry
    from fastapi import FastAPI

    provider, _ = _fresh_provider()
    app = FastAPI()
    tracer = setup_telemetry(app, service_name="test-svc", tracer_provider=provider)
    assert tracer is not None
    with tracer.start_as_current_span("smoke") as span:
        assert span.is_recording()


@pytest.mark.unit
def test_health_endpoint_excluded_from_traces() -> None:
    """The /health endpoint should NOT produce a span (high frequency, low signal)."""
    from observability import setup_telemetry
    from fastapi import FastAPI

    provider, exporter = _fresh_provider()
    app = FastAPI()

    @app.get("/health")
    def health():  # noqa: ANN202
        return {"status": "ok"}

    setup_telemetry(app, service_name="t", tracer_provider=provider)
    client = TestClient(app)
    exporter.clear()
    r = client.get("/health")
    assert r.status_code == 200

    spans = exporter.get_finished_spans()
    health_spans = [s for s in spans if "health" in (s.name or "").lower()]
    assert health_spans == []


@pytest.mark.unit
def test_traceparent_response_header_is_injected() -> None:
    """FastAPI responses must include a `traceparent` header so frontend JS can
    surface the trace ID."""
    from observability import setup_telemetry
    from fastapi import FastAPI

    provider, _ = _fresh_provider()
    app = FastAPI()

    @app.get("/ping")
    def ping():  # noqa: ANN202
        return {"ok": True}

    setup_telemetry(app, service_name="t", tracer_provider=provider)
    client = TestClient(app)
    r = client.get("/ping")
    assert r.status_code == 200
    tp = r.headers.get("traceparent")
    assert tp is not None
    parts = tp.split("-")
    assert len(parts) == 4
    assert parts[0] == "00"
    assert len(parts[1]) == 32
    assert len(parts[2]) == 16


# ----- Thread context propagation -----


@pytest.mark.unit
def test_run_in_span_context_makes_worker_span_a_child_of_captured(
    memory_exporter: InMemorySpanExporter,
) -> None:
    """The daemon-thread helper must produce TRUE parent-child relationships
    (NOT span links). Worker span's parent must equal the captured span's
    context — same trace_id and the captured span's span_id as parent."""
    from observability import run_in_span_context

    tracer = trace.get_tracer("test")
    captured_trace_id = None
    captured_span_id = None
    with tracer.start_as_current_span("request-span") as request_span:
        captured_span = trace.get_current_span()
        captured_trace_id = request_span.get_span_context().trace_id
        captured_span_id = request_span.get_span_context().span_id

    def worker():
        with tracer.start_as_current_span("worker-span") as worker_span:
            # Confirm worker shares trace and parent points at request
            ctx = worker_span.get_span_context()
            assert ctx.trace_id == captured_trace_id
            assert worker_span.parent is not None
            assert worker_span.parent.span_id == captured_span_id

    run_in_span_context(captured_span, worker)


@pytest.mark.unit
def test_run_in_span_context_calls_force_flush_at_exit() -> None:
    """force_flush MUST run at the end of the thread body so spans exit before
    the daemon thread is reaped. Without this, short-lived workers drop spans."""
    from observability import run_in_span_context

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("parent") as parent:
        captured = parent

    flushed = {"count": 0}

    class FakeProvider:
        def force_flush(self, timeout_millis: int = 5000) -> None:  # noqa: ARG002
            flushed["count"] += 1

    with patch("observability._tracer_provider", lambda: FakeProvider()):
        run_in_span_context(captured, lambda: None)

    assert flushed["count"] == 1


@pytest.mark.unit
def test_run_in_span_context_flushes_even_on_worker_exception() -> None:
    """If the worker raises, force_flush must still fire (finally clause)."""
    from observability import run_in_span_context

    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("parent") as parent:
        captured = parent

    flushed = {"count": 0}

    class FakeProvider:
        def force_flush(self, timeout_millis: int = 5000) -> None:  # noqa: ARG002
            flushed["count"] += 1

    def boom():
        raise RuntimeError("worker exploded")

    with patch("observability._tracer_provider", lambda: FakeProvider()):
        with pytest.raises(RuntimeError, match="worker exploded"):
            run_in_span_context(captured, boom)

    assert flushed["count"] == 1
