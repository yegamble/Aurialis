import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SimpleMastering } from "../SimpleMastering";
import type { ToggleName } from "@/types/mastering";

const baseToggles: Record<ToggleName, boolean> = {
  cleanup: false,
  warm: false,
  bright: false,
  wide: false,
  loud: false,
  deharsh: false,
  glueComp: false,
};

const baseProps = {
  intensity: 50,
  onIntensityChange: vi.fn(),
  genre: "pop" as const,
  onGenreChange: vi.fn(),
  toggles: baseToggles,
  onToggle: vi.fn(),
  onAutoMaster: vi.fn(),
};

describe("SimpleMastering — Output Target", () => {
  it("renders the five platform targets and fires onOutputPresetChange", () => {
    const onOutputPresetChange = vi.fn();
    render(
      <SimpleMastering
        {...baseProps}
        outputPreset={null}
        onOutputPresetChange={onOutputPresetChange}
      />,
    );
    expect(screen.getByText("Output Target")).toBeInTheDocument();
    for (const label of ["Spotify", "Apple Music", "YouTube", "SoundCloud", "CD"]) {
      expect(
        screen.getByRole("button", { name: label, exact: true }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Apple Music", exact: true }));
    expect(onOutputPresetChange).toHaveBeenCalledWith("Apple Music");
  });

  it("marks the active target with aria-pressed", () => {
    render(
      <SimpleMastering
        {...baseProps}
        outputPreset="YouTube"
        onOutputPresetChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "YouTube", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Spotify", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("omits the Output Target section when no handler is provided", () => {
    render(<SimpleMastering {...baseProps} />);
    expect(screen.queryByText("Output Target")).toBeNull();
  });
});
