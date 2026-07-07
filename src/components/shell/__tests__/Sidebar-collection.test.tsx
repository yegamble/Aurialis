import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

const tracks = [{ id: "t1", title: "Velvet Static" }];

describe("Sidebar — tracks group label", () => {
  it("defaults the tracks group label to 'Tracks'", () => {
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={vi.fn()}
      />,
    );
    expect(screen.getByText("Tracks")).toBeInTheDocument();
  });

  it("uses collectionTitle for the tracks group label when provided", () => {
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={vi.fn()}
        collectionTitle="Nightline EP"
      />,
    );
    expect(screen.getByText("Nightline EP")).toBeInTheDocument();
    expect(screen.queryByText("Tracks")).not.toBeInTheDocument();
  });
});
