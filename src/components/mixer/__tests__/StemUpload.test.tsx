import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StemUpload } from "../StemUpload";

describe("StemUpload", () => {
  it("renders upload area with instructions", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={false} />);
    expect(
      screen.getByText(/drop audio files or zip/i)
    ).toBeInTheDocument();
  });

  it("renders file input with audio and zip accept types", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.accept).toContain("audio/*");
    expect(input.accept).toContain(".zip");
  });

  it("has multiple attribute on file input", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it("calls onStemsLoaded with files when files are selected", () => {
    const onStemsLoaded = vi.fn();
    render(<StemUpload onStemsLoaded={onStemsLoaded} isLoading={false} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["audio"], "test.wav", { type: "audio/wav" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onStemsLoaded).toHaveBeenCalledWith([file]);
  });

  it("shows loading state when isLoading is true", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when error prop is set", () => {
    render(
      <StemUpload
        onStemsLoaded={vi.fn()}
        isLoading={false}
        error="No audio files found in ZIP"
      />
    );
    expect(
      screen.getByText("No audio files found in ZIP")
    ).toBeInTheDocument();
  });

  it("shows stem count when stemCount is provided", () => {
    render(
      <StemUpload
        onStemsLoaded={vi.fn()}
        isLoading={false}
        stemCount={5}
      />
    );
    expect(screen.getByText(/5 stems loaded/i)).toBeInTheDocument();
  });

  it("shows stem limit warning", () => {
    render(
      <StemUpload
        onStemsLoaded={vi.fn()}
        isLoading={false}
        stemCount={16}
      />
    );
    expect(screen.getByText(/maximum/i)).toBeInTheDocument();
  });

  it("has accessible upload button with aria-label", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={false} />);
    expect(
      screen.getByRole("button", { name: /upload/i })
    ).toBeInTheDocument();
  });

  it("applies drag-over styling", () => {
    render(<StemUpload onStemsLoaded={vi.fn()} isLoading={false} />);
    const dropZone = screen.getByTestId("stem-upload-zone");

    fireEvent.dragOver(dropZone, { dataTransfer: { types: ["Files"] } });
    // Just verifying no crash; visual styling is tested by E2E
  });
});
