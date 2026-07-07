import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MasterPage from "../page";
import { useAudioStore } from "@/lib/stores/audio-store";

// jsdom has no 2D canvas. The mastering workspace embeds canvas visualizers
// (WaveformDisplay / SpectrumDisplay); stub getContext with a no-op proxy so the
// real page structure mounts and this test exercises shell composition, not the
// pixel-level draw code (covered elsewhere by e2e).
beforeEach(() => {
  const ctxProxy: unknown = new Proxy(
    {},
    {
      get: () => () => ctxProxy,
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctxProxy,
  ) as unknown as HTMLCanvasElement["getContext"];
});

// Keep the unified shell deterministic (desktop layout).
vi.mock("@/hooks/use-is-lg-viewport", () => ({
  useIsLgViewport: () => true,
}));

// next/navigation's useRouter needs the App Router context, absent under RTL.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe("MasterPage shell composition", () => {
  beforeEach(() => {
    // A file must be present or the page redirects to "/".
    useAudioStore
      .getState()
      .setFile(new File([new Uint8Array(16)], "track.wav", { type: "audio/wav" }));
  });

  it("renders the mastering workspace inside the unified AppShell", () => {
    render(<MasterPage />);

    const shell = screen.getByTestId("app-shell");
    expect(shell).toBeInTheDocument();

    // The nav Sidebar is part of the shell and Master is the active screen.
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("pro-mode-toggle")).toBeInTheDocument();

    // The mastering workspace (readouts + inspector rail) renders inside the shell.
    expect(within(shell).getByTestId("master-readouts")).toBeInTheDocument();
    expect(within(shell).getByTestId("master-right-rail")).toBeInTheDocument();
  });
});
