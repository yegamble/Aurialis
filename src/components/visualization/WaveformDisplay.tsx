"use client";

import { useRef, useEffect, useCallback } from "react";

interface WaveformDisplayProps {
  audioData: number[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

export function WaveformDisplay({
  audioData,
  currentTime,
  duration,
  onSeek,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const barCount = Math.min(audioData.length, Math.floor(rect.width / 3));
    const barWidth = rect.width / barCount;
    const progress = duration > 0 ? currentTime / duration : 0;
    const mid = rect.height / 2;

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor((i / barCount) * audioData.length);
      const val = audioData[dataIndex] || 0;
      const barH = Math.max(2, val * mid * 0.9);
      const x = i * barWidth;
      const isPast = i / barCount <= progress;

      if (isPast) {
        const gradient = ctx.createLinearGradient(x, mid - barH, x, mid + barH);
        gradient.addColorStop(0, "#5ac8fa");
        gradient.addColorStop(0.5, "#0a84ff");
        gradient.addColorStop(1, "#5ac8fa");
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
      }

      const bw = Math.max(1, barWidth - 1);
      ctx.fillRect(x, mid - barH, bw, barH);
      ctx.fillRect(x, mid, bw, barH);
    }

    // Playhead
    const px = progress * rect.width;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px - 1, 0, 2, rect.height);
  }, [audioData, currentTime, duration]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  const handleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !duration) return;
    const x = e.clientX - rect.left;
    onSeek((x / rect.width) * duration);
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-28 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] cursor-pointer overflow-hidden"
      onClick={handleClick}
      role="slider"
      aria-label="Audio waveform. Click to seek."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
