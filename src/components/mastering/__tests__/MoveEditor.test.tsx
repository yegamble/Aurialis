import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoveEditor } from "../MoveEditor";
import type { Move } from "@/types/deep-mastering";

function move(overrides: Partial<Move> = {}): Move {
  return {
    id: "m1",
    param: "master.compressor.threshold",
    startSec: 0,
    endSec: 1,
    envelope: [
      [0, -24],
      [1, -18],
    ],
    reason: "Tighten chorus low end",
    original: -24,
    edited: false,
    muted: false,
    ...overrides,
  };
}

describe("MoveEditor (T15)", () => {
  it("renders the move param, time, and reason", () => {
    render(
      <MoveEditor
        move={move()}
        onChangeValue={vi.fn()}
        onToggleMute={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/master\.compressor\.threshold/)).toBeInTheDocument();
    expect(screen.getByText(/Tighten chorus low end/)).toBeInTheDocument();
  });

  it("dragging the value slider invokes onChangeValue with the new value", () => {
    const onChangeValue = vi.fn();
    render(
      <MoveEditor
        move={move()}
        onChangeValue={onChangeValue}
        onToggleMute={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const slider = screen.getByTestId("move-editor-value");
    fireEvent.change(slider, { target: { value: "-21" } });
    expect(onChangeValue).toHaveBeenCalledWith(-21);
  });

  it("Mute button calls onToggleMute and reflects muted state", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <MoveEditor
        move={move()}
        onChangeValue={vi.fn()}
        onToggleMute={onToggle}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("move-editor-mute"));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      <MoveEditor
        move={move({ muted: true })}
        onChangeValue={vi.fn()}
        onToggleMute={onToggle}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("move-editor-mute")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Reset is disabled when not edited or muted, and enabled otherwise", () => {
    const { rerender } = render(
      <MoveEditor
        move={move()}
        onChangeValue={vi.fn()}
        onToggleMute={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("move-editor-reset")).toBeDisabled();
    rerender(
      <MoveEditor
        move={move({ edited: true })}
        onChangeValue={vi.fn()}
        onToggleMute={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("move-editor-reset")).not.toBeDisabled();
  });

  it("Reset button invokes onReset", () => {
    const onReset = vi.fn();
    render(
      <MoveEditor
        move={move({ edited: true })}
        onChangeValue={vi.fn()}
        onToggleMute={vi.fn()}
        onReset={onReset}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("move-editor-reset"));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("Close button invokes onClose", () => {
    const onClose = vi.fn();
    render(
      <MoveEditor
        move={move()}
        onChangeValue={vi.fn()}
        onToggleMute={vi.fn()}
        onReset={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("move-editor-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
