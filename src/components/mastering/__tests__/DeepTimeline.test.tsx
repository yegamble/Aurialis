import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeepTimeline, laneForParam, TIMELINE_LANES } from "../DeepTimeline";
import type { MasteringScript, Move, Section } from "@/types/deep-mastering";

function move(overrides: Partial<Move> = {}): Move {
  return {
    id: overrides.id ?? "m1",
    param: overrides.param ?? "master.compressor.threshold",
    startSec: overrides.startSec ?? 1,
    endSec: overrides.endSec ?? 2,
    envelope: overrides.envelope ?? [
      [0, 0],
      [1, 1],
    ],
    reason: overrides.reason ?? "test reason",
    original: overrides.original ?? 0,
    edited: overrides.edited ?? false,
    muted: overrides.muted ?? false,
  };
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: overrides.id ?? "s1",
    type: overrides.type ?? "verse",
    startSec: overrides.startSec ?? 0,
    endSec: overrides.endSec ?? 5,
    loudnessLufs: overrides.loudnessLufs ?? -14,
    spectralCentroidHz: overrides.spectralCentroidHz ?? 2000,
  };
}

function script(moves: Move[], sections: Section[]): MasteringScript {
  return {
    version: 1,
    trackId: "test",
    sampleRate: 44100,
    duration: 30,
    profile: "modern_pop_polish",
    sections,
    moves,
  };
}

describe("DeepTimeline (T14)", () => {
  it("renders empty state when script is null", () => {
    render(<DeepTimeline script={null} />);
    expect(screen.getByTestId("deep-timeline-empty")).toBeInTheDocument();
  });

  it("renders an empty timeline (no crash) when moves/sections are malformed", () => {
    // A malformed backend envelope can hand us a script whose `moves` is not
    // an array. The timeline must render lanes empty, not throw
    // "script.moves is not iterable".
    const malformed = {
      version: 1,
      trackId: "test",
      sampleRate: 44100,
      duration: 30,
      profile: "modern_pop_polish",
      sections: undefined,
      moves: undefined,
    } as unknown as MasteringScript;
    expect(() => render(<DeepTimeline script={malformed} />)).not.toThrow();
    expect(screen.getByTestId("deep-timeline")).toBeInTheDocument();
    for (const lane of TIMELINE_LANES) {
      expect(
        screen.getByTestId(`deep-timeline-lane-${lane.id}`),
      ).toBeInTheDocument();
    }
  });

  it("renders 5 lanes (Volume / EQ / Comp/Sat / Width / AI Repair)", () => {
    render(
      <DeepTimeline script={script([], [section()])} />,
    );
    expect(TIMELINE_LANES).toHaveLength(5);
    for (const lane of TIMELINE_LANES) {
      expect(
        screen.getByTestId(`deep-timeline-lane-${lane.id}`),
      ).toBeInTheDocument();
    }
  });

  it("renders section bands", () => {
    const sections = [
      section({ id: "s1", type: "verse" }),
      section({ id: "s2", type: "chorus", startSec: 5, endSec: 12 }),
    ];
    render(<DeepTimeline script={script([], sections)} />);
    expect(screen.getByTestId("deep-timeline-section-s1")).toBeInTheDocument();
    expect(screen.getByTestId("deep-timeline-section-s2")).toBeInTheDocument();
  });

  it("places markers on the correct lane based on param", () => {
    const moves = [
      move({ id: "v", param: "master.compressor.makeup" }), // volume
      move({ id: "e", param: "master.eq.band1.gain" }), // eq
      move({ id: "c", param: "master.compressor.threshold" }), // comp
      move({ id: "w", param: "master.stereoWidth.width" }), // width
      move({ id: "a", param: "master.aiRepair.amount" }), // airepair
    ];
    render(<DeepTimeline script={script(moves, [section()])} />);
    expect(
      within("deep-timeline-lane-volume", "deep-timeline-move-v"),
    ).toBeTruthy();
    expect(
      within("deep-timeline-lane-eq", "deep-timeline-move-e"),
    ).toBeTruthy();
    expect(
      within("deep-timeline-lane-comp", "deep-timeline-move-c"),
    ).toBeTruthy();
    expect(
      within("deep-timeline-lane-width", "deep-timeline-move-w"),
    ).toBeTruthy();
    expect(
      within("deep-timeline-lane-airepair", "deep-timeline-move-a"),
    ).toBeTruthy();
  });

  it("renders the AI badge on AI Repair markers (visual differentiator for TS-003)", () => {
    const moves = [move({ id: "ai1", param: "master.aiRepair.amount" })];
    render(<DeepTimeline script={script(moves, [section()])} />);
    const badge = screen.getByTestId("deep-timeline-ai-badge-ai1");
    expect(badge).toBeInTheDocument();
    expect(screen.getByTestId("deep-timeline-move-ai1")).toHaveAttribute(
      "data-airepair",
      "true",
    );
  });

  it("hovering a marker shows the move's reason as a tooltip", () => {
    const moves = [
      move({
        id: "h1",
        reason: "Tighten chorus low end",
      }),
    ];
    render(<DeepTimeline script={script(moves, [section()])} />);
    const marker = screen.getByTestId("deep-timeline-move-h1");
    fireEvent.mouseEnter(marker);
    expect(screen.getByTestId("deep-timeline-tooltip-h1")).toHaveTextContent(
      "Tighten chorus low end",
    );
  });

  it("clicking a marker invokes onMoveClick", () => {
    const onClick = vi.fn();
    const moves = [move({ id: "c1" })];
    render(
      <DeepTimeline script={script(moves, [section()])} onMoveClick={onClick} />,
    );
    fireEvent.click(screen.getByTestId("deep-timeline-move-c1"));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick.mock.calls[0]![0]!.id).toBe("c1");
  });
});

