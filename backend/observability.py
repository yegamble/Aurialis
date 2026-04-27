"""OpenTelemetry tracing + structured JSON logging for the Aurialis backend.

Defaults to a console exporter so spans are visible in `wrangler tail` without
configuration. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to ship traces to an external
collector (Honeycomb / Tempo / etc.).

Key concerns this module solves:
  - The FastAPI auto-instrumentor does NOT inject `traceparent` into responses
    by default. Cross-origin frontend can't read trace IDs without it. We add
    an explicit ASGI response hook + CORS expose_headers (the latter lives in
    main.py).
  - Worker code in `_run_deep_analysis` runs in a daemon thread. OTel context
    does NOT auto-propagate across thread boundaries. Span Links are NOT
    parent-child — they render as sidebar references. Use `run_in_span_context`
    to attach the captured request-span context inside the thread so worker
    spans nest under the request span as TRUE children.
  - `force_flush` at thread exit is required; otherwise short-lived workers
    drop their spans.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Callable

from fastapi import FastAPI
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
)
from opentelemetry.trace import Span, set_span_in_context
from opentelemetry.trace.propagation.tracecontext import (
    TraceContextTextMapPropagator,
)


_LOGGER_NAME = "aurialis.deep_analysis"
_PROPAGATOR = TraceContextTextMapPropagator()
_logger_initialized = False


class JsonFormatter(logging.Formatter):
    """Emits one-line JSON per record. Includes the active trace_id so logs
    are correlatable with the OTel traces they originated from."""

    _STANDARD_ATTRS = {
        "name", "msg", "args", "levelname", "levelno", "pathname",
        "filename", "module", "exc_info", "exc_text", "stack_info",
        "lineno", "funcName", "created", "msecs", "relativeCreated",
        "thread", "threadName", "processName", "process", "message",
        "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        out: dict = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S.%fZ"),
            "level": record.levelname,
            "msg": record.getMessage(),
            "trace_id": _active_trace_id_hex(),
        }
        # Pass through any extra fields the caller attached (job_id, phase, etc.)
        for k, v in record.__dict__.items():
            if k in self._STANDARD_ATTRS or k.startswith("_"):
                continue
            out[k] = v
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def _active_trace_id_hex() -> str:
    """Returns the active trace_id as 32-hex (or empty string when no span)."""
    span = trace.get_current_span()
    ctx = span.get_span_context()
    if ctx.trace_id == 0:
        return ""
    return format(ctx.trace_id, "032x")


def _tracer_provider() -> TracerProvider:
    """Indirection so tests can patch it (force_flush assertion)."""
    provider = trace.get_tracer_provider()
    # In production this is always our SDK TracerProvider (set in setup_telemetry)
    return provider  # type: ignore[return-value]


class TraceparentInjectorMiddleware:
    """Pure ASGI middleware that injects `traceparent` into every HTTP response.

    Why ASGI (not `app.middleware('http')` / BaseHTTPMiddleware): the latter
    buffers the entire response body, breaking streaming/file responses (e.g.
    /jobs/{id}/stems/{name} FileResponse). This middleware mutates only the
    `http.response.start` message headers and passes everything else through.

    Why not `FastAPIInstrumentor(server_response_hook=...)`: the installed
    `opentelemetry-instrumentation-fastapi==0.62b1` does NOT expose
    `server_response_hook` as a kwarg (verified via `inspect.signature`).
    Earlier docs may suggest otherwise; the runtime is authoritative.
    """

    def __init__(self, app):  # type: ignore[no-untyped-def]
        self.app = app

    async def __call__(self, scope, receive, send):  # type: ignore[no-untyped-def]
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def wrapped_send(message):  # type: ignore[no-untyped-def]
            if message["type"] == "http.response.start":
                carrier: dict[str, str] = {}
                _PROPAGATOR.inject(carrier)
                headers = list(message.get("headers", []))
                for k, v in carrier.items():
                    headers.append((k.encode("latin-1"), v.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, wrapped_send)


def _build_logger() -> logging.Logger:
    global _logger_initialized
    log = logging.getLogger(_LOGGER_NAME)
    if not _logger_initialized:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        log.propagate = False
        _logger_initialized = True
    return log


def setup_telemetry(
    app: FastAPI,
    service_name: str = "aurialis-core",
    tracer_provider: TracerProvider | None = None,
) -> trace.Tracer:
    """Wire up OTel tracing + JSON logging on a FastAPI app.

    - Builds (or uses the provided) TracerProvider with `service.name`.
    - Adds a span processor pointing at OTLP if OTEL_EXPORTER_OTLP_ENDPOINT is
      set, else the console exporter.
    - Auto-instruments FastAPI requests, excluding /health.
    - Adds an HTTP middleware that injects `traceparent` into every response.

    `tracer_provider` is exposed for tests so they can pass an in-memory provider
    without trying to override the process-global one (which OTel forbids).
    """
    if tracer_provider is None:
        resource = Resource.create({"service.name": service_name})
        tracer_provider = TracerProvider(resource=resource)
        otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        exporter = (
            OTLPSpanExporter(endpoint=otlp_endpoint)
            if otlp_endpoint
            else ConsoleSpanExporter()
        )
        tracer_provider.add_span_processor(BatchSpanProcessor(exporter))
        try:
            trace.set_tracer_provider(tracer_provider)
        except Exception:
            # Already set in this process — keep going with the existing provider
            pass

    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="health",
        tracer_provider=tracer_provider,
    )
    # Pure ASGI middleware (NOT app.middleware("http")) so streaming /
    # FileResponse endpoints aren't buffered.
    app.add_middleware(TraceparentInjectorMiddleware)

    _build_logger()
    return tracer_provider.get_tracer(_LOGGER_NAME)


def get_logger() -> logging.Logger:
    """Returns the configured aurialis.deep_analysis JSON logger.
    Safe to call before setup_telemetry — initializes the handler on first use."""
    return _build_logger()


def get_tracer() -> trace.Tracer:
    return trace.get_tracer(_LOGGER_NAME)


def run_in_span_context(captured_span: Span, fn: Callable[[], None]) -> None:
    """Run `fn` in the OTel context of `captured_span` so spans created inside
    `fn` become TRUE children of the captured span (parent.span_id matches).

    Forces `tracer_provider.force_flush()` after `fn` returns (success or
    exception) so daemon-thread spans don't get dropped.
    """
    token = otel_context.attach(set_span_in_context(captured_span))
    try:
        fn()
    finally:
        otel_context.detach(token)
        provider = _tracer_provider()
        flush = getattr(provider, "force_flush", None)
        if callable(flush):
            try:
                flush(timeout_millis=5000)
            except TypeError:
                # Some providers expose force_flush() with no args
                flush()


def phase_span(
    phase: str,
    job_id: str,
    **attrs: object,
) -> "trace.Span":
    """Convenience wrapper — start a manual span with the standard attribute set."""
    tracer = get_tracer()
    span = tracer.start_span(f"deep_analysis.{phase}")
    span.set_attribute("phase", phase)
    span.set_attribute("job_id", job_id)
    for k, v in attrs.items():
        span.set_attribute(k, v)
    return span


def log_phase(
    phase: str,
    job_id: str,
    started_ms: float,
    *,
    error: str | None = None,
) -> None:
    """Emit a structured JSON log line at phase end."""
    duration_ms = int((time.time() - started_ms) * 1000)
    extra = {"job_id": job_id, "phase": phase, "duration_ms": duration_ms}
    log = get_logger()
    if error:
        log.error("phase failed", extra={**extra, "error": error})
    else:
        log.info("phase done", extra=extra)
