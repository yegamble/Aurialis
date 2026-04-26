"use client";

/**
 * DeepTimeline — read-only visualization of the active mastering script.
 *
 * Layout (top → bottom):
 *   - Section bands strip (24 px) — one band per `Section`, type label
 *   - 5 lanes × 32 px:
 *       Volume       (master.inputGain, compressor.makeup)
 *       EQ           (master.eq.bandN.gain)
 *       Comp/Sat     (compressor.{threshold, ratio}, saturation.drive)
 *       Width        (master.stereoWidth.width)
 *       AI Repair    (master.aiRepair.amount) — distinct accent + badge
 *
 * Each Move is rendered as a marker at its `startSec` on the appropriate
 * lane. Hovering a marker shows the move's `reason` in a tooltip. T15 wires
 * click → MoveEditor popover.
 *
 * v1 uses absolutely-positioned DOM markers — script generators target
 * <30 moves per track, so React rerender cost stays well below the
 * canvas-vs-DOM threshold. Move to canvas in a perf pass if move counts grow.
 */

import { useMemo, useState } from "react";
import type {
  MasteringScript,
  Move,
  MoveParam,
  Section,
} from "@/types/deep-mastering";
import { useDeepStore } from "@/lib/stores/deep-store";
import { MoveEditor } from "./MoveEditor";

const LANE_HEIGHT = 32;
const SECTIONS_HEIGHT = 24;

export const TIMELINE_LANES = [
  { id: "volume", label: "Volume" },
  { id: "eq", label: "EQ" },
  { id: "comp", label: "Comp/Sat" },
  { id: "width", label: "Width" },
  { id: "airepair", label: "AI Repair" },
] as const;

export type LaneId = (typeof TIMELINE_LANES)[number]["id"];

/** Map MoveParam → lane id. The AI Repair lane gets its own dedicated row. */
export function laneForParam(param: MoveParam): LaneId {
  if (param.startsWith("master.eq.")) return "eq";
  if (
    param === "master.compressor.threshold" ||
    param === "master.compressor.ratio" ||
    param === "master.saturation.drive"
  )
    return "comp";
  if (param === "master.stereoWidth.width") return "width";
  if (param === "master.aiRepair.amount") return "airepair";
  // Default (inputGain, compressor.makeup, attack, release) → volume lane.
  return "volume";
}

export interface DeepTimelineProps {
  script: MasteringScript | null;
  /** Optional click handler — T15 wires this to the MoveEditor popover. */
  onMoveClick?: (move: Move) => void;
}

export function DeepTimeline({
  script,
  onMoveClick,
}: DeepTimelineProps): React.ReactElement {
  const [hoveredMoveId, setHoveredMoveId] = useState<string | null>(null);
  const [editingMoveId, setEditingMoveId] = useState<string | null>(null);
  const applyMoveEdit = useDeepStore((s) => s.applyMoveEdit);
  const resetMove = useDeepStore((s) => s.resetMove);
  const duration = script?.duration ?? 0;

  // Group moves by lane for stable rendering.
  const movesByLane = useMemo(() => {
    const map: Record<LaneId, Move[]> = {
      volume: [],
      eq: [],
      comp: [],
      width: [],
      airepair: [],
    };
    if (!script) return map;
    for (const move of script.moves) {
      map[laneForParam(move.param)].push(move);
    }
    return map;
  }, [script]);

  if (!script) {
    return (
      <div
        data-testid="deep-timeline-empty"
        className="rounded-md border border-dashed border-[rgba(255,255,255,0.1)] p-6 text-center text-xs text-[rgba(255,255,255,0.5)]"
      >
        No active script. Click Analyze to generate one.
      </div>
    );
  }

  return (
    <div
      data-testid="deep-timeline"
      className="relative rounded-md border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] overflow-hidden"
    >
      {/* Sections strip */}
      <div
        data-testid="deep-timeline-sections"
        className="relative w-full border-b border-[rgba(255,255,255,0.06)]"
        style={{ height: SECTIONS_HEIGHT }}
      >
        {script.sections.map((section) => (
          <SectionBand
            key={section.id}
            section={section}
            duration={duration}
          />
        ))}
      </div>

      {/* Lanes */}
      {TIMELINE_LANES.map((lane) => (
        <div
          key={lane.id}
          data-testid={`deep-timeline-lane-${lane.id}`}
          className="relative w-full border-b border-[rgba(255,255,255,0.04)] last:border-b-0"
          style={{ height: LANE_HEIGHT }}
        >
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.4)]">
            {lane.label}
          </span>
          {movesByLane[lane.id].map((move) => (
            <MoveMarker
              key={move.id}
              move={move}
              duration={duration}
              isHovered={hoveredMoveId === move.id}
              onHoverStart={() => setHoveredMoveId(move.id)}
              onHoverEnd={() => setHoveredMoveId(null)}
              onClick={() => {
                setEditingMoveId(move.id);
                onMoveClick?.(move);
              }}
              isAiRepair={lane.id === "airepair"}
            />
          ))}
        </div>
      ))}

      {editingMoveId && script && renderEditorOverlay(
        script,
        editingMoveId,
        () => setEditingMoveId(null),
        applyMoveEdit,
        resetMove,
      )}
    </div>
  );
}