describe("laneForParam (T14)", () => {
  it.each<[string, string]>([
    ["master.compressor.makeup", "volume"],
    ["master.eq.band1.gain", "eq"],
    ["master.eq.band5.gain", "eq"],
    ["master.compressor.threshold", "comp"],
    ["master.compressor.ratio", "comp"],
    ["master.saturation.drive", "comp"],
    ["master.stereoWidth.width", "width"],
    ["master.aiRepair.amount", "airepair"],
  ])("%s → %s", (param, expected) => {
    expect(laneForParam(param as Parameters<typeof laneForParam>[0])).toBe(
      expected,
    );
  });
});

/** Small helper — assert moveTestId exists inside laneTestId. */
function within(laneTestId: string, moveTestId: string): boolean {
  const lane = screen.getByTestId(laneTestId);
  const move = lane.querySelector(`[data-testid="${moveTestId}"]`);
  return move !== null;
}

describe("DeepTimeline envelope rendering (whole-track moves)", () => {
  // Real scripts emit one whole-track envelope move per parameter
  // (startSec = 0) — the timeline must show the envelope's breakpoints
  // across the lane, not a single dot clipped at x=0.
  const envelopeMove = () =>
    move({
      id: "env1",
      param: "master.inputGain",
      startSec: 0,
      endSec: 30,
      envelope: [
        [0, 0],
        [10, 0], // flat — no breakpoint
        [15, 2], // change
        [20, 2], // flat — no breakpoint
        [25, -1], // change
      ],
    });

  it("renders a dot per value-changing breakpoint plus the step line", () => {
    render(<DeepTimeline script={script([envelopeMove()], [section()])} />);
    // Primary marker keeps the stable testid; extra breakpoints are suffixed.
    expect(screen.getByTestId("deep-timeline-move-env1")).toBeInTheDocument();
    expect(
      screen.getByTestId("deep-timeline-move-env1-bp-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("deep-timeline-move-env1-bp-2"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("deep-timeline-move-env1-bp-3"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("deep-timeline-envelope-env1"),
    ).toBeInTheDocument();
  });

  it("clamps the startSec=0 marker away from the lane edge (no half-clip)", () => {
    render(<DeepTimeline script={script([envelopeMove()], [section()])} />);
    const primary = screen.getByTestId("deep-timeline-move-env1");
    // jsdom mangles clamp() serialization — assert the parts, not the exact form.
    expect(primary.style.left).toContain("clamp(");
    expect(primary.style.left).toContain("8px");
    expect(primary.style.left).toContain("calc(100% - 8px)");
  });

  it("renders a flat envelope as a single centered dot without a step line", () => {
    const flat = move({
      id: "flat1",
      startSec: 0,
      envelope: [
        [0, 1],
        [30, 1],
      ],
    });
    render(<DeepTimeline script={script([flat], [section()])} />);
    expect(screen.getByTestId("deep-timeline-move-flat1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("deep-timeline-move-flat1-bp-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("deep-timeline-envelope-flat1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("deep-timeline-move-flat1").style.top).toBe(
      "50%",
    );
  });

  it("clicking a breakpoint dot opens the editor for the move", () => {
    const onMoveClick = vi.fn();
    render(
      <DeepTimeline
        script={script([envelopeMove()], [section()])}
        onMoveClick={onMoveClick}
      />,
    );
    fireEvent.click(screen.getByTestId("deep-timeline-move-env1-bp-2"));
    expect(onMoveClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: "env1" }),
    );
    expect(
      screen.getByTestId("deep-timeline-editor-overlay"),
    ).toBeInTheDocument();
  });
});
