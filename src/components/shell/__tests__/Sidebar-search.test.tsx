import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

describe("Sidebar — search", () => {
  it("renders a search field with the design placeholder and ⌘K chip", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const search = screen.getByTestId("sidebar-search");
    expect(search).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search library")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });

  it("focuses the search field on a global ⌘K keydown", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText("Search library");
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(input).toHaveFocus();
  });

  it("focuses the search field on a global ctrl+K keydown", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText("Search library");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
  });

  it("filters the sidebar track list by case-insensitive substring on title", () => {
    const tracks = [
      { id: "t1", title: "Velvet Static" },
      { id: "t2", title: "Slow Run" },
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
    expect(screen.getByText("Velvet Static")).toBeInTheDocument();
    expect(screen.getByText("Slow Run")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search library"), {
      target: { value: "sl" },
    });

    expect(screen.getByText("Slow Run")).toBeInTheDocument();
    expect(screen.queryByText("Velvet Static")).not.toBeInTheDocument();
    expect(screen.queryByText("Honey Walls")).not.toBeInTheDocument();
  });
});