function renderEditorOverlay(
  script: MasteringScript,
  editingMoveId: string,
  close: () => void,
  applyMoveEdit: ReturnType<typeof useDeepStore.getState>["applyMoveEdit"],
  resetMove: ReturnType<typeof useDeepStore.getState>["resetMove"],
): React.ReactNode {
  const move = script.moves.find((m) => m.id === editingMoveId);
  if (!move) return null;
  const left = (move.startSec / Math.max(script.duration, 0.001)) * 100;
  return (
    <div
      data-testid="deep-timeline-editor-overlay"
      className="absolute z-10"
      style={{ left: `${left}%`, top: SECTIONS_HEIGHT + LANE_HEIGHT * 5 + 4 }}
    >
      <MoveEditor
        move={move}
        onChangeValue={(v) => {
          // Shift the entire envelope by the delta from the last point's
          // value to keep the curve shape intact.
          const last = move.envelope[move.envelope.length - 1];
          const lastVal = last ? last[1] : move.original;
          const delta = v - lastVal;
          const next = move.envelope.map(([t, x]) => [t, x + delta] as [number, number]);
          applyMoveEdit(move.id, { envelope: next });
        }}
        onToggleMute={() => applyMoveEdit(move.id, { muted: !move.muted })}
        onReset={() => resetMove(move.id)}
        onClose={close}
      />
    </div>
  );
}

interface SectionBandProps {
  section: Section;
  duration: number;
}

function SectionBand({ section, duration }: SectionBandProps): React.ReactElement {
  const left = (section.startSec / duration) * 100;
  const width = ((section.endSec - section.startSec) / duration) * 100;
  return (
    <div
      data-testid={`deep-timeline-section-${section.id}`}
      className="absolute top-0 bottom-0 border-r border-[rgba(255,255,255,0.08)] flex items-center justify-center text-[10px] text-[rgba(255,255,255,0.6)]"
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      {section.type}
    </div>
  );
}

interface MoveMarkerProps {
  move: Move;
  duration: number;
  isHovered: boolean;
  isAiRepair: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onClick: () => void;
}

function MoveMarker({
  move,
  duration,
  isHovered,
  isAiRepair,
  onHoverStart,
  onHoverEnd,
  onClick,
}: MoveMarkerProps): React.ReactElement {
  const left = (move.startSec / duration) * 100;
  return (
    <button
      type="button"
      data-testid={`deep-timeline-move-${move.id}`}
      data-airepair={isAiRepair ? "true" : "false"}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={onHoverStart}
      onBlur={onHoverEnd}
      onClick={onClick}
      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
        move.muted
          ? "opacity-30"
          : isHovered
            ? "opacity-100 scale-125"
            : "opacity-80"
      } ${
        isAiRepair
          ? "bg-[#ff7a00] ring-1 ring-[rgba(255,255,255,0.3)]"
          : move.edited
            ? "bg-[#ffd60a]"
            : "bg-[#0a84ff]"
      }`}
      style={{ left: `${left}%`, width: 10, height: 10 }}
    >
      {isAiRepair && (
        <span
          data-testid={`deep-timeline-ai-badge-${move.id}`}
          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-wider text-[#ff7a00]"
        >
          AI
        </span>
      )}
      {isHovered && (
        <div
          role="tooltip"
          data-testid={`deep-timeline-tooltip-${move.id}`}
          className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[rgba(0,0,0,0.85)] px-2 py-1 text-[10px] text-white pointer-events-none"
        >
          {move.reason || `${move.param} @ ${move.startSec.toFixed(2)}s`}
        </div>
      )}
    </button>
  );
}
