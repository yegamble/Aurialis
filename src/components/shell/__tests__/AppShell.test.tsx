import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../AppShell";

describe("AppShell", () => {
  it("renders sidebar nav and main content", () => {
    render(
      <AppShell activeScreen="library" onSelect={vi.fn()}>
        <p data-testid="child-content">hello</p>
      </AppShell>,
    );
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

  describe("workspace variant", () => {
    it("keeps app-shell, sidebar and a role='main' landmark", () => {
      render(
        <AppShell activeScreen="master" onSelect={vi.fn()} variant="workspace">
          <div data-testid="child-content">workspace</div>
        </AppShell>,
      );
      expect(screen.getByTestId("app-shell")).toBeInTheDocument();
      expect(screen.getByTestId("sidebar")).toBeInTheDocument();
      expect(screen.getByRole("main")).toBeInTheDocument();
    });

    it("renders children directly in a full-height flex region (no single-column scroll wrapper)", () => {
      render(
        <AppShell activeScreen="master" onSelect={vi.fn()} variant="workspace">
          <div data-testid="child-content">workspace</div>
        </AppShell>,
      );
      const main = screen.getByRole("main");
      // Workspace children own their own layout: the shell must not impose the
      // default single-column `overflow-y-auto` scroll wrapper.
      expect(main.className).not.toContain("overflow-y-auto");
      expect(main.className).toContain("flex-col");
      expect(main).toContainElement(screen.getByTestId("child-content"));
    });

    it("renders the sidebar unconditionally (matches / and /album)", () => {
      render(
        <AppShell activeScreen="stems" onSelect={vi.fn()} variant="workspace">
          <div />
        </AppShell>,
      );
      expect(screen.getByRole("navigation")).toBeInTheDocument();
    });
  });
});
