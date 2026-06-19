import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { DeepMastering } from "../DeepMastering";
import { useDeepStore } from "@/lib/stores/deep-store";
import type { MasteringScript, Move } from "@/types/deep-mastering";
import { startDeepAnalysis } from "@/lib/api/deep-analysis";

// Mock the lg-viewport hook so tests run deterministically.
vi.mock("@/hooks/use-is-lg-viewport", () => ({
  useIsLgViewport: () => true,
}));

// Mock the analyze boundary so the profile-switch flow can be asserted
// without hitting the network. `startDeepAnalysis` rejecting with an
// AbortError keeps the run short and is swallowed silently by the component.
vi.mock("@/lib/api/deep-analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/deep-analysis")>();
  return {
    ...actual,
    startDeepAnalysis: vi.fn(() =>
      Promise.reject(new DOMException("test-abort", "AbortError")),
    ),
  };
});

describe("DeepMastering (T12 — panel skeleton)", () => {
  beforeEach(() => {
    act(() => {
      useDeepStore.getState().reset();
    });
  });

  it("renders the panel container with the deep-mastering test id", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-mastering-panel")).toBeInTheDocument();
  });

  it("renders the active profile name from the deep store", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-current-profile")).toHaveTextContent(
      "modern_pop_polish",
    );
  });

  it("renders an Analyze button (disabled in T12 — wired up in T17)", () => {
    render(<DeepMastering />);
    const button = screen.getByTestId("deep-analyze-button");
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("reflects deep-store status in the status line", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-status").textContent).toContain("idle");
    act(() => {
      useDeepStore.setState({ status: "analyzing", subStatus: "sections" });
    });
    expect(screen.getByTestId("deep-status").textContent).toContain(
      "analyzing",
    );
    expect(screen.getByTestId("deep-status").textContent).toContain(
      "sections",
    );
  });

  it("A/B toggle (T16) flips deepStore.scriptActive", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<DeepMastering />);
    const toggle = screen.getByTestId("deep-script-active-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(useDeepStore.getState().scriptActive).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(useDeepStore.getState().scriptActive).toBe(true);
  });
});

describe("DeepMastering (T17 — profile-switch discard guard)", () => {
  function makeMove(overrides: Partial<Move> = {}): Move {
    return {
      id: "m1",
      param: "master.inputGain",
      startSec: 0,
      endSec: 1,
      envelope: [
        [0, 0],
        [1, 0],
      ],
      reason: "test",
      original: 0,
      edited: false,
      muted: false,
      ...overrides,
    };
  }

  function makeDirtyScript(): MasteringScript {
    return {
      version: 1,
      trackId: "t1",
      sampleRate: 44100,
      duration: 10,
      profile: "modern_pop_polish",
      sections: [],
      moves: [makeMove({ edited: true })],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useDeepStore.getState().reset();
    });
  });

  function stageAndApply(targetCardId: string) {
    fireEvent.click(screen.getByTestId(`profile-card-${targetCardId}`));
    fireEvent.click(screen.getByTestId("profile-apply-button"));
  }

  it("opens a Radix confirmation dialog (not window.confirm) when switching with dirty edits", () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValue(true);
    act(() => {
      useDeepStore.setState({ script: makeDirtyScript() });
    });
    render(<DeepMastering audioFile={new File(["x"], "a.wav")} />);

    stageAndApply("metal_wall");

    // Radix dialog is rendered; window.confirm is NOT used.
    expect(
      screen.getByTestId("profile-switch-confirm-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByText(/discard your edits to 1 move/i)).toBeInTheDocument();
    expect(screen.getByText(/metal_wall/i)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("Cancel keeps the existing script and profile, and does NOT analyze", async () => {
    const beforeScript = makeDirtyScript();
    act(() => {
      useDeepStore.setState({ script: beforeScript });
    });
    render(<DeepMastering audioFile={new File(["x"], "a.wav")} />);

    stageAndApply("metal_wall");
    fireEvent.click(screen.getByTestId("profile-switch-cancel-button"));

    // Dialog dismissed, script + profile unchanged, analyze never started.
    await waitFor(() =>
      expect(
        screen.queryByTestId("profile-switch-confirm-dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(useDeepStore.getState().profile).toBe("modern_pop_polish");
    expect(useDeepStore.getState().script).toBe(beforeScript);
    expect(startDeepAnalysis).not.toHaveBeenCalled();
  });

  it("Confirm performs the switch (setProfile + runAnalyze)", async () => {
    act(() => {
      useDeepStore.setState({ script: makeDirtyScript() });
    });
    render(<DeepMastering audioFile={new File(["x"], "a.wav")} />);

    stageAndApply("metal_wall");
    fireEvent.click(screen.getByTestId("profile-switch-confirm-button"));

    // Profile switched in the store and the analyze flow was started.
    expect(useDeepStore.getState().profile).toBe("metal_wall");
    await waitFor(() =>
      expect(startDeepAnalysis).toHaveBeenCalledWith(
        expect.any(File),
        "metal_wall",
        expect.anything(),
      ),
    );
  });

  it("switching with NO dirty edits applies immediately without a dialog", async () => {
    act(() => {
      useDeepStore.setState({ script: null });
    });
    render(<DeepMastering audioFile={new File(["x"], "a.wav")} />);

    stageAndApply("metal_wall");

    expect(
      screen.queryByTestId("profile-switch-confirm-dialog"),
    ).not.toBeInTheDocument();
    expect(useDeepStore.getState().profile).toBe("metal_wall");
    await waitFor(() =>
      expect(startDeepAnalysis).toHaveBeenCalledWith(
        expect.any(File),
        "metal_wall",
        expect.anything(),
      ),
    );
  });
});

describe("DeepMastering (mobile fallback)", () => {
  it("renders desktop banner when viewport is < lg", () => {
    vi.resetModules();
    vi.doMock("@/hooks/use-is-lg-viewport", () => ({
      useIsLgViewport: () => false,
    }));
    return import("../DeepMastering").then(({ DeepMastering: MobileDeep }) => {
      render(<MobileDeep />);
      expect(
        screen.getByText(/Deep mode requires a larger screen/i),
      ).toBeInTheDocument();
    });
  });
});
