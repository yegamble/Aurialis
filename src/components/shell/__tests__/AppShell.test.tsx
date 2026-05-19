import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../AppShell";

describe("AppShell", () => {
  it("renders window chrome, sidebar nav, and main content", () => {
    render(
      <AppShell activeScreen="library" onSelect={vi.fn()}>
        <p data-testid="child-content">hello</p>
      </AppShell>,
    );
    expect(screen.getByTestId("window-chrome-title")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("forwards activeScreen to the sidebar", () => {
    render(
      <AppShell activeScreen="album" onSelect={vi.fn()}>
        <div />
      </AppShell>,
    );
    const album = screen.getByRole("button", { name: /Smart Master Album/i });
    expect(album).toHaveAttribute("aria-current", "page");
  });

  it("exposes data-testid='app-shell' on the root", () => {
    render(
      <AppShell activeScreen="library" onSelect={vi.fn()}>
        <div />
      </AppShell>,
    );
    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });
});
