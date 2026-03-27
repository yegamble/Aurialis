import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ABToggle } from "../ABToggle";

describe("ABToggle", () => {
  it("shows 'A' and 'Processed' when inactive", () => {
    render(<ABToggle isActive={false} onToggle={vi.fn()} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("Processed")).toBeInTheDocument();
  });

  it("shows 'B' and 'Bypass' when active", () => {
    render(<ABToggle isActive={true} onToggle={vi.fn()} />);
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("Bypass")).toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<ABToggle isActive={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("has correct aria-pressed attribute", () => {
    const { rerender } = render(<ABToggle isActive={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(<ABToggle isActive={true} onToggle={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("has data-testid='ab-toggle'", () => {
    render(<ABToggle isActive={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId("ab-toggle")).toBeInTheDocument();
  });
});
