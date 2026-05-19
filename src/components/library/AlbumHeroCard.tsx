"use client";

import type { ReactElement } from "react";
import { Sparkles } from "lucide-react";

export interface AlbumHeroCardProps {
  title: string;
  artist: string;
  trackCount: number;
  avgLufs?: number;
  onClick?: () => void;
}

function formatLufs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `−${abs}` : value > 0 ? `+${abs}` : abs;
}

export function AlbumHeroCard({
  title,
  artist,
  trackCount,
  avgLufs,
  onClick,
}: AlbumHeroCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="album-hero-card"
      className="grid w-full grid-cols-[140px_1fr_auto] items-center gap-[18px] rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(28,28,30,0.8)] p-[18px] text-left transition-colors hover:border-[rgba(10,132,255,0.5)]"
    >
      <div className="flex h-[140px] w-[140px] items-center justify-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[#7b1d4d] to-[#1b0612]">
        <Sparkles className="h-8 w-8 text-white/60" />
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
          {`Album · ${trackCount} ${trackCount === 1 ? "track" : "tracks"}`}
        </div>
        <div className="truncate text-[22px] font-semibold tracking-tight text-white">{title}</div>
        <div className="mt-0.5 truncate text-[13px] text-[rgba(255,255,255,0.6)]">{artist}</div>
        <div className="mt-3.5 flex items-center gap-3.5">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.45)]">
              Avg LUFS
            </div>
            <div
              data-testid="album-avg-lufs"
              className="text-sm font-medium tabular-nums text-white"
            >
              {formatLufs(avgLufs)}
            </div>
          </div>
        </div>
      </div>
      <span aria-hidden className="text-[rgba(255,255,255,0.4)]">
        ›
      </span>
    </button>
  );
}
