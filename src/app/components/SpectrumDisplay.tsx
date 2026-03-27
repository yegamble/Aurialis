import { useRef, useEffect, useCallback } from "react";

interface SpectrumDisplayProps {
  data: number[];
}

export function SpectrumDisplay({ data }: SpectrumDisplayProps) {
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

    // Draw spectrum line
    ctx.beginPath();
    ctx.moveTo(0, rect.height);

    const points: [number, number][] = [];
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * rect.width;
      const y = rect.height - data[i] * rect.height * 0.85;
      points.push([x, y]);
    }

    // Smooth curve
    if (points.length > 0) {
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i][0] + points[i + 1][0]) / 2;
        const yc = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], xc, yc);
      }
      if (points.length > 1) {
        const last = points[points.length - 1];
        ctx.lineTo(last[0], last[1]);
      }
    }

    ctx.lineTo(rect.width, rect.height);
    ctx.lineTo(0, rect.height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
    gradient.addColorStop(0, "rgba(10,132,255,0.3)");
    gradient.addColorStop(1, "rgba(10,132,255,0.02)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke
    ctx.beginPath();
    if (points.length > 0) {
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i][0] + points[i + 1][0]) / 2;
        const yc = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], xc, yc);
      }
      if (points.length > 1) {
        ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
      }
    }
    ctx.strokeStyle = "#0a84ff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Frequency labels
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "10px Inter, system-ui";
    const labels = ["20", "100", "1k", "5k", "10k", "20k"];
    labels.forEach((label, i) => {
      const x = (i / (labels.length - 1)) * rect.width;
      ctx.fillText(label, x, rect.height - 4);
    });
  }, [data]);

  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [draw]);

  return (
    <div
      ref={containerRef}
      className="w-full h-32 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] overflow-hidden"
      aria-label="Frequency spectrum display"
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
