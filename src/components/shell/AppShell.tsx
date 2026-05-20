"use client";

import type { ReactElement, ReactNode } from "react";
import { WindowChrome } from "./WindowChrome";
import { Sidebar, type ShellScreen, type SidebarTrack } from "./Sidebar";

export interface AppShellProps {
  activeScreen: ShellScreen;
  onSelect: (screen: ShellScreen) => void;
  tracks?: SidebarTrack[];
  activeTrackId?: string | null;
  onSelectTrack?: (id: string) => void;
  proMode?: boolean;
  onProModeChange?: (next: boolean) => void;
  title?: string;
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
  title,
  children,
}: AppShellProps): ReactElement {
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground"
    >
      <WindowChrome title={title} />
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
        <main role="main" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
