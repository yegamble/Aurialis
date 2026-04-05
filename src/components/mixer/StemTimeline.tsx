"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface StemLane {
  id: string;
  name: string;
  color: string;
  waveformPeaks: number[];
  offset: number;
  duration: number;
}

interface StemTimelineProps {
  stems: StemLane[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onOffsetChange: (stemId: string, offset: number) => void;
}

const LANE_HEIGHT = 48;
const LABEL_WIDTH = 80;
const TIME_HEADER_HEIGHT = 20;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function drawLane(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  color: string,
  width: number,
  height: number,
  offsetPx: number
) {
  ctx.clearRect(0, 0, width, height);

  if (peaks.length === 0) return;

  const barCount = Math.min(peaks.length, Math.floor((width - offsetPx) / 2));
  if (barCount <= 0) return;

  const barWidth = (width - offsetPx) / barCount;
  const mid = height / 2;

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;

  for (let i = 0; i < barCount; i++) {
    const dataIndex = Math.floor((i / barCount) * peaks.length);
    const val = peaks[dataIndex] || 0;
    const barH = Math.max(1, val * mid * 0.85);
    const x = offsetPx + i * barWidth;
    const bw = Math.max(1, barWidth - 1);

    ctx.fillRect(x, mid - barH, bw, barH);
    ctx.fillRect(x, mid, bw, barH);
  }

  ctx.globalAlpha = 1;
}

export function StemTimeline({
  stems,
  currentTime,
  duration,
  onSeek,
  onOffsetChange,
}: StemTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const draggingRef = useRef<{ stemId: string; startX: number; startOffset: number } | null>(null);
  const [timelineWidth, setTimelineWidth] = useState(600);

  // Keep timelineWidth in sync with container size
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setTimelineWidth(containerRef.current.clientWidth - LABEL_WIDTH);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  /** Read live width from ref — only for use in event handlers and effects. */
  const readTimelineWidth = useCallback(() => {
    return containerRef.current
      ? containerRef.current.clientWidth - LABEL_WIDTH
      : timelineWidth;
  }, [timelineWidth]);

  // Draw waveforms
  useEffect(() => {
    for (const stem of stems) {
      const canvas = canvasRefs.current.get(stem.id);
      if (!canvas) continue;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const width = readTimelineWidth();

      canvas.width = width * dpr;
      canvas.height = LANE_HEIGHT * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${LANE_HEIGHT}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      ctx.scale(dpr, dpr);

      const offsetPx = duration > 0 ? (stem.offset / duration) * width : 0;
      drawLane(ctx, stem.waveformPeaks, stem.color, width, LANE_HEIGHT, offsetPx);
    }
  }, [stems, duration, readTimelineWidth]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || duration <= 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const width = readTimelineWidth();
      if (x >= 0) {
        onSeek((x / width) * duration);
      }
    },
    [duration, onSeek, readTimelineWidth]
  );

  const handleMouseDown = useCallback(
    (stemId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const stem = stems.find((s) => s.id === stemId);
      if (!stem) return;
      draggingRef.current = {
        stemId,
        startX: e.clientX,
        startOffset: stem.offset,
      };
    },
    [stems]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = draggingRef.current;
      if (!drag || duration <= 0) return;
      const width = readTimelineWidth();
      const dx = e.clientX - drag.startX;
      const timeDelta = (dx / width) * duration;
      onOffsetChange(drag.stemId, Math.max(0, drag.startOffset + timeDelta));
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [duration, onOffsetChange, readTimelineWidth]);

  // Playhead position
  const progress = duration > 0 ? currentTime / duration : 0;

  // Time markers
  const markerCount = Math.max(2, Math.floor(duration / 10) + 1);
  const markers = Array.from({ length: Math.min(markerCount, 10) }, (_, i) => {
    const t = (i / (Math.min(markerCount, 10) - 1)) * duration;
    return { time: t, label: formatTime(t) };
  });

  return (
    <div
      ref={containerRef}
      data-testid="stem-timeline"
      className="w-full rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] overflow-hidden cursor-pointer select-none"
      onClick={handleClick}
    >
      {/* Time markers */}
      <div
        className="flex relative"
        style={{ height: TIME_HEADER_HEIGHT, paddingLeft: LABEL_WIDTH }}
      >
        {markers.map((m, i) => (
          <span
            key={i}
            className="absolute text-[9px] text-[rgba(255,255,255,0.3)] tabular-nums"
            style={{
              left: `${LABEL_WIDTH + (m.time / (duration || 1)) * timelineWidth}px`,
              top: 2,
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Stem lanes */}
      <div className="relative">
        {stems.map((stem) => (
          <div
            key={stem.id}
            className="flex items-center border-t border-[rgba(255,255,255,0.04)]"
            style={{ height: LANE_HEIGHT }}
          >
            <div
              className="shrink-0 px-2 flex items-center gap-1 overflow-hidden"
              style={{ width: LABEL_WIDTH }}
            >
              <div
                className="w-1.5 h-3 rounded-sm shrink-0"
                style={{ backgroundColor: stem.color }}
              />
              <span className="text-[10px] text-[rgba(255,255,255,0.5)] truncate">
                {stem.name}
              </span>
            </div>
            <div
              className="flex-1 relative cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => handleMouseDown(stem.id, e)}
            >
              <canvas
                ref={(el) => {
                  if (el) canvasRefs.current.set(stem.id, el);
                  else canvasRefs.current.delete(stem.id);
                }}
              />
            </div>
          </div>
        ))}

        {/* Playhead */}
        {stems.length > 0 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
            style={{ left: `${LABEL_WIDTH + progress * timelineWidth}px` }}
          />
        )}
      </div>
    </div>
  );
}
