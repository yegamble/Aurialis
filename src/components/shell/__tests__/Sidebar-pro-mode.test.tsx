import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar";

describe("Sidebar — Pro Mode footer toggle", () => {
  it("does not render the Pro Mode toggle when proMode prop is omitted", () => {
    render(<Sidebar activeScreen="library" onSelect={vi.fn()} />);
    expect(screen.queryByTestId("pro-mode-toggle")).not.toBeInTheDocument();
  });

  it("renders the Pro Mode toggle when proMode + onProModeChange are provided", () => {
    render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode={false}
        onProModeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("pro-mode-toggle")).toBeInTheDocument();
    expect(screen.getByText(/Pro Mode/i)).toBeInTheDocument();
  });

  it("aria-pressed reflects proMode state", () => {
    const { rerender } = render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode={false}
        onProModeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("pro-mode-toggle")).toHaveAttribute("aria-pressed", "false");
    rerender(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode
        onProModeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("pro-mode-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onProModeChange with the inverse value when clicked", () => {
    const onProModeChange = vi.fn();
    const { rerender } = render(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode={false}
        onProModeChange={onProModeChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pro-mode-toggle"));
    expect(onProModeChange).toHaveBeenCalledWith(true);

    onProModeChange.mockClear();
    rerender(
      <Sidebar
        activeScreen="library"
        onSelect={vi.fn()}
        proMode
        onProModeChange={onProModeChange}
      />,
    );
    fireEvent.click(screen.getByTestId("pro-mode-toggle"));
    expect(onProModeChange).toHaveBeenCalledWith(false);
  });
});
