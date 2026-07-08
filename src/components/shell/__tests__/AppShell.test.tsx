import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  describe("mobile navigation drawer", () => {
    it("exposes a reachable mobile nav toggle and starts closed", () => {
      render(
        <AppShell activeScreen="library" onSelect={vi.fn()}>
          <div />
        </AppShell>,
      );
      const toggle = screen.getByTestId("mobile-nav-toggle");
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      // Drawer wrapper is off-canvas until opened.
      const wrapper = screen.getByTestId("sidebar").parentElement!;
      expect(wrapper.className).toContain("-translate-x-full");
      expect(screen.queryByTestId("mobile-nav-scrim")).not.toBeInTheDocument();
    });

    it("opens the drawer (and shows a scrim) when the toggle is pressed", () => {
      render(
        <AppShell activeScreen="library" onSelect={vi.fn()}>
          <div />
        </AppShell>,
      );
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
      const wrapper = screen.getByTestId("sidebar").parentElement!;
      expect(wrapper.className).toContain("translate-x-0");
      expect(screen.getByTestId("mobile-nav-scrim")).toBeInTheDocument();
    });

    it("closes the drawer after selecting a nav item", () => {
      const onSelect = vi.fn();
      render(
        <AppShell activeScreen="library" onSelect={onSelect}>
          <div />
        </AppShell>,
      );
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
      fireEvent.click(screen.getByRole("button", { name: /Smart Split/i }));
      expect(onSelect).toHaveBeenCalledWith("stems");
      expect(screen.queryByTestId("mobile-nav-scrim")).not.toBeInTheDocument();
    });

    it("closes the drawer when the scrim is clicked", () => {
      render(
        <AppShell activeScreen="library" onSelect={vi.fn()}>
          <div />
        </AppShell>,
      );
      fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
      fireEvent.click(screen.getByTestId("mobile-nav-scrim"));
      expect(screen.queryByTestId("mobile-nav-scrim")).not.toBeInTheDocument();
    });
  });
});
