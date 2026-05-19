"use client";

import type { ReactElement, ReactNode } from "react";
import { Library, Sparkles, Scissors, Upload } from "lucide-react";

export type ShellScreen = "library" | "album" | "stems" | "upload" | "master";

export interface SidebarTrack {
  id: string;
  title: string;
}

export interface SidebarProps {
  activeScreen: ShellScreen;
  onSelect: (screen: ShellScreen) => void;
  tracks?: SidebarTrack[];
  activeTrackId?: string | null;
  onSelectTrack?: (id: string) => void;
}

interface NavSpec {
  screen: ShellScreen;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavSpec[] = [
  { screen: "library", label: "Library", icon: <Library className="h-3.5 w-3.5" /> },
  { screen: "album", label: "Smart Master Album", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { screen: "stems", label: "Smart Split", icon: <Scissors className="h-3.5 w-3.5" /> },
  { screen: "upload", label: "Import", icon: <Upload className="h-3.5 w-3.5" /> },
];

export function Sidebar({
  activeScreen,
  onSelect,
  tracks,
  activeTrackId,
  onSelectTrack,
}: SidebarProps): ReactElement {
  return (
    <nav
      aria-label="Primary"
      data-testid="sidebar"
      className="flex w-60 flex-shrink-0 flex-col overflow-hidden border-r border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)] backdrop-blur-xl"
    >
      <NavGroup label="Aurialis">
        {NAV_ITEMS.map((item) => {
          const active = activeScreen === item.screen;
          return (
            <NavItem
              key={item.screen}
              active={active}
              icon={item.icon}
              onClick={() => onSelect(item.screen)}
            >
              {item.label}
            </NavItem>
          );
        })}
      </NavGroup>

      {tracks && tracks.length > 0 ? (
        <NavGroup label="Tracks">
          {tracks.map((t) => (
            <NavTrack
              key={t.id}
              title={t.title}
              active={activeTrackId === t.id}
              onClick={() => onSelectTrack?.(t.id)}
            />
          ))}
        </NavGroup>
      ) : null}

      <div className="flex-1" />
    </nav>
  );
}

interface NavGroupProps {
  label: string;
  children: ReactNode;
}

function NavGroup({ label, children }: NavGroupProps): ReactElement {
  return (
    <section className="px-3 pb-3 pt-4">
      <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
        {label}
      </div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

interface NavItemProps {
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}

function NavItem({ active, icon, onClick, children }: NavItemProps): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] " +
          (active
            ? "bg-[rgba(10,132,255,0.18)] text-[#0a84ff]"
            : "text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.05)]")
        }
      >
        <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
        <span className="truncate">{children}</span>
      </button>
    </li>
  );
}

interface NavTrackProps {
  title: string;
  active: boolean;
  onClick: () => void;
}

function NavTrack({ title, active, onClick }: NavTrackProps): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] " +
          (active
            ? "bg-[rgba(10,132,255,0.18)] text-[#0a84ff]"
            : "text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.05)]")
        }
      >
        <span className="truncate">{title}</span>
      </button>
    </li>
  );
}
