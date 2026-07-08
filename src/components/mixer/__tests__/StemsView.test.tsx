import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StemsView } from "../StemsView";
import { useMixerStore } from "@/lib/stores/mixer-store";
import { DEFAULT_CHANNEL_PARAMS, STEM_COLORS } from "@/types/mixer";
import type { StemTrack } from "@/types/mixer";

function seedStem(): StemTrack {
  return {
    id: "stem-1",
    name: "vocals.wav",
    audioBuffer: null,
    waveformPeaks: [],
    classification: "vocals",
    confidence: 0.9,
    channelParams: { ...DEFAULT_CHANNEL_PARAMS },
    offset: 0,
    duration: 10,
    color: STEM_COLORS[0],
  };
}

// Keep the unified shell deterministic.
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

describe("StemsView", () => {
  beforeEach(() => {
    useMixerStore.getState().reset();
  });

  it("renders the unified shell + the stem-upload landing when no stems are loaded", () => {
    render(<StemsView />);
    // Direction A: the nav Sidebar is present (Smart Split is this screen).
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Smart Split/i }),
    ).toBeInTheDocument();
    // No stems yet → the upload dropzone is shown.
    expect(screen.getByText(/Drop audio files or ZIP/i)).toBeInTheDocument();
  });

  it("composes the shared AppShell workspace (mixer content lives inside app-shell)", () => {
    render(<StemsView />);
    const shell = screen.getByTestId("app-shell");
    expect(shell).toBeInTheDocument();
    // Sidebar + Pro Mode toggle thread through the shell.
    expect(within(shell).getByTestId("sidebar")).toBeInTheDocument();
    expect(within(shell).getByTestId("pro-mode-toggle")).toBeInTheDocument();
    // The mixer workspace renders inside the shell (a single role="main" region).
    expect(within(shell).getByRole("main")).toBeInTheDocument();
    expect(
      within(shell).getByText(/Drop audio files or ZIP/i),
    ).toBeInTheDocument();
  });

  it("shows the send-to-master CTA card once stems are loaded", () => {
    useMixerStore.getState().addStems([seedStem()]);
    render(<StemsView />);
    const card = screen.getByTestId("send-to-master-card");
    expect(card).toHaveTextContent(/Send these stems to mastering/i);
    expect(
      within(card).getByRole("button", { name: /Smart Mix/i }),
    ).toBeInTheDocument();
  });
});
