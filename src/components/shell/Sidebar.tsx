"use client";

import type { ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Library, Sparkles, Scissors, Upload, Search } from "lucide-react";

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
  proMode?: boolean;
  onProModeChange?: (next: boolean) => void;
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
  proMode,
  onProModeChange,
}: SidebarProps): ReactElement {
  const showProToggle = proMode !== undefined && onProModeChange !== undefined;
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredTracks = useMemo(() => {
    if (!tracks) return tracks;
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => t.title.toLowerCase().includes(q));
  }, [tracks, query]);

  return (
    <nav
      aria-label="Primary"
      data-testid="sidebar"
      className="flex w-60 flex-shrink-0 flex-col overflow-hidden border-r border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.6)] backdrop-blur-xl"
    >
      <div className="px-3 pb-1 pt-3.5">
        <SearchBar ref={searchRef} value={query} onChange={setQuery} />
      </div>

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

      {filteredTracks && filteredTracks.length > 0 ? (
        <NavGroup label="Tracks">
          {filteredTracks.map((t) => (
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

      {showProToggle ? (
        <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-3">
          <button
            type="button"
            data-testid="pro-mode-toggle"
            onClick={() => onProModeChange!(!proMode)}
            aria-pressed={proMode}
            className={
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] " +
              (proMode
                ? "bg-[rgba(10,132,255,0.18)] text-[#0a84ff]"
                : "text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.05)]")
            }
          >
            <span>Pro Mode</span>
            <span
              aria-hidden
              className={
                "relative inline-block h-[18px] w-[30px] rounded-full transition-colors " +
                (proMode ? "bg-[#0a84ff]" : "bg-[rgba(255,255,255,0.16)]")
              }
            >
              <span
                className={
                  "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all " +
                  (proMode ? "left-[14px]" : "left-[2px]")
                }
              />
            </span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}

interface SearchBarProps {
  value: string;
  onChange: (next: string) => void;
  ref?: React.Ref<HTMLInputElement>;
}

function SearchBar({ value, onChange, ref }: SearchBarProps): ReactElement {
  return (
    <div
      data-testid="sidebar-search"
      className="flex items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.06)] px-2.5 py-1.5 text-[rgba(255,255,255,0.45)]"
    >
      <Search className="h-3 w-3 flex-shrink-0" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search library"
        aria-label="Search library"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-[rgba(255,255,255,0.85)] placeholder:text-[rgba(255,255,255,0.45)] focus:outline-none"
      />
      <kbd
        aria-hidden
        className="rounded-[3px] bg-[rgba(255,255,255,0.08)] px-1 py-px text-[9px] font-normal text-[rgba(255,255,255,0.45)]"
      >
        ⌘K
      </kbd>
    </div>
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
