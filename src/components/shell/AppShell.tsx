"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Sidebar, type ShellScreen, type SidebarTrack } from "./Sidebar";

/**
 * Shell layout variants:
 * - `default`: children render inside a single-column `overflow-y-auto` scroll
 *   wrapper (used by `/` and `/album`).
 * - `workspace`: children render directly in the flex row next to the Sidebar as
 *   a full-height flex column (no imposed scroll wrapper). Used by the mastering
 *   and mixer workspaces, which supply their own toolbar row + horizontal
 *   main/inspector layout inside the region.
 */
export type AppShellVariant = "default" | "workspace";

export interface AppShellProps {
  activeScreen: ShellScreen;
  onSelect: (screen: ShellScreen) => void;
  tracks?: SidebarTrack[];
  activeTrackId?: string | null;
  onSelectTrack?: (id: string) => void;
  proMode?: boolean;
  onProModeChange?: (next: boolean) => void;
  variant?: AppShellVariant;
  children: ReactNode;
}

export function AppShell({
  activeScreen,
  onSelect,
  tracks,
  activeTrackId,
  onSelectTrack,
  proMode,
  onProModeChange,
  variant = "default",
  children,
}: AppShellProps): ReactElement {
  // On phones/tablets the sidebar collapses into an off-canvas drawer so the
  // main workspace gets the full viewport width. Desktop (lg+) is unaffected:
  // the drawer wrapper becomes `display: contents`, so the Sidebar renders as a
  // direct static flex child exactly as before (pixel-identical).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  const handleSelect = (screen: ShellScreen): void => {
    setMobileNavOpen(false);
    onSelect(screen);
  };

  const handleSelectTrack = onSelectTrack
    ? (id: string): void => {
        setMobileNavOpen(false);
        onSelectTrack(id);
      }
    : undefined;

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Mobile-only top bar: the primary-nav entry point on phones/tablets.
          Hidden from lg up, where the static sidebar is always present. */}
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.08)] bg-[rgba(20,20,22,0.9)] px-3 py-2 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          data-testid="mobile-nav-toggle"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.06)]"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-semibold tracking-tight text-white">
          Aurialis
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Drawer wrapper: fixed off-canvas panel on mobile, `display: contents`
            on lg (so the Sidebar is a plain static flex child). */}
        <div
          className={
            "fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 lg:transition-none lg:contents " +
            (mobileNavOpen ? "translate-x-0" : "-translate-x-full")
          }
        >
          <Sidebar
            activeScreen={activeScreen}
            onSelect={handleSelect}
            tracks={tracks}
            activeTrackId={activeTrackId}
            onSelectTrack={handleSelectTrack}
            proMode={proMode}
            onProModeChange={onProModeChange}
          />
        </div>

        {/* Scrim behind the drawer (mobile only). */}
        {mobileNavOpen ? (
          <div
            data-testid="mobile-nav-scrim"
            aria-hidden
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        ) : null}

        {variant === "workspace" ? (
          <div role="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        ) : (
          <main role="main" className="min-w-0 flex-1 overflow-y-auto">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
