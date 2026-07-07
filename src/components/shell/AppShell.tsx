"use client";

import type { ReactElement, ReactNode } from "react";
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
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground"
    >
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeScreen={activeScreen}
          onSelect={onSelect}
          tracks={tracks}
          activeTrackId={activeTrackId}
          onSelectTrack={onSelectTrack}
          proMode={proMode}
          onProModeChange={onProModeChange}
        />
        {variant === "workspace" ? (
          <div role="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </div>
        ) : (
          <main role="main" className="flex-1 overflow-y-auto">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
