import { describe, it, expect, beforeEach } from "vitest";
import { useDeepStore } from "../deep-store";
import type { MasteringScript, Move } from "@/types/deep-mastering";

const buildMove = (overrides: Partial<Move> = {}): Move => ({
  id: "m1",
  param: "master.compressor.threshold",
  startSec: 0,
  endSec: 10,
  envelope: [
    [0, -24],
    [10, -18],
  ],
  reason: "test",
  original: -24,
  edited: false,
  muted: false,
  ...overrides,
});

const buildScript = (moves: Move[] = [buildMove()]): MasteringScript => ({
  version: 1,
  trackId: "t1",
  sampleRate: 48000,
  duration: 30,
  profile: "modern_pop_polish",
  sections: [],
  moves,
});

describe("deepStore", () => {
  beforeEach(() => {
    useDeepStore.getState().reset();
  });

  it("starts in idle state with no script", () => {
    const s = useDeepStore.getState();
    expect(s.status).toBe("idle");
    expect(s.script).toBeNull();
    expect(s.subStatus).toBeNull();
    expect(s.scriptActive).toBe(true);
  });

  it("setStatus updates status", () => {
    useDeepStore.getState().setStatus("analyzing");
    expect(useDeepStore.getState().status).toBe("analyzing");
  });

  it("setSubStatus updates subStatus", () => {
    useDeepStore.getState().setSubStatus("sections");
    expect(useDeepStore.getState().subStatus).toBe("sections");
  });

  it("setProfile updates profile id", () => {
    useDeepStore.getState().setProfile("metal_wall");
    expect(useDeepStore.getState().profile).toBe("metal_wall");
  });

  it("setScript replaces script", () => {
    const script = buildScript();
    useDeepStore.getState().setScript(script);
    expect(useDeepStore.getState().script).toEqual(script);
  });

  it("applyMoveEdit patches move and flips edited", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("m1", { muted: true });
    const move = useDeepStore.getState().script!.moves[0]!;
    expect(move.muted).toBe(true);
    expect(move.edited).toBe(true);
    expect(move.original).toBe(-24); // original preserved
  });

  it("applyMoveEdit on missing moveId is a no-op", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("nonexistent", { muted: true });
    expect(useDeepStore.getState().script!.moves[0]!.muted).toBe(false);
  });

  it("hasEditedMoves is false when none edited", () => {
    useDeepStore.getState().setScript(buildScript());
    expect(useDeepStore.getState().hasEditedMoves()).toBe(false);
  });

  it("hasEditedMoves is true after edit", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().applyMoveEdit("m1", { muted: true });
    expect(useDeepStore.getState().hasEditedMoves()).toBe(true);
  });

  it("resetMove restores original value and clears edited flag", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore
      .getState()
      .applyMoveEdit("m1", { muted: true });
    expect(useDeepStore.getState().script!.moves[0]!.edited).toBe(true);
    useDeepStore.getState().resetMove("m1");
    const m = useDeepStore.getState().script!.moves[0]!;
    expect(m.edited).toBe(false);
    expect(m.muted).toBe(false);
  });

  it("setScriptActive toggles A/B without disturbing script", () => {
    const script = buildScript();
    useDeepStore.getState().setScript(script);
    useDeepStore.getState().setScriptActive(false);
    expect(useDeepStore.getState().scriptActive).toBe(false);
    expect(useDeepStore.getState().script).toEqual(script);
  });

  it("reset clears all state", () => {
    useDeepStore.getState().setScript(buildScript());
    useDeepStore.getState().setStatus("ready");
    useDeepStore.getState().setSubStatus("script");
    useDeepStore.getState().reset();
    const s = useDeepStore.getState();
    expect(s.script).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.subStatus).toBeNull();
    expect(s.scriptActive).toBe(true);
  });
});
