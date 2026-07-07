"use client";

import type { ReactElement } from "react";
import type { AlbumTrackRow } from "./AlbumView";

/** Chart height in px (design: ~220). */
const CHART_HEIGHT = 220;
/** Drift threshold (LU) beyond which a bar is coloured amber. */
const DRIFT_LU = 1.5;

const ACCENT = "#0a84ff";
const DRIFT = "#ff9f0a";

export interface LufsBarChartProps {
  /** All album rows; tracks without a measured LUFS are excluded from the chart. */
  tracks: AlbumTrackRow[];
  /** Album loudness target (LUFS). */
  target: number;
  /** Open a track by id — same handler as the row "Open" action. */
  onOpen: (id: string) => void;
}

interface MeasuredRow {
  id: string;
  title: string;
  lufs: number;
}

function measuredRows(tracks: AlbumTrackRow[]): MeasuredRow[] {
  const out: MeasuredRow[] = [];
  for (const t of tracks) {
    if (t.lufs !== null && Number.isFinite(t.lufs)) {
      out.push({ id: t.id, title: t.title, lufs: t.lufs });
    }
  }
  return out;
}

function signed(value: number): string {
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `−${abs}` : `+${abs}`;
}

/**
 * Loudness-across-album bar chart. One bar per analyzed track positioned at its
 * measured LUFS, against a labelled target line and y-gridlines. Bars drifting
 * more than 1.5 LU from the target glow amber; every bar is clickable and opens
 * the track. Tracks without a measured LUFS are excluded (they stay in the row
 * list). Returns null when nothing is measured so the parent can show a hint.
 */
export function LufsBarChart({
  tracks,
  target,
  onOpen,
}: LufsBarChartProps): ReactElement | null {
  const rows = measuredRows(tracks);
  if (rows.length === 0) return null;

  const values = rows.map((r) => r.lufs);
  const lo = Math.min(...values, target) - 1;
  const hi = Math.max(...values, target) + 1;
  const span = hi - lo || 1;
  const yFor = (v: number): number => CHART_HEIGHT - ((v - lo) / span) * CHART_HEIGHT;

  // Gridlines: top, target (highlighted), bottom.
  const lines: { v: number; target: boolean }[] = [
    { v: hi, target: false },
    { v: target, target: true },
    { v: lo, target: false },
  ];

  return (
    <div
      data-testid="album-lufs-chart"
      className="relative"
      style={{ height: CHART_HEIGHT, paddingTop: 8 }}
    >
      <div className="pointer-events-none absolute inset-0">
        {lines.map((line, i) => (
          <div
            key={i}
            className="absolute left-0 right-0"
            style={{
              top: yFor(line.v) - (line.target ? 0.5 : 0),
              height: line.target ? 1.5 : 1,
              background: line.target ? ACCENT : "rgba(255,255,255,0.08)",
              opacity: line.target ? 0.9 : 1,
            }}
          >
            <span
              className="absolute px-1 text-[10px] tabular-nums"
              style={{
                right: 6,
                top: i === 0 ? 0 : line.target ? -16 : -14,
                color: line.target ? ACCENT : "rgba(255,255,255,0.45)",
                fontWeight: line.target ? 600 : 400,
                background: "rgba(28,28,30,0.85)",
              }}
            >
              {line.v.toFixed(1)} {line.target ? "LUFS (target)" : "LUFS"}
            </span>
          </div>
        ))}
      </div>

      <div className="flex h-full items-end gap-3.5" style={{ paddingRight: 110 }}>
        {rows.map((r) => {
          const delta = r.lufs - target;
          const drift = Math.abs(delta) > DRIFT_LU;
          const color = drift ? DRIFT : ACCENT;
          const top = yFor(r.lufs);
          return (
            <button
              key={r.id}
              type="button"
              data-testid="album-lufs-bar"
              data-fingerprint={r.id}
              data-drift={drift ? "true" : "false"}
              onClick={() => onOpen(r.id)}
              aria-label={`Open ${r.title} — ${r.lufs.toFixed(1)} LUFS, ${signed(delta)} LU from target`}
              className="relative flex h-full flex-1 cursor-pointer flex-col items-center bg-transparent"
            >
              <span
                className="absolute left-1/2 -translate-x-1/2 rounded"
                style={{
                  bottom: 0,
                  top,
                  width: "60%",
                  background: color,
                  boxShadow: drift ? `0 0 12px ${color}66` : `0 0 6px ${color}44`,
                }}
              />
              <span
                className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums"
                style={{ top: top - 22, color }}
              >
                {signed(delta)}
              </span>
              <span
                className="absolute w-full truncate px-0.5 pt-1 text-center text-[10px]"
                style={{ bottom: -22, color: "rgba(255,255,255,0.6)" }}
              >
                {r.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
