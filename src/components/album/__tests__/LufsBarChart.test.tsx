import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LufsBarChart } from "../LufsBarChart";
import type { AlbumTrackRow } from "../AlbumView";

const tracks: AlbumTrackRow[] = [
  { id: "fp-1", title: "Velvet Static", lufs: -8.7, durationSec: 218 },
  { id: "fp-2", title: "Slow Run", lufs: -9.4, durationSec: 184 },
  { id: "fp-3", title: "Honey Walls", lufs: -11.2, durationSec: 245 },
  { id: "fp-4", title: "Backyard Bloom", lufs: null, durationSec: 201 },
];

describe("LufsBarChart", () => {
  it("renders the chart container", () => {
    render(<LufsBarChart tracks={tracks} target={-10} onOpen={vi.fn()} />);
    expect(screen.getByTestId("album-lufs-chart")).toBeInTheDocument();
  });

  it("renders one bar per measured track and excludes null-LUFS tracks", () => {
    render(<LufsBarChart tracks={tracks} target={-10} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId("album-lufs-bar")).toHaveLength(3);
  });

  it("renders null when no track has a measured LUFS", () => {
    const { container } = render(
      <LufsBarChart
        tracks={[{ id: "x", title: "None", lufs: null, durationSec: 10 }]}
        target={-10}
        onOpen={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the target line with '(target)'", () => {
    render(<LufsBarChart tracks={tracks} target={-10} onOpen={vi.fn()} />);
    expect(screen.getByText(/-10\.0 LUFS \(target\)/)).toBeInTheDocument();
  });

  it("shows a signed delta label per bar", () => {
    render(<LufsBarChart tracks={tracks} target={-10} onOpen={vi.fn()} />);
    // -8.7 - (-10) = +1.3 ; -11.2 - (-10) = -1.2
    expect(screen.getByText("+1.3")).toBeInTheDocument();
    expect(screen.getByText("−1.2")).toBeInTheDocument();
  });

  it("marks bars drifting more than 1.5 LU as drift", () => {
    // target -6 → -8.7 is 2.7 off (drift); -9.4 is 3.4 off (drift)
    render(<LufsBarChart tracks={tracks} target={-6} onOpen={vi.fn()} />);
    const drifting = screen
      .getAllByTestId("album-lufs-bar")
      .filter((b) => b.getAttribute("data-drift") === "true");
    expect(drifting.length).toBeGreaterThan(0);
  });

  it("opens the track when a bar is clicked", () => {
    const onOpen = vi.fn();
    render(<LufsBarChart tracks={tracks} target={-10} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByTestId("album-lufs-bar")[0]!);
    expect(onOpen).toHaveBeenCalledWith("fp-1");
  });
});
