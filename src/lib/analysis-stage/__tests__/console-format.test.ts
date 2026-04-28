import { describe, it, expect } from "vitest";
import {
  formatPrefix,
  formatElapsed,
  formatLine,
} from "../console-format";
import type { AnalysisStageEvent } from "../types";

describe("formatPrefix", () => {
  it("renders flow:stage in brackets", () => {
    expect(formatPrefix("deep", "stems")).toBe("[analysis:deep:stems]");
    expect(formatPrefix("smart-split", "queued")).toBe(
      "[analysis:smart-split:queued]"
    );
    expect(formatPrefix("mastering-auto", "loudness")).toBe(
      "[analysis:mastering-auto:loudness]"
    );
    expect(formatPrefix("auto-mix", "stem-2/4")).toBe(
      "[analysis:auto-mix:stem-2/4]"
    );
  });
});

describe("formatElapsed", () => {
  it("renders ms < 60s as +Ns with one decimal", () => {
    expect(formatElapsed(0)).toBe("+0.0s");
    expect(formatElapsed(1200)).toBe("+1.2s");
    expect(formatElapsed(12345)).toBe("+12.3s");
    expect(formatElapsed(59900)).toBe("+59.9s");
  });

  it("renders >= 60s as +NmSSs", () => {
    expect(formatElapsed(60_000)).toBe("+1m00s");
    expect(formatElapsed(62_000)).toBe("+1m02s");
    expect(formatElapsed(125_000)).toBe("+2m05s");
    expect(formatElapsed(3_660_000)).toBe("+61m00s");
  });

  it("clamps negative inputs to +0.0s", () => {
    expect(formatElapsed(-5)).toBe("+0.0s");
  });
});

describe("formatLine", () => {
  const baseEvent: AnalysisStageEvent = {
    flow: "deep",
    runId: "run-1",
    stage: "stems",
    phase: "start",
    at: 1000,
  };

  it("includes prefix and elapsed", () => {
    const line = formatLine(baseEvent, 0);
    expect(line).toContain("[analysis:deep:stems]");
    expect(line).toContain("+1.0s");
  });

  it("omits progress suffix when progress is undefined", () => {
    const line = formatLine(baseEvent, 0);
    expect(line).not.toContain("(progress:");
  });

  it("includes progress suffix when set", () => {
    const line = formatLine({ ...baseEvent, progress: 42 }, 0);
    expect(line).toContain("(progress: 42%)");
  });

  it("includes note when set", () => {
    const line = formatLine({ ...baseEvent, note: "queued by backend" }, 0);
    expect(line).toContain("queued by backend");
  });

  it("uses elapsed relative to runStartedAt, not absolute at", () => {
    const line = formatLine(
      { ...baseEvent, at: 5500, phase: "end" },
      4000
    );
    expect(line).toContain("+1.5s");
  });
});
