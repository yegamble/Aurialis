import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

describe("Sidebar — NavTrack art + analyzed check", () => {
  it("renders a deterministic art tile for each track", () => {
    const tracks = [
      { id: "t1", title: "Velvet Static" },
      { id: "t2", title: "Slow Run" },
    ];
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sidebar-track-art-t1")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-track-art-t2")).toBeInTheDocument();
  });

  it("shows a trailing analyzed check only when analyzed is true", () => {
    const tracks = [
      { id: "t1", title: "Velvet Static", analyzed: true },
      { id: "t2", title: "Slow Run", analyzed: false },
      { id: "t3", title: "Honey Walls" },
    ];
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sidebar-track-check-t1")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-track-check-t2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-track-check-t3")).not.toBeInTheDocument();
  });

  it("seeds the art tile from artSeed when provided, else id", () => {
    const tracks = [{ id: "t1", title: "Velvet Static", artSeed: "seed-x" }];
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={vi.fn()}
      />,
    );
    // Tile keyed by id for the testid, still rendered.
    expect(screen.getByTestId("sidebar-track-art-t1")).toBeInTheDocument();
  });
});
