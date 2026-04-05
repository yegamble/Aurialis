"use client";

import { ChannelStrip } from "./ChannelStrip";
import type { StemTrack, StemChannelParams } from "@/types/mixer";

interface StemListProps {
  stems: StemTrack[];
  onParamChange: (stemId: string, key: keyof StemChannelParams, value: StemChannelParams[keyof StemChannelParams]) => void;
  onMuteToggle: (stemId: string) => void;
  onSoloToggle: (stemId: string) => void;
  isEffectivelyMuted: (stemId: string) => boolean;
}

export function StemList({
  stems,
  onParamChange,
  onMuteToggle,
  onSoloToggle,
  isEffectivelyMuted,
}: StemListProps) {
  if (stems.length === 0) {
    return (
      <div className="text-[rgba(255,255,255,0.3)] text-sm text-center py-8">
        No stems loaded
      </div>
    );
  }

  return (
    <div
      data-testid="stem-list-container"
      className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-[rgba(255,255,255,0.1)]"
    >
      {stems.map((stem) => (
        <ChannelStrip
          key={stem.id}
          stemId={stem.id}
          name={stem.name}
          color={stem.color}
          classification={stem.classification}
          params={stem.channelParams}
          onParamChange={onParamChange}
          onMuteToggle={onMuteToggle}
          onSoloToggle={onSoloToggle}
          isEffectivelyMuted={isEffectivelyMuted(stem.id)}
        />
      ))}
    </div>
  );
}
