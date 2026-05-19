"use client";

import type { ReactElement } from "react";

export interface WindowChromeProps {
  title?: string;
}

const LIGHTS = [
  { id: "close", color: "#ff5f57", label: "Close" },
  { id: "minimize", color: "#febc2e", label: "Minimize" },
  { id: "maximize", color: "#28c840", label: "Maximize" },
] as const;

export function WindowChrome({ title = "Aurialis" }: WindowChromeProps): ReactElement {
  return (
    <header
      role="banner"
      data-testid="window-chrome"
      className="flex h-9 flex-shrink-0 items-center gap-3 border-b border-[rgba(0,0,0,0.6)] bg-gradient-to-b from-[#2a2a2c] to-[#1f1f21] px-3.5"
    >
      <div className="flex gap-2">
        {LIGHTS.map((l) => (
          <span
            key={l.id}
            data-testid={`window-traffic-${l.id}`}
            aria-label={l.label}
            className="h-3 w-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.15)]"
            style={{ background: l.color }}
          />
        ))}
      </div>
      <div
        data-testid="window-chrome-title"
        className="flex flex-1 justify-center text-xs font-medium text-[rgba(255,255,255,0.6)]"
      >
        {title}
      </div>
      <div className="w-[60px]" aria-hidden />
    </header>
  );
}
