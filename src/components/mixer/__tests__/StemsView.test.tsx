import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StemsView } from "../StemsView";

// Keep the unified shell deterministic.
vi.mock("@/hooks/use-is-lg-viewport", () => ({
  useIsLgViewport: () => true,
}));

// next/navigation's useRouter needs the App Router context, absent under RTL.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe("StemsView", () => {
  it("renders the unified shell + the stem-upload landing when no stems are loaded", () => {
    render(<StemsView />);
    // Direction A: the nav Sidebar is present (Smart Split is this screen).
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Smart Split/i }),
    ).toBeInTheDocument();
    // No stems yet → the upload dropzone is shown.
    expect(screen.getByText(/Drop audio files or ZIP/i)).toBeInTheDocument();
  });

  it("composes the shared AppShell workspace (mixer content lives inside app-shell)", () => {
    render(<StemsView />);
    const shell = screen.getByTestId("app-shell");
    expect(shell).toBeInTheDocument();
    // Sidebar + Pro Mode toggle thread through the shell.
    expect(within(shell).getByTestId("sidebar")).toBeInTheDocument();
    expect(within(shell).getByTestId("pro-mode-toggle")).toBeInTheDocument();
    // The mixer workspace renders inside the shell (a single role="main" region).
    expect(within(shell).getByRole("main")).toBeInTheDocument();
    expect(
      within(shell).getByText(/Drop audio files or ZIP/i),
    ).toBeInTheDocument();
  });
});
