"use client";

import { useEffect, useRef } from "react";

interface GoniometerProps {
  /** Live L-channel analyser from `engine.leftAnalyserNode`. */
  left: AnalyserNode | null;
  /** Live R-channel analyser from `engine.rightAnalyserNode`. */
  right: AnalyserNode | null;
  /** Canvas pixel size (square). Defaults to 192. */
  size?: number;
}

/**
 * Goniometer / vectorscope (Phase 4a Task 6).
 *
 * Reads time-domain L/R samples from a pair of main-thread AnalyserNodes
 * every `requestAnimationFrame` and draws a Lissajous scatter. Axes are
 * rotated 45° (the standard goniometer convention): fully mono renders as
 * a vertical line (+y), fully out-of-phase as a horizontal line (+x).
 *
 * Respects `prefers-reduced-motion`: when enabled, updates at ~5 Hz via
 * setTimeout instead of rAF. When the tab is hidden, rendering pauses.
 */
export function Goniometer({ left, right, size = 192 }: GoniometerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Reuse sample buffers across frames to avoid per-frame allocation.
  const leftBufRef = useRef<Float32Array | null>(null);
  const rightBufRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect reduced motion
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches ?? false;
    const frameIntervalMs = reduced ? 200 : 0; // 5 Hz vs rAF-paced

    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        scheduleNext();
        return;
      }
      if (!left || !right) {
        drawIdle(ctx, canvas);
        scheduleNext();
        return;
      }

      const fft = Math.min(left.fftSize, right.fftSize);
      if (!leftBufRef.current || leftBufRef.current.length !== fft) {
        leftBufRef.current = new Float32Array(fft);
        rightBufRef.current = new Float32Array(fft);
      }
      const lBuf = leftBufRef.current;
      const rBuf = rightBufRef.current!;
      left.getFloatTimeDomainData(lBuf);
      right.getFloatTimeDomainData(rBuf);

      drawLissajous(ctx, canvas, lBuf, rBuf);
      scheduleNext();
    };

    const scheduleNext = () => {
      if (cancelled) return;
      if (frameIntervalMs > 0) {
        timeoutId = setTimeout(draw, frameIntervalMs);
      } else {
        rafId = requestAnimationFrame(draw);
      }
    };

    // First paint
    draw();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [left, right]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[rgba(255,255,255,0.4)] text-[10px] uppercase tracking-wider">
        Goniometer
      </div>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        data-testid="goniometer-canvas"
        className="rounded-lg bg-[rgba(0,0,0,0.4)]"
        style={{ width: size, height: size }}
      />
    </div>
  );
}

function drawIdle(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(0, 0, w, h);
  drawAxes(ctx, w, h);
  // Single low-opacity dot at origin
  ctx.fillStyle = "rgba(10, 132, 255, 0.3)";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawLissajous(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  left: Float32Array,
  right: Float32Array
) {
  const w = canvas.width;
  const h = canvas.height;

  // Fade previous frame for trail effect (not a full clear)
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, w, h);
  drawAxes(ctx, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 4;

  // Detect silence to draw a single centre dot instead of a spread
  let rms = 0;
  for (let i = 0; i < left.length; i++) {
    rms += left[i] * left[i] + right[i] * right[i];
  }
  rms = Math.sqrt(rms / (left.length * 2));
  if (rms < 1e-5) {
    ctx.fillStyle = "rgba(10, 132, 255, 0.3)";
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Rotate axes 45° so mono (L=R) lands on +y and side (L=-R) on +x.
  // Traditional goniometer: x = (L - R) / √2, y = (L + R) / √2 (scaled for display)
  const inv = 1 / Math.SQRT2;
  ctx.fillStyle = "rgba(10, 132, 255, 0.6)";
  for (let i = 0; i < left.length; i++) {
    const l = left[i];
    const r = right[i];
    const x = cx + (l - r) * inv * radius;
    const y = cy - (l + r) * inv * radius;
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}
