import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { DeepMastering } from "../DeepMastering";
import { useDeepStore } from "@/lib/stores/deep-store";

// Mock the lg-viewport hook so tests run deterministically.
vi.mock("@/hooks/use-is-lg-viewport", () => ({
  useIsLgViewport: () => true,
}));

describe("DeepMastering (T12 — panel skeleton)", () => {
  beforeEach(() => {
    act(() => {
      useDeepStore.getState().reset();
    });
  });

  it("renders the panel container with the deep-mastering test id", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-mastering-panel")).toBeInTheDocument();
  });

  it("renders the active profile name from the deep store", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-current-profile")).toHaveTextContent(
      "modern_pop_polish",
    );
  });

  it("renders an Analyze button (disabled in T12 — wired up in T17)", () => {
    render(<DeepMastering />);
    const button = screen.getByTestId("deep-analyze-button");
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("reflects deep-store status in the status line", () => {
    render(<DeepMastering />);
    expect(screen.getByTestId("deep-status").textContent).toContain("idle");
    act(() => {
      useDeepStore.setState({ status: "analyzing", subStatus: "sections" });
    });
    expect(screen.getByTestId("deep-status").textContent).toContain(
      "analyzing",
    );
    expect(screen.getByTestId("deep-status").textContent).toContain(
      "sections",
    );
  });

  it("A/B toggle (T16) flips deepStore.scriptActive", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<DeepMastering />);
    const toggle = screen.getByTestId("deep-script-active-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(useDeepStore.getState().scriptActive).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(useDeepStore.getState().scriptActive).toBe(true);
  });
});

describe("DeepMastering (mobile fallback)", () => {
  it("renders desktop banner when viewport is < lg", () => {
    vi.resetModules();
    vi.doMock("@/hooks/use-is-lg-viewport", () => ({
      useIsLgViewport: () => false,
    }));
    return import("../DeepMastering").then(({ DeepMastering: MobileDeep }) => {
      render(<MobileDeep />);
      expect(
        screen.getByText(/Deep mode requires a larger screen/i),
      ).toBeInTheDocument();
    });
  });
});
