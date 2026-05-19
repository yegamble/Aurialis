import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

describe("Sidebar", () => {
  it("renders a navigation landmark", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders the four primary nav items", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("button", { name: /Library/i })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Smart Master Album/i })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Smart Split/i })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /Import/i })).toBeInTheDocument();
  });

  it.each([
    ["Library", "library"],
    ["Smart Master Album", "album"],
    ["Smart Split", "stems"],
    ["Import", "upload"],
  ] as const)("fires onSelect('%s') when '%s' is clicked", (label, expected) => {
    const onSelect = vi.fn();
    render(<Sidebar activeScreen="library" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
    expect(onSelect).toHaveBeenCalledWith(expected);
  });

  it("marks the active screen with aria-current='page'", () => {
    render(<Sidebar activeScreen="album" onSelect={vi.fn()} />);
    const album = screen.getByRole("button", { name: /Smart Master Album/i });
    expect(album).toHaveAttribute("aria-current", "page");
    const library = screen.getByRole("button", { name: /Library/i });
    expect(library).not.toHaveAttribute("aria-current", "page");
  });

  it("renders track items when tracks are provided", () => {
    const tracks = [
      { id: "fp-1", title: "Velvet Static" },
      { id: "fp-2", title: "Slow Run" },
    ];
    const onSelectTrack = vi.fn();
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        tracks={tracks}
        activeTrackId={null}
        onSelectTrack={onSelectTrack}
      />,
    );
    expect(screen.getByText("Velvet Static")).toBeInTheDocument();
    expect(screen.getByText("Slow Run")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Velvet Static"));
    expect(onSelectTrack).toHaveBeenCalledWith("fp-1");
  });
});
