"use client";

/**
 * MoveEditor — per-move popover with value slider, mute toggle, and reset.
 *
 * - Value slider operates on the LAST envelope point's value (treats the
 *   envelope as a single target the user can shift up or down). For multi-
 *   point envelopes the same delta is applied to all points so the shape
 *   is preserved.
 * - Mute toggles `move.muted` — the engine treats muted moves as no-ops.
 * - Reset restores `move.original`, clears `edited` + `muted`.
 *
 * The component is dumb (props in / events out). Wiring to deepStore lives
 * in the parent (DeepMastering / DeepTimeline) so the popover is reusable.
 */

import { useMemo } from "react";
import type { Move } from "@/types/deep-mastering";

export interface MoveEditorProps {
  move: Move;
  onChangeValue: (newValue: number) => void;
  onToggleMute: () => void;
  onReset: () => void;
  onClose: () => void;
}

export function MoveEditor({
  move,
  onChangeValue,
  onToggleMute,
  onReset,
  onClose,
}: MoveEditorProps): React.ReactElement {
  const currentValue = useMemo(() => {
    // Use last envelope point as the "current" value the user is shifting.
    // For static moves (env length=2 with same value), this is the constant.
    const env = move.envelope;
    if (env.length === 0) return move.original;
    return env[env.length - 1]![1];
  }, [move.envelope, move.original]);

  const sliderRange = pickSliderRange(currentValue, move.original);

  return (
    <div
      data-testid="move-editor"
      className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(20,20,22,0.95)] p-3 text-xs text-white shadow-lg w-64"
      role="dialog"
      aria-label="Move editor"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">{move.param}</div>
        <button
          type="button"
          data-testid="move-editor-close"
          onClick={onClose}
          aria-label="Close move editor"
          className="text-[rgba(255,255,255,0.5)] hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="text-[10px] text-[rgba(255,255,255,0.5)] mb-2">
        @ {move.startSec.toFixed(2)}s — {move.reason || "(no reason)"}
      </div>

      <label className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] text-[rgba(255,255,255,0.6)] w-10">Value</span>
        <input
          type="range"
          data-testid="move-editor-value"
          min={sliderRange.min}
          max={sliderRange.max}
          step={sliderRange.step}
          value={currentValue}
          onChange={(e) => onChangeValue(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-[10px] tabular-nums w-12 text-right">
          {currentValue.toFixed(2)}
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="move-editor-mute"
          aria-pressed={move.muted}
          onClick={onToggleMute}
          className={`flex-1 rounded px-2 py-1 text-[10px] transition-colors ${
            move.muted
              ? "bg-[rgba(255,59,48,0.2)] text-[#ff453a]"
              : "bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)]"
          }`}
        >
          {move.muted ? "Muted" : "Mute"}
        </button>
        <button
          type="button"
          data-testid="move-editor-reset"
          onClick={onReset}
          disabled={!move.edited && !move.muted}
          className="flex-1 rounded px-2 py-1 text-[10px] bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function pickSliderRange(
  currentValue: number,
  original: number,
): { min: number; max: number; step: number } {
  // Pick a sensible range based on the magnitude of the original value:
  //  - small magnitudes (e.g., dB / pct) → ±20 around original
  //  - large magnitudes (e.g., Hz, ms)  → original × 0.25 .. × 4
  const ref = Math.max(Math.abs(original), Math.abs(currentValue), 0.001);
  if (ref < 100) {
    return { min: original - 20, max: original + 20, step: 0.1 };
  }
  return { min: ref * 0.25, max: ref * 4, step: ref / 100 };
}
