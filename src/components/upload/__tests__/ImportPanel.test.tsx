import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportPanel } from "../ImportPanel";

describe("ImportPanel", () => {
  it("renders the Import eyebrow and Add audio title", () => {
    render(<ImportPanel onFilesUploaded={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/^Import$/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Add audio/i })).toBeInTheDocument();
  });

  it("exposes a file input for selection", () => {
    const { container } = render(
      <ImportPanel onFilesUploaded={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(<ImportPanel onFilesUploaded={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("opens the picker via the Choose files button", () => {
    render(<ImportPanel onFilesUploaded={vi.fn()} onCancel={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Choose files/i }),
    ).toBeInTheDocument();
  });
});
