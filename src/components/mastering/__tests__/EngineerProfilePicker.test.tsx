import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  EngineerProfilePicker,
  PROFILE_CARDS,
} from "../EngineerProfilePicker";
import { useDeepStore } from "@/lib/stores/deep-store";

describe("EngineerProfilePicker (T13)", () => {
  beforeEach(() => {
    act(() => {
      useDeepStore.getState().reset();
    });
  });

  it("renders all 5 profile cards", () => {
    render(<EngineerProfilePicker />);
    expect(PROFILE_CARDS).toHaveLength(5);
    for (const card of PROFILE_CARDS) {
      expect(screen.getByTestId(`profile-card-${card.id}`)).toBeInTheDocument();
      expect(screen.getByText(card.name)).toBeInTheDocument();
    }
  });

  it("highlights the active profile from the deep store as initial selection", () => {
    render(<EngineerProfilePicker />);
    const activeCard = screen.getByTestId("profile-card-modern_pop_polish");
    expect(activeCard).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a card stages selection (visual highlight)", () => {
    render(<EngineerProfilePicker />);
    const metal = screen.getByTestId("profile-card-metal_wall");
    fireEvent.click(metal);
    expect(metal).toHaveAttribute("aria-pressed", "true");
  });

  it("Apply button is disabled when the staged profile equals the active one", () => {
    render(<EngineerProfilePicker />);
    expect(screen.getByTestId("profile-apply-button")).toBeDisabled();
  });

  it("Apply button enables once a different profile is staged, and fires onApply", () => {
    const onApply = vi.fn();
    render(<EngineerProfilePicker onApply={onApply} />);
    fireEvent.click(screen.getByTestId("profile-card-indie_warmth"));
    const apply = screen.getByTestId("profile-apply-button");
    expect(apply).not.toBeDisabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith("indie_warmth");
  });
});
