import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MixToolbar } from "../MixToolbar";

describe("MixToolbar", () => {
  const baseProps = {
    onBack: vi.fn(),
    hasStemsLoaded: false,
    smartRepairEnabled: false,
    onSmartRepairToggle: vi.fn(),
    onAutoMix: vi.fn(),
    autoMixDisabled: false,
    autoMixLabel: "Auto Mix",
    onSendToMaster: vi.fn(),
    sendDisabled: false,
    onExportMix: vi.fn(),
    exportDisabled: false,
  };

  it("always renders the back button", () => {
    render(<MixToolbar {...baseProps} />);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("invokes onBack when the back button is clicked", () => {
    const onBack = vi.fn();
    render(<MixToolbar {...baseProps} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders the 'Mix' brand label", () => {
    render(<MixToolbar {...baseProps} />);
    expect(screen.getByTestId("mix-toolbar")).toHaveTextContent(/Mix/);
  });

  it("hides the action buttons when no stems are loaded", () => {
    render(<MixToolbar {...baseProps} hasStemsLoaded={false} />);
    expect(screen.queryByRole("button", { name: /smart repair/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("auto-mix-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send to master/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export mix/i })).not.toBeInTheDocument();
  });

  it("renders all four action buttons when stems are loaded", () => {
    render(<MixToolbar {...baseProps} hasStemsLoaded />);
    expect(screen.getByRole("button", { name: /smart repair/i })).toBeInTheDocument();
    expect(screen.getByTestId("auto-mix-button")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send to master/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export mix/i })).toBeInTheDocument();
  });

  it("Smart Repair button aria-pressed reflects state", () => {
    const { rerender } = render(
      <MixToolbar {...baseProps} hasStemsLoaded smartRepairEnabled={false} />,
    );
    expect(screen.getByRole("button", { name: /smart repair/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<MixToolbar {...baseProps} hasStemsLoaded smartRepairEnabled />);
    expect(screen.getByRole("button", { name: /smart repair/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("fires onSmartRepairToggle when Smart Repair clicked", () => {
    const onSmartRepairToggle = vi.fn();
    render(
      <MixToolbar {...baseProps} hasStemsLoaded onSmartRepairToggle={onSmartRepairToggle} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /smart repair/i }));
    expect(onSmartRepairToggle).toHaveBeenCalledOnce();
  });

  it("fires onAutoMix when Auto Mix clicked, respects autoMixDisabled", () => {
    const onAutoMix = vi.fn();
    const { rerender } = render(
      <MixToolbar {...baseProps} hasStemsLoaded onAutoMix={onAutoMix} />,
    );
    fireEvent.click(screen.getByTestId("auto-mix-button"));
    expect(onAutoMix).toHaveBeenCalledOnce();

    onAutoMix.mockClear();
    rerender(
      <MixToolbar {...baseProps} hasStemsLoaded onAutoMix={onAutoMix} autoMixDisabled />,
    );
    expect(screen.getByTestId("auto-mix-button")).toBeDisabled();
  });

  it("uses autoMixLabel for Auto Mix button text", () => {
    render(
      <MixToolbar
        {...baseProps}
        hasStemsLoaded
        autoMixLabel="Auto-mixing… loudness"
      />,
    );
    expect(screen.getByTestId("auto-mix-button")).toHaveTextContent("Auto-mixing… loudness");
  });

  it("fires onSendToMaster + onExportMix and honors their disabled flags", () => {
    const onSendToMaster = vi.fn();
    const onExportMix = vi.fn();
    const { rerender } = render(
      <MixToolbar
        {...baseProps}
        hasStemsLoaded
        onSendToMaster={onSendToMaster}
        onExportMix={onExportMix}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send to master/i }));
    fireEvent.click(screen.getByRole("button", { name: /export mix/i }));
    expect(onSendToMaster).toHaveBeenCalledOnce();
    expect(onExportMix).toHaveBeenCalledOnce();

    rerender(
      <MixToolbar
        {...baseProps}
        hasStemsLoaded
        sendDisabled
        exportDisabled
        onSendToMaster={onSendToMaster}
        onExportMix={onExportMix}
      />,
    );
    expect(screen.getByRole("button", { name: /send to master/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /export mix/i })).toBeDisabled();
  });
});
